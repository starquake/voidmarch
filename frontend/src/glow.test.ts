import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bakeGlow, double, type Pixels } from './glow.ts';

/** A width x height image, clear but for opaque white pixels at the given places. */
function image(width: number, height: number, white: readonly [number, number][]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of white) {
    data.set([255, 255, 255, 255], (y * width + x) * 4);
  }

  return { width, height, data };
}

const pixel = (img: Pixels, x: number, y: number): number[] => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

const GLOW = { color: 0x3fa8ff, strength: 6, quality: 3, distance: 4 };

test('doubling makes each pixel a 2x2 block', () => {
  const big = double(image(2, 1, [[1, 0]]));
  assert.deepEqual([big.width, big.height], [4, 2]);
  assert.deepEqual(pixel(big, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual([pixel(big, 2, 0), pixel(big, 3, 1)], [[255, 255, 255, 255], [255, 255, 255, 255]]);
});

test('a baked glow is padded by its distance and keeps the shape as drawn', () => {
  const src = image(3, 3, [[1, 1]]);
  const glowing = bakeGlow(src, GLOW);
  assert.deepEqual([glowing.width, glowing.height], [3 + 8, 3 + 8]);
  assert.deepEqual(pixel(glowing, 5, 5), [255, 255, 255, 255], 'the shape itself is untouched');
});

test('the glow is the glow color, strongest next to the shape and gone beyond its distance', () => {
  const src = image(4, 4, [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
  ]);
  const glowing = bakeGlow(src, GLOW);
  // The shape sits at 5..6 in the padded image.
  const [r, g, b, near] = pixel(glowing, 4, 5);
  assert.ok((near ?? 0) > 0, 'glow right next to the shape');
  assert.deepEqual([r, g, b], [0x3f, 0xa8, 0xff], 'in the glow color');
  const [, , , far] = pixel(glowing, 1, 5);
  assert.ok((far ?? 0) < (near ?? 0), 'weaker further out');
  assert.deepEqual(pixel(glowing, 0, 0), [0, 0, 0, 0], 'none past the distance');
});
