import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { SHIP_RADIUS, TICK_RATE, TICK_SECONDS, WEAPON_STATS } from './sim/rules.gen.ts';
import type { InputSnapshot } from './sim/input.ts';
import { Sandbox, instantiate, isWeapon, type GoRuntime } from './simwasm.ts';

const WASM = new URL('../../internal/web/static/wasm/', import.meta.url);
// The committed module, run as the page runs it, under TinyGo's wasm_exec.js;
// make test-wasm-fallback points these at a standard Go build and its glue.
const MODULE = process.env.SIM_WASM ?? new URL('sim.wasm', WASM);
const GLUE = process.env.SIM_WASM_EXEC ?? new URL('wasm_exec.js', WASM);

(0, eval)(readFileSync(GLUE, 'utf8'));
const Go = (globalThis as unknown as { Go: new () => GoRuntime }).Go;

/** A fresh sim: each has its own module instance and memory. */
async function sim(): Promise<Sandbox> {
  return new Sandbox(await instantiate(readFileSync(MODULE), new Go()));
}

const input = (overrides: Partial<InputSnapshot> = {}): InputSnapshot => ({
  up: false,
  down: false,
  left: false,
  right: false,
  pointerX: 0,
  pointerY: -1000,
  fire: false,
  ...overrides,
});

test('the ship starts below the home planet with the default parts', async () => {
  const s = await sim();
  assert.deepEqual([s.ship.x, s.ship.y], [0, 160]);
  assert.equal(s.ship.loadout.weapon, 'autoCannon');
});

test('advance runs whole ticks, moves the ship and remembers where it was', async () => {
  const s = await sim();
  const events = s.advance(TICK_SECONDS * 2.5, input({ up: true }));
  assert.equal(events.ticks, 2);
  assert.ok(Math.abs(s.alpha - 0.5) < 1e-6);
  assert.ok(s.ship.y < 160);
  assert.ok(s.previous.y > s.ship.y);
  assert.equal(s.ship.thrusting, true);
});

test('firing reports shots, which fly in the pool as own shots', async () => {
  const s = await sim();
  const events = s.advance(TICK_SECONDS, input({ fire: true }));
  const [fired] = events.shots;
  assert.ok(fired !== undefined && events.shots.length === 1);
  assert.equal(fired.weapon, 'autoCannon');
  assert.equal(s.projectiles.activeCount, 1);
  const shot = s.projectiles.items.find((p) => p.active);
  assert.ok(shot !== undefined);
  assert.deepEqual([shot.faction, shot.owner, shot.shotId], ['own', '', fired.id]);

  let expired = 0;
  for (let t = 0; t < WEAPON_STATS.autoCannon.lifetime + 0.2; t += TICK_SECONDS) {
    expired += s.advance(TICK_SECONDS, input()).expired.length;
  }
  assert.equal(expired, 1);
});

test('a charging weapon reports the charge, then the shot', async () => {
  const s = await sim();
  s.setLoadout({ ...s.ship.loadout, weapon: 'bigSpaceGun' });
  assert.equal(s.ship.loadout.weapon, 'bigSpaceGun');
  assert.deepEqual(s.advance(TICK_SECONDS, input({ fire: true })).charges, ['bigSpaceGun']);
  let shots = 0;
  for (let t = 0; t < 1; t += TICK_SECONDS) {
    shots += s.advance(TICK_SECONDS, input()).shots.length;
  }
  assert.equal(shots, 1);
});

test('screen-relative control moves W up whatever the aim', async () => {
  const s = await sim();
  s.controlMode = 'screen';
  assert.equal(s.controlMode, 'screen');
  for (let i = 0; i < 30; i++) {
    s.advance(TICK_SECONDS, input({ up: true, pointerX: 10_000, pointerY: 160 }));
  }
  assert.ok(Math.abs(s.ship.x) < 1e-9);
  assert.ok(s.ship.y < 140);
});

test('the ship can be placed, damaged and snapped', async () => {
  const s = await sim();
  s.placeShip(50, 60);
  assert.deepEqual([s.ship.x, s.ship.y, s.previous.x, s.previous.y], [50, 60, 50, 60]);
  s.setDamage(2);
  s.setRotationSnap(16);
  assert.deepEqual([s.ship.damage, s.ship.rotationSnap], [2, 16]);
});

test('a hit in front takes a shield charge, one from behind a hull step', async () => {
  const s = await sim();
  s.advance(TICK_SECONDS, input());
  assert.equal(s.ship.shield, 3);
  // The ship faces up, toward the pointer: the front shield covers above it.
  const front = s.projectiles.spawn({ kind: 'klaedBullet', x: 0, y: 100, angle: Math.PI / 2 }, { faction: 'enemy' });
  assert.equal(s.takeHit(front.slot), true);
  assert.deepEqual([s.ship.shield, s.ship.damage, s.ship.sinceHit], [2, 0, 0]);
  const behind = s.projectiles.spawn({ kind: 'klaedBullet', x: 0, y: 220, angle: -Math.PI / 2 }, { faction: 'enemy' });
  assert.equal(s.takeHit(behind.slot), false);
  assert.deepEqual([s.ship.shield, s.ship.damage], [2, 1]);
});

test('a squadmate near recharges the shield faster', async () => {
  const recharged = async (squadmateDistance: number): Promise<number> => {
    const s = await sim();
    const bullet = s.projectiles.spawn({ kind: 'klaedBullet', x: 0, y: 100, angle: Math.PI / 2 }, { faction: 'enemy' });
    s.takeHit(bullet.slot);
    for (let t = 0; t < 4 * TICK_RATE; t++) {
      s.advance(TICK_SECONDS, input(), squadmateDistance);
    }

    return s.ship.shield;
  };
  const alone = await recharged(Infinity);
  assert.ok(alone > 2 && alone < 3, `alone: ${String(alone)}`);
  assert.equal(await recharged(50), 3);
});

test('remote shots keep their owner and id, and end by them', async () => {
  const s = await sim();
  const p = s.projectiles.spawn({ kind: 'zapper', x: 0, y: 0, angle: 0 }, { faction: 'remote', owner: 'mo', shotId: 7 });
  assert.deepEqual([p.faction, p.owner, p.shotId, p.active], ['remote', 'mo', 7, true]);
  assert.equal(s.projectiles.end('sanne', 7), undefined);
  assert.equal(s.projectiles.end('mo', 7)?.slot, p.slot);
  assert.equal(p.active, false);
});

test('enemy bullets spawn part-way through their flight, and clear by faction', async () => {
  const s = await sim();
  const bullet = s.projectiles.spawn(
    { kind: 'klaedBullet', x: 0, y: 0, angle: 0 },
    { faction: 'enemy', owner: '3', ageSeconds: 1 },
  );
  assert.equal(bullet.age, 1);
  assert.ok(bullet.x > 100, 'a second along its way');
  assert.equal(isWeapon(bullet.kind), false);
  s.projectiles.clear('enemy');
  assert.equal(bullet.active, false);
});

test('a scan ends the shots that hit, and says what they hit', async () => {
  const s = await sim();
  const hitting = s.projectiles.spawn({ kind: 'autoCannon', x: -30, y: 0, angle: 0 });
  const missing = s.projectiles.spawn({ kind: 'autoCannon', x: -30, y: 100, angle: 0 });
  const bullet = s.projectiles.spawn({ kind: 'klaedBullet', x: -30, y: 0, angle: 0 }, { faction: 'enemy' });
  s.advance(TICK_SECONDS * 2, input());
  const hits = s.hitScan('own', TICK_SECONDS * 2, [{ id: 'enemy', x: 0, y: 0, radius: SHIP_RADIUS }]);
  assert.deepEqual(
    hits.map((h) => [h.projectile.slot, h.target.id]),
    [[hitting.slot, 'enemy']],
  );
  assert.deepEqual([hitting.active, missing.active, bullet.active], [false, true, true]);
  assert.deepEqual(s.hitScan('enemy', TICK_SECONDS, []), []);
});

test('an enemy volley is the same for the same seed, and leaves in front of the enemy', async () => {
  const s = await sim();
  const a = s.enemyPattern('fighter', 100, 50, 0, 4_000_000_000);
  assert.deepEqual(a, s.enemyPattern('fighter', 100, 50, 0, 4_000_000_000));
  const [bullet] = a;
  assert.ok(bullet !== undefined);
  assert.equal(bullet.kind, 'klaedBigBullet');
  assert.ok(bullet.x > 100);
});
