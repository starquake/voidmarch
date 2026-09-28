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

/** Summons count companions; the specs share one server's 16 seats, so they use few. */
async function summon(page: Page, count: number): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('g');
  }
  await expect.poll(async () => (await state(page)).companions.length).toBe(count);
}

/** Holds Q with the pointer at (x, y), points at the order, and lets go. */
async function giveOrder(page: Page, x: number, y: number, label: string): Promise<void> {
  await page.mouse.move(x, y);
  await page.keyboard.down('q');
  await expect.poll(async () => (await state(page)).orderMenuOpen).toBe(true);
  const at = itemPosition(
    ORDER_ITEMS.findIndex((item) => item.label === label),
    60,
  );
  await page.mouse.move(x + at.x, y + at.y, { steps: 4 });
  await page.keyboard.up('q');
}

test('the server lists the hangar\'s ships to a joining player', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await expect.poll(async () => (await state(page)).hangar).toBeDefined();
  // Other specs share the hangar, so only the range is ours to assert.
  const hangar = (await state(page)).hangar ?? -1;
  expect(hangar).toBeGreaterThanOrEqual(0);
  expect(hangar).toBeLessThanOrEqual(15);
});

test('summoned companions fly with their owner, and others see them as theirs', async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  await summon(page, 3);
  const owner = (await state(page)).net.playerId;
  const mo = await otherPlayer(browser, baseURL ?? '', `Mo${String(Date.now() % 100000)}`);
  try {
    await expect
      .poll(async () => (await state(mo)).net.others.filter((o) => o.ownerId === owner).map((o) => o.id).sort())
      .toEqual([`${owner ?? ''}/1`, `${owner ?? ''}/2`, `${owner ?? ''}/3`]);
  } finally {
    // An open page keeps rendering WebGL through later specs (#22).
    await mo.context().close();
  }
});

test('the Attack mode reaches the squadron, and its companions shoot down an enemy', async ({ page }) => {
  test.setTimeout(90_000);
  await summon(page, 2);

  const view = page.viewportSize() ?? { width: 640, height: 360 };
  await giveOrder(page, view.width / 2 + 180, view.height / 2, 'Attack');
  // The hub flies the companions under the squadron's mode.
  await expect.poll(async () => (await state(page)).squadronMode).toBe('Attack');

  // Fly out of the safe zone; the companions come along and hunt.
  await page.mouse.move(view.width / 2, view.height - 10);
  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      const s = await state(page);

      return Math.hypot(s.ship.x, s.ship.y);
    })
    .toBeGreaterThan(340);
  await page.keyboard.up('w');
  await expect
    .poll(async () => (await state(page)).companionKills, { message: 'a companion shot down an enemy', timeout: 45_000 })
    .toBeGreaterThan(0);
});

test('without the server, G summons nothing and says why', async ({ page }) => {
  await page.routeWebSocket('**/ws', (ws) => {
    void ws.close();
  });
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  await page.keyboard.press('g');

  await expect.poll(async () => (await state(page)).notice).toBe('companions need the server');
  expect((await state(page)).companions).toEqual([]);
});
