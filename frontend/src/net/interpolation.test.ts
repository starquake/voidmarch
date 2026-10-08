import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_LOADOUT } from '../sim/loadout.ts';
import { StateBuffer } from './interpolation.ts';
import type { RemoteShip } from './mapping.ts';

const ship = (x: number, y: number, angle = 0, thrusting = false, vx = 0, vy = 0): RemoteShip => ({
  x,
  y,
  vx,
  vy,
  angle,
  thrusting,
  loadout: { ...DEFAULT_LOADOUT },
  damage: 0,
  shield: 3,
  revive: 0,
});

const close = (actual: number | undefined, expected: number, message = ''): void => {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${String(actual)} is not ${String(expected)} ${message}`);
};

test('an empty buffer has nothing to show', () => {
  const buffer = new StateBuffer<RemoteShip>(20);
  assert.equal(buffer.empty, true);
  assert.equal(buffer.sample(10), undefined);
});

test('positions are blended between the surrounding snapshots', () => {
  const buffer = new StateBuffer<RemoteShip>(20);
  buffer.push(10, ship(0, 0));
  buffer.push(11, ship(10, 20));
  buffer.push(12, ship(30, 20));
  close(buffer.sample(10.5)?.x, 5);
  close(buffer.sample(10.5)?.y, 10);
  close(buffer.sample(11.25)?.x, 15);
});

test('before the first and after the last snapshot a ship at rest holds still', () => {
  const buffer = new StateBuffer<RemoteShip>(20);
  buffer.push(10, ship(1, 1));
  buffer.push(11, ship(2, 2));
  close(buffer.sample(5)?.x, 1);
  close(buffer.sample(50)?.x, 2);
});

test('angles turn the short way round', () => {
  const buffer = new StateBuffer<RemoteShip>(20);
  buffer.push(1, ship(0, 0, Math.PI - 0.1));
  buffer.push(2, ship(0, 0, -Math.PI + 0.1));
  const angle = buffer.sample(1.5)?.angle ?? 0;
  assert.ok(Math.abs(Math.abs(angle) - Math.PI) < 1e-9, `angle ${angle}`);
});

test('discrete state comes from the earlier snapshot', () => {
  const buffer = new StateBuffer<RemoteShip>(20);
  buffer.push(1, ship(0, 0, 0, false));
  buffer.push(2, ship(0, 0, 0, true));
  assert.equal(buffer.sample(1.9)?.thrusting, false);
  assert.equal(buffer.sample(2)?.thrusting, true);
});

test('out-of-order snapshots are ignored and old ones are forgotten', () => {
  const buffer = new StateBuffer<RemoteShip>(20);
  buffer.push(5, ship(5, 0));
  buffer.push(4, ship(4, 0));
  close(buffer.sample(4)?.x, 5);
  for (let tick = 6; tick < 60; tick++) {
    buffer.push(tick, ship(tick, 0));
  }
  close(buffer.sample(5)?.x, 28);
});

test('past the newest snapshot a ship flies on for up to 3 ticks, then holds', () => {
  const buffer = new StateBuffer<RemoteShip>(20);
  buffer.push(10, ship(0, 0, 1, true, 200, -100));
  const on = buffer.sample(11.5);
  close(on?.x, 15);
  close(on?.y, -7.5);
  close(on?.angle, 1);
  assert.equal(on?.thrusting, true);
  close(buffer.sample(13)?.x, 30);
  close(buffer.sample(40)?.x, 30);
  close(buffer.sample(40)?.y, -15);
});

test('nothing is drawn from an empty buffer', () => {
  assert.equal(new StateBuffer<RemoteShip>(20).draw(10), undefined);
});

test('a drawn ship follows its samples while they agree', () => {
  const buffer = new StateBuffer<RemoteShip>(20);
  buffer.push(10, ship(0, 0, 0, false, 200));
  close(buffer.draw(10.5)?.x, 5);
  buffer.push(11, ship(10, 0, 0, false, 200));
  close(buffer.draw(11.5)?.x, 15);
  close(buffer.draw(12)?.x, 20);
});

test('a correction from a newer snapshot fades out over 2 ticks', () => {
  const buffer = new StateBuffer<RemoteShip>(20);
  buffer.push(10, ship(0, 0, 0, false, 200));
  buffer.push(11, ship(10, 0, 0, false, 200));
  close(buffer.draw(12)?.x, 20);
  // It stopped at 14, not 20: drawn from where it was, closing in on 14.
  buffer.push(12, ship(14, 0));
  close(buffer.draw(12)?.x, 20);
  close(buffer.draw(12.5)?.x, 18.5);
  close(buffer.draw(13)?.x, 17);
  close(buffer.draw(14)?.x, 14);
  close(buffer.draw(20)?.x, 14);
  close(buffer.sample(12)?.x, 14, 'sampling ignores the drawn offset');
});

test('a correction over 150 px snaps, as for a respawn', () => {
  const buffer = new StateBuffer<RemoteShip>(20);
  buffer.push(10, ship(0, 0, 0, false, 200));
  close(buffer.draw(11)?.x, 10);
  buffer.push(11, ship(500, 0));
  close(buffer.draw(11.5)?.x, 500);
});

test('a moving ship repeated in the next snapshot is skipped, so it is bridged rather than held', () => {
  const buffer = new StateBuffer<RemoteShip>(20);
  buffer.push(10, ship(0, 0, 0, false, 200));
  buffer.push(11, ship(0, 0, 0, false, 200)); // the hub had no newer state
  buffer.push(12, ship(20, 0, 0, false, 200));
  close(buffer.sample(11)?.x, 10);
});

test('a ship at rest is kept in every snapshot, so it starts moving when it does', () => {
  const buffer = new StateBuffer<RemoteShip>(20);
  buffer.push(10, ship(0, 0));
  buffer.push(11, ship(0, 0));
  buffer.push(12, ship(10, 0));
  close(buffer.sample(11)?.x, 0);
  close(buffer.sample(11.5)?.x, 5);
});
