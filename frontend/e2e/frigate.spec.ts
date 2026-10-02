import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { TRIES, aimAt, state } from './hunt.ts';

import type { DebugState } from '../src/debug.ts';

/** The e2e map's Frigate, as drawn. */
const frigate = (s: DebugState): DebugState['enemies'][number] | undefined => s.enemies.find((e) => e.kind === 'frigate');

const distance = (s: DebugState, at: { x: number; y: number }): number => Math.hypot(at.x - s.ship.x, at.y - s.ship.y);

/** Flies at the Frigate until the ship is this close, or down. */
async function closeIn(page: Page, range: number): Promise<void> {
  await page.keyboard.down('w');
  await expect
    .poll(
      async () => {
        const s = await state(page);
        const f = frigate(s);
        await aimAt(page, s, f?.x ?? s.ship.x, f?.y ?? s.ship.y - 150);

        return s.downed || (f !== undefined && distance(s, f) < range);
      },
      { message: 'the ship closes in on the Frigate', timeout: 30_000, intervals: [100] },
    )
    .toBe(true);
  await page.keyboard.up('w');
}

/** Fires at the Frigate until its shield or health drops, and reports whether it did before the ship went down. */
async function wear(page: Page): Promise<boolean> {
  await page.mouse.down();
  await expect
    .poll(
      async () => {
        const s = await state(page);
        const f = frigate(s);
        if (f !== undefined) {
          await aimAt(page, s, f.x, f.y);
        }

        return s.downed || (s.boss !== undefined && (s.boss.shield < 1 || s.boss.health < 1));
      },
      { message: 'a hit lowers the Frigate', timeout: 30_000, intervals: [100] },
    )
    .toBe(true);
  await page.mouse.up();

  return !(await state(page)).downed;
}

test('flying to the Frigate shows its health bar, and a hit lowers its shield or health', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await expect.poll(async () => frigate(await state(page)), { message: 'the map has a Frigate' }).toBeDefined();
  expect((await state(page)).boss, 'no bar at home').toBeUndefined();

  for (let tries = 1; ; tries++) {
    await closeIn(page, 260);
    const near = await state(page);
    if (!near.downed) {
      expect(near.boss?.name).toBe("KLA'ED FRIGATE");
      expect(near.boss?.text).toMatch(/^\d+ \/ \d+ · scaled for [\d.]+ online$/);
      if (await wear(page)) {
        break;
      }
    }
    expect(tries, 'went down five times before a hit landed').toBeLessThan(TRIES);
    await expect.poll(async () => (await state(page)).canRespawn, { timeout: 10_000 }).toBe(true);
    await page.keyboard.press('h');
    await expect.poll(async () => (await state(page)).downed).toBe(false);
  }
});
