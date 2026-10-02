import { app, contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('meetlocal', {
  isDesktop: true,
  platform: process.platform,
  version: app.getVersion(),
  getDesktopSources: () => ipcRenderer.invoke('desktop-sources'),
  saveFile: (bytes: Uint8Array, filename: string) => ipcRenderer.invoke('save-file', { bytes, filename }),
  checkForUpdate: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  launchUpdate: () => ipcRenderer.invoke('updates:launch'),
  revealUpdate: () => ipcRenderer.invoke('updates:reveal'),
  inspectCertificate: (pageUrl: string) => ipcRenderer.invoke('certificate:inspect', pageUrl),
  trustCertificate: (host: string, fingerprint: string) => ipcRenderer.invoke('certificate:trust', { host, fingerprint }),
  openHostedMeeting: (meetingId: string, hostSecret: string) => ipcRenderer.invoke('host:open', { meetingId, hostSecret }),
  openLink: (pageUrl: string) => ipcRenderer.invoke('shell:open', pageUrl),
  onUpdateProgress: (callback: (progress: { received: number; total: number }) => void) => {
    const listener = (_event: unknown, progress: { received: number; total: number }) => callback(progress)
    ipcRenderer.on('update-progress', listener)
    return () => ipcRenderer.removeListener('update-progress', listener)
  },
})
