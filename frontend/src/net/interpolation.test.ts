import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_LOADOUT } from '../sim/loadout.ts';
import { StateBuffer } from './interpolation.ts';
import type { RemoteShip } from './mapping.ts';

const ship = (x: number, y: number, angle = 0, thrusting = false): RemoteShip => ({
  x,
  y,
  vx: 0,
  vy: 0,
  angle,
  thrusting,
  loadout: { ...DEFAULT_LOADOUT },
  damage: 0,
  shield: 3,
});

const close = (actual: number | undefined, expected: number): void => {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
};

test('an empty buffer has nothing to show', () => {
  const buffer = new StateBuffer<RemoteShip>();
  assert.equal(buffer.empty, true);
  assert.equal(buffer.sample(10), undefined);
});

test('positions are blended between the surrounding snapshots', () => {
  const buffer = new StateBuffer<RemoteShip>();
  buffer.push(10, ship(0, 0));
  buffer.push(11, ship(10, 20));
  buffer.push(12, ship(30, 20));
  close(buffer.sample(10.5)?.x, 5);
  close(buffer.sample(10.5)?.y, 10);
  close(buffer.sample(11.25)?.x, 15);
});

test('before the first and after the last snapshot the ship holds still', () => {
  const buffer = new StateBuffer<RemoteShip>();
  buffer.push(10, ship(1, 1));
  buffer.push(11, ship(2, 2));
  close(buffer.sample(5)?.x, 1);
  close(buffer.sample(50)?.x, 2);
});

test('angles turn the short way round', () => {
  const buffer = new StateBuffer<RemoteShip>();
  buffer.push(1, ship(0, 0, Math.PI - 0.1));
  buffer.push(2, ship(0, 0, -Math.PI + 0.1));
  const angle = buffer.sample(1.5)?.angle ?? 0;
  assert.ok(Math.abs(Math.abs(angle) - Math.PI) < 1e-9, `angle ${angle}`);
});

test('discrete state comes from the earlier snapshot', () => {
  const buffer = new StateBuffer<RemoteShip>();
  buffer.push(1, ship(0, 0, 0, false));
  buffer.push(2, ship(0, 0, 0, true));
  assert.equal(buffer.sample(1.9)?.thrusting, false);
  assert.equal(buffer.sample(2)?.thrusting, true);
});

test('out-of-order snapshots are ignored and old ones are forgotten', () => {
  const buffer = new StateBuffer<RemoteShip>();
  buffer.push(5, ship(5, 0));
  buffer.push(4, ship(4, 0));
  close(buffer.sample(4)?.x, 5);
  for (let tick = 6; tick < 60; tick++) {
    buffer.push(tick, ship(tick, 0));
  }
  close(buffer.sample(5)?.x, 28);
});
