import type { BrowserContext, Page } from '@playwright/test';

import { expect, registerPlayer, signIn, test } from './fixtures.ts';
import { coveredOnScreen } from './screens.ts';

import type { NetStatus } from '../src/scenes/netplay.ts';

const status = (page: Page): Promise<NetStatus | undefined> => page.evaluate(() => window.voidmarch?.net.status);

/** Two pages render WebGL in software at once in CI, so each gets a small viewport (#22). */
const VIEWPORT = { width: 640, height: 360 };

/** A new tab of the context's player, online: every page in one context shares its token. */
async function tab(context: BrowserContext, query = ''): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  return page;
}

/** Signs every page of the context in as one new player. */
async function player(context: BrowserContext): Promise<void> {
  await signIn(context, await registerPlayer(context.request, 'Tabs'));
}

test('two tabs of one player: the newest plays, the other waits until Play here', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ baseURL: baseURL ?? '', viewport: VIEWPORT });
  try {
    await player(context);
    const first = await tab(context);
    const second = await tab(context);

    const screen = first.locator('#elsewhere-form');
    await expect(screen).toBeVisible();
    await expect(screen).toContainText("You're playing in another tab.");
    expect(await status(first)).toBe('elsewhere');
    expect(await coveredOnScreen(first)).toEqual([]);

    // Longer than the reconnect waits of 1 and 2 s: neither tab pushes the other out again.
    for (let i = 0; i < 8; i++) {
      await second.waitForTimeout(500);
      expect([await status(first), await status(second)]).toEqual(['elsewhere', 'online']);
    }
    await expect(second.locator('#elsewhere-form')).toBeHidden();

    // A click takes the game back; the other tab waits in turn.
    await first.getByRole('button', { name: 'Play here' }).click();
    await first.waitForFunction(() => window.voidmarch?.net.status === 'online');
    await expect(screen).toBeHidden();
    await expect(second.locator('#elsewhere-form')).toBeVisible();

    // Enter takes it back too.
    await second.keyboard.press('Enter');
    await second.waitForFunction(() => window.voidmarch?.net.status === 'online');
    await expect(screen).toBeVisible();
  } finally {
    await context.close();
  }
});

test('a tap on Play here takes the game back on touch', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ baseURL: baseURL ?? '', viewport: VIEWPORT, hasTouch: true });
  try {
    await player(context);
    const first = await tab(context, '?touch=1');
    const second = await tab(context, '?touch=1');
    await expect(first.locator('#elsewhere-form')).toBeVisible();

    await first.getByRole('button', { name: 'Play here' }).tap();
    await first.waitForFunction(() => window.voidmarch?.net.status === 'online');
    await expect(second.locator('#elsewhere-form')).toBeVisible();
  } finally {
    await context.close();
  }
});
