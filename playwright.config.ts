import { defineConfig, devices } from '@playwright/test'

// Phone profiles run in Chromium with phone screen sizes, touch and user
// agents. They check layout and touch behavior, not Safari's engine.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-size', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'node scripts/serve.mjs',
    url: 'http://127.0.0.1:4173/dev/host.html',
    reuseExistingServer: !process.env.CI,
  },
})
