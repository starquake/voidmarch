import { test as base, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

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
 * Every page starts as a registered player, so the game skips the name screen;
 * the name screen's own spec opts out with a fresh page. A spec testing the
 * game's own control or effects default sets `controls` or `effects` to `game`.
 */
export const test = base.extend<{ token: string; controls: Controls; effects: Effects }>({
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
