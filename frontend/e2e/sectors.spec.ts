import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { TRIES, aimAt, fitRockets, nearest, state } from './hunt.ts';

/** Flies sideways from home into the sector beside it, east or west, past its edge at 800. */
async function flyInto(page: Page, east: boolean): Promise<void> {
  const side = east ? 1 : -1;
  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      const s = await state(page);
      await aimAt(page, s, s.ship.x + side * 150, s.ship.y);

      return side * s.ship.x;
    })
    .toBeGreaterThan(900);
  await page.keyboard.up('w');
}

/**
 * Fires at the nearest enemy until the sector reads cleared, or the ship
 * goes down. Counting kills would wait forever when the last one lands just
 * before it starts.
 */
async function clear(page: Page, cleared: string): Promise<'cleared' | 'down'> {
  await page.mouse.down();
  await expect
    .poll(
      async () => {
        const s = await state(page);
        const target = nearest(s);
        if (target !== undefined) {
          await aimAt(page, s, target.x, target.y);
        }

        return s.sector === cleared || s.downed;
      },
      { message: 'the sector is cleared, or the ship went down', timeout: 60_000, intervals: [100] },
    )
    .toBe(true);
  await page.mouse.up();

  return (await state(page)).downed ? 'down' : 'cleared';
}

// The e2e map gives E4 and C4 a garrison of 2, one sector per browser: a
// cleared sector stays cleared on the shared server.
test('destroying a sector\'s garrison clears it, and its clear gives this player a part', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const east = testInfo.project.name !== 'firefox';
  const sector = east ? 'E4' : 'C4';
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  expect((await state(page)).sector).toBe('Sector D4 · home');
  // A squadron starts with a mission in ring 1 (#101).
  await expect.poll(async () => (await state(page)).mission).toMatch(/^[C-E][3-5]$/);
  // and it is announced in the middle of the screen, with the way to it.
  await expect.poll(async () => (await state(page)).missionBanner).toMatch(/^New mission: sector [C-E][3-5]\n.*\nFollow the gold arrow/);
  await fitRockets(page);
  await flyInto(page, east);
  expect((await state(page)).sector).toBe(`Sector ${sector} · hostile`);

  const cleared = `Sector ${sector} · cleared`;
  for (let tries = 1; (await state(page)).sector !== cleared; tries++) {
    if ((await clear(page, cleared)) === 'down') {
      expect(tries, 'went down five times before clearing the sector').toBeLessThan(TRIES);
      await expect.poll(async () => (await state(page)).canRespawn, { timeout: 10_000 }).toBe(true);
      await page.keyboard.press('h');
      await expect.poll(async () => (await state(page)).downed).toBe(false);
      await flyInto(page, east);
    }
  }
  expect((await state(page)).sector).toBe(cleared);
  // The clear gave this player a part; the notice naming it can be gone already.
  const last = (await state(page)).lastClear;
  expect(last?.sector).toBe(sector);
  expect(last?.reward, 'the clear gave this player a part').toBeDefined();

  // E on a development server sends an attack at the cleared sector (#102):
  // the HUD counts it down and a banner says what to do.
  await page.keyboard.press('e');
  await expect.poll(async () => (await state(page)).worldEvent).toMatch(new RegExp(`^${sector} under attack · \\d+:\\d\\d$`));
  await expect
    .poll(async () => (await state(page)).missionBanner, { timeout: 20_000 })
    .toMatch(new RegExp(`^Sector ${sector} is under attack!\\n`));
});
