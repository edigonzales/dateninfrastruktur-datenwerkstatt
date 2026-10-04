import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests/deployment',
  outputDir: 'test-results-deployment',
  timeout: 240000,
  expect: {timeout: 15000},
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', {open: 'never', outputFolder: 'playwright-report/deployment'}]],
  use: {timezoneId: 'UTC', trace: 'retain-on-failure', screenshot: 'only-on-failure'},
  projects: ['chromium', 'firefox', 'webkit'].flatMap((browserName) =>
    [0, 1, 2].map((profile) => ({
      name: `${browserName}-${profile}`,
      metadata: {profile},
      use: {
        browserName: browserName as 'chromium' | 'firefox' | 'webkit',
        baseURL: `http://127.0.0.1:${4180 + profile}${profile ? '/lab/' : '/'}`,
      },
    })),
  ),
  webServer: [
    {
      command: 'node scripts/test-deployment.mjs',
      gracefulShutdown: {signal: 'SIGTERM', timeout: 10000},
      url: 'http://127.0.0.1:4182/lab/runtime-config.json',
      timeout: 180000,
      reuseExistingServer: false,
    },
    {
      command: 'node tests/portal/server.mjs',
      url: 'http://127.0.0.1:4174/health',
      timeout: 10000,
      reuseExistingServer: process.env.DW_REUSE_TEST_PORTAL === '1',
    },
  ],
});
