import assert from 'node:assert/strict';
import { test } from 'node:test';

import { relativeTo, toCommand, type InputSnapshot } from './input.ts';

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

const close = (actual: number, expected: number): void => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not close to ${expected}`);
};

test('ship-relative W thrusts toward the facing', () => {
  // Facing right: W moves right, S moves left.
  let cmd = relativeTo(toCommand({ ...idle, up: true }), 0);
  close(cmd.moveX, 1);
  close(cmd.moveY, 0);
  cmd = relativeTo(toCommand({ ...idle, down: true }), 0);
  close(cmd.moveX, -1);
  close(cmd.moveY, 0);
});

test('ship-relative D strafes to the ship right', () => {
  // Facing right (+x), the ship's right is down the screen (+y).
  const cmd = relativeTo(toCommand({ ...idle, right: true }), 0);
  close(cmd.moveX, 0);
  close(cmd.moveY, 1);
});

test('ship-relative keys match the screen when facing up', () => {
  const cmd = relativeTo(toCommand({ ...idle, up: true, right: true }), -Math.PI / 2);
  const screen = toCommand({ ...idle, up: true, right: true });
  close(cmd.moveX, screen.moveX);
  close(cmd.moveY, screen.moveY);
  assert.deepEqual([cmd.aimX, cmd.aimY, cmd.fire], [screen.aimX, screen.aimY, screen.fire]);
});
