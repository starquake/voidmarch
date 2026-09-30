import { expect, test } from './fixtures.ts';
import { OUT_OF_SAFE_ZONE, aimAt, shootOneDown, state } from './hunt.ts';

test('enemies come for a player out of the safe zone and can be shot down', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  await shootOneDown(page);
});

test('a parked ship loses its shield charge, then hull', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  // The round shield covers every side, so the first hit always takes its one charge.
  await page.keyboard.press('3');
  await page.keyboard.press('3');
  await expect
    .poll(async () => {
      const s = await state(page);

      return [s.loadout.shield, s.shield, s.shieldShown, s.damage];
    })
    .toEqual(['round', 1, true, 'fullHealth']);
  const charged = await state(page);

  await aimAt(page, charged, charged.ship.x, charged.ship.y + 150);
  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      const s = await state(page);

      return Math.hypot(s.ship.x, s.ship.y);
    })
    .toBeGreaterThan(OUT_OF_SAFE_ZONE);
  await page.keyboard.up('w');

  await expect
    .poll(async () => {
      const s = await state(page);

      return s.shield < 1 && !s.shieldShown;
    }, { message: 'the shield is used up and hidden', timeout: 60_000, intervals: [100] })
    .toBe(true);
  const hurt = await expect
    .poll(async () => (await state(page)).damage, { message: 'a hit reaches the hull', timeout: 60_000, intervals: [50] })
    .not.toBe('fullHealth')
    .then(() => state(page));
  expect(hurt.shield, 'the hull only takes hits the shield could not').toBeLessThan(1);
});
