import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { aimAt, nearest, state } from './hunt.ts';

/**
 * Up and left of home, toward C3's center: 600 px out is past the safe zone
 * and within reach of C3's garrison. Its line-up never moves on, so its
 * second ship, a Support Ship (#184), comes out every time. Only the shield
 * spec fires at it, a shot at a time, stopping at the first repair.
 */
const TOWARD_C3 = { x: -Math.sqrt(3) / 2, y: -1 / 2 };
const OUT = 600;
/** Inside C3, past its side 857 px out, where its garrison comes for the ship. */
const IN_C3 = 1000;
/** The kinds that show a shield only while repaired (#188); the bosses' show their charge. */
const SMALL = ['scout', 'fighter', 'bomber', 'torpedo'];
/** Near enough for an auto cannon shot, which flies about 470 px. */
const IN_RANGE = 400;
/** Near enough a Support Ship for it to repair, a little inside its 200 px. */
const REPAIR_RANGE = 180;

/** Flies out toward C3 until the ship is out this far and C3's Support Ship has come out. */
async function meetC3Support(page: Page, out: number): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      const s = await state(page);
      await aimAt(page, s, TOWARD_C3.x * 2 * out, TOWARD_C3.y * 2 * out);

      return s.ship.x * TOWARD_C3.x + s.ship.y * TOWARD_C3.y;
    })
    .toBeGreaterThan(out);
  await page.keyboard.up('w');

  await expect
    .poll(async () => (await state(page)).enemies.filter((e) => e.kind === 'support').length, {
      message: 'a Support Ship comes out',
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
}

test('a garrison comes out with its Support Ship', async ({ page }) => {
  await meetC3Support(page, OUT);
});

test("a small ship shows its shield while it's repaired, and not after (#188)", async ({ page }) => {
  test.setTimeout(90_000);
  await meetC3Support(page, IN_C3);

  // A shot at a time at a ship by the Support Ship, until one shows its shield.
  let shielded: number | undefined;
  await expect
    .poll(
      async () => {
        const s = await state(page);
        shielded = s.enemies.find((e) => e.shielded && SMALL.includes(e.kind))?.id;
        if (shielded !== undefined) {
          return true;
        }
        const supports = s.enemies.filter((e) => e.kind === 'support');
        const near = s.enemies.filter(
          (e) =>
            SMALL.includes(e.kind) &&
            Math.hypot(e.x - s.ship.x, e.y - s.ship.y) < IN_RANGE &&
            supports.some((o) => Math.hypot(e.x - o.x, e.y - o.y) < REPAIR_RANGE),
        );
        // A Scout goes down in two hits, so another kind first.
        const tough = near.filter((e) => e.kind !== 'scout');
        const target = nearest({ ...s, enemies: tough.length > 0 ? tough : near });
        if (target !== undefined) {
          await aimAt(page, s, target.x, target.y);
          await page.mouse.down();
          await page.waitForTimeout(40);
          await page.mouse.up();
        }

        return false;
      },
      { message: 'a damaged ship shows its shield while the Support Ship repairs it', timeout: 45_000, intervals: [250] },
    )
    .toBe(true);

  await expect
    .poll(async () => (await state(page)).enemies.find((e) => e.id === shielded)?.shielded ?? 'gone', {
      message: 'the shield goes once the repair stops',
      timeout: 20_000,
    })
    .toBe(false);
});
