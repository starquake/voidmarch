import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { state } from './hunt.ts';

test.use({ hasTouch: true });

/** Sends a touch event to the game's canvas at (x, y) in CSS pixels, for touch id. */
async function touch(page: Page, type: 'touchstart' | 'touchmove' | 'touchend', id: number, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([kind, identifier, clientX, clientY]) => {
      const canvas = document.querySelector('#game canvas');
      if (canvas === null) {
        throw new Error('no canvas');
      }
      const t = new Touch({ identifier, target: canvas, clientX, clientY });
      canvas.dispatchEvent(
        new TouchEvent(kind, { touches: kind === 'touchend' ? [] : [t], changedTouches: [t], cancelable: true, bubbles: true }),
      );
    },
    [type, id, x, y] as const,
  );
}

test('the touch controls move the ship, aim and fire, and their buttons work', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto('/?touch=1');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const view = page.viewportSize() ?? { width: 640, height: 360 };
  await expect.poll(async () => (await state(page)).touchButtons).toEqual(['summon', 'orders', 'settings', 'help', 'fullscreen']);
  expect((await state(page)).touch).toBe(true);

  // The left stick: a thumb down on the left half, pushed up.
  const startY = (await state(page)).ship.y;
  await touch(page, 'touchstart', 1, 200, 640);
  await touch(page, 'touchmove', 1, 200, 560);
  await expect.poll(async () => (await state(page)).ship.y, { message: 'the ship moves up the screen' }).toBeLessThan(startY - 30);
  await touch(page, 'touchend', 1, 200, 560);

  // The right stick: pushed to the right, it turns the ship that way and fires.
  const shotsBefore = (await state(page)).shotsFired;
  await touch(page, 'touchstart', 2, view.width - 260, 640);
  await expect.poll(async () => (await state(page)).touchSticks).toEqual(['aim']);
  await touch(page, 'touchmove', 2, view.width - 180, 640);
  await expect.poll(async () => (await state(page)).shotsFired, { message: 'it fires' }).toBeGreaterThan(shotsBefore);
  expect(Math.abs((await state(page)).ship.angle)).toBeLessThan(0.3);
  await touch(page, 'touchend', 2, view.width - 180, 640);
  const shotsAfter = (await state(page)).shotsFired;
  await page.waitForTimeout(500);
  expect((await state(page)).shotsFired, 'letting go stops firing').toBe(shotsAfter);

  // Summon: a companion joins from the hangar at home.
  const summon = { x: view.width - 24 - 48, y: view.height * 0.37 + 32 };
  await touch(page, 'touchstart', 3, summon.x, summon.y);
  await touch(page, 'touchend', 3, summon.x, summon.y);
  await expect.poll(async () => (await state(page)).companions.length, { message: 'Summon brings a companion' }).toBeGreaterThan(0);

  // A tap on the minimap opens the full map, and a tap beside it closes it.
  await touch(page, 'touchstart', 4, view.width - 96 - 85, 96 + 90);
  await touch(page, 'touchend', 4, view.width - 96 - 85, 96 + 90);
  await expect.poll(async () => (await state(page)).mapOpen, { message: 'the minimap opens the map' }).toBe(true);
  expect((await state(page)).touchButtons, 'no buttons over the map').toEqual([]);
  await touch(page, 'touchstart', 5, 40, view.height - 40);
  await touch(page, 'touchend', 5, 40, view.height - 40);
  await expect.poll(async () => (await state(page)).mapOpen, { message: 'a tap beside it closes it' }).toBe(false);
});

// A phone in landscape: the minimap covers much of the right half, so a thumb that lands on it and moves aims.
test('on a phone the controls shrink, and aiming can start on the minimap', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?touch=1');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await expect.poll(async () => (await state(page)).touchButtons).toEqual(['summon', 'orders', 'settings', 'help', 'fullscreen']);
  const shotsBefore = (await state(page)).shotsFired;
  // The minimap's center at 0.6 of its size: 390 pixels tall is under the 700 the UI is full size for.
  const mini = { x: 844 - 0.6 * (96 + 85), y: 0.6 * (96 + 94) };
  await touch(page, 'touchstart', 1, mini.x, mini.y);
  await page.waitForTimeout(100);
  expect((await state(page)).touchSticks, 'it starts as a tap on the map').toEqual([]);
  await touch(page, 'touchmove', 1, mini.x - 60, mini.y);
  await expect.poll(async () => (await state(page)).touchSticks).toEqual(['aim']);
  await expect.poll(async () => (await state(page)).shotsFired, { message: 'it fires' }).toBeGreaterThan(shotsBefore);
  await touch(page, 'touchend', 1, mini.x - 60, mini.y);
  expect((await state(page)).mapOpen, 'a drag is not a tap').toBe(false);
});
