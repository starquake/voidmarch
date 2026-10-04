import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MIN_ZOOM, backgroundScale, integerZoom } from './zoom.ts';

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

test('a background tile is scaled up until one covers the view', () => {
  assert.equal(backgroundScale(640, 360, 640, 360), 1, 'the view the tile was drawn for');
  assert.equal(backgroundScale(800, 450, 640, 360), 2, '1600x900 at 150%: zoom 3');
  assert.equal(backgroundScale(959, 539, 640, 360), 2);
  assert.equal(backgroundScale(640, 800, 640, 360), 3, 'a tall window');
  assert.equal(backgroundScale(0, 0, 640, 360), 1);
});
