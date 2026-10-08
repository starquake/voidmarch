import { expect, test } from './fixtures.ts';
import { aimAt, state } from './hunt.ts';

/**
 * Up and left of home, toward C3's center: 600 px out is past the safe zone
 * and within reach of C3's garrison, which no spec fights. Its line-up never
 * moves on, so its second ship, a Support Ship (#184), comes out every time.
 */
const TOWARD_C3 = { x: -Math.sqrt(3) / 2, y: -1 / 2 };
const OUT = 600;
/** C3's center, about 1715 px from home: a ship there has all of C3 within reach of what it's sent (#309). */
const C3_CENTER = { x: TOWARD_C3.x * 1715, y: TOWARD_C3.y * 1715 };

test('a garrison comes out with its Support Ship', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      const s = await state(page);
      await aimAt(page, s, TOWARD_C3.x * 2 * OUT, TOWARD_C3.y * 2 * OUT);

      return s.ship.x * TOWARD_C3.x + s.ship.y * TOWARD_C3.y;
    })
    .toBeGreaterThan(OUT);

  // A garrison ship comes out anywhere in its sector, and only enemies within
  // 1200 px are sent (#299): fly on toward C3's center until it's in view (#309).
  await expect
    .poll(
      async () => {
        const s = await state(page);
        await aimAt(page, s, C3_CENTER.x, C3_CENTER.y);

        return s.enemies.filter((e) => e.kind === 'support').length;
      },
      { message: 'a Support Ship comes out', timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  await page.keyboard.up('w');
});
