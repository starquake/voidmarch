import type { Browser, Page } from '@playwright/test';

import { expect, registerPlayer, test } from './fixtures.ts';

import type { DebugState } from '../src/debug.ts';

const state = (page: Page): Promise<DebugState> =>
  page.evaluate(() => {
    if (window.voidmarch === undefined) {
      throw new Error('window.voidmarch is not published');
    }

    return structuredClone(window.voidmarch);
  });

/** Past the server's safe zone around the home planet (300). */
const OUT_OF_SAFE_ZONE = 340;

/**
 * Takes the round shield, one charge all around, flies out of the safe zone
 * and parks until enemy fire takes the ship down.
 */
async function goDown(page: Page): Promise<void> {
  await page.keyboard.press('3');
  await page.keyboard.press('3');
  await expect.poll(async () => (await state(page)).loadout.shield).toBe('round');
  const view = page.viewportSize() ?? { width: 640, height: 360 };
  await page.mouse.move(view.width / 2, view.height - 10);
  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      const s = await state(page);

      return Math.hypot(s.ship.x, s.ship.y);
    })
    .toBeGreaterThan(OUT_OF_SAFE_ZONE);
  await page.keyboard.up('w');
  await expect
    .poll(async () => (await state(page)).downed, { message: 'enemy fire takes the ship down', timeout: 150_000 })
    .toBe(true);
}

test('a downed player respawns at home, whole', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await goDown(page);

  const down = await state(page);
  expect(down.downLabel).toMatch(/^DOWN/);
  expect(down.downPanel).toContain("You're down");
  await expect
    .poll(async () => (await state(page)).downPanel ?? '', { timeout: 10_000 })
    .toContain('[H] respawn at home');

  await page.keyboard.press('h');
  await expect
    .poll(async () => {
      const s = await state(page);

      return [s.downed, s.damage, s.shield, Math.round(s.ship.x), s.downPanel];
    })
    .toEqual([false, 'fullHealth', 1, 0, undefined]);
  expect((await state(page)).revives).toBe(0);
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

/**
 * Steers page's ship with screen-relative keys toward where target is,
 * holding it within reach, until done says so.
 */
async function hoverBy(page: Page, target: Page, reach: number, done: () => Promise<boolean>): Promise<void> {
  const held = new Set<string>();
  const hold = async (keys: string[]): Promise<void> => {
    for (const key of held) {
      if (!keys.includes(key)) {
        await page.keyboard.up(key);
        held.delete(key);
      }
    }
    for (const key of keys) {
      if (!held.has(key)) {
        await page.keyboard.down(key);
        held.add(key);
      }
    }
  };
  const deadline = Date.now() + 60_000;
  while (!(await done())) {
    if (Date.now() > deadline) {
      throw new Error('never got there in time');
    }
    const [me, them] = await Promise.all([state(page), state(target)]);
    const dx = them.ship.x - me.ship.x;
    const dy = them.ship.y - me.ship.y;
    const keys: string[] = [];
    if (Math.hypot(dx, dy) > reach) {
      const slack = reach / 2;
      if (dx > slack) keys.push('d');
      if (dx < -slack) keys.push('a');
      if (dy > slack) keys.push('s');
      if (dy < -slack) keys.push('w');
    }
    await hold(keys);
    await page.waitForTimeout(50);
  }
  await hold([]);
}

test('a squadmate hovering next to a downed player revives it', async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await expect.poll(async () => (await state(page)).squadron).not.toBe('');
  const squadron = (await state(page)).squadron;

  const mo = await otherPlayer(browser, baseURL ?? '', `Mo${String(Date.now() % 100000)}`);
  try {
    await expect.poll(async () => (await state(mo)).squadronScreen).toBe(true);
    await mo.keyboard.press('Enter');
    await expect.poll(async () => (await state(mo)).squadron).toBe(squadron);
    await mo.keyboard.press('c');
    await expect.poll(async () => (await state(mo)).controlMode).toBe('screen');

    await goDown(page);
    // Mo flies over and stays close: a squadmate revives in 1.5 s.
    await hoverBy(mo, page, 35, async () => (await state(page)).revives > 0);
    const up = await state(page);
    expect(up.revives).toBeGreaterThan(0);
  } finally {
    // An open page keeps rendering WebGL through later specs (#22).
    await mo.context().close();
  }
});
