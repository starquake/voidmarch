import assert from 'node:assert/strict';
import { test } from 'node:test';

import { vignetteDarkness, vignetteImage } from './vignette.ts';

const VIGNETTE = { x: 0.5, y: 0.5, radius: 0.9, strength: 0.35 };

test('the vignette leaves the center clear and darkens toward the edges, as the filter does', () => {
  assert.equal(vignetteDarkness(0.5, 0.5, VIGNETTE), 0);
  const edge = vignetteDarkness(0.5, 0, VIGNETTE);
  const corner = vignetteDarkness(0, 0, VIGNETTE);
  assert.ok(Math.abs(edge - Math.sin((0.5 / 0.9) * 3.14 * 0.35)) < 1e-12);
  assert.ok(corner > edge && edge > 0, `corner ${String(corner)} edge ${String(edge)}`);
  assert.equal(vignetteDarkness(0.5, 0.5, { ...VIGNETTE, radius: 0.1, x: 0 }), 1, 'black beyond the radius');
});

test('the vignette image is black at that darkness everywhere', () => {
  const size = 8;
  const data = vignetteImage(size, VIGNETTE);
  assert.equal(data.length, size * size * 4);
  const at = (x: number, y: number): number[] => [...data.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
  const [r, g, b, middle] = at(4, 4);
  assert.deepEqual([r, g, b], [0, 0, 0]);
  assert.ok((middle ?? 255) < (at(0, 0)[3] ?? 0), 'clearer in the middle than in the corner');
});
