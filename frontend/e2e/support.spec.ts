import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { aimAt, state } from './hunt.ts';

/**
 * Up and left of home, toward C3's center: 600 px out is past the safe zone
 * and within reach of C3's garrison, which no spec fights. Its line-up never
 * moves on, so its second ship, a Support Ship (#184), comes out every time.
 */
const TOWARD_C3 = { x: -Math.sqrt(3) / 2, y: -1 / 2 };
const OUT = 600;

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
  await page.keyboard.up('w');

  await expect
    .poll(async () => (await state(page)).enemies.filter((e) => e.kind === 'support').length, {
      message: 'a Support Ship comes out',
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
});

/** An enemy as protobuf JSON puts it in a snapshot (`?wire=json`). */
interface WireEnemy {
  enemyId: number;
  kind: string;
  faction: string;
  x: number;
  y: number;
  angle: number;
  repairing?: number;
}

/** Ids past any the hub hands out, so the added ships never meet a real one. */
const SUPPORT_ID = 4_000_000_000;
const FIGHTER_ID = SUPPORT_ID + 1;
const SCOUT_ID = SUPPORT_ID + 2;

/** The added ships' controls: where they fly, and the end of the repair. */
interface Repair {
  near: (x: number, y: number) => void;
  stop: () => void;
}

/**
 * Routes the page's connection through to its server, adding to every
 * snapshot, once `near` places them, a Support Ship, the Fighter it repairs
 * until `stop`, and a Scout it never repairs. A real repair lasts only while
 * the garrison wins its fight, which no spec can count on (#188).
 */
async function withRepair(page: Page): Promise<Repair> {
  let at: { x: number; y: number } | undefined;
  let repairing = true;
  await page.routeWebSocket('**/ws', (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      const frame = typeof message === 'string' ? (JSON.parse(message) as { snapshot?: { enemies?: WireEnemy[] } }) : {};
      if (at === undefined || frame.snapshot === undefined) {
        ws.send(message);

        return;
      }
      const { x, y } = at;
      const ship = (enemyId: number, kind: string, dx: number): WireEnemy => ({
        enemyId,
        kind: `ENEMY_KIND_${kind}`,
        faction: 'ENEMY_FACTION_KLAED',
        x: x + dx,
        y: y - 120,
        angle: Math.PI / 2,
      });
      frame.snapshot.enemies = [
        ...(frame.snapshot.enemies ?? []),
        { ...ship(SUPPORT_ID, 'SUPPORT', -80), repairing: repairing ? FIGHTER_ID : 0 },
        ship(FIGHTER_ID, 'FIGHTER', 0),
        ship(SCOUT_ID, 'SCOUT', 80),
      ];
      ws.send(JSON.stringify(frame));
    });
  });

  return {
    near: (nx, ny) => {
      at = { x: nx, y: ny };
    },
    stop: () => {
      repairing = false;
    },
  };
}

test("a small ship shows its shield while it's repaired, and not after (#188)", async ({ page }) => {
  const repair = await withRepair(page);
  await page.goto('/?wire=json');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const { ship } = await state(page);
  repair.near(ship.x, ship.y);

  const shields = async (): Promise<{ fighter: boolean | undefined; scout: boolean | undefined }> => {
    const { enemies } = await state(page);
    const shielded = (id: number): boolean | undefined => enemies.find((e) => e.id === id)?.shielded;

    return { fighter: shielded(FIGHTER_ID), scout: shielded(SCOUT_ID) };
  };
  await expect
    .poll(shields, { message: 'the repaired Fighter shows its shield, the Scout beside it none' })
    .toEqual({ fighter: true, scout: false });

  repair.stop();
  await expect.poll(shields, { message: 'the shield goes once the repair stops' }).toEqual({ fighter: false, scout: false });
});
