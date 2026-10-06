import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distanceToSide, fieldColor, fieldDotImage, fieldSides, nearestSide, sparks, zapVolume, type View } from './forcefield.ts';
import { WORLD_EDGE_BAND } from './rules.gen.ts';
import {
  FIELD_COLOR,
  FIELD_CORE_RADIUS,
  FIELD_DOT_TEXELS,
  FIELD_DRAW_RANGE,
  FIELD_GLOW_RADIUS,
  FIELD_HOT_COLOR,
  FIELD_STEP,
  FIELD_VIEW_MARGIN,
  FIELD_ZAP_VOLUME,
} from './tuning.ts';

const SIDE = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
const EVERYWHERE: View = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };

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
  const sides = fieldSides([SIDE, far], { x: 50, y: 10 }, 0, EVERYWHERE);
  assert.equal(sides.length, 1);
  const [side] = sides;
  assert.ok(side);
  assert.equal(side.samples.length, Math.ceil(100 / FIELD_STEP) + 1);
  assert.deepEqual([side.nx, side.ny], [-0, 1]);
  assert.equal(side.first, 0);
});

const LONG = { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } };

test('fieldSides gives nothing for a side outside the view', () => {
  const ship = { x: 500, y: 100 };
  const below: View = { left: 0, top: 200, right: 1000, bottom: 400 };
  assert.deepEqual(fieldSides([LONG], ship, 0, below), []);
  const pastTheEnd: View = { left: 1000 + FIELD_VIEW_MARGIN + 1, top: -100, right: 2000, bottom: 100 };
  assert.deepEqual(fieldSides([LONG], ship, 0, pastTheEnd), []);
});

test('fieldSides samples only the part of a side in the view, the same as the whole side', () => {
  const ship = { x: 500, y: 100 };
  const view: View = { left: 400, top: -50, right: 600, bottom: 250 };
  const [side] = fieldSides([LONG], ship, 1.5, view);
  assert.ok(side);
  const whole = fieldSides([LONG], ship, 1.5, EVERYWHERE)[0]?.samples ?? [];
  assert.deepEqual(side.samples, whole.slice(side.first, side.first + side.samples.length));
  const xs = side.samples.map((s) => s.x);
  assert.ok(Math.min(...xs) <= view.left - FIELD_VIEW_MARGIN, `the first sample is at ${String(Math.min(...xs))}`);
  assert.ok(Math.min(...xs) > view.left - FIELD_VIEW_MARGIN - FIELD_STEP - 1, `the first sample is at ${String(Math.min(...xs))}`);
  assert.ok(Math.max(...xs) >= view.right + FIELD_VIEW_MARGIN, `the last sample is at ${String(Math.max(...xs))}`);
  assert.ok(Math.max(...xs) < view.right + FIELD_VIEW_MARGIN + FIELD_STEP + 1, `the last sample is at ${String(Math.max(...xs))}`);
  assert.ok(side.samples.length < whole.length / 3);
});

test('fieldSides culls a slanted side to the view too', () => {
  const slant = { a: { x: 0, y: 0 }, b: { x: 600, y: 800 } };
  const view: View = { left: 200, top: 300, right: 400, bottom: 500 };
  const [side] = fieldSides([slant], { x: 300, y: 400 }, 0, view);
  assert.ok(side);
  for (const s of side.samples) {
    const along = s.x * 0.6 + s.y * 0.8;
    assert.ok(along > 300 * 0.6 + 400 * 0.8 - 250 && along < 300 * 0.6 + 400 * 0.8 + 250, `a sample at ${String(s.x)}, ${String(s.y)}`);
  }
});

test('the field dot is the core inside the glow, both disks, nothing outside', () => {
  const { size, data } = fieldDotImage();
  const radius = FIELD_GLOW_RADIUS * FIELD_DOT_TEXELS;
  assert.equal(size, radius * 2);
  const alpha = (x: number, y: number): number => data[(y * size + x) * 4 + 3] ?? -1;
  const center = radius;
  assert.equal(alpha(center, center), 255);
  assert.equal(alpha(center + FIELD_CORE_RADIUS * FIELD_DOT_TEXELS - 2, center), 255);
  assert.equal(alpha(center + FIELD_CORE_RADIUS * FIELD_DOT_TEXELS + 2, center), 128);
  assert.equal(alpha(center + radius - 2, center), 128);
  assert.equal(alpha(0, 0), 0);
  assert.equal(alpha(size - 1, size - 1), 0);
  assert.deepEqual([...data.slice(0, 3)], [255, 255, 255]);
});

test('the field flares near the ship and ripples close to its side', () => {
  const near = fieldSides([SIDE], { x: 0, y: 0 }, 1.5, EVERYWHERE)[0]?.samples ?? [];
  assert.equal(near[0]?.flare, 1);
  const calm = fieldSides([{ a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }], { x: 0, y: 0 }, 1.5, EVERYWHERE)[0]?.samples ?? [];
  assert.equal(calm.at(-1)?.flare, 0);
  for (const s of [...near, ...calm]) {
    assert.ok(Math.abs(s.y) < 20 && Math.abs(s.y2) < 20, `a strand strays to ${String(s.y)}, ${String(s.y2)}`);
    assert.ok(s.flicker >= 0.3 && s.flicker <= 1);
  }
});

test('the field moves with time, and the same time draws the same field', () => {
  const at = (t: number): number[] => (fieldSides([SIDE], { x: 50, y: 300 }, t, EVERYWHERE)[0]?.samples ?? []).map((s) => s.y);
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
  assert.equal(zapVolume(WORLD_EDGE_BAND, false), 0);
  assert.equal(zapVolume(WORLD_EDGE_BAND + 100, false), 0);
  assert.equal(zapVolume(0, false), FIELD_ZAP_VOLUME);
  assert.ok(zapVolume(50, false) > zapVolume(150, false) && zapVolume(150, false) > 0);
});

test('a downed ship hears no zap, however deep in the band', () => {
  assert.equal(zapVolume(0, true), 0);
  assert.equal(zapVolume(100, true), 0);
});
