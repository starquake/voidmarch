import { WORLD_EDGE_BAND } from '../src/sim/rules.gen.ts';
import { expect, test } from './fixtures.ts';
import { aimAt, state } from './hunt.ts';

/** Up and right from home, through E3 (ring 1) toward F2, closed until the Dreadnought falls (#123). */
const TOWARD_F2 = { x: Math.cos(-Math.PI / 6), y: Math.sin(-Math.PI / 6) };

test('the closed ring\'s force field zaps a ship that flies into it', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  expect((await state(page)).openRings).toBe(1);
  expect((await state(page)).field.zaps).toBe(0);

  await page.keyboard.down('w');
  await expect
    .poll(
      async () => {
        const s = await state(page);
        await aimAt(page, s, s.ship.x + TOWARD_F2.x * 150, s.ship.y + TOWARD_F2.y * 150);

        return s.field.distance ?? Number.POSITIVE_INFINITY;
      },
      { timeout: 60_000 },
    )
    .toBeLessThan(WORLD_EDGE_BAND);
  await expect.poll(async () => (await state(page)).field.zaps).toBeGreaterThan(0);
  await page.keyboard.up('w');
});
