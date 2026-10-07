import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allBlack, blankSamples, deviceSize, enlargedSize, renderRatio } from './display.ts';

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

test('a black world is told by a grid of pure black samples across the middle', () => {
  const grid = blankSamples(1000, 500);
  assert.equal(grid.length, 9);
  assert.deepEqual(grid[0], { x: 300, y: 150 });
  assert.deepEqual(grid.at(-1), { x: 700, y: 350 });
  const black = new Uint8Array([0, 0, 0, 255]);
  const space = new Uint8Array([5, 3, 10, 255]);
  assert.equal(allBlack([black, black]), true);
  assert.equal(allBlack([black, space]), false, 'the background drew somewhere');
  assert.equal(allBlack([]), false);
});

test('the half-size glow of the bloom enlarges by whole numbers, a pixel past an odd screen (#234)', () => {
  assert.deepEqual(enlargedSize({ width: 640, height: 360 }, { width: 1280, height: 720 }), { width: 1280, height: 720 });
  assert.deepEqual(enlargedSize({ width: 641, height: 361 }, { width: 1281, height: 721 }), { width: 1282, height: 722 });
  assert.deepEqual(enlargedSize({ width: 1266, height: 585 }, { width: 2532, height: 1170 }), { width: 2532, height: 1170 });
  assert.deepEqual(enlargedSize({ width: 800, height: 600 }, { width: 800, height: 600 }), { width: 800, height: 600 }, 'the same size stays');
});
