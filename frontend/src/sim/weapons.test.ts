import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WEAPONS } from './loadout.ts';
import { createShip } from './ship.ts';
import { TICK_SECONDS, WEAPON_STATS } from './tuning.ts';
import { stepWeapon } from './weapons.ts';

const fireFor = (weapon: (typeof WEAPONS)[number], seconds: number): number => {
  const ship = createShip(0, 0, { weapon, engine: 'base', shield: 'front' });
  let shots = 0;
  for (let t = 0; t < seconds; t += TICK_SECONDS) {
    shots += stepWeapon(ship, true, TICK_SECONDS).length;
  }

  return shots;
};

test('a ready weapon fires on the first tick', () => {
  const ship = createShip(0, 0);
  assert.equal(stepWeapon(ship, true, TICK_SECONDS).length, 1);
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

test('not firing lets the cooldown recover but not bank shots', () => {
  const ship = createShip(0, 0);
  stepWeapon(ship, true, TICK_SECONDS);
  for (let i = 0; i < 120; i++) {
    stepWeapon(ship, false, TICK_SECONDS);
  }
  assert.equal(ship.cooldown, 0);
  assert.equal(stepWeapon(ship, true, TICK_SECONDS).length, 1);
});

test('alternating weapons switch barrels each shot', () => {
  const ship = createShip(0, 0);
  ship.angle = 0;
  const first = stepWeapon(ship, true, TICK_SECONDS)[0];
  ship.cooldown = 0;
  const second = stepWeapon(ship, true, TICK_SECONDS)[0];
  assert.ok(first !== undefined && second !== undefined);
  assert.notEqual(Math.sign(first.y), Math.sign(second.y));
});

test('shots leave from the muzzle in the aim direction', () => {
  const ship = createShip(100, 50, { weapon: 'bigSpaceGun', engine: 'base', shield: 'front' });
  ship.angle = 0;
  const [shot] = stepWeapon(ship, true, TICK_SECONDS);
  assert.ok(shot !== undefined);
  assert.equal(shot.weapon, 'bigSpaceGun');
  assert.equal(shot.angle, 0);
  assert.ok(Math.abs(shot.x - 116) < 1e-9);
  assert.ok(Math.abs(shot.y - 50) < 1e-9);
});

test('the zapper fires both prongs at once', () => {
  const ship = createShip(0, 0, { weapon: 'zapper', engine: 'base', shield: 'front' });
  assert.equal(stepWeapon(ship, true, TICK_SECONDS).length, 2);
});
