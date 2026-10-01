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

/** B3's center in the world: ring 2, which no spec clears. */
const B3 = { x: -2970, y: -Math.sqrt(3) * 990 };

test('Tab opens the full map, the ship holds still under it, and a click sends the squadron', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await expect.poll(async () => (await state(page)).mission).toMatch(/^[A-G]\d$/);

  await page.keyboard.press('Tab');
  await expect.poll(async () => (await state(page)).mapOpen).toBe(true);
  const before = (await state(page)).ship;
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  const held = (await state(page)).ship;
  expect(Math.hypot(held.x - before.x, held.y - before.y), 'the ship holds still under the map').toBeLessThan(2);

  const { mapLayout } = await state(page);
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  await page.mouse.click((mapLayout.x + B3.x * mapLayout.scale) / dpr, (mapLayout.y + B3.y * mapLayout.scale) / dpr);
  await expect.poll(async () => (await state(page)).mission).toBe('B3');

  await page.keyboard.press('Tab');
  await expect.poll(async () => (await state(page)).mapOpen).toBe(false);
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await state(page)).mapOpen).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).mapOpen).toBe(false);
});
