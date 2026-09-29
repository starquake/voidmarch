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
/** Just past the safe zone's edge, where a squadmate inside it can reach (60 px). */
const JUST_OUT = 306;
/** Inside the safe zone, where enemies neither target nor go. */
const JUST_IN = 290;

/**
 * Takes the round shield, one charge all around, flies out of the safe zone
 * and parks until enemy fire takes the ship down. At the edge, it creeps out
 * with screen-relative taps and parks just past it.
 */
async function goDown(page: Page, atEdge = false): Promise<void> {
  await page.keyboard.press('3');
  await page.keyboard.press('3');
  await expect.poll(async () => (await state(page)).loadout.shield).toBe('round');
  const out = async (): Promise<number> => {
    const s = await state(page);

    return Math.hypot(s.ship.x, s.ship.y);
  };
  if (atEdge) {
    await page.keyboard.press('c');
    await expect.poll(async () => (await state(page)).controlMode).toBe('screen');
    while ((await out()) < JUST_OUT) {
      await page.keyboard.down('s');
      await page.waitForTimeout(60);
      await page.keyboard.up('s');
      await page.waitForTimeout(400);
    }
  } else {
    const view = page.viewportSize() ?? { width: 640, height: 360 };
    await page.mouse.move(view.width / 2, view.height - 10);
    await page.keyboard.down('w');
    await expect.poll(out).toBeGreaterThan(OUT_OF_SAFE_ZONE);
    await page.keyboard.up('w');
  }
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
 * Steers page's ship with screen-relative keys toward the point spot gives,
 * holding it within reach, until done says so or seconds pass. Given up, it
 * says where the ship and the other stood.
 */
async function hoverAt(
  page: Page,
  other: Page,
  spot: () => Promise<{ x: number; y: number }>,
  reach: number,
  seconds: number,
  done: () => Promise<boolean>,
): Promise<void> {
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
  const deadline = Date.now() + seconds * 1000;
  while (!(await done())) {
    const me = await state(page);
    if (Date.now() > deadline) {
      const them = await state(other);
      const show = (s: DebugState): string =>
        `(${s.ship.x.toFixed(0)}, ${s.ship.y.toFixed(0)}) ${s.damage}${s.downed ? ` down, revive ${s.revive.toFixed(2)}` : ''}`;
      throw new Error(`gave up after ${String(seconds)} s: hovering ship at ${show(me)}, the other at ${show(them)}`);
    }
    const to = await spot();
    const dx = to.x - me.ship.x;
    const dy = to.y - me.ship.y;
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

    // Down just past the safe zone's edge, the player is revived by Mo from
    // inside it: enemies turn on anyone hovering by a downed ship out there,
    // but neither target nor enter the zone. A squadmate revives in 1.5 s.
    await goDown(page, true);
    const down = (await state(page)).ship;
    const out = Math.hypot(down.x, down.y);
    const spot = { x: (down.x / out) * JUST_IN, y: (down.y / out) * JUST_IN };
    await hoverAt(mo, page, () => Promise.resolve(spot), 12, 120, async () => (await state(page)).revives > 0);
    const up = await state(page);
    expect(up.revives).toBeGreaterThan(0);
  } finally {
    // An open page keeps rendering WebGL through later specs (#22).
    await mo.context().close();
  }
});
