import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { TRIES, aimAt, state } from './hunt.ts';

import type { DebugState } from '../src/debug.ts';

/** The e2e map's derelict spot, rescuable at once; the Frigate's waits held beside it (#114). */
const SPOT = { x: -420, y: -120 };

/** The e2e map's derelict, as drawn. */
const derelict = (s: DebugState): DebugState['derelicts'][number] | undefined =>
  s.derelicts.find((d) => Math.hypot(d.x - SPOT.x, d.y - SPOT.y) < 1);

/** The most of a rescue's bar seen filled. */
let filled = 0;

/**
 * Flies beside the derelict and holds still there until this player rescued
 * it, and reports whether they did before the ship went down.
 */
async function rescue(page: Page): Promise<boolean> {
  await expect
    .poll(
      async () => {
        const s = await state(page);
        const d = derelict(s);
        if (d === undefined || s.downed) {
          await page.keyboard.up('w');

          return true;
        }
        filled = Math.max(filled, d.rescue);
        // Thrust toward a point 50 px short of it, and coast once there.
        const far = Math.hypot(d.x - 50 - s.ship.x, d.y - s.ship.y) > 30;
        await aimAt(page, s, d.x - 50, d.y);
        await (far ? page.keyboard.down('w') : page.keyboard.up('w'));

        return s.rescues > 0;
      },
      { message: 'the derelict is rescued, or the ship went down', timeout: 60_000, intervals: [100] },
    )
    .toBe(true);
  await page.keyboard.up('w');

  return (await state(page)).rescues > 0;
}

test('hovering beside a derelict fills its rescue bar and docks it in the hangar', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await expect.poll(async () => derelict(await state(page)), { message: 'the map has a derelict' }).toBeDefined();
  const teleports = (await state(page)).teleports;

  for (let tries = 1; ; tries++) {
    if (await rescue(page)) {
      break;
    }
    expect(tries, 'went down five times before the rescue').toBeLessThan(TRIES);
    await expect.poll(async () => (await state(page)).canRespawn, { timeout: 10_000 }).toBe(true);
    await page.keyboard.press('h');
    await expect.poll(async () => (await state(page)).downed).toBe(false);
  }
  expect((await state(page)).rescues).toBe(1);
  expect(filled, 'the rescue bar filled on the way').toBeGreaterThan(0.5);
  // The rescued derelict teleports away rather than vanishing (#190).
  await expect.poll(async () => (await state(page)).teleports, { message: 'the rescued derelict teleports' }).toBeGreaterThan(teleports);
  await expect.poll(async () => (await state(page)).departing, { message: 'the teleport is over' }).toBe(0);
});

test("the Frigate's derelict waits beside it, held by its fleet", async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  // Held, it's towed 160 px below the patrolling Frigate (#114, #121); the
  // Frigate is drawn a moment in the past, so allow for a few pixels.
  await expect
    .poll(
      async () => {
        const s = await state(page);
        const f = s.enemies.find((e) => e.kind === 'frigate');

        return f !== undefined && s.derelicts.some((d) => d.held && Math.hypot(d.x - f.x, d.y - (f.y + 160)) < 10);
      },
      { message: "the Frigate's derelict is beside it, held" },
    )
    .toBe(true);
});
