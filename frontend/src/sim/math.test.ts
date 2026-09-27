import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TAU, clamp, normalize, rotateOffset, seededRandom, snapAngle, triangleWave, wrapAngle } from './math.ts';

const close = (actual: number, expected: number, message?: string): void => {
  assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} is not close to ${expected}`);
};

test('clamp limits a value to a range', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
});

test('wrapAngle maps angles into [-PI, PI)', () => {
  close(wrapAngle(0), 0);
  close(wrapAngle(TAU + 1), 1);
  close(wrapAngle(-TAU - 1), -1);
  close(wrapAngle(Math.PI), -Math.PI);
});

test('snapAngle leaves angles free with 0 steps', () => {
  close(snapAngle(0.3, 0), 0.3);
});

test('snapAngle rounds to the nearest of 16 directions', () => {
  const step = TAU / 16;
  close(snapAngle(step * 0.4, 16), 0);
  close(snapAngle(step * 0.6, 16), step);
  close(snapAngle(-step * 3.2, 16), -step * 3);
});

test('normalize returns a unit vector, or zero for zero', () => {
  const v = normalize(3, 4);
  close(v.x, 0.6);
  close(v.y, 0.8);
  assert.deepEqual(normalize(0, 0), { x: 0, y: 0 });
});

test('rotateOffset maps sprite forward and right into world space', () => {
  // Facing +x: forward is +x and right is +y (down the screen).
  let v = rotateOffset(10, 2, 0);
  close(v.x, 10);
  close(v.y, 2);

  // Facing up (-y): forward is -y and right is +x.
  v = rotateOffset(10, 2, -Math.PI / 2);
  close(v.x, 2);
  close(v.y, -10);
});

test('triangleWave runs 0, 1, 0, -1 over a period', () => {
  close(triangleWave(0), 0);
  close(triangleWave(0.25), 1);
  close(triangleWave(0.5), 0);
  close(triangleWave(0.75), -1);
  close(triangleWave(1), 0);
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
