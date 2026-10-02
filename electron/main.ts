import { app, BrowserWindow, Menu, desktopCapturer, dialog, ipcMain, session, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { startMeetServer } from './server'
import { checkForUpdate, downloadOfferedUpdate, launchOfferedUpdate, revealOfferedUpdate } from './updates'

const dev = process.env.MEETLOCAL_DEV === '1'

app.commandLine.appendSwitch(
  'disable-features',
  'WebRtcHideLocalIpsWithMdns,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights',
)
app.setAppUserModelId('com.meetlocal.app')

let mainWindow: BrowserWindow | null = null
let stopServer: (() => Promise<void>) | null = null

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

  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const subject = `${request.certificate.subjectName} ${request.certificate.issuerName}`
    const local = request.hostname === '127.0.0.1' || request.hostname === 'localhost'
    if (local || subject.includes('MeetLocal')) {
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
  const options = {
    defaultPath: payload.filename,
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
