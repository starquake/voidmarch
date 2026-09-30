import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { TRIES, aimAt, shootOneDown, state } from './hunt.ts';

/**
 * Flies at the nearest pickup until this player owns more than owned parts,
 * and reports whether they do; false when the ship goes down first. It keeps
 * thrusting: flying through a pickup collects it, and a ship left to coast can
 * stop just short of its reach (#84).
 */
async function collectNearest(page: Page, owned: number): Promise<boolean> {
  await page.keyboard.down('w');
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
        }

        return Object.keys(s.unlocks).length > owned || s.downed;
      },
      { message: 'the part is unlocked, or the ship went down', timeout: 30_000, intervals: [100] },
    )
    .toBe(true);
  await page.keyboard.up('w');

  return Object.keys((await state(page)).unlocks).length > owned;
}

// The E2E server sets DROP_CHANCE=1, so every kill drops a part (#77).
test('a shot-down enemy drops a part, and flying over it unlocks it', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const owned = Object.keys((await state(page)).unlocks).length;

  // Enemies keep shooting while the ship collects: going down means going
  // home and shooting down another.
  for (let tries = 1; ; tries++) {
    await shootOneDown(page);
    await expect.poll(async () => (await state(page)).pickups.length, { message: 'a part drops' }).toBeGreaterThan(0);
    if (await collectNearest(page, owned)) {
      break;
    }
    expect(tries, 'went down five times without collecting a part').toBeLessThan(TRIES);
    await expect.poll(async () => (await state(page)).canRespawn, { timeout: 10_000 }).toBe(true);
    await page.keyboard.press('h');
    await expect.poll(async () => (await state(page)).downed).toBe(false);
  }
});
