import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distanceToSide, fieldColor, fieldSides, nearestSide, sparks, zapVolume } from './forcefield.ts';
import { WORLD_EDGE_BAND } from './rules.gen.ts';
import { FIELD_COLOR, FIELD_DRAW_RANGE, FIELD_HOT_COLOR, FIELD_STEP, FIELD_ZAP_VOLUME } from './tuning.ts';

const SIDE = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };

test('distanceToSide measures to the nearest point, ends included', () => {
  assert.equal(distanceToSide(SIDE, { x: 50, y: 30 }), 30);
  assert.equal(distanceToSide(SIDE, { x: -30, y: 40 }), 50);
  assert.equal(distanceToSide(SIDE, { x: 103, y: -4 }), 5);
  assert.equal(distanceToSide({ a: { x: 1, y: 1 }, b: { x: 1, y: 1 } }, { x: 4, y: 5 }), 5);
});

test('nearestSide takes the closest side, and is Infinity with none', () => {
  const far = { a: { x: 0, y: 500 }, b: { x: 100, y: 500 } };
  assert.equal(nearestSide([far, SIDE], { x: 50, y: 20 }), 20);
  assert.equal(nearestSide([], { x: 0, y: 0 }), Number.POSITIVE_INFINITY);
});

test('fieldSides samples only the sides near the ship', () => {
  const far = { a: { x: 0, y: FIELD_DRAW_RANGE + 50 }, b: { x: 100, y: FIELD_DRAW_RANGE + 50 } };
  const sides = fieldSides([SIDE, far], { x: 50, y: 10 }, 0);
  assert.equal(sides.length, 1);
  const [side] = sides;
  assert.ok(side);
  assert.equal(side.samples.length, Math.ceil(100 / FIELD_STEP) + 1);
  assert.deepEqual([side.nx, side.ny], [-0, 1]);
});

test('the field flares near the ship and ripples close to its side', () => {
  const near = fieldSides([SIDE], { x: 0, y: 0 }, 1.5)[0]?.samples ?? [];
  assert.equal(near[0]?.flare, 1);
  const calm = fieldSides([{ a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }], { x: 0, y: 0 }, 1.5)[0]?.samples ?? [];
  assert.equal(calm.at(-1)?.flare, 0);
  for (const s of [...near, ...calm]) {
    assert.ok(Math.abs(s.y) < 20 && Math.abs(s.y2) < 20, `a strand strays to ${String(s.y)}, ${String(s.y2)}`);
    assert.ok(s.flicker >= 0.3 && s.flicker <= 1);
  }
});

test('the field moves with time, and the same time draws the same field', () => {
  const at = (t: number): number[] => (fieldSides([SIDE], { x: 50, y: 300 }, t)[0]?.samples ?? []).map((s) => s.y);
  assert.deepEqual(at(2), at(2));
  assert.notDeepEqual(at(2), at(2.1));
});

test('fieldColor runs from the field red to the hot color', () => {
  assert.equal(fieldColor(0), FIELD_COLOR);
  assert.equal(fieldColor(1), FIELD_HOT_COLOR);
});

test('sparks are few, and change over time', () => {
  const at = (t: number): number => Array.from({ length: 1000 }, (_, i) => sparks(i, t)).filter(Boolean).length;
  assert.ok(at(0) > 0 && at(0) < 200, `${String(at(0))} sparks in 1000 samples`);
  assert.notDeepEqual(
    Array.from({ length: 100 }, (_, i) => sparks(i, 0)),
    Array.from({ length: 100 }, (_, i) => sparks(i, 0.05)),
  );
});

test('a zap sounds only inside the push-back band, louder the deeper', () => {
  assert.equal(zapVolume(WORLD_EDGE_BAND), 0);
  assert.equal(zapVolume(WORLD_EDGE_BAND + 100), 0);
  assert.equal(zapVolume(0), FIELD_ZAP_VOLUME);
  assert.ok(zapVolume(50) > zapVolume(150) && zapVolume(150) > 0);
});
