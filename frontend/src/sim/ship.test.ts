import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ShipCommand } from './input.ts';
import { TAU } from './math.ts';
import { createShip, stepShip } from './ship.ts';
import { ENGINE_STATS, TICK_SECONDS } from './tuning.ts';

const hold = (moveX: number, moveY: number, aimX = 0, aimY = -1000): ShipCommand => ({
  moveX,
  moveY,
  aimX,
  aimY,
  fire: false,
});

test('a new ship is at rest, facing up, with the default loadout', () => {
  const ship = createShip(1, 2);
  assert.deepEqual([ship.x, ship.y, ship.vx, ship.vy], [1, 2, 0, 0]);
  assert.equal(ship.angle, -Math.PI / 2);
  assert.equal(ship.loadout.weapon, 'autoCannon');
});

test('createShip copies the loadout', () => {
  const loadout = { weapon: 'zapper', engine: 'burst', shield: 'round' } as const;
  const ship = createShip(0, 0, loadout);
  ship.loadout.weapon = 'rockets';
  assert.equal(loadout.weapon, 'zapper');
});

test('thrusting accelerates the ship in the move direction', () => {
  const ship = createShip(0, 0);
  stepShip(ship, hold(0, -1), TICK_SECONDS);
  assert.ok(ship.vy < 0);
  assert.ok(ship.y < 0);
  assert.equal(ship.thrusting, true);
});

test('speed never exceeds the engine maximum', () => {
  for (const engine of ['base', 'bigPulse', 'burst', 'supercharged'] as const) {
    const ship = createShip(0, 0, { weapon: 'autoCannon', engine, shield: 'front' });
    for (let i = 0; i < 600; i++) {
      stepShip(ship, hold(1, 0), TICK_SECONDS);
    }
    const speed = Math.hypot(ship.vx, ship.vy);
    assert.ok(speed <= ENGINE_STATS[engine].maxSpeed + 1e-9, `${engine}: ${speed}`);
    assert.ok(speed > ENGINE_STATS[engine].maxSpeed * 0.5, `${engine} is too slow: ${speed}`);
  }
});

test('drag brings a coasting ship to rest', () => {
  const ship = createShip(0, 0);
  ship.vx = 200;
  for (let i = 0; i < 600; i++) {
    stepShip(ship, hold(0, 0), TICK_SECONDS);
  }
  assert.ok(Math.abs(ship.vx) < 1);
  assert.equal(ship.thrusting, false);
});

test('the ship faces the aim point', () => {
  const ship = createShip(0, 0);
  stepShip(ship, hold(0, 0, 100, 0), TICK_SECONDS);
  assert.ok(Math.abs(ship.angle) < 1e-9);
  stepShip(ship, hold(0, 0, 0, 100), TICK_SECONDS);
  assert.ok(Math.abs(ship.angle - Math.PI / 2) < 1e-9);
});

test('aiming at the ship itself keeps the current facing', () => {
  const ship = createShip(0, 0);
  ship.angle = 1;
  stepShip(ship, hold(0, 0, 0, 0), TICK_SECONDS);
  assert.equal(ship.angle, 1);
});

test('rotation snap limits facing to fixed directions', () => {
  const ship = createShip(0, 0);
  ship.rotationSnap = 16;
  stepShip(ship, hold(0, 0, 100, 12), TICK_SECONDS);
  const steps = ship.angle / (TAU / 16);
  assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9);
});
