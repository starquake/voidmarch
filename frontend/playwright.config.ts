import { defineConfig, devices } from '@playwright/test';

const port = process.env.E2E_PORT ?? '8181';
const ci = process.env.CI !== undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: ci,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  // CI renders WebGL in software, where a frame can take a while.
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 960, height: 540 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 960, height: 540 },
      // The game plays music; keep test runs silent.
      launchOptions: { args: ['--mute-audio'] },
    } },
    { name: 'firefox', use: {
      ...devices['Desktop Firefox'],
      viewport: { width: 960, height: 540 },
      launchOptions: { firefoxUserPrefs: { 'media.volume_scale': '0.0' } },
    } },
  ],
  webServer: {
    command: 'go run ./cmd/voidmarch',
    cwd: '..',
    url: `http://127.0.0.1:${port}/healthz`,
    env: { APP_ENV: 'development', HOST: '127.0.0.1', PORT: port },
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
