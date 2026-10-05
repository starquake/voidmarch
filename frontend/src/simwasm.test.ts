import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { HOME_SPAWN_Y, MAX_DAMAGE, RAM_SPEED, RESPAWN_DELAY, SHIP_RADIUS, TICK_RATE, TICK_SECONDS, WEAPON_STATS } from './sim/rules.gen.ts';
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
  // A new weapon waits out the swap first (#191).
  assert.ok(s.ship.cooldown > 0);
  assert.deepEqual(s.advance(TICK_SECONDS, input({ fire: true })).charges, [], 'nothing during the swap');
  while (s.ship.cooldown > 0) {
    s.advance(TICK_SECONDS, input());
  }
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

test('a closed ring stops the ship at its side, and an opened sector lets it through', async () => {
  const s = await sim();
  const d3Top = -3 * (Math.sqrt(3) / 2) * 990;
  const fly = (): number => {
    s.placeShip(0, d3Top + 50);
    for (let i = 0; i < 60; i++) {
      s.advance(TICK_SECONDS, input({ up: true, pointerX: 0, pointerY: s.ship.y - 1000 }));
    }

    return s.ship.y;
  };
  s.setFrontier(1, []);
  assert.ok(fly() >= d3Top, 'kept out of closed D2');
  s.setFrontier(1, ['D2', 'Z9']);
  assert.ok(fly() < d3Top, 'through into D2, opened on its own');
});

test('an enemy bullet meets the front shield ahead, and only the hull behind', async () => {
  const s = await sim();
  s.advance(TICK_SECONDS, input());
  const { x, y } = s.ship;
  assert.equal(s.ship.shield, 3);
  const me = [{ id: 'me', x, y, angle: s.ship.angle, shield: s.ship.loadout.shield, charges: s.ship.shield }];
  // 20 px out: within the shield's reach, beyond the hull's. The ship faces up.
  const ahead = s.projectiles.spawn({ kind: 'klaedBullet', x, y: y - 20, angle: Math.PI / 2 }, { faction: 'enemy' });
  const behind = s.projectiles.spawn({ kind: 'klaedBullet', x, y: y + 20, angle: -Math.PI / 2 }, { faction: 'enemy' });
  const hits = s.shipScan(TICK_SECONDS, me);
  assert.deepEqual(
    hits.map((h) => [h.projectile.slot, h.ship.id]),
    [[ahead.slot, 'me']],
  );
  assert.equal(behind.active, true);
  const from = hits[0]?.from ?? NaN;
  assert.ok(Math.abs(from + Math.PI / 2) < 1e-9, `from ${String(from)}`);

  assert.equal(s.takeHit(from, 'autoCannon'), true);
  assert.deepEqual([s.ship.shield, s.ship.damage, s.ship.sinceHit], [2, 0, 0]);
  assert.equal(s.takeHit(Math.PI / 2, 'autoCannon'), false);
  assert.deepEqual([s.ship.shield, s.ship.damage], [2, 1]);
  assert.deepEqual(s.shipScan(TICK_SECONDS, []), []);
});

test('a squadmate near recharges the shield faster', async () => {
  const recharged = async (squadmateDistance: number): Promise<number> => {
    const s = await sim();
    s.advance(TICK_SECONDS, input());
    s.takeHit(-Math.PI / 2, 'autoCannon');
    for (let t = 0; t < 4 * TICK_RATE; t++) {
      s.advance(TICK_SECONDS, input(), squadmateDistance);
    }

    return s.ship.shield;
  };
  const alone = await recharged(Infinity);
  assert.ok(alone > 2 && alone < 3, `alone: ${String(alone)}`);
  assert.equal(await recharged(50), 3);
});

test('bumping pushes the ship out, and a ram hurts once per cooldown', async () => {
  const s = await sim();
  s.advance(TICK_SECONDS, input());
  const { x, y } = s.ship;
  const resting = { x: x + 20, y, vx: 0, vy: 0, radius: SHIP_RADIUS, key: 1, side: 1 };
  assert.deepEqual(s.bump([resting]), []);
  assert.ok(Math.abs(s.ship.x - (x - 4)) < 1e-9, `pushed to ${String(s.ship.x)}`);

  // From behind, where the front shield doesn't cover.
  const ramming = { x: s.ship.x, y: s.ship.y + 20, vx: 0, vy: -2 * RAM_SPEED, radius: SHIP_RADIUS, key: 2, side: 1 };
  assert.deepEqual(s.bump([ramming]), [{ index: 0, absorbed: false }]);
  assert.equal(s.ship.damage, 1);
  assert.deepEqual(s.bump([{ ...ramming, y: s.ship.y + 20 }]), []);
});

test('three hull hits take the ship down; it respawns whole after the delay', async () => {
  const s = await sim();
  s.advance(TICK_SECONDS, input());
  for (let i = 0; i < MAX_DAMAGE; i++) {
    s.takeHit(Math.PI / 2, 'autoCannon');
  }
  assert.equal(s.downed, true);
  assert.equal(s.ship.shield, 0);
  assert.equal(s.respawn(0, HOME_SPAWN_Y), false);
  // Down, it ignores the controls.
  s.advance(TICK_SECONDS, input({ up: true, fire: true }));
  assert.equal(s.ship.thrusting, false);
  for (let t = 0; t <= RESPAWN_DELAY * TICK_RATE; t++) {
    s.advance(TICK_SECONDS, input());
  }
  assert.equal(s.canRespawn, true);
  assert.equal(s.respawn(0, HOME_SPAWN_Y), true);
  assert.deepEqual([s.downed, s.ship.damage, s.ship.shield, s.ship.y], [false, 0, 3, HOME_SPAWN_Y]);
});

test('a friend near revives a downed ship, one hull step up', async () => {
  const s = await sim();
  for (let i = 0; i < MAX_DAMAGE; i++) {
    s.takeHit(Math.PI / 2, 'autoCannon');
  }
  // A squadmate 30 px away revives in 3 s.
  for (let t = 0; t < 4 * TICK_RATE; t++) {
    s.advance(TICK_SECONDS, input(), 30, 30);
  }
  assert.equal(s.downed, false);
  assert.equal(s.ship.damage, MAX_DAMAGE - 1);
});

test('a big space gun ball bursts into the same star on every screen, its shards ended by number', async () => {
  const mine = await sim();
  const theirs = await sim();
  const own = mine.burst('bigSpaceGun', 'own', 10, 20, 7, 'sanne');
  const remote = theirs.burst('bigSpaceGun', 'remote', 10, 20, 7, 'sanne');
  assert.equal(own.length, 8);
  assert.deepEqual(
    own.map((p) => [p.kind, p.shard, p.shotId, p.angle]),
    remote.map((p) => [p.kind, p.shard, p.shotId, p.angle]),
  );
  assert.deepEqual(own.map((p) => p.shard), [1, 2, 3, 4, 5, 6, 7, 8]);
  // Ending shard 3 of Sanne's shot 7 leaves the others flying.
  assert.equal(theirs.projectiles.end('sanne', 7, 3)?.shard, 3);
  assert.equal(theirs.projectiles.activeCount, 7);
  assert.notDeepEqual(
    (await sim()).burst('bigSpaceGun', 'own', 10, 20, 7, 'mo').map((p) => p.angle),
    own.map((p) => p.angle),
  );
  assert.deepEqual(mine.burst('zapper', 'own', 0, 0, 1, 'sanne'), []);
});

test('a rocket steers toward an enemy ahead', async () => {
  const s = await sim();
  const rocket = s.projectiles.spawn({ kind: 'rockets', x: 0, y: 0, angle: 0 });
  s.steer('own', TICK_SECONDS, [{ id: 1, x: 200, y: -100, radius: 10 }]);
  assert.ok(rocket.angle < 0, `angle ${String(rocket.angle)}, want turned up toward the enemy`);
});

test('a zapper shot pierces two enemies and ends on the third', async () => {
  const s = await sim();
  s.projectiles.spawn({ kind: 'zapper', x: 0, y: 0, angle: 0 }, { ageSeconds: 0.2 });
  const row = [11, 12, 13].map((id) => ({ id, x: 0, y: 0, radius: 200 }));
  const goesOn = [0, 1, 2].map(() => s.hitScan('own', 0.2, row)[0]?.goesOn);
  assert.deepEqual(goesOn, [true, true, false]);
});

test('a projectile that runs out names its shot and owner', async () => {
  const s = await sim();
  s.projectiles.spawn({ kind: 'bigSpaceGun', x: 0, y: 0, angle: 0 }, { faction: 'remote', owner: 'mo', shotId: 9, ageSeconds: 1.99 });
  const events = s.advance(TICK_SECONDS, input());
  assert.deepEqual(
    events.expired.map((e) => [e.kind, e.faction, e.shotId, e.owner]),
    [['bigSpaceGun', 'remote', 9, 'mo']],
  );
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
  const a = s.enemyPattern('fighter', 'klaed', 100, 50, 0, 4_000_000_000);
  assert.deepEqual(a, s.enemyPattern('fighter', 'klaed', 100, 50, 0, 4_000_000_000));
  const [bullet] = a;
  assert.ok(bullet !== undefined);
  assert.equal(bullet.kind, 'klaedBigBullet');
  assert.ok(bullet.x > 100);
});

test("each faction's Scouts and Fighters fire their own pack's bullets", async () => {
  const s = await sim();
  assert.equal(s.enemyPattern('scout', 'nairan', 0, 0, 0, 1)[0]?.kind, 'nairanBolt');
  assert.equal(s.enemyPattern('fighter', 'nairan', 0, 0, 0, 1)[0]?.kind, 'nairanRay');
  assert.equal(s.enemyPattern('scout', 'nautolan', 0, 0, 0, 1)[0]?.kind, 'nautolanBullet');
  assert.equal(s.enemyPattern('fighter', 'nautolan', 0, 0, 0, 1)[0]?.kind, 'nautolanSpinningBullet');
});

test('a Bomber fires a pair that curves in, and a Torpedo takes two hull steps', async () => {
  const s = await sim();
  const pair = s.enemyPattern('bomber', 'nairan', 0, 0, 0, 1);
  assert.equal(pair.length, 2);
  assert.ok(pair.every((b) => b.kind === 'nairanRocket'));
  assert.ok((pair[0]?.curve ?? 0) * (pair[1]?.curve ?? 0) < 0, 'the two curve toward each other');
  const [torpedo] = s.enemyPattern('torpedo', 'nautolan', 0, 0, 0, 1);
  assert.equal(torpedo?.kind, 'nautolanWave');
  s.takeHit(Math.PI / 2, 'nautolanWave');
  assert.equal(s.ship.damage, 2);
});

test("the Kla'ed heavies fire a pair of Big Bullets and a Torpedo that takes two hull steps", async () => {
  const s = await sim();
  const pair = s.enemyPattern('bomber', 'klaed', 0, 0, 0, 1);
  assert.equal(pair.length, 2);
  assert.ok(pair.every((b) => b.kind === 'klaedBigBullet'));
  const [torpedo] = s.enemyPattern('torpedo', 'klaed', 0, 0, 0, 1);
  assert.equal(torpedo?.kind, 'klaedTorpedo');
  s.takeHit(Math.PI / 2, 'klaedTorpedo');
  assert.equal(s.ship.damage, 2);
});

test('a Frigate fires a whole ring of big bullets', async () => {
  const s = await sim();
  const ring = s.enemyPattern('frigate', 'klaed', 0, 0, 0, 7);
  assert.equal(ring.length, 12);
  assert.ok(ring.every((b) => b.kind === 'klaedBigBullet'));
});
