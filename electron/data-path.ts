import fs from 'node:fs'
import pathPosix from 'node:path/posix'
import pathWin from 'node:path/win32'

export type DataLocation = {
  portableDir?: string
  appImage?: string
  packaged: boolean
  platform: string
  execPath: string
  appPath: string
}

const DATA_FOLDER = 'MeetLocal-data'

function pathsFor(platform: string) {
  return platform === 'win32' ? pathWin : pathPosix
}

/** Folder that contains the app the person launched, not a temporary unpack directory. */
export function appHomeDirectory(input: DataLocation): string {
  const path = pathsFor(input.platform)
  if (input.portableDir) return input.portableDir
  if (input.appImage) return path.dirname(input.appImage)
  if (input.packaged && input.platform === 'darwin') {
    const bundle = path.resolve(input.execPath, '../../..')
    if (path.basename(bundle).endsWith('.app')) return path.dirname(bundle)
  }
  if (input.packaged) return path.dirname(input.execPath)
  return input.appPath
}

/**
 * Prefer a folder inside a Mac app bundle. A Windows exe and a Linux AppImage
 * are single files, so their data sits beside the file.
 */
export function dataDirectoryCandidates(input: DataLocation): string[] {
  const path = pathsFor(input.platform)
  const beside = path.join(appHomeDirectory(input), DATA_FOLDER)
  if (input.packaged && input.platform === 'darwin' && !input.portableDir && !input.appImage) {
    const bundle = path.resolve(input.execPath, '../../..')
    if (path.basename(bundle).endsWith('.app')) return [path.join(bundle, 'Contents', DATA_FOLDER), beside]
  }
  return [beside]
}

export function selectWritableDirectory(candidates: string[]): string {
  let lastError: unknown
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.accessSync(dir, fs.constants.W_OK)
      return dir
    } catch (error) {
      lastError = error
    }
  }
  const detail = lastError instanceof Error ? lastError.message : 'The folder is not writable.'
  throw new Error(`MeetLocal could not store its data with the app. ${detail}`)
}
