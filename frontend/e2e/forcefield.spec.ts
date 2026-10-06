import { WORLD_EDGE_BAND } from '../src/sim/rules.gen.ts';
import { sectorName, sectorOpen, sectorRing, type Frontier } from '../src/sim/sectors.ts';
import type { DebugState } from '../src/debug.ts';
import { expect, test } from './fixtures.ts';
import { aimAt, state } from './hunt.ts';

/**
 * Up and right from home, through E3 (ring 1) into F3, closed until the
 * Dreadnought falls (#123); or down and right, through E4 into F5.
 */
const HEADINGS = [-Math.PI / 6, Math.PI / 6].map((a) => ({ x: Math.cos(a), y: Math.sin(a) }));

/**
 * Whether flying straight along heading from the ship meets a closed sector
 * before any sector beyond the open rings: the one the Dreadnought woke in
 * opens for it, at random (#124), and has no field toward ring 1.
 */
function reachesField(s: DebugState, heading: { x: number; y: number }): boolean {
  const frontier: Frontier = { openRings: s.openRings, opened: new Set(s.openedSectors) };
  for (let d = 0; ; d += 50) {
    const name = sectorName(s.ship.x + heading.x * d, s.ship.y + heading.y * d);
    if (name === undefined || (sectorRing(name) ?? 0) > s.openRings) {
      return name !== undefined && !sectorOpen(name, frontier);
    }
  }
}

test('the closed ring\'s force field zaps a ship that flies into it', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const start = await state(page);
  expect(start.openRings).toBe(1);
  expect(start.field.zaps).toBe(0);
  const heading = HEADINGS.find((h) => reachesField(start, h));
  expect(heading, 'a heading meets the field before the Dreadnought\'s open sector').toBeDefined();
  const { x, y } = heading ?? { x: 0, y: 0 };

  await page.keyboard.down('w');
  await expect
    .poll(
      async () => {
        const s = await state(page);
        await aimAt(page, s, s.ship.x + x * 150, s.ship.y + y * 150);

        return s.field.distance ?? Number.POSITIVE_INFINITY;
      },
      { timeout: 60_000 },
    )
    .toBeLessThan(WORLD_EDGE_BAND);
  await expect.poll(async () => (await state(page)).field.zaps).toBeGreaterThan(0);
  expect((await state(page)).field.dots, 'the field glows').toBeGreaterThan(0);
  await page.keyboard.up('w');
});
