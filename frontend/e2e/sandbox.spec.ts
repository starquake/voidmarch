import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { changeOption } from './settings.ts';

import type { DebugState } from '../src/debug.ts';

const state = (page: Page): Promise<DebugState> =>
  page.evaluate(() => {
    if (window.voidmarch === undefined) {
      throw new Error('window.voidmarch is not published');
    }

    return structuredClone(window.voidmarch);
  });

/** The canvas center, where the camera keeps the ship. */
const center = async (page: Page): Promise<{ x: number; y: number }> => {
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

test.describe('with the game\'s own default controls', () => {
  test.use({ controls: 'game' });

  test('screen-relative is the default: W flies up the screen, wherever the mouse is', async ({ page }) => {
    const { x, y } = await center(page);
    await page.mouse.move(x + 150, y);
    const before = await state(page);
    expect(before.controlMode).toBe('screen');
    await page.keyboard.down('w');
    await expect.poll(async () => (await state(page)).ship.thrusting).toBe(true);
    await expect.poll(async () => (await state(page)).ship.y).toBeLessThan(before.ship.y - 20);
    await page.keyboard.up('w');
  });

  test('the settings switch to ship-relative, and the choice survives a reload', async ({ page }) => {
    await changeOption(page, 'Controls');
    await expect.poll(async () => (await state(page)).controlMode).toBe('ship');

    const { x, y } = await center(page);
    await page.mouse.move(x + 150, y);
    await expect.poll(async () => Math.abs((await state(page)).ship.angle)).toBeLessThan(0.2);
    const before = await state(page);
    await page.keyboard.down('w');
    await expect.poll(async () => (await state(page)).ship.x).toBeGreaterThan(before.ship.x + 20);
    await page.keyboard.up('w');

    await page.reload();
    await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
    expect((await state(page)).controlMode).toBe('ship');
  });
});

test('the ship turns to face the mouse', async ({ page }) => {
  const { x, y } = await center(page);

  await page.mouse.move(x + 120, y);
  await expect.poll(async () => Math.abs((await state(page)).ship.angle)).toBeLessThan(0.2);

  await page.mouse.move(x, y + 120);
  await expect.poll(async () => Math.abs((await state(page)).ship.angle - Math.PI / 2)).toBeLessThan(0.2);
});

test('holding the left button fires projectiles', async ({ page }) => {
  const { x, y } = await center(page);
  await page.mouse.move(x + 120, y);
  await page.mouse.down();
  await expect.poll(async () => (await state(page)).projectiles).toBeGreaterThan(0);
  await expect.poll(async () => (await state(page)).shotsFired).toBeGreaterThanOrEqual(3);
  await page.mouse.up();
});

test('debug keys cycle parts, and the settings switch rotation and effects', async ({ page }) => {
  await page.keyboard.press('1');
  await page.keyboard.press('2');
  await page.keyboard.press('3');
  // Esc would close the part list the taps showed, not open the settings (#259).
  await expect(page.locator('#hud-gauge .hud-drop')).toHaveCount(0);
  await changeOption(page, 'Rotation');
  await changeOption(page, 'Effects');

  // Phaser handles queued key events on its next update, so wait for it.
  await expect
    .poll(async () => {
      const s = await state(page);

      return {
        loadout: s.loadout,
        rotationSnap: s.rotationSnap,
        effects: s.effects,
        enemyFireGlow: s.enemyFireGlow,
      };
    })
    .toEqual({
      loadout: { weapon: 'rockets', engine: 'bigPulse', shield: 'frontAndSide', weaponTier: 0, engineTier: 0, shieldTier: 0 },
      rotationSnap: 16,
      effects: false,
      enemyFireGlow: false,
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

  const { x, y } = await center(page);
  await page.mouse.move(x + 120, y);
  // Held while sampling: a click shorter than one game frame is never seen.
  await page.mouse.down();

  // Sample every animation frame until our own ball is out, counted apart from
  // any other ship's shots.
  const samples = await page.evaluate(
    () =>
      new Promise<{ frame: number; shots: number }[]>((resolve) => {
        const seen: { frame: number; shots: number }[] = [];
        const sample = (): void => {
          const s = window.voidmarch;
          if (s !== undefined) {
            seen.push({ frame: s.weaponFrame, shots: s.shotsFired });
            if (s.shotsFired > 0 || seen.length > 600) {
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

  const charging = samples.filter((s) => s.shots === 0).map((s) => s.frame);
  expect(Math.max(...charging)).toBeGreaterThan(0);
  expect(Math.max(...charging)).toBeLessThan(7);
  expect(samples.at(-1)?.frame).toBeGreaterThanOrEqual(7);
});

test('music starts after the first input, and the sound and music settings are remembered', async ({ page }) => {
  const { x, y } = await center(page);
  await page.mouse.click(x + 100, y);
  try {
    await expect.poll(async () => (await state(page)).audio.playingMusic).toMatch(/^music-/);
  } finally {
    console.log(`${test.info().project.name} audio: ${JSON.stringify((await state(page)).audio)}`);
  }

  await changeOption(page, 'Sound');
  await changeOption(page, 'Music');
  await expect.poll(async () => (await state(page)).audio).toMatchObject({ muted: true, music: false, playingMusic: null });

  await page.reload();
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  expect((await state(page)).audio).toMatchObject({ muted: true, music: false });
});

test('the settings cap the frame rate and lower the resolution, and both are remembered', async ({ page }) => {
  expect(await state(page)).toMatchObject({ fpsCap: false, cssPixels: false });
  await changeOption(page, 'Frame rate');
  await changeOption(page, 'Resolution');
  await expect.poll(async () => await state(page)).toMatchObject({ fpsCap: true, cssPixels: true });

  await page.reload();
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  expect(await state(page)).toMatchObject({ fpsCap: true, cssPixels: true });
});

test('a big space gun ball fired at nothing bursts into a star when it runs out', async ({ page }) => {
  await page.keyboard.press('1');
  await page.keyboard.press('1');
  await expect.poll(async () => (await state(page)).loadout.weapon).toBe('bigSpaceGun');

  const { x, y } = await center(page);
  await page.mouse.move(x + 120, y);
  // Held through the charge, so the ball leaves.
  await page.mouse.down();
  await expect.poll(async () => (await state(page)).shotsFired).toBeGreaterThan(0);
  await page.mouse.up();
  // It flies 150 px, then bursts into 8 shards (#72).
  await expect
    .poll(async () => (await state(page)).ownShards, { message: 'the ball bursts', timeout: 10_000, intervals: [50] })
    .toBe(8);
  // The camera shakes once per burst, not on firing.
  await expect
    .poll(async () => {
      const s = await state(page);
      return s.shakes === s.shotsFired;
    })
    .toBe(true);
});
