import type { Page } from '@playwright/test';

import { INTEREST_MARGIN, INTEREST_RADIUS } from '../src/sim/tuning.ts';
import { expect, test } from './fixtures.ts';
import { flyHome, flyOut, state } from './hunt.ts';

/** An id no server enemy reaches, for the Scout the route adds. */
const FAKE_ID = 4_000_000_000;

/**
 * Passes every frame between the page and the real server, adding a Scout at
 * scout's place to each snapshot while it is set.
 */
async function addScout(page: Page, scout: { current: { x: number; y: number } | undefined }): Promise<void> {
  await page.routeWebSocket('**/ws', (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      server.send(message);
    });
    server.onMessage((message) => {
      const at = scout.current;
      if (typeof message !== 'string' || at === undefined) {
        ws.send(message);

        return;
      }
      const msg = JSON.parse(message) as { snapshot?: { enemies?: unknown[] } };
      if (msg.snapshot !== undefined) {
        msg.snapshot.enemies = [
          ...(msg.snapshot.enemies ?? []),
          { enemyId: FAKE_ID, kind: 'ENEMY_KIND_SCOUT', faction: 'ENEMY_FACTION_KLAED', x: at.x, y: at.y },
        ];
      }
      ws.send(JSON.stringify(msg));
    });
  });
}

test('an enemy that leaves the snapshots goes quietly, and comes back when it returns (#231)', async ({ page }) => {
  const scout: { current: { x: number; y: number } | undefined } = { current: undefined };
  await addScout(page, scout);
  await page.goto('/?wire=json');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const { ship } = await state(page);
  scout.current = { x: ship.x + 250, y: ship.y };

  const shown = async (): Promise<boolean> => (await state(page)).enemies.some((e) => e.id === FAKE_ID);
  await expect.poll(shown, { message: 'the Scout shows while it is in the snapshots' }).toBe(true);

  const destroyed = (await state(page)).enemiesDestroyed;
  scout.current = undefined;
  await expect.poll(shown, { message: 'the Scout leaves once it is out of the snapshots' }).toBe(false);
  const after = await state(page);
  expect(after.enemiesGone.filter((g) => g.id === FAKE_ID), 'it went quietly, without exploding').toEqual([
    { id: FAKE_ID, exploded: false },
  ]);
  expect(after.enemiesDestroyed, 'no kill was counted').toBe(destroyed);

  scout.current = { x: ship.x + 250, y: ship.y };
  await expect.poll(shown, { message: 'the Scout is back once it is in the snapshots again' }).toBe(true);
});

/** How far past the edge an enemy may be drawn: 100 ms late, while the ship has moved on from the state the server used. */
const DRAW_SLACK = 100;

test('the server sends only the enemies near the ship, and every boss (#231)', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  // Checked every frame in the page while the ship flies out to D5's garrison and home.
  await page.evaluate((limit) => {
    const w = window as unknown as { interestCheck: { farthest: number; frames: number } };
    w.interestCheck = { farthest: 0, frames: 0 };
    let last: { x: number; y: number } | undefined;
    let settleUntil = 0;
    const check = (now: number): void => {
      const s = window.voidmarch;
      if (s !== undefined) {
        // A respawn moves the ship home before the server hears of it.
        if (last !== undefined && Math.hypot(s.ship.x - last.x, s.ship.y - last.y) > 200) {
          settleUntil = now + 1000;
        }
        last = { x: s.ship.x, y: s.ship.y };
        if (!s.downed && now > settleUntil) {
          const ships = [s.ship, ...s.companions];
          for (const e of s.enemies) {
            if (e.kind !== 'frigate' && e.kind !== 'dreadnought') {
              const nearest = Math.min(...ships.map((p) => Math.hypot(e.x - p.x, e.y - p.y)));
              w.interestCheck.farthest = Math.max(w.interestCheck.farthest, nearest - limit);
            }
          }
          w.interestCheck.frames++;
        }
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, INTEREST_RADIUS + INTEREST_MARGIN);

  await flyOut(page);
  await expect
    .poll(async () => (await state(page)).enemies.filter((e) => e.kind !== 'frigate' && e.kind !== 'dreadnought').length, {
      message: "D5's garrison shows",
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  await flyHome(page);

  const check = await page.evaluate(() => (window as unknown as { interestCheck: { farthest: number; frames: number } }).interestCheck);
  expect(check.frames, 'frames were checked').toBeGreaterThan(0);
  expect(check.farthest, 'px past the interest edge an enemy was drawn').toBeLessThanOrEqual(DRAW_SLACK);
});
