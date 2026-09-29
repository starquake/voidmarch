import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';

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
 * Points the mouse at a world position, from the ship at the screen center,
 * kept inside the viewport so the page sees the pointer.
 */
async function aimAt(page: Page, s: DebugState, x: number, y: number): Promise<void> {
  const view = page.viewportSize() ?? { width: 640, height: 360 };
  const clamp = (v: number, max: number): number => Math.min(max - 1, Math.max(0, v));
  await page.mouse.move(
    clamp(view.width / 2 + (x - s.ship.x) * s.zoom, view.width),
    clamp(view.height / 2 + (y - s.ship.y) * s.zoom, view.height),
  );
}

/** The enemy nearest the ship, if any. */
const nearest = (s: DebugState): DebugState['enemies'][number] | undefined =>
  s.enemies.reduce<DebugState['enemies'][number] | undefined>(
    (best, e) =>
      best === undefined || Math.hypot(e.x - s.ship.x, e.y - s.ship.y) < Math.hypot(best.x - s.ship.x, best.y - s.ship.y)
        ? e
        : best,
    undefined,
  );

/** Flies from wherever the ship is, down and away from the home planet, out of the safe zone. */
async function flyOut(page: Page): Promise<void> {
  const start = await state(page);
  await aimAt(page, start, start.ship.x, start.ship.y + 150);
  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      const s = await state(page);

      return Math.hypot(s.ship.x, s.ship.y);
    })
    .toBeGreaterThan(OUT_OF_SAFE_ZONE);
  await page.keyboard.up('w');
}

/**
 * Keeps the nearest enemy in the sights until one this player shot down is
 * gone, or the ship goes down. Chasing one strafing enemy at a slow runner's
 * frame rate can miss for good (#31).
 */
async function hunt(page: Page): Promise<'shot' | 'down'> {
  const before = (await state(page)).enemiesDestroyed;
  const shot = (s: DebugState): boolean =>
    s.enemiesDestroyed > before && !s.enemies.some((e) => e.id === s.lastEnemyDestroyed);
  await page.mouse.down();
  await expect
    .poll(
      async () => {
        const s = await state(page);
        const target = nearest(s);
        if (target !== undefined) {
          await aimAt(page, s, target.x, target.y);
        }

        return shot(s) || s.downed;
      },
      { message: 'an enemy this player shot down is gone', timeout: 45_000, intervals: [100] },
    )
    .toBe(true);
  await page.mouse.up();

  return shot(await state(page)) ? 'shot' : 'down';
}

test('enemies come for a player out of the safe zone and can be shot down', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  // Out there the ship can go down before it hits anything (#47): then it
  // respawns at home and goes again.
  for (let tries = 1; ; tries++) {
    await flyOut(page);
    await expect
      .poll(async () => (await state(page)).enemies.length, { message: 'an enemy shows up', timeout: 20_000 })
      .toBeGreaterThan(0);
    if ((await hunt(page)) === 'shot') {
      break;
    }
    expect(tries, 'went down three times without shooting an enemy down').toBeLessThan(3);
    await expect.poll(async () => (await state(page)).canRespawn, { timeout: 10_000 }).toBe(true);
    await page.keyboard.press('h');
    await expect.poll(async () => (await state(page)).downed).toBe(false);
  }
});

test('a parked ship loses its shield charge, then hull', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  // The round shield covers every side, so the first hit always takes its one charge.
  await page.keyboard.press('3');
  await page.keyboard.press('3');
  await expect
    .poll(async () => {
      const s = await state(page);

      return [s.loadout.shield, s.shield, s.shieldShown, s.damage];
    })
    .toEqual(['round', 1, true, 'fullHealth']);
  const charged = await state(page);

  await aimAt(page, charged, charged.ship.x, charged.ship.y + 150);
  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      const s = await state(page);

      return Math.hypot(s.ship.x, s.ship.y);
    })
    .toBeGreaterThan(OUT_OF_SAFE_ZONE);
  await page.keyboard.up('w');

  await expect
    .poll(async () => {
      const s = await state(page);

      return s.shield < 1 && !s.shieldShown;
    }, { message: 'the shield is used up and hidden', timeout: 60_000, intervals: [100] })
    .toBe(true);
  const hurt = await expect
    .poll(async () => (await state(page)).damage, { message: 'a hit reaches the hull', timeout: 60_000, intervals: [50] })
    .not.toBe('fullHealth')
    .then(() => state(page));
  expect(hurt.shield, 'the hull only takes hits the shield could not').toBeLessThan(1);
});
