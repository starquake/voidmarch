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

/** Points the mouse at a world position, from the ship at the screen centre. */
async function aimAt(page: Page, s: DebugState, x: number, y: number): Promise<void> {
  const view = page.viewportSize() ?? { width: 640, height: 360 };
  await page.mouse.move(
    view.width / 2 + (x - s.ship.x) * s.zoom,
    view.height / 2 + (y - s.ship.y) * s.zoom,
  );
}

test('enemies come for a player out of the safe zone and can be shot down', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  // Fly away from the home planet, where nothing spawns.
  const start = await state(page);
  await aimAt(page, start, start.ship.x, start.ship.y + 1000);
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
  const seen = await state(page);
  const target = seen.enemies.reduce((a, b) =>
    Math.hypot(a.x - seen.ship.x, a.y - seen.ship.y) <=
    Math.hypot(b.x - seen.ship.x, b.y - seen.ship.y)
      ? a
      : b,
  );

  // Keep it in the sights until it's destroyed and gone.
  await page.mouse.down();
  await expect
    .poll(
      async () => {
        const s = await state(page);
        const enemy = s.enemies.find((e) => e.id === target.id);
        if (enemy !== undefined) {
          await aimAt(page, s, enemy.x, enemy.y);
        }

        return enemy === undefined && s.enemiesDestroyed > seen.enemiesDestroyed;
      },
      { message: 'the target is destroyed and gone', timeout: 45_000, intervals: [100] },
    )
    .toBe(true);
  await page.mouse.up();
});
