import { expect, test, type Page } from '@playwright/test';

import type { DebugState } from '../src/debug.ts';

const state = (page: Page): Promise<DebugState> =>
  page.evaluate(() => {
    if (window.voidmarch === undefined) {
      throw new Error('window.voidmarch is not published');
    }

    return structuredClone(window.voidmarch);
  });

/** The canvas centre, where the camera keeps the ship. */
const centre = async (page: Page): Promise<{ x: number; y: number }> => {
  const box = await page.locator('#game canvas').boundingBox();
  if (box === null) {
    throw new Error('canvas has no bounding box');
  }

  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
});

test('holding W moves the ship up', async ({ page }) => {
  const before = await state(page);
  await page.keyboard.down('w');
  await expect.poll(async () => (await state(page)).ship.y).toBeLessThan(before.ship.y - 20);
  expect((await state(page)).ship.thrusting).toBe(true);
  await page.keyboard.up('w');
});

test('the ship turns to face the mouse', async ({ page }) => {
  const { x, y } = await centre(page);

  await page.mouse.move(x + 200, y);
  await expect.poll(async () => Math.abs((await state(page)).ship.angle)).toBeLessThan(0.2);

  await page.mouse.move(x, y + 200);
  await expect.poll(async () => Math.abs((await state(page)).ship.angle - Math.PI / 2)).toBeLessThan(0.2);
});

test('holding the left button fires projectiles', async ({ page }) => {
  const { x, y } = await centre(page);
  await page.mouse.move(x + 200, y);
  await page.mouse.down();
  await expect.poll(async () => (await state(page)).shotsFired).toBeGreaterThanOrEqual(3);
  expect((await state(page)).projectiles).toBeGreaterThan(0);
  await page.mouse.up();
});

test('debug keys cycle parts, hull, rotation and effects', async ({ page }) => {
  await page.keyboard.press('1');
  await page.keyboard.press('2');
  await page.keyboard.press('3');
  await page.keyboard.press('h');
  await page.keyboard.press('r');
  await page.keyboard.press('f');

  const s = await state(page);
  expect(s.loadout).toEqual({ weapon: 'rockets', engine: 'bigPulse', shield: 'frontAndSide' });
  expect(s.damage).toBe('slightDamage');
  expect(s.rotationSnap).toBe(16);
  expect(s.effects).toBe(false);
});

test('the view uses a whole-number zoom of at least 2', async ({ page }) => {
  const { zoom } = await state(page);
  expect(Number.isInteger(zoom)).toBe(true);
  expect(zoom).toBeGreaterThanOrEqual(2);
});
