import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/deployment/**',
  timeout: 120_000,
  expect: {timeout: 10_000},
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', {open: 'never'}]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {name: 'chromium', use: {browserName: 'chromium'}},
    {name: 'firefox', use: {browserName: 'firefox'}},
    {name: 'webkit', use: {browserName: 'webkit'}},
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:4173',
      // Only for explicitly started, identical candidate builds during local verification.
      reuseExistingServer: process.env.DW_REUSE_DEV_SERVER === '1',
      timeout: 30_000,
    },
    {
      command: 'node tests/portal/server.mjs',
      url: 'http://127.0.0.1:4174/health',
      reuseExistingServer: process.env.DW_REUSE_TEST_PORTAL === '1',
      timeout: 10000,
    },
  ],
});
