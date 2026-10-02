import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

async function createMeeting(page: Page, options: { password?: boolean; waiting?: boolean; temp?: boolean }) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Meet on your own network.' })).toBeVisible()
  await page.getByTestId('meeting-title-input').fill(options.waiting ? 'Standup' : 'Ship review')
  await page.getByTestId('allow-stun').uncheck()
  if (options.password) {
    await page.getByTestId('password-toggle').check()
    await page.getByTestId('password-generate').click()
    await expect(page.getByTestId('password-input')).not.toHaveValue('')
  }
  if (options.waiting) await page.getByTestId('waiting-toggle').check()
  if (options.temp) await page.getByTestId('link-temp').click()
  else await page.getByTestId('link-network').click()
  await page.getByTestId('create-meeting').click()
  await expect(page.getByTestId('enter-meeting')).toBeVisible()
  const path = (await page.getByTestId('enter-meeting').getAttribute('data-path')) ?? ''
  const password = options.password ? await page.getByTestId('share-password').innerText() : ''
    if (await page.getByTestId('share-url').count()) {
    const url = await page.getByTestId('share-url').innerText()
    expect(url.startsWith('http://')).toBeTruthy()
    expect(url).toContain(options.temp ? '/t/' : '/m/')
    if (options.temp) expect(url).not.toMatch(/\d{1,3}(?:\.\d{1,3}){3}/)
  }
  expect(path.startsWith(options.temp ? '/t/' : '/m/')).toBeTruthy()
  return { path, password }
}

async function joinLobby(page: Page, name: string, password = '') {
  await page.getByTestId('prejoin-name').fill(name)
  if (password) await page.getByTestId('prejoin-password').fill(password)
  await page.getByTestId('prejoin-join').click()
}

test('password, media, chat, reactions, screen share, and recording', async ({ page }) => {
  const { path, password } = await createMeeting(page, { password: true, temp: true })
  expect(password.length).toBeGreaterThanOrEqual(18)
  await expect(page.getByTestId('fingerprint')).not.toHaveText('')
  await page.getByTestId('enter-meeting').click()
  await joinLobby(page, 'Alex Host')
  await expect(page.getByTestId('meeting-title')).toHaveText('Ship review')

  const guest = await page.context().newPage()
  await guest.goto(path)
  await joinLobby(guest, 'Blair Guest', password)
  await expect(page.getByTestId('tile').filter({ hasText: 'Blair Guest' })).toBeVisible()
  await expect(guest.getByTestId('tile').filter({ hasText: 'Alex Host' })).toBeVisible()
  await expect.poll(async () => guest.locator('[data-testid="remote-audio"]').count()).toBeGreaterThan(0)
  await expect
    .poll(async () =>
      guest
        .locator('[data-name="Alex Host"] video')
        .first()
        .evaluate((element: HTMLVideoElement) => element.videoWidth)
        .catch(() => 0),
    )
    .toBeGreaterThan(0)

  await page.getByTestId('control-mic').click()
  await expect(page.getByTestId('control-mic')).toHaveAttribute('aria-label', /Unmute/)
  await expect(guest.locator('[data-name="Alex Host"]')).toContainText('Muted')
  await page.getByTestId('control-cam').click()
  await expect(guest.locator('[data-name="Alex Host"] .avatar')).toBeVisible()

  await page.getByTestId('control-chat').click()
  await page.getByTestId('chat-input').fill('hello from host')
  await page.getByTestId('chat-send').click()
  await guest.getByTestId('control-chat').click()
  await expect(guest.getByTestId('chat-log')).toContainText('hello from host')

  await guest.getByTestId('control-react').hover()
  await guest.getByTestId('reaction-👍').click()
  await expect(page.getByTestId('reaction-fly').first()).toBeVisible()

  await guest.getByTestId('control-hand').click()
  await page.getByTestId('control-people').click()
  await expect(page.getByTestId('people-list')).toContainText('Hand raised')

  await page.getByTestId('control-more').click()
  await page.getByTestId('menu-speaker').click()
  await expect(page.getByTestId('speaker-stage')).toBeVisible()
  await page.getByTestId('control-more').click()
  await page.getByTestId('menu-settings').click()
  await expect(page.getByTestId('settings-mic')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByTestId('control-share').click()
  await expect(page.getByTestId('screen-picker')).toBeVisible()
  await page.getByTestId('share-choice-screen').click()
  await expect(page.getByTestId('presenting-banner')).toBeVisible()
  await expect(guest.getByTestId('screen-stage')).toBeVisible()

  await page.getByTestId('control-more').click()
  await page.getByTestId('menu-record').click()
  await expect(page.getByTestId('recording-indicator')).toBeVisible()
  await page.waitForTimeout(700)
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('control-more').click()
  await page.getByTestId('menu-record').click()
  expect((await downloadPromise).suggestedFilename()).toContain('.webm')
  await page.getByTestId('menu-lock').click()
  const stranger = await page.context().newPage()
  await stranger.goto(path)
  await joinLobby(stranger, 'Casey Stranger', password)
  await expect(stranger.getByTestId('meeting-ended')).toContainText(/locked/i)

  await page.getByTestId('control-leave').click()
  await page.getByTestId('confirm-end').click()
  await expect(page.getByRole('heading', { name: 'Meet on your own network.' })).toBeVisible()
  await guest.goto(path)
  await expect(guest.getByTestId('join-error')).toContainText(/ended/i)
  await guest.close()
  await stranger.close()
})

test('a wrong password does not open the meeting', async ({ page }) => {
  const { path } = await createMeeting(page, { password: true, temp: true })
  const guest = await page.context().newPage()
  await guest.goto(path)
  await joinLobby(guest, 'Blair Guest', 'not-the-password')
  await expect(guest.getByTestId('meeting-ended')).toContainText(/not right/i)
  await guest.close()
})

test('the host can admit someone from the waiting room', async ({ page }) => {
  const { path } = await createMeeting(page, { waiting: true })
  await page.getByTestId('enter-meeting').click()
  await joinLobby(page, 'Alex Host')
  const guest = await page.context().newPage()
  await guest.goto(path)
  await joinLobby(guest, 'Blair Guest')
  await expect(guest.getByTestId('waiting-room')).toBeVisible()
  await page.getByTestId('control-people').click()
  await page.getByTestId('admit').click()
  await expect(guest.getByTestId('control-mic')).toBeVisible()
  await expect(page.getByTestId('tile').filter({ hasText: 'Blair Guest' })).toBeVisible()
  await guest.close()
})

test('the desktop app can pick a whole screen or one window', async ({ page }) => {
  await page.addInitScript(() => {
    const thumbnail = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
    const desktop = window as Window & {
      meetlocal?: {
        isDesktop: true
        platform: string
        getDesktopSources: () => Promise<Array<{ id: string; name: string; kind: 'screen' | 'window'; thumbnail: string; appIcon: null }>>
        saveFile: () => Promise<{ canceled: boolean; filePath: string }>
      }
    }
    desktop.meetlocal = {
      isDesktop: true,
      platform: 'test',
      async getDesktopSources() {
        return [
          { id: 'screen:0:0', name: 'Entire screen', kind: 'screen', thumbnail, appIcon: null },
          { id: 'window:10:0', name: 'Notes', kind: 'window', thumbnail, appIcon: null },
        ]
      },
      async saveFile() {
        return { canceled: false, filePath: 'recording.webm' }
      },
    }
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = (constraints) => {
      const video = constraints?.video as { mandatory?: { chromeMediaSource?: string } } | undefined
      if (video && typeof video === 'object' && 'mandatory' in video && video.mandatory?.chromeMediaSource === 'desktop') {
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 360
        const context = canvas.getContext('2d')
        if (context) {
          context.fillStyle = '#0f6e6b'
          context.fillRect(0, 0, 640, 360)
        }
        return Promise.resolve(canvas.captureStream(15))
      }
      return original(constraints)
    }
  })
  await createMeeting(page, { temp: true })
  await page.getByTestId('enter-meeting').click()
  await joinLobby(page, 'Alex Host')
  await page.getByTestId('control-share').click()
  await expect(page.getByTestId('screen-picker')).toBeVisible()
  await expect(page.getByTestId('share-source').first()).toContainText('Entire screen')
  await page.getByTestId('tab-windows').click()
  await page.getByRole('button', { name: 'Notes' }).click()
  await page.getByTestId('confirm-share').click()
  await expect(page.getByTestId('presenting-banner')).toBeVisible()
})

test('an available GitHub release shows its changelog and versioned download', async ({ page }) => {
  await page.addInitScript(() => {
    const desktop = window as Window & {
      meetlocal?: {
        isDesktop: true
        platform: string
        version: string
        checkForUpdate: () => Promise<{
          currentVersion: string
          latestVersion: string
          updateAvailable: boolean
          name: string
          notes: string
          publishedAt: string
          htmlUrl: string
          assetName: string
          assetSize: number
          currentNotes: string
          currentNotesName: string
          message: string
        }>
        downloadUpdate: () => Promise<{ filePath: string; fileName: string; version: string }>
        launchUpdate: () => Promise<void>
        revealUpdate: () => Promise<void>
        onUpdateProgress: (callback: (progress: { received: number; total: number }) => void) => () => void
        getDesktopSources: () => Promise<never[]>
        saveFile: () => Promise<{ canceled: boolean }>
      }
    }
    desktop.meetlocal = {
      isDesktop: true,
      platform: 'win32',
      version: '1.0.0',
      async getDesktopSources() {
        return []
      },
      async saveFile() {
        return { canceled: true }
      },
      async checkForUpdate() {
        return {
          currentVersion: '1.0.0',
          latestVersion: '1.2.0',
          updateAvailable: true,
          name: 'MeetLocal 1.2.0',
          notes: '## Changes\n\n- Faster screen sharing\n- The new file keeps its version in the name',
          publishedAt: '2026-10-01T12:00:00Z',
          htmlUrl: 'https://github.com/YHOneBox/Meet-Local/releases/tag/v1.2.0',
          assetName: 'MeetLocal-1.2.0-windows-x64.exe',
          assetSize: 80_000_000,
          currentNotes: '',
          currentNotesName: '',
          message: '',
        }
      },
      async downloadUpdate() {
        return {
          filePath: 'C:\\Users\\me\\Downloads\\MeetLocal-1.2.0-windows-x64.exe',
          fileName: 'MeetLocal-1.2.0-windows-x64.exe',
          version: '1.2.0',
        }
      },
      async launchUpdate() {},
      async revealUpdate() {},
      onUpdateProgress(callback) {
        callback({ received: 40_000_000, total: 80_000_000 })
        return () => undefined
      },
    }
  })
  await page.goto('/')
  await expect(page.getByTestId('update-banner')).toContainText('1.2.0')
  await expect(page.getByTestId('update-banner')).toContainText('MeetLocal-1.2.0-windows-x64.exe')
  await page.getByTestId('update-notes').click()
  await expect(page.getByTestId('changelog')).toContainText('Faster screen sharing')
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByTestId('update-download').click()
  await expect(page.getByTestId('update-ready')).toContainText('MeetLocal-1.2.0-windows-x64.exe')
})
