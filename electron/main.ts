import { app, BrowserWindow, Menu, desktopCapturer, dialog, ipcMain, session, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { dataDirectoryCandidates, selectWritableDirectory } from './data-path'
import { startMeetServer } from './server'
import { fingerprintFromPem, isFingerprint, readPeerFingerprint } from './security'
import { checkForUpdate, downloadOfferedUpdate, launchOfferedUpdate, revealOfferedUpdate } from './updates'

const dev = process.env.MEETLOCAL_DEV === '1'
const dataDir = selectWritableDirectory(
  dataDirectoryCandidates({
    portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
    appImage: process.env.APPIMAGE,
    packaged: app.isPackaged,
    platform: process.platform,
    execPath: process.execPath,
    appPath: app.getAppPath(),
  }),
)
app.setPath('userData', dataDir)

app.commandLine.appendSwitch(
  'disable-features',
  'WebRtcHideLocalIpsWithMdns,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights',
)
app.setAppUserModelId('com.meetlocal.app')

let mainWindow: BrowserWindow | null = null
let stopServer: (() => Promise<void>) | null = null
const trustedCertificates = new Set<string>()

function trustKey(host: string, fingerprint: string) {
  return `${host.toLowerCase()}:${fingerprint}`
}

function installMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
  if (dev) template.push({ role: 'viewMenu' })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createWindow() {
  const root = path.join(__dirname, '..')
  const running = await startMeetServer({
    dev,
    projectRoot: root,
    staticDir: path.join(root, 'dist'),
  })
  stopServer = running.close
  trustedCertificates.add(trustKey('127.0.0.1', running.fingerprint))
  trustedCertificates.add(trustKey('localhost', running.fingerprint))

  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const fingerprint = fingerprintFromPem(request.certificate.data)
    const host = request.hostname.toLowerCase()
    if (isFingerprint(fingerprint) && trustedCertificates.has(trustKey(host, fingerprint))) {
      callback(0)
      return
    }
    callback(-3)
  })

  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    const allowed = new Set(['media', 'display-capture', 'fullscreen', 'pointerLock', 'mediaKeySystem'])
    callback(allowed.has(permission))
  })

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    if (!sources[0]) {
      callback({})
      return
    }
    callback({ video: sources[0] })
  })

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    title: 'MeetLocal',
    backgroundColor: '#f3efe6',
    autoHideMenuBar: true,
    icon: path.join(root, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  await mainWindow.loadURL(`https://127.0.0.1:${running.port}/`)
  if (dev) mainWindow.webContents.openDevTools({ mode: 'detach' })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 360, height: 202 },
    fetchWindowIcons: true,
  })
  return sources.slice(0, 80).map((source) => ({
    id: source.id,
    name: source.name,
    kind: source.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: source.thumbnail.toDataURL(),
    appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
  }))
})

ipcMain.handle('save-file', async (_event, payload: { bytes: Uint8Array; filename: string }) => {
  const recordings = path.join(app.getPath('userData'), 'recordings')
  await fs.mkdir(recordings, { recursive: true })
  const filename = path.basename(String(payload.filename || 'meeting.webm')).replace(/[^\w.-]+/g, '_') || 'meeting.webm'
  const options = {
    defaultPath: path.join(recordings, filename),
    filters: [{ name: 'WebM video', extensions: ['webm'] }],
  }
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { canceled: true }
  await fs.writeFile(result.filePath, Buffer.from(payload.bytes))
  return { canceled: false, filePath: result.filePath }
})

ipcMain.handle('updates:check', () => checkForUpdate())

ipcMain.handle('updates:download', async (event) => {
  return downloadOfferedUpdate((progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('update-progress', progress)
  })
})

ipcMain.handle('updates:launch', () => launchOfferedUpdate())

ipcMain.handle('updates:reveal', () => {
  revealOfferedUpdate()
})

ipcMain.handle('certificate:inspect', async (_event, pageUrl: string) => {
  if (typeof pageUrl !== 'string' || pageUrl.length > 500) throw new Error('That meeting link is not valid.')
  const report = await readPeerFingerprint(pageUrl)
  return { ...report, trusted: trustedCertificates.has(trustKey(report.host, report.fingerprint)) }
})

ipcMain.handle('certificate:trust', (_event, payload: { host?: string; fingerprint?: string }) => {
  const host = String(payload?.host || '').toLowerCase().replace(/^\[|\]$/g, '')
  const fingerprint = String(payload?.fingerprint || '')
  if (!isFingerprint(fingerprint) || !/^[a-z0-9.:-]+$/i.test(host) || host.length > 253) {
    throw new Error('That certificate is not valid.')
  }
  trustedCertificates.add(trustKey(host, fingerprint))
})

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    installMenu()
    return createWindow()
  }).catch((error) => {
    console.error(error)
    dialog.showErrorBox('MeetLocal could not start', error instanceof Error ? error.message : String(error))
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    void stopServer?.()
  })
}
