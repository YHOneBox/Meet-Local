import { describe, expect, it } from 'vitest'
import { appHomeDirectory, dataDirectoryCandidates } from '../electron/data-path'

describe('app data location', () => {
  it('keeps Windows portable data beside the exe, not the temp unpack folder', () => {
    const input = {
      portableDir: 'D:\\Apps',
      packaged: true,
      platform: 'win32',
      execPath: 'C:\\Users\\me\\AppData\\Local\\Temp\\meetlocal\\MeetLocal.exe',
      appPath: 'C:\\Users\\me\\AppData\\Local\\Temp\\meetlocal\\resources\\app.asar',
    }
    expect(appHomeDirectory(input)).toBe('D:\\Apps')
    expect(dataDirectoryCandidates(input)).toEqual(['D:\\Apps\\MeetLocal-data'])
  })

  it('keeps Linux data beside the AppImage', () => {
    const input = {
      appImage: '/home/me/Apps/MeetLocal-1.0.1-linux-x64.AppImage',
      packaged: true,
      platform: 'linux',
      execPath: '/tmp/.mount_meet/MeetLocal',
      appPath: '/tmp/.mount_meet/resources/app.asar',
    }
    expect(dataDirectoryCandidates(input)).toEqual(['/home/me/Apps/MeetLocal-data'])
  })

  it('keeps Mac data inside the app bundle', () => {
    const input = {
      packaged: true,
      platform: 'darwin',
      execPath: '/Users/me/Apps/MeetLocal.app/Contents/MacOS/MeetLocal',
      appPath: '/Users/me/Apps/MeetLocal.app/Contents/Resources/app.asar',
    }
    expect(dataDirectoryCandidates(input)[0]).toBe('/Users/me/Apps/MeetLocal.app/Contents/MeetLocal-data')
    expect(dataDirectoryCandidates(input)[1]).toBe('/Users/me/Apps/MeetLocal-data')
  })
})
