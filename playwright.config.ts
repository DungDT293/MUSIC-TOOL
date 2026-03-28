import { defineConfig } from '@playwright/test'
import path from 'node:path'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // Screenshot on failure
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'electron-logic',
      // Pure logic tests (no Electron launch needed) — run with tsx
      testMatch: [
        'tests/e2e/auth.e2e.ts',
        'tests/e2e/jobQueue.e2e.ts',
        'tests/e2e/songNhac.e2e.ts',
        'tests/e2e/youtubeDownloader.e2e.ts',
      ],
      use: {
        // No browser needed — Node-only tests
      },
    },
  ],
})
