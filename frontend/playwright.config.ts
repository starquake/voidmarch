import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const port = process.env.E2E_PORT ?? '8181';
const ci = process.env.CI !== undefined;
// A fresh database per run, so no hangar or player carries over between runs.
const dbPath = join(tmpdir(), `voidmarch-e2e-${String(Date.now())}.db`);

/**
 * Firefox's launch environment. macOS keeps other apps out of the installed
 * Firefox's ~/Library/Application Support/Firefox, and Firefox won't start
 * without it, so on macOS it gets a home folder of its own (#247).
 */
function firefoxEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  if (process.platform === 'darwin') {
    const home = join(tmpdir(), 'voidmarch-e2e-firefox-home');
    mkdirSync(home, { recursive: true });
    env.CFFIXED_USER_HOME = home;
  }

  return env;
}

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
      launchOptions: { env: firefoxEnv(), firefoxUserPrefs: { 'media.volume_scale': '0.0' } },
    } },
  ],
  webServer: {
    command: 'go run ./cmd/voidmarch',
    cwd: '..',
    url: `http://127.0.0.1:${port}/healthz`,
    // The specs share one hangar, one spec at a time. The 16-ship fleet cap
    // leaves room for three rescued derelicts (#52): one per browser, and a retry.
    env: {
      APP_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: port,
      POOL_START: '13',
      DB_PATH: dbPath,
      // Every spec registers its players from one address.
      REGISTER_LIMIT: '0',
      // Every kill drops a part, so the pickup spec needn't wait for luck.
      DROP_CHANCE: '1',
      // The test map, with the Frigate near home (#89).
      MAP: 'e2e',
    },
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
