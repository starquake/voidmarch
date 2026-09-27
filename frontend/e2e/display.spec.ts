import { expect, test } from './fixtures.ts';

test.use({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1.5 });

test('at 150% scaling the canvas has one pixel per device pixel', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');

  const canvas = await page.locator('#game canvas').evaluate((c: HTMLCanvasElement) => ({
    width: c.width,
    height: c.height,
    cssWidth: c.getBoundingClientRect().width,
  }));
  expect(canvas).toEqual({ width: 1440, height: 810, cssWidth: 960 });

  const zoom = await page.evaluate(() => window.voidmarch?.zoom ?? 0);
  expect(Number.isInteger(zoom)).toBe(true);
  expect(zoom).toBeGreaterThanOrEqual(2);
});

test('the mouse still aims where it points at 150%', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  const box = await page.locator('#game canvas').boundingBox();
  if (box === null) {
    throw new Error('canvas has no bounding box');
  }

  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => Math.abs(window.voidmarch?.ship.angle ?? 9))).toBeLessThan(0.2);
});
