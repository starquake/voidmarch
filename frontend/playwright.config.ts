import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const port = process.env.E2E_PORT ?? '8181';
const ci = process.env.CI !== undefined;
// A fresh database per run, so no hangar or player carries over between runs.
const dbPath = join(tmpdir(), `voidmarch-e2e-${String(Date.now())}.db`);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // One worker everywhere. Every page is a player on the same server: in CI,
  // rendering WebGL in software, pages would starve each other (#22), and at
  // the home planet each page counts toward the others' companion wing cap.
  workers: 1,
  forbidOnly: ci,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  // CI renders WebGL in software, where a frame can take a while.
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
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
  webServer: {
    command: 'go run ./cmd/voidmarch',
    cwd: '..',
    url: `http://127.0.0.1:${port}/healthz`,
    // The specs share one hangar, so it holds a ship for every seat but one.
    env: {
      APP_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: port,
      POOL_START: '15',
      DB_PATH: dbPath,
      // Every spec registers its players from one address.
      REGISTER_LIMIT: '0',
      // Every kill drops a part, so the pickup spec needn't wait for luck.
      DROP_CHANCE: '1',
    },
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
