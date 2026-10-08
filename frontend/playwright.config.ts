import { defineConfig, devices } from '@playwright/test';

const ci = process.env.CI !== undefined;

export default defineConfig({
  testDir: './e2e',
  // The e2e folder's *.test.ts are unit tests of the specs' helpers, run by npm test.
  testMatch: '**/*.spec.ts',
  // Builds the server once; each worker then starts its own (e2e/fixtures.ts).
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  // One worker: in CI, rendering WebGL in software, pages would starve each other (#22).
  workers: 1,
  forbidOnly: ci,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  // CI renders WebGL in software, where a frame can take a while.
  expect: { timeout: 15_000 },
  use: {
    viewport: { width: 640, height: 360 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 640, height: 360 },
      // The game plays music; keep test runs silent.
      launchOptions: { args: ['--mute-audio'] },
    } },
    { name: 'firefox', use: {
      ...devices['Desktop Firefox'],
      viewport: { width: 640, height: 360 },
      launchOptions: { firefoxUserPrefs: { 'media.volume_scale': '0.0' } },
    } },
  ],
});
