import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MIN_ZOOM, integerZoom } from './zoom.ts';

test('integerZoom picks the largest scale that fits', () => {
  assert.equal(integerZoom(1920, 1080, 640, 360), 3);
  assert.equal(integerZoom(2560, 1440, 640, 360), 4);
});

test('integerZoom is limited by the tighter axis', () => {
  assert.equal(integerZoom(3000, 800, 640, 360), 2);
});

test('integerZoom never goes below the minimum', () => {
  assert.equal(integerZoom(320, 200, 640, 360), MIN_ZOOM);
});
