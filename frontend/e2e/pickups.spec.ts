import { expect, test } from './fixtures.ts';
import { aimAt, shootOneDown, state } from './hunt.ts';

// The E2E server sets DROP_CHANCE=1, so every kill drops a part (#77).
test('a shot-down enemy drops a part, and flying over it unlocks it', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const owned = Object.keys((await state(page)).unlocks).length;

  await shootOneDown(page);
  await expect.poll(async () => (await state(page)).pickups.length, { message: 'a part drops' }).toBeGreaterThan(0);

  // Fly at the nearest pickup, easing off close by so the ship doesn't overshoot it.
  await expect
    .poll(
      async () => {
        const s = await state(page);
        const target = s.pickups.reduce<(typeof s.pickups)[number] | undefined>(
          (best, p) =>
            best === undefined || Math.hypot(p.x - s.ship.x, p.y - s.ship.y) < Math.hypot(best.x - s.ship.x, best.y - s.ship.y)
              ? p
              : best,
          undefined,
        );
        if (target !== undefined) {
          await aimAt(page, s, target.x, target.y);
          if (Math.hypot(target.x - s.ship.x, target.y - s.ship.y) > 60) {
            await page.keyboard.down('w');
          } else {
            await page.keyboard.up('w');
          }
        }

        return Object.keys(s.unlocks).length;
      },
      { message: 'the part is unlocked', timeout: 60_000, intervals: [100] },
    )
    .toBeGreaterThan(owned);
  await page.keyboard.up('w');
});
