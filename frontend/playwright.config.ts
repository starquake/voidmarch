import { defineConfig, devices } from '@playwright/test';

const port = process.env.E2E_PORT ?? '8181';
const ci = process.env.CI !== undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: ci,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
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
