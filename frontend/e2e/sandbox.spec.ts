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

test('ship-relative is the default: W flies toward the mouse', async ({ page }) => {
  const { x, y } = await centre(page);
  await page.mouse.move(x + 300, y);
  await expect.poll(async () => Math.abs((await state(page)).ship.angle)).toBeLessThan(0.2);

  const before = await state(page);
  expect(before.controlMode).toBe('ship');
  await page.keyboard.down('w');
  await expect.poll(async () => (await state(page)).ship.thrusting).toBe(true);
  await expect.poll(async () => (await state(page)).ship.x).toBeGreaterThan(before.ship.x + 20);
  await page.keyboard.up('w');
});

test('C switches to screen-relative, and the choice survives a reload', async ({ page }) => {
  await page.keyboard.press('c');
  await expect.poll(async () => (await state(page)).controlMode).toBe('screen');

  const { x, y } = await centre(page);
  await page.mouse.move(x + 300, y);
  const before = await state(page);
  await page.keyboard.down('w');
  await expect.poll(async () => (await state(page)).ship.y).toBeLessThan(before.ship.y - 20);
  await page.keyboard.up('w');

  await page.reload();
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  expect((await state(page)).controlMode).toBe('screen');
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
  await expect.poll(async () => (await state(page)).projectiles).toBeGreaterThan(0);
  await expect.poll(async () => (await state(page)).shotsFired).toBeGreaterThanOrEqual(3);
  await page.mouse.up();
});

test('debug keys cycle parts, hull, rotation and effects', async ({ page }) => {
  await page.keyboard.press('1');
  await page.keyboard.press('2');
  await page.keyboard.press('3');
  await page.keyboard.press('h');
  await page.keyboard.press('r');
  await page.keyboard.press('f');

  // Phaser handles queued key events on its next update, so wait for it.
  await expect
    .poll(async () => {
      const s = await state(page);

      return { loadout: s.loadout, damage: s.damage, rotationSnap: s.rotationSnap, effects: s.effects };
    })
    .toEqual({
      loadout: { weapon: 'rockets', engine: 'bigPulse', shield: 'frontAndSide' },
      damage: 'slightDamage',
      rotationSnap: 16,
      effects: false,
    });
});

test('the view uses a whole-number zoom of at least 2', async ({ page }) => {
  const { zoom } = await state(page);
  expect(Number.isInteger(zoom)).toBe(true);
  expect(zoom).toBeGreaterThanOrEqual(2);
});

test('the big space gun charges, and the ball leaves on the recoil frame', async ({ page }) => {
  await page.keyboard.press('1');
  await page.keyboard.press('1');
  await expect.poll(async () => (await state(page)).loadout.weapon).toBe('bigSpaceGun');

  const { x, y } = await centre(page);
  await page.mouse.move(x + 200, y);
  // Held while sampling: a click shorter than one game frame is never seen.
  await page.mouse.down();

  // Sample every animation frame until the ball is out, recording what the gun showed.
  const samples = await page.evaluate(
    () =>
      new Promise<{ frame: number; projectiles: number }[]>((resolve) => {
        const seen: { frame: number; projectiles: number }[] = [];
        const sample = (): void => {
          const s = window.voidmarch;
          if (s !== undefined) {
            seen.push({ frame: s.weaponFrame, projectiles: s.projectiles });
            if (s.projectiles > 0 || seen.length > 600) {
              resolve(seen);

              return;
            }
          }
          requestAnimationFrame(sample);
        };
        sample();
      }),
  );

  await page.mouse.up();

  const charging = samples.filter((s) => s.projectiles === 0).map((s) => s.frame);
  expect(Math.max(...charging)).toBeGreaterThan(0);
  expect(Math.max(...charging)).toBeLessThan(7);
  expect(samples.at(-1)?.frame).toBeGreaterThanOrEqual(7);
});

test('music starts after the first input, and M and N are remembered', async ({ page }) => {
  const { x, y } = await centre(page);
  await page.mouse.click(x + 100, y);
  try {
    await expect.poll(async () => (await state(page)).audio.playingMusic).toMatch(/^music-/);
  } finally {
    console.log(`${test.info().project.name} audio: ${JSON.stringify((await state(page)).audio)}`);
  }

  await page.keyboard.press('m');
  await page.keyboard.press('n');
  await expect.poll(async () => (await state(page)).audio).toMatchObject({ muted: true, music: false, playingMusic: null });

  await page.reload();
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  expect((await state(page)).audio).toMatchObject({ muted: true, music: false });
});
