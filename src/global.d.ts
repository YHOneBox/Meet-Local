export type DesktopSource = {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string
  appIcon: string | null
}

export type UpdateProgress = { received: number; total: number }

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

export type MeetLocalApi = {
  isDesktop: true
  platform: string
  version: string
  getDesktopSources: () => Promise<DesktopSource[]>
  saveFile: (bytes: Uint8Array, filename: string) => Promise<{ canceled: boolean; filePath?: string }>
  checkForUpdate: () => Promise<UpdateInfo>
  downloadUpdate: () => Promise<{ filePath: string; fileName: string; version: string }>
  launchUpdate: () => Promise<void>
  revealUpdate: () => Promise<void>
  inspectCertificate: (pageUrl: string) => Promise<{ host: string; fingerprint: string; trusted: boolean }>
  trustCertificate: (host: string, fingerprint: string) => Promise<void>
  openHostedMeeting: (meetingId: string, hostSecret: string) => Promise<void>
  openLink: (pageUrl: string) => Promise<void>
  setCaptureIntent: (intent: { sourceId: string; audio: boolean } | null) => Promise<void>
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void
}

declare global {
  interface Window {
    meetlocal?: MeetLocalApi
  }
}

export {}
