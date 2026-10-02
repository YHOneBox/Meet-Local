import { app, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import {
  compareVersions,
  isAllowedDownloadHost,
  isReleaseAssetUrl,
  pickReleaseAsset,
  releasesApi,
  type ReleaseAsset,
} from '../shared/updates'

export type UpdateInfo = {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  name: string
  notes: string
  publishedAt: string
  htmlUrl: string
  assetName: string | null
  assetSize: number
  currentNotes: string
  currentNotesName: string
  message: string
}

type GithubAsset = { name?: string; browser_download_url?: string; size?: number }
type GithubRelease = {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  assets?: GithubAsset[]
}

export type DownloadProgress = { received: number; total: number }

const notesFile = () => path.join(app.getPath('userData'), 'release-notes.json')
let pendingAsset: { name: string; url: string; version: string } | null = null
let savedFile = ''
let savedVersion = ''

function emptyInfo(currentVersion: string, message = ''): UpdateInfo {
  return {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    name: '',
    notes: '',
    publishedAt: '',
    htmlUrl: '',
    assetName: null,
    assetSize: 0,
    currentNotes: '',
    currentNotesName: '',
    message,
  }
}

async function readNotesCache(): Promise<Record<string, { name: string; notes: string }>> {
  try {
    const parsed = JSON.parse(await fs.readFile(notesFile(), 'utf8')) as Record<string, { name?: string; notes?: string }>
    const notes: Record<string, { name: string; notes: string }> = {}
    for (const [version, entry] of Object.entries(parsed)) {
      if (entry && typeof entry.notes === 'string') notes[version] = { name: entry.name || version, notes: entry.notes }
    }
    return notes
  } catch {
    return {}
  }
}

async function rememberNotes(version: string, name: string, notes: string) {
  if (!version || !notes) return
  const cache = await readNotesCache()
  cache[version] = { name, notes }
  await fs.mkdir(path.dirname(notesFile()), { recursive: true })
  await fs.writeFile(notesFile(), JSON.stringify(cache))
}

function request(url: string, headers: Record<string, string>): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (!isAllowedDownloadHost(url) && !url.startsWith('https://api.github.com/')) {
      reject(new Error('That download address is not a MeetLocal release.'))
      return
    }
    const requestUrl = new URL(url)
    const client = requestUrl.protocol === 'https:' ? https : http
    const req = client.request(
      requestUrl,
      {
        method: 'GET',
        headers: { 'User-Agent': `MeetLocal/${app.getVersion()}`, Accept: 'application/vnd.github+json', ...headers },
      },
      (response) => resolve(response),
    )
    req.setTimeout(20000, () => req.destroy(new Error('The update check timed out.')))
    req.on('error', reject)
    req.end()
  })
}

async function readJson(url: string): Promise<GithubRelease | null> {
  const response = await request(url, {})
  if (response.statusCode === 404) {
    response.resume()
    return null
  }
  if (response.statusCode === 403) {
    response.resume()
    throw new Error('GitHub asked MeetLocal to wait before checking again.')
  }
  if (!response.statusCode || response.statusCode >= 400) {
    response.resume()
    throw new Error('GitHub did not return the release list.')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 2_000_000) throw new Error('The release description was too large.')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as GithubRelease
}

function assetsFrom(release: GithubRelease): ReleaseAsset[] {
  return (release.assets || [])
    .map((asset) => ({
      name: String(asset.name || ''),
      url: String(asset.browser_download_url || ''),
      size: Number(asset.size || 0),
    }))
    .filter((asset) => asset.name && isReleaseAssetUrl(asset.url))
}

function applyRelease(info: UpdateInfo, release: GithubRelease, platform: string, arch: string, update: boolean) {
  const version = String(release.tag_name || '').replace(/^v/i, '')
  const asset = pickReleaseAsset(assetsFrom(release), version, platform, arch)
  info.latestVersion = version || null
  info.name = release.name || `MeetLocal ${version}`
  info.notes = release.body || ''
  info.publishedAt = release.published_at || ''
  info.htmlUrl = release.html_url || ''
  info.assetName = asset?.name ?? null
  info.assetSize = asset?.size ?? 0
  info.updateAvailable = update && Boolean(asset)
  if (update && asset) pendingAsset = { name: asset.name, url: asset.url, version }
  if (update && !asset) info.message = 'A newer release exists, but not for this computer.'
}

export async function checkForUpdate(platform = process.platform, arch = process.arch): Promise<UpdateInfo> {
  const currentVersion = app.getVersion()
  const cache = await readNotesCache()
  const info = emptyInfo(currentVersion)
  pendingAsset = null
  const cached = cache[currentVersion]
  if (cached) {
    info.currentNotes = cached.notes
    info.currentNotesName = cached.name
  }
  try {
    const latest = await readJson(releasesApi('latest'))
    if (!latest?.tag_name) return info
    const latestVersion = latest.tag_name.replace(/^v/i, '')
    const newer = compareVersions(currentVersion, latestVersion) < 0
    if (newer) {
      applyRelease(info, latest, platform, arch, true)
      await rememberNotes(latestVersion, info.name, info.notes)
      if (!info.currentNotes) {
        const tagged = await readJson(releasesApi('tag', `v${currentVersion}`)).catch(() => null)
        if (tagged?.body) {
          info.currentNotes = tagged.body
          info.currentNotesName = tagged.name || `MeetLocal ${currentVersion}`
          await rememberNotes(currentVersion, info.currentNotesName, info.currentNotes)
        }
      }
    } else if (compareVersions(currentVersion, latestVersion) === 0) {
      applyRelease(info, latest, platform, arch, false)
      info.currentNotes = info.notes
      info.currentNotesName = info.name
      info.updateAvailable = false
      await rememberNotes(currentVersion, info.name, info.notes)
    } else {
      const tagged = await readJson(releasesApi('tag', `v${currentVersion}`)).catch(() => null)
      if (tagged?.body) {
        info.currentNotes = tagged.body
        info.currentNotesName = tagged.name || `MeetLocal ${currentVersion}`
        await rememberNotes(currentVersion, info.currentNotesName, info.currentNotes)
      }
    }
    return info
  } catch (error) {
    info.message = error instanceof Error ? error.message : 'Could not check for updates.'
    return info
  }
}

async function saveDirectory(): Promise<string> {
  const candidates = [
    process.env.PORTABLE_EXECUTABLE_DIR,
    process.env.APPIMAGE ? path.dirname(process.env.APPIMAGE) : '',
    app.isPackaged ? path.dirname(process.execPath) : '',
    app.getPath('downloads'),
  ].filter((dir): dir is string => Boolean(dir))
  for (const dir of candidates) {
    try {
      await fs.access(dir, fsConstants.W_OK)
      return dir
    } catch {
      /* try the next folder */
    }
  }
  return app.getPath('downloads')
}

async function follow(url: string, hops = 0): Promise<http.IncomingMessage> {
  if (hops > 5) throw new Error('The download was redirected too many times.')
  if (hops === 0 && !isReleaseAssetUrl(url)) throw new Error('That download address is not a MeetLocal release.')
  if (hops > 0 && !isAllowedDownloadHost(url)) throw new Error('The download left GitHub.')
  const response = await request(url, { Accept: 'application/octet-stream' })
  const status = response.statusCode || 0
  if (status >= 300 && status < 400 && response.headers.location) {
    response.resume()
    const next = new URL(response.headers.location, url).toString()
    return follow(next, hops + 1)
  }
  if (status >= 400) {
    response.resume()
    throw new Error('The release file could not be downloaded.')
  }
  return response
}

export async function downloadUpdate(assetName: string, assetUrl: string, onProgress: (progress: DownloadProgress) => void): Promise<string> {
  if (!isReleaseAssetUrl(assetUrl)) throw new Error('That download address is not a MeetLocal release.')
  const safeName = path.basename(assetName)
  if (safeName !== assetName || !safeName.startsWith('MeetLocal-')) throw new Error('The release file name is not valid.')
  const directory = await saveDirectory()
  const destination = path.join(directory, safeName)
  const partial = `${destination}.partial`
  const response = await follow(assetUrl)
  const total = Number(response.headers['content-length'] || 0)
  const file = await fs.open(partial, 'w')
  let received = 0
  try {
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      received += buffer.length
      if (received > 1024 * 1024 * 1024) throw new Error('The download is larger than expected.')
      await file.write(buffer)
      onProgress({ received, total })
    }
  } catch (error) {
    await file.close()
    await fs.rm(partial, { force: true })
    throw error
  }
  await file.close()
  await fs.rm(destination, { force: true })
  await fs.rename(partial, destination)
  if (process.platform !== 'win32') await fs.chmod(destination, 0o755).catch(() => undefined)
  return destination
}

export async function downloadOfferedUpdate(onProgress: (progress: DownloadProgress) => void) {
  const offer = pendingAsset
  if (!offer) throw new Error('No update is available.')
  const filePath = await downloadUpdate(offer.name, offer.url, onProgress)
  savedFile = filePath
  savedVersion = offer.version
  return { filePath, fileName: offer.name, version: offer.version }
}

function spawnDetached(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.unref()
  return child
}

export async function launchDownloaded(filePath: string, version: string) {
  const resolved = path.resolve(filePath)
  const folder = path.resolve(await saveDirectory())
  const relative = path.relative(folder, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('The update is not in the downloads folder.')
  await fs.access(resolved)
  const extension = path.extname(resolved).toLowerCase()
  if (extension === '.zip') {
    const dest = resolved.replace(/\.zip$/i, '')
    await fs.rm(dest, { recursive: true, force: true })
    await new Promise<void>((resolve, reject) => {
      const tool = process.platform === 'darwin' ? 'ditto' : 'unzip'
      const args = process.platform === 'darwin' ? ['-xk', resolved, dest] : ['-o', resolved, '-d', dest]
      const child = spawn(tool, args, { stdio: 'ignore' })
      child.on('error', reject)
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('The Mac archive could not be opened.'))))
    })
    const entries = await fs.readdir(dest)
    const bundle = entries.find((entry) => entry.endsWith('.app'))
    if (!bundle) throw new Error('The archive did not contain the app.')
    const versioned = `MeetLocal-${version}.app`
    const source = path.join(dest, bundle)
    const target = path.join(dest, versioned)
    if (bundle !== versioned) await fs.rename(source, target)
    spawnDetached('open', ['-n', target])
  } else if (extension === '.appimage') {
    await fs.chmod(resolved, 0o755)
    spawnDetached(resolved, [])
  } else {
    spawnDetached(resolved, [])
  }
  app.releaseSingleInstanceLock()
  setTimeout(() => app.quit(), 400)
}

export function revealDownloaded(filePath: string) {
  shell.showItemInFolder(path.resolve(filePath))
}

export async function launchOfferedUpdate() {
  if (!savedFile || !savedVersion) throw new Error('Download the update first.')
  await launchDownloaded(savedFile, savedVersion)
}

export function revealOfferedUpdate() {
  if (!savedFile) throw new Error('Download the update first.')
  revealDownloaded(savedFile)
}
