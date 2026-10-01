import type { Page } from '@playwright/test';

import { expect } from './fixtures.ts';

import type { DebugState } from '../src/debug.ts';

/** Helpers for specs that fly out and shoot enemies down (#4, #77). */
export const state = (page: Page): Promise<DebugState> =>
  page.evaluate(() => {
    if (window.voidmarch === undefined) {
      throw new Error('window.voidmarch is not published');
    }

    return structuredClone(window.voidmarch);
  });

/** Goes down and respawns this many times at most before the hunt fails. */
export const TRIES = 5;

/**
 * Inside D5, the sector south of home, where the e2e map keeps a garrison
 * that never runs out (#99): home's sector ends at y 800.
 */
export const IN_D5 = 900;

/**
 * Points the mouse at a world position, from the ship at the screen center,
 * kept inside the viewport so the page sees the pointer.
 */
export async function aimAt(page: Page, s: DebugState, x: number, y: number): Promise<void> {
  const view = page.viewportSize() ?? { width: 640, height: 360 };
  const clamp = (v: number, max: number): number => Math.min(max - 1, Math.max(0, v));
  await page.mouse.move(
    clamp(view.width / 2 + (x - s.ship.x) * s.zoom, view.width),
    clamp(view.height / 2 + (y - s.ship.y) * s.zoom, view.height),
  );
}

/** The enemy nearest the ship, if any. */
const nearest = (s: DebugState): DebugState['enemies'][number] | undefined =>
  s.enemies.reduce<DebugState['enemies'][number] | undefined>(
    (best, e) =>
      best === undefined || Math.hypot(e.x - s.ship.x, e.y - s.ship.y) < Math.hypot(best.x - s.ship.x, best.y - s.ship.y)
        ? e
        : best,
    undefined,
  );

/** Flies from wherever the ship is, down from the home planet, into D5 and its garrison. */
export async function flyOut(page: Page): Promise<void> {
  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      const s = await state(page);
      await aimAt(page, s, s.ship.x, s.ship.y + 150);

      return s.ship.y;
    })
    .toBeGreaterThan(IN_D5);
  await page.keyboard.up('w');
}

/**
 * Cycles the weapon with the development key 1 until rockets are fitted. A
 * hunt that goes round again finds them fitted already, and one more press
 * would step past them (#96).
 */
export async function fitRockets(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const { weapon } = (await state(page)).loadout;
        if (weapon !== 'rockets') {
          await page.keyboard.press('1');
        }

        return weapon;
      },
      { message: 'rockets are fitted', intervals: [250] },
    )
    .toBe('rockets');
}

/**
 * Keeps the nearest enemy in the sights until one this player shot down is
 * gone, or the ship goes down. Chasing one strafing enemy at a slow runner's
 * frame rate can miss for good (#31).
 */
export async function hunt(page: Page): Promise<'shot' | 'down'> {
  const before = (await state(page)).enemiesDestroyed;
  const shot = (s: DebugState): boolean =>
    s.enemiesDestroyed > before && !s.enemies.some((e) => e.id === s.lastEnemyDestroyed);
  await page.mouse.down();
  await expect
    .poll(
      async () => {
        const s = await state(page);
        const target = nearest(s);
        if (target !== undefined) {
          await aimAt(page, s, target.x, target.y);
        }

        return shot(s) || s.downed;
      },
      { message: 'an enemy this player shot down is gone', timeout: 45_000, intervals: [100] },
    )
    .toBe(true);
  await page.mouse.up();

  return shot(await state(page)) ? 'shot' : 'down';
}

/**
 * Flies out and shoots an enemy down with rockets: a Scout goes down in one
 * hit and a Fighter in two, where the auto cannon needs two and six (#73).
 * Out there the ship can go down before it hits anything (#47): then it
 * respawns at home and goes again.
 */
export async function shootOneDown(page: Page): Promise<void> {
  await fitRockets(page);
  for (let tries = 1; ; tries++) {
    await flyOut(page);
    await expect
      .poll(async () => (await state(page)).enemies.length, { message: 'an enemy shows up', timeout: 20_000 })
      .toBeGreaterThan(0);
    if ((await hunt(page)) === 'shot') {
      break;
    }
    expect(tries, 'went down five times without shooting an enemy down').toBeLessThan(TRIES);
    await expect.poll(async () => (await state(page)).canRespawn, { timeout: 10_000 }).toBe(true);
    await page.keyboard.press('h');
    await expect.poll(async () => (await state(page)).downed).toBe(false);
  }
}

/**
 * Flies at the nearest pickup until this player owns more than owned parts,
 * and reports whether they do; false when the ship goes down first. It keeps
 * thrusting: flying through a pickup collects it, and a ship left to coast can
 * stop just short of its reach (#84).
 */
export async function collectNearest(page: Page, owned: number): Promise<boolean> {
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

/**
 * Shoots enemies down and collects a part they drop, until this player owns
 * more than owned parts. The E2E server sets DROP_CHANCE=1, so every kill
 * drops one (#77). Enemies keep shooting while the ship collects: going down
 * means going home and shooting down another.
 */
export async function collectAPart(page: Page, owned: number): Promise<void> {
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
}

/**
 * Flies home and eases off inside the safe zone, so the ship comes to rest
 * there. Enemies can still shoot it down on the way: then it respawns, which
 * is at home too.
 */
export async function flyHome(page: Page): Promise<void> {
  let last = { x: Number.NaN, y: Number.NaN };
  await expect
    .poll(
      async () => {
        const s = await state(page);
        if (s.downed) {
          await page.keyboard.up('w');
          if (s.canRespawn) {
            await page.keyboard.press('h');
          }

          return false;
        }
        const far = Math.hypot(s.ship.x, s.ship.y) > HOME;
        await aimAt(page, s, 0, 0);
        await (far ? page.keyboard.down('w') : page.keyboard.up('w'));
        const still = Math.hypot(s.ship.x - last.x, s.ship.y - last.y) < 1;
        last = { x: s.ship.x, y: s.ship.y };

        return !far && still;
      },
      { message: 'the ship is home, at rest', timeout: 60_000, intervals: [100] },
    )
    .toBe(true);
  await page.keyboard.up('w');
}

/** Well inside the server's safe zone around the home planet (300). */
const HOME = 150;
