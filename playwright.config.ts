import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  // Local machines may reuse an installed Chrome; CI installs the pinned Chromium.
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    { name: 'mobile-web', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node scripts/test-server.mjs api',
      url: 'http://127.0.0.1:3001/health/live',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node scripts/test-server.mjs web',
      url: 'http://127.0.0.1:3100',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
