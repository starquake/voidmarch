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
 * Points the mouse at a world position, from the ship at the screen centre,
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

test('enemies come for a player out of the safe zone and can be shot down', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  // Fly away from the home planet, where nothing spawns.
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

  // An enemy shows up near the player.
  await expect
    .poll(async () => (await state(page)).enemies.length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const before = (await state(page)).enemiesDestroyed;

  // Keep the nearest in the sights until one this player shot down is gone.
  // Chasing one strafing enemy at a slow runner's frame rate can miss for good (#31).
  await page.mouse.down();
  await expect
    .poll(
      async () => {
        const s = await state(page);
        const target = nearest(s);
        if (target !== undefined) {
          await aimAt(page, s, target.x, target.y);
        }

        return s.enemiesDestroyed > before && !s.enemies.some((e) => e.id === s.lastEnemyDestroyed);
      },
      { message: 'an enemy this player shot down is gone', timeout: 45_000, intervals: [100] },
    )
    .toBe(true);
  await page.mouse.up();
});
