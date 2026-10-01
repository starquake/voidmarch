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

/** Inside D5, south of home, where the e2e map keeps a garrison (#99). */
const IN_D5 = 900;

/**
 * Takes the round shield, one charge all around, flies into D5 and parks
 * until enemy fire takes the ship down.
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

      return s.ship.y;
    })
    .toBeGreaterThan(IN_D5);
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
  // Alone out there, nobody revives: DOWN, and no bar yet.
  expect([down.downLabel, down.reviveBar]).toEqual(['DOWN', undefined]);
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
