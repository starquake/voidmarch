import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProjectilePool, place, travelled, type Projectile } from './projectiles.ts';
import { TICK_SECONDS, WEAPON_STATS } from './tuning.ts';

const always = (): boolean => true;

test('travelled is linear without acceleration', () => {
  const stats = WEAPON_STATS.autoCannon;
  assert.equal(travelled(stats, 0.5), stats.speed * 0.5);
});

test('travelled accelerates rockets up to their top speed', () => {
  const stats = WEAPON_STATS.rockets;
  const early = travelled(stats, 0.1) - travelled(stats, 0);
  const late = travelled(stats, 1.1) - travelled(stats, 1);
  assert.ok(early < late);
  assert.ok(Math.abs(late - stats.maxSpeed * 0.1) < 1e-6);
});

test('place is a pure function of spawn and age', () => {
  const make = (): Projectile => ({
    active: true,
    weapon: 'zapper',
    originX: 10,
    originY: 20,
    angle: 1,
    age: 0.3,
    x: 0,
    y: 0,
  });
  const a = make();
  const b = make();
  place(a);
  place(b);
  assert.deepEqual(a, b);
});

test('the zapper zigzags across its line of fire', () => {
  const p: Projectile = { active: true, weapon: 'zapper', originX: 0, originY: 0, angle: 0, age: 0, x: 0, y: 0 };
  const sides = new Set<number>();
  for (let age = 0.01; age < 0.4; age += 0.02) {
    p.age = age;
    place(p);
    sides.add(Math.sign(Math.round(p.y * 1000)));
  }
  assert.ok(sides.has(1) && sides.has(-1));
});

test('projectiles fly and expire at the end of their lifetime', () => {
  const pool = new ProjectilePool(8);
  const p = pool.spawn({ weapon: 'autoCannon', muzzle: 0, x: 0, y: 0, angle: 0 });
  assert.equal(pool.activeCount, 1);

  pool.step(TICK_SECONDS, always);
  assert.ok(p.x > 0);

  let expired = 0;
  for (let t = 0; t < WEAPON_STATS.autoCannon.lifetime + 0.1; t += TICK_SECONDS) {
    expired += pool.step(TICK_SECONDS, always).length;
  }
  assert.equal(expired, 1);
  assert.equal(pool.activeCount, 0);
});

test('projectiles expire when they leave the bounds', () => {
  const pool = new ProjectilePool(4);
  pool.spawn({ weapon: 'autoCannon', muzzle: 0, x: 0, y: 0, angle: 0 });
  const expired = pool.step(TICK_SECONDS, () => false);
  assert.equal(expired.length, 1);
});

test('a full pool reuses its oldest projectile', () => {
  const pool = new ProjectilePool(2);
  const first = pool.spawn({ weapon: 'autoCannon', muzzle: 0, x: 0, y: 0, angle: 0 });
  pool.step(TICK_SECONDS, always);
  pool.spawn({ weapon: 'autoCannon', muzzle: 0, x: 0, y: 0, angle: 0 });
  const third = pool.spawn({ weapon: 'rockets', muzzle: 0, x: 5, y: 5, angle: 0 });
  assert.equal(third, first);
  assert.equal(third.weapon, 'rockets');
  assert.equal(pool.activeCount, 2);
});

test('a pool needs capacity', () => {
  const pool = new ProjectilePool(0);
  assert.throws(() => pool.spawn({ weapon: 'autoCannon', muzzle: 0, x: 0, y: 0, angle: 0 }), /zero capacity/);
});

test('a projectile can start part-way through its flight', () => {
  const pool = new ProjectilePool(2);
  const p = pool.spawn({ weapon: 'autoCannon', muzzle: 0, x: 0, y: 0, angle: 0 }, 0.5);
  assert.equal(p.age, 0.5);
  assert.equal(p.x, WEAPON_STATS.autoCannon.speed * 0.5);
});
