import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { InputSnapshot } from './input.ts';
import { Sandbox } from './sandbox.ts';
import { MAX_TICKS_PER_FRAME, TICK_SECONDS, WEAPON_STATS } from './tuning.ts';

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

test('advance runs whole ticks and carries the remainder', () => {
  const sandbox = new Sandbox();
  assert.equal(sandbox.advance(TICK_SECONDS * 2.5, input()).ticks, 2);
  assert.ok(Math.abs(sandbox.alpha - 0.5) < 1e-6);
  assert.equal(sandbox.advance(TICK_SECONDS * 0.6, input()).ticks, 1);
});

test('advance caps the ticks after a long stall', () => {
  const sandbox = new Sandbox();
  assert.equal(sandbox.advance(10, input()).ticks, MAX_TICKS_PER_FRAME);
});

test('holding W moves the ship up and remembers the previous position', () => {
  const sandbox = new Sandbox();
  const startY = sandbox.ship.y;
  sandbox.advance(0.5, input({ up: true }));
  assert.ok(sandbox.ship.y < startY);
  assert.ok(sandbox.previous.y > sandbox.ship.y);
});

test('a charging weapon reports the charge, then the shot', () => {
  const sandbox = new Sandbox();
  sandbox.ship.loadout.weapon = 'bigSpaceGun';
  const first = sandbox.advance(TICK_SECONDS, input({ fire: true }));
  assert.deepEqual(first.charges, ['bigSpaceGun']);
  assert.equal(first.shots.length, 0);

  let shots = 0;
  for (let t = 0; t < 1; t += TICK_SECONDS) {
    shots += sandbox.advance(TICK_SECONDS, input()).shots.length;
  }
  assert.equal(shots, 1);
});

test('firing spawns projectiles and reports shots and expiries', () => {
  const sandbox = new Sandbox();
  const events = sandbox.advance(TICK_SECONDS, input({ fire: true }));
  assert.equal(events.shots.length, 1);
  assert.equal(sandbox.projectiles.activeCount, 1);

  let expired = 0;
  for (let t = 0; t < WEAPON_STATS.autoCannon.lifetime + 0.2; t += TICK_SECONDS) {
    expired += sandbox.advance(TICK_SECONDS, input()).expired.length;
  }
  assert.equal(expired, 1);
});

test('ship-relative control is the default: W flies toward the aim', () => {
  const sandbox = new Sandbox();
  const startX = sandbox.ship.x;
  const aimRight = input({ up: true, pointerX: 10_000, pointerY: sandbox.ship.y });
  for (let i = 0; i < 30; i++) {
    sandbox.advance(TICK_SECONDS, aimRight);
  }
  assert.equal(sandbox.controlMode, 'ship');
  assert.ok(sandbox.ship.x > startX + 20);
});

test('screen-relative control: W flies up whatever the aim', () => {
  const sandbox = new Sandbox();
  sandbox.controlMode = 'screen';
  const start = { x: sandbox.ship.x, y: sandbox.ship.y };
  const aimRight = input({ up: true, pointerX: 10_000, pointerY: sandbox.ship.y });
  for (let i = 0; i < 30; i++) {
    sandbox.advance(TICK_SECONDS, aimRight);
  }
  assert.ok(sandbox.ship.y < start.y - 20);
  assert.ok(Math.abs(sandbox.ship.x - start.x) < 1e-9);
});
