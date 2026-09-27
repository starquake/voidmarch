import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WEAPONS } from './loadout.ts';
import { createShip } from './ship.ts';
import { TICK_SECONDS, WEAPON_STATS } from './tuning.ts';
import { stepWeapon } from './weapons.ts';

const armed = (weapon: (typeof WEAPONS)[number], x = 0, y = 0): ReturnType<typeof createShip> =>
  createShip(x, y, { weapon, engine: 'base', shield: 'front' });

const fireFor = (weapon: (typeof WEAPONS)[number], seconds: number): number => {
  const ship = armed(weapon);
  let shots = 0;
  for (let t = 0; t < seconds; t += TICK_SECONDS) {
    shots += stepWeapon(ship, true, TICK_SECONDS).shots.length;
  }

  return shots;
};

test('a ready weapon without a charge fires on the first tick', () => {
  const step = stepWeapon(armed('autoCannon'), true, TICK_SECONDS);
  assert.equal(step.shots.length, 1);
  assert.equal(step.chargeStarted, false);
});

test('holding fire keeps each weapon at its rate', () => {
  for (const weapon of WEAPONS) {
    const stats = WEAPON_STATS[weapon];
    const perVolley = stats.alternate ? 1 : stats.muzzles.length;
    const expected = Math.ceil(3 / stats.interval) * perVolley;
    const shots = fireFor(weapon, 3);
    assert.ok(Math.abs(shots - expected) <= perVolley, `${weapon}: ${shots} shots, want about ${expected}`);
  }
});

test('the big space gun charges before its shot leaves', () => {
  const ship = armed('bigSpaceGun');
  const first = stepWeapon(ship, true, TICK_SECONDS);
  assert.equal(first.chargeStarted, true);
  assert.equal(first.shots.length, 0);

  let elapsed = 0;
  let shots = 0;
  while (shots === 0 && elapsed < 2) {
    elapsed += TICK_SECONDS;
    shots = stepWeapon(ship, true, TICK_SECONDS).shots.length;
  }
  assert.equal(shots, 1);
  const charge = WEAPON_STATS.bigSpaceGun.charge;
  assert.ok(Math.abs(elapsed - charge) <= TICK_SECONDS * 1.5, `released after ${elapsed}s, charge is ${charge}s`);
});

test('a started charge fires even when the trigger is let go', () => {
  const ship = armed('bigSpaceGun');
  stepWeapon(ship, true, TICK_SECONDS);
  let shots = 0;
  for (let t = 0; t < 1; t += TICK_SECONDS) {
    shots += stepWeapon(ship, false, TICK_SECONDS).shots.length;
  }
  assert.equal(shots, 1);
});

test('the shot leaves from where the ship is when the charge completes', () => {
  const ship = armed('bigSpaceGun');
  ship.angle = 0;
  stepWeapon(ship, true, TICK_SECONDS);
  ship.x = 500;
  let shot;
  for (let t = 0; t < 1 && shot === undefined; t += TICK_SECONDS) {
    shot = stepWeapon(ship, true, TICK_SECONDS).shots[0];
  }
  assert.ok(shot !== undefined);
  assert.ok(Math.abs(shot.x - 516) < 1e-9);
});

test('not firing lets the cooldown recover but not bank shots', () => {
  const ship = armed('autoCannon');
  stepWeapon(ship, true, TICK_SECONDS);
  for (let i = 0; i < 120; i++) {
    stepWeapon(ship, false, TICK_SECONDS);
  }
  assert.equal(ship.cooldown, 0);
  assert.equal(stepWeapon(ship, true, TICK_SECONDS).shots.length, 1);
});

test('alternating weapons switch barrels each shot and say which', () => {
  const ship = armed('autoCannon');
  ship.angle = 0;
  const first = stepWeapon(ship, true, TICK_SECONDS).shots[0];
  ship.cooldown = 0;
  const second = stepWeapon(ship, true, TICK_SECONDS).shots[0];
  assert.ok(first !== undefined && second !== undefined);
  assert.notEqual(Math.sign(first.y), Math.sign(second.y));
  assert.deepEqual([first.muzzle, second.muzzle], [0, 1]);
});

test('shots leave from the muzzle in the aim direction', () => {
  const ship = armed('autoCannon', 100, 50);
  ship.angle = 0;
  const [shot] = stepWeapon(ship, true, TICK_SECONDS).shots;
  assert.ok(shot !== undefined);
  assert.equal(shot.weapon, 'autoCannon');
  assert.equal(shot.angle, 0);
  assert.ok(Math.abs(shot.x - 109) < 1e-9);
  assert.ok(Math.abs(shot.y - 39.5) < 1e-9);
});

test('the zapper fires both prongs at once after its short charge', () => {
  const ship = armed('zapper');
  let shots: number[] = [];
  for (let t = 0; t < 0.5 && shots.length === 0; t += TICK_SECONDS) {
    shots = stepWeapon(ship, true, TICK_SECONDS).shots.map((s) => s.muzzle);
  }
  assert.deepEqual(shots, [0, 1]);
});
