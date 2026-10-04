import type { Page } from '@playwright/test';

import type { DebugState } from '../src/debug.ts';
import { expect, test } from './fixtures.ts';

const state = (page: Page): Promise<DebugState> =>
  page.evaluate(() => {
    if (window.voidmarch === undefined) {
      throw new Error('window.voidmarch is not published');
    }

    return structuredClone(window.voidmarch);
  });

/** D1's center in the world: ring 3, closed until the Dreadnought falls (#123). */
const D1 = { x: 0, y: -3 * Math.sqrt(3) * 990 };
/** E3's center: ring 1, up and right of home, which no spec clears. */
const E3 = { x: 1485, y: -(Math.sqrt(3) / 2) * 990 };

test('M opens the full map, the ship holds still under it, and a click sends the squadron', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await expect.poll(async () => (await state(page)).mission).toMatch(/^[A-G]\d$/);
  // Only home and ring 1 are open until the Kla'ed Dreadnought falls (#123).
  expect((await state(page)).openRings).toBe(1);

  await page.keyboard.press('m');
  await expect.poll(async () => (await state(page)).mapOpen).toBe(true);
  const before = (await state(page)).ship;
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  const held = (await state(page)).ship;
  expect(Math.hypot(held.x - before.x, held.y - before.y), 'the ship holds still under the map').toBeLessThan(2);

  const { mapLayout } = await state(page);
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const click = (p: { x: number; y: number }): Promise<void> =>
    page.mouse.click((mapLayout.x + p.x * mapLayout.scale) / dpr, (mapLayout.y + p.y * mapLayout.scale) / dpr);
  await click(D1);
  await page.waitForTimeout(500);
  expect((await state(page)).mission, 'a closed sector can\'t be picked').not.toBe('D1');
  await click(E3);
  await expect.poll(async () => (await state(page)).mission).toBe('E3');

  await page.keyboard.press('m');
  await expect.poll(async () => (await state(page)).mapOpen).toBe(false);
  await page.keyboard.press('m');
  await expect.poll(async () => (await state(page)).mapOpen).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).mapOpen).toBe(false);
});
