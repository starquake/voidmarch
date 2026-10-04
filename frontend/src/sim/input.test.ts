import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toCommand, type InputSnapshot } from './input.ts';

const idle: InputSnapshot = {
  up: false,
  down: false,
  left: false,
  right: false,
  pointerX: 5,
  pointerY: 6,
  fire: false,
};

test('no keys means no movement', () => {
  const cmd = toCommand(idle);
  assert.equal(cmd.moveX, 0);
  assert.equal(cmd.moveY, 0);
});

test('W moves up and D moves right', () => {
  assert.deepEqual([toCommand({ ...idle, up: true }).moveX, toCommand({ ...idle, up: true }).moveY], [0, -1]);
  assert.deepEqual([toCommand({ ...idle, right: true }).moveX, toCommand({ ...idle, right: true }).moveY], [1, 0]);
});

test('diagonals are no faster than straight lines', () => {
  const cmd = toCommand({ ...idle, down: true, left: true });
  assert.ok(Math.abs(Math.hypot(cmd.moveX, cmd.moveY) - 1) < 1e-9);
  assert.ok(cmd.moveX < 0 && cmd.moveY > 0);
});

test('opposite keys cancel out', () => {
  const cmd = toCommand({ ...idle, left: true, right: true });
  assert.equal(cmd.moveX, 0);
});

test('the pointer and fire button pass through', () => {
  const cmd = toCommand({ ...idle, fire: true });
  assert.deepEqual([cmd.aimX, cmd.aimY, cmd.fire], [5, 6, true]);
});

test('an analog stick moves as far as it is pushed, at most full speed', () => {
  const idle = { up: false, down: false, left: false, right: false, pointerX: 0, pointerY: 0, fire: false };
  assert.deepEqual(toCommand({ ...idle, up: true, moveX: 0.3, moveY: 0.4 }), { moveX: 0.3, moveY: 0.4, aimX: 0, aimY: 0, fire: false });
  const full = toCommand({ ...idle, moveX: 3, moveY: 4 });
  assert.deepEqual([full.moveX, full.moveY], [0.6, 0.8]);
});
