import type { Browser, Page } from '@playwright/test';

import { expect, registerPlayer, test } from './fixtures.ts';

import type { DebugState } from '../src/debug.ts';
import { ORDER_ITEMS, itemPosition } from '../src/ordermenu.ts';

const state = (page: Page): Promise<DebugState> =>
  page.evaluate(() => {
    if (window.voidmarch === undefined) {
      throw new Error('window.voidmarch is not published');
    }

    return structuredClone(window.voidmarch);
  });

/** A small viewport, since two pages render WebGL in software at once in CI (#22). */
const VIEWPORT = { width: 480, height: 270 };

/** A second registered player in their own browser context, online. */
async function otherPlayer(browser: Browser, baseURL: string, name: string): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: VIEWPORT });
  const token = await registerPlayer(context.request, name);
  await context.addInitScript((t) => {
    localStorage.setItem('voidmarch.token', t);
  }, token);
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  return page;
}

test('squadmates join from the screen and hear each other\'s orders', async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  // Alone, there's nothing to choose: the first player starts a squadron straight away.
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await expect.poll(async () => (await state(page)).squadron).not.toBe('');
  const squadron = (await state(page)).squadron;
  expect((await state(page)).squadronScreen).toBe(false);

  const mo = await otherPlayer(browser, baseURL ?? '', `Mo${String(Date.now() % 100000)}`);
  try {
    // The second player picks it on the join screen: Enter joins the picked one.
    await expect.poll(async () => (await state(mo)).squadronScreen).toBe(true);
    await mo.keyboard.press('Enter');
    await expect.poll(async () => (await state(mo)).squadron).toBe(squadron);
    await expect.poll(async () => (await state(mo)).squadronScreen).toBe(false);

    // An order from the first player reaches the second as a callout.
    const view = page.viewportSize() ?? { width: 640, height: 360 };
    const x = view.width / 2 + 180;
    const y = view.height / 2;
    await page.mouse.move(x, y);
    await page.keyboard.down('q');
    await expect.poll(async () => (await state(page)).orderMenuOpen).toBe(true);
    const at = itemPosition(
      ORDER_ITEMS.findIndex((item) => item.label === 'Attack'),
      60,
    );
    await page.mouse.move(x + at.x, y + at.y, { steps: 4 });
    await page.keyboard.up('q');
    await expect.poll(async () => (await state(mo)).notice).toMatch(/: Attack$/);
  } finally {
    // An open page keeps rendering WebGL through later specs (#22).
    await mo.context().close();
  }
});
