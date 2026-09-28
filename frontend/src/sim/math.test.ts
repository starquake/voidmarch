import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TAU, normalize, seededRandom, wrapAngle } from './math.ts';

const close = (actual: number, expected: number, message?: string): void => {
  assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} is not close to ${expected}`);
};

test('wrapAngle maps angles into [-PI, PI)', () => {
  close(wrapAngle(0), 0);
  close(wrapAngle(TAU + 1), 1);
  close(wrapAngle(-TAU - 1), -1);
  close(wrapAngle(Math.PI), -Math.PI);
});

test('normalize returns a unit vector, or zero for zero', () => {
  const v = normalize(3, 4);
  close(v.x, 0.6);
  close(v.y, 0.8);
  assert.deepEqual(normalize(0, 0), { x: 0, y: 0 });
});

test('seededRandom is deterministic and in [0, 1)', () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  for (let i = 0; i < 100; i++) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
  }
  assert.notEqual(seededRandom(1)(), seededRandom(2)());
});
