import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { TRIES, aimAt, fitRockets, nearest, state } from './hunt.ts';

import { sectorName } from '../src/sim/sectors.ts';

/** Flies from wherever the ship is to the middle of a sector beside home's, E4 or C4, where its garrison is. */
async function flyInto(page: Page, east: boolean): Promise<void> {
  const target = { x: (east ? 1 : -1) * 1485, y: 857 };
  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      const s = await state(page);
      await aimAt(page, s, target.x, target.y);

      return Math.hypot(target.x - s.ship.x, target.y - s.ship.y);
    })
    .toBeLessThan(500);
  await page.keyboard.up('w');
}

/** The status line of a cleared sector. */
const clearedLine = (sector: string): string => `Sector ${sector} · cleared`;

/** Well inside the rockets' seeking range (400 px), where they turn onto their target. */
const REACH = 300;

/**
 * Fires at the nearest enemy inside the sector until the sector reads
 * cleared, or the ship goes down, flying at it while it is out of reach: a
 * lone Support Ship roams out of rocket range (#246). Counting kills would
 * wait forever when the last one lands just before it starts.
 */
async function clear(page: Page, sector: string): Promise<'cleared' | 'down'> {
  let thrusting = false;
  await page.mouse.down();
  await expect
    .poll(
      async () => {
        const s = await state(page);
        const inSector = nearest({ ...s, enemies: s.enemies.filter((e) => sectorName(e.x, e.y) === sector) });
        const target = inSector ?? nearest(s);
        if (target !== undefined) {
          await aimAt(page, s, target.x, target.y);
        }
        const chase = inSector !== undefined && !s.downed && Math.hypot(inSector.x - s.ship.x, inSector.y - s.ship.y) > REACH;
        if (chase !== thrusting) {
          await (chase ? page.keyboard.down('w') : page.keyboard.up('w'));
          thrusting = chase;
        }

        return s.sector === clearedLine(sector) || s.downed;
      },
      { message: 'the sector is cleared, or the ship went down', timeout: 60_000, intervals: [100] },
    )
    .toBe(true);
  await page.keyboard.up('w');
  await page.mouse.up();

  return (await state(page)).downed ? 'down' : 'cleared';
}

// The e2e map gives E4 and C4 a garrison of 2, one sector per browser: a
// cleared sector stays cleared on the shared server, so each server runs this once.
test('destroying a sector\'s garrison clears it, and its clear gives this player a part', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const east = testInfo.project.name !== 'firefox';
  const sector = east ? 'E4' : 'C4';
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  expect((await state(page)).sector).toBe('Sector D4 · home');
  expect((await state(page)).clearedSectors, `no one cleared ${sector} on this server before`).not.toContain(sector);
  // A squadron starts with a mission in ring 1 (#101).
  await expect.poll(async () => (await state(page)).mission).toMatch(/^[C-E][3-5]$/);
  // and it is announced in the middle of the screen, with the way to it.
  await expect.poll(async () => (await state(page)).missionBanner).toMatch(/^New mission: sector [C-E][3-5]\n.*\nFollow the gold arrow/);
  await fitRockets(page);
  await flyInto(page, east);
  const cleared = clearedLine(sector);
  // The garrison comes out to meet the ship, and rams on the way in can clear it already (#195).
  const arrived = await state(page);
  expect(arrived.sector).toBe(arrived.clearedSectors.includes(sector) ? cleared : `Sector ${sector} · hostile`);

  for (let tries = 1; (await state(page)).sector !== cleared; tries++) {
    if ((await clear(page, sector)) === 'down') {
      expect(tries, 'went down five times before clearing the sector').toBeLessThan(TRIES);
      await expect.poll(async () => (await state(page)).canRespawn, { timeout: 10_000 }).toBe(true);
      await page.keyboard.press('h');
      await expect.poll(async () => (await state(page)).downed).toBe(false);
      await flyInto(page, east);
    }
  }
  expect((await state(page)).sector).toBe(cleared);
  expect((await state(page)).clearedSectors).toContain(sector);
  // The clear gave this player a part; the notice naming it can be gone already.
  const last = (await state(page)).lastClear;
  expect(last?.sector).toBe(sector);
  expect(last?.reward, 'the clear gave this player a part').toBeDefined();

  // K on a development server sends an attack at the cleared sector (#102):
  // the HUD counts it down and a banner says what to do.
  await page.keyboard.press('k');
  await expect.poll(async () => (await state(page)).worldEvent).toMatch(new RegExp(`^${sector} under attack · \\d+:\\d\\d to save it$`));
  await expect
    .poll(async () => (await state(page)).missionBanner, { timeout: 20_000 })
    .toMatch(new RegExp(`^Sector ${sector} is under attack!\\n`));
});
