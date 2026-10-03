import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deviceSize, renderRatio } from './display.ts';

test('the canvas is as large as the device pixels it covers', () => {
  assert.deepEqual(deviceSize(1280, 720, 1.5), { width: 1920, height: 1080, zoom: 1 / 1.5, dpr: 1.5 });
  assert.deepEqual(deviceSize(1440, 900, 2), { width: 2880, height: 1800, zoom: 0.5, dpr: 2 });
  assert.deepEqual(deviceSize(960, 540, 1), { width: 960, height: 540, zoom: 1, dpr: 1 });
});

test('fractional device sizes round down, so the canvas never overflows the window', () => {
  const size = deviceSize(1281, 721, 1.25);
  assert.equal(size.width, 1601);
  assert.equal(size.height, 901);
  assert.ok(size.width * size.zoom <= 1281);
});

test('a missing or broken ratio counts as 1', () => {
  for (const dpr of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(deviceSize(800, 600, dpr), { width: 800, height: 600, zoom: 1, dpr: 1 });
  }
});

test('a collapsed window still gets a 1-pixel canvas', () => {
  assert.deepEqual(deviceSize(0, 0, 2), { width: 1, height: 1, zoom: 0.5, dpr: 2 });
});

test('rendering at CSS pixels uses a ratio of 1, a quarter of the pixels on a 2x screen', () => {
  assert.equal(renderRatio(2, false), 2);
  assert.equal(renderRatio(2, true), 1);
  assert.deepEqual(deviceSize(1000, 600, renderRatio(2, true)), { width: 1000, height: 600, zoom: 1, dpr: 1 });
});
