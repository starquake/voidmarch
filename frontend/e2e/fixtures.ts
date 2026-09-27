import { test as base, type APIRequestContext } from '@playwright/test';

export { expect } from '@playwright/test';

/** Registers a player through the API and returns their token. */
export async function registerPlayer(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post('/api/players', { data: { name } });
  const body = (await response.json()) as { token: string };

  return body.token;
}

/**
 * Every page starts as a registered player, so the game skips the name screen;
 * the name screen's own spec opts out with a fresh page.
 */
export const test = base.extend<{ token: string }>({
  token: [
    async ({ page, request }, use) => {
      const token = await registerPlayer(request, 'Tester');
      await page.addInitScript((t) => {
        localStorage.setItem('voidmarch.token', t);
      }, token);
      await use(token);
    },
    { auto: true },
  ],
});
