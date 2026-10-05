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
 * Signs every page of target in as the player with token, past the intro
 * screen (#193). With `ship` controls it also saves ship-relative, unless a
 * page already saved a mode.
 */
export async function signIn(target: Page | BrowserContext, token: string, controls: Controls = 'ship'): Promise<void> {
  await target.addInitScript(
    ([t, c]) => {
      localStorage.setItem('voidmarch.token', t);
      localStorage.setItem('voidmarch.introSeen', '1');
      if (c === 'ship' && localStorage.getItem('voidmarch.controlMode') === null) {
        localStorage.setItem('voidmarch.controlMode', 'ship');
      }
    },
    [token, controls] as const,
  );
}

/**
 * Every page starts as a registered player, so the game skips the name screen;
 * the name screen's own spec opts out with a fresh page. A spec testing the
 * game's own control default sets `controls` to `game`.
 */
export const test = base.extend<{ token: string; controls: Controls }>({
  controls: ['ship', { option: true }],
  token: [
    async ({ page, request, controls }, use) => {
      const token = await registerPlayer(request, 'Tester');
      await signIn(page, token, controls);
      await use(token);
    },
    { auto: true },
  ],
});
