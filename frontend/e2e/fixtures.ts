import { test as base, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

import { claimFirefoxHome } from './firefox.ts';
import { RUN_DIR, startServer } from './server.ts';

export { expect } from '@playwright/test';

/** Registers a player through the API and returns their token. */
export async function registerPlayer(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post('/api/players', { data: { name } });
  const body = (await response.json()) as { token: string };

  return body.token;
}

/**
 * The controls a spec's pages start with: ship-relative, since the helpers
 * steer by pointing and holding W, or the game's own default (#104).
 */
export type Controls = 'ship' | 'game';

/**
 * The effects a spec's pages start with: on, as the specs were written for,
 * or the game's own default, which is off on CI's software WebGL (#234).
 */
export type Effects = 'on' | 'game';

/**
 * Signs every page of target in as the player with token, past the intro
 * screen (#193). With `ship` controls it also saves ship-relative, unless a
 * page already saved a mode, and with effects `on` it saves them on, unless
 * a page already saved its view.
 */
export async function signIn(target: Page | BrowserContext, token: string, controls: Controls = 'ship', effects: Effects = 'on'): Promise<void> {
  await target.addInitScript(
    ([t, c, e]) => {
      localStorage.setItem('voidmarch.token', t);
      localStorage.setItem('voidmarch.introSeen', '1');
      if (c === 'ship' && localStorage.getItem('voidmarch.controlMode') === null) {
        localStorage.setItem('voidmarch.controlMode', 'ship');
      }
      if (e === 'on' && localStorage.getItem('voidmarch.view') === null) {
        localStorage.setItem('voidmarch.view', JSON.stringify({ snapRotation: false, effects: true }));
      }
    },
    [token, controls, effects] as const,
  );
}

/**
 * A page that starts as a first visit. Each worker plays on a server of its
 * own, with its own port and database, so its tests run one at a time on it
 * and never meet another worker's (#321). E2E_BASE_URL points every worker
 * at a server already running instead, for debugging.
 */
export const fresh = base.extend<object, { server: string }>({
  server: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern.
    async ({}, use, workerInfo) => {
      const running = process.env.E2E_BASE_URL;
      if (running !== undefined) {
        await use(running);

        return;
      }
      const dir = process.env[RUN_DIR];
      if (dir === undefined) {
        throw new Error(`${RUN_DIR} is unset: the global setup builds the server`);
      }
      const server = await startServer(dir, `worker-${String(workerInfo.workerIndex)}`);
      try {
        await use(server.url);
      } finally {
        await server.stop();
      }
    },
    { scope: 'worker', timeout: 60_000 },
  ],
  baseURL: async ({ server }, use) => {
    await use(server);
  },
  // macOS keeps other apps out of the installed Firefox's ~/Library/Application
  // Support/Firefox, and Firefox won't start without it, so on macOS it gets a
  // home folder of its own (#247), one per worker (#312).
  launchOptions: [
    async ({ launchOptions, browserName }, use) => {
      if (browserName !== 'firefox' || process.platform !== 'darwin') {
        await use(launchOptions);

        return;
      }
      const home = claimFirefoxHome();
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }
      try {
        await use({ ...launchOptions, env: { ...env, CFFIXED_USER_HOME: home.path } });
      } finally {
        home.release();
      }
    },
    { scope: 'worker' },
  ],
});

/**
 * Every page starts as a registered player, so the game skips the name screen;
 * a spec testing the name screen uses `fresh`. A spec testing the game's own
 * control or effects default sets `controls` or `effects` to `game`.
 */
export const test = fresh.extend<{ token: string; controls: Controls; effects: Effects }>({
  controls: ['ship', { option: true }],
  effects: ['on', { option: true }],
  token: [
    async ({ page, request, controls, effects }, use) => {
      const token = await registerPlayer(request, 'Tester');
      await signIn(page, token, controls, effects);
      await use(token);
    },
    { auto: true },
  ],
});
