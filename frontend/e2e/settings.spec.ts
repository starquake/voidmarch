import { expect, test } from './fixtures.ts';
import { state, thrustSeen } from './hunt.ts';
import { changeOption } from './settings.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
});

test('Esc opens the settings, the ship holds still, and changes apply and are remembered', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).settingsScreen).toBe(true);
  // The specs' pages fly ship-relative (fixtures.ts).
  await expect(page.locator('#settings-rows .settings-row')).toHaveText([
    'Soundon',
    'Musicon',
    'Controlsship-relative',
    'Rotationfree',
    'Effectson',
    'Frame ratethe display\'s own',
    'Resolutionfull',
  ]);

  await page.keyboard.down('w');
  expect(await thrustSeen(page, 400), 'the ship holds still under the screen').toBe(false);
  await page.keyboard.up('w');

  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).effects).toBe(false);
  await expect(page.locator('#settings-rows .settings-row.selected')).toHaveText('Effectsoff');
  await page.locator('#settings-rows .settings-row', { hasText: 'Rotation' }).click();
  await expect.poll(async () => (await state(page)).rotationSnap).toBe(16);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).settingsScreen).toBe(false);
  await page.keyboard.down('w');
  expect(await thrustSeen(page, 400), 'W flies once it closes').toBe(true);
  await page.keyboard.up('w');

  await page.reload();
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  await expect.poll(async () => (await state(page)).effects).toBe(false);
  expect((await state(page)).rotationSnap).toBe(16);
});

test('the old option keys switch nothing', async ({ page }) => {
  const before = await state(page);
  for (const key of ['m', 'n', 'c', 'r', 'f', 'v', 'p']) {
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(300);
  expect(await state(page)).toMatchObject({
    audio: { muted: false, music: true },
    controlMode: before.controlMode,
    rotationSnap: 0,
    effects: true,
    fpsCap: false,
    cssPixels: false,
  });
});

test.describe('with the game\'s own default effects', () => {
  test.use({ effects: 'game' });

  test('effects start off on a software renderer and on with a GPU, until the player picks them (#234)', async ({ page }) => {
    const { effects, softwareRenderer } = await state(page);
    expect(effects).toBe(!softwareRenderer);

    await changeOption(page, 'Rotation');
    await page.reload();
    await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
    expect((await state(page)).effects, 'saving the rotation leaves the default to the renderer').toBe(!softwareRenderer);

    await changeOption(page, 'Effects');
    await expect.poll(async () => (await state(page)).effects).toBe(softwareRenderer);
    await page.reload();
    await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
    expect((await state(page)).effects, 'the picked effects win over the default').toBe(softwareRenderer);
  });
});
