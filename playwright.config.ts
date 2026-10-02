import { defineConfig, devices } from '@playwright/test'

const fakeMedia = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--auto-select-desktop-capture-source=Entire screen',
  '--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks',
]

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:47999',
    ignoreHTTPSErrors: true,
    permissions: ['camera', 'microphone', 'local-network-access'],
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: fakeMedia },
  },
  webServer: {
    command: 'npx tsx scripts/e2e-server.ts',
    url: 'http://127.0.0.1:47999/api/health',
    ignoreHTTPSErrors: true,
    timeout: 120000,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
