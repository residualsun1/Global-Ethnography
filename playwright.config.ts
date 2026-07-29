import { defineConfig, devices } from '@playwright/test';

const isCi = Boolean(process.env.CI);
const localBrowser = isCi ? {} : { channel: 'msedge' as const };
const port = isCi ? 4173 : 5173;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: isCi ? 90_000 : 30_000,
  expect: { timeout: isCi ? 20_000 : 5_000 },
  workers: isCi ? 1 : undefined,
  retries: isCi ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: isCi
      ? `npm run preview -- --host 127.0.0.1 --port ${port}`
      : `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !isCi,
    timeout: 120_000
  },
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...localBrowser, viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      grepInvert: /imports, exports and clears private archives/,
      use: { ...devices['Pixel 7'], ...localBrowser }
    }
  ]
});
