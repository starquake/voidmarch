import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hitTarget } from './hits.ts';
import { SHOT_RADIUS } from './tuning.ts';

const targets = [
  { id: 1, x: 0, y: 0, radius: 10 },
  { id: 2, x: 100, y: 0, radius: 12 },
];

test('a projectile inside a circle hits it', () => {
  assert.equal(hitTarget(5, 5, targets)?.id, 1);
  assert.equal(hitTarget(95, 3, targets)?.id, 2);
});

test('the projectile has a little size of its own', () => {
  assert.equal(hitTarget(10 + SHOT_RADIUS, 0, targets)?.id, 1);
  assert.equal(hitTarget(10 + SHOT_RADIUS + 0.5, 0, targets), undefined);
});

test('a miss hits nothing', () => {
  assert.equal(hitTarget(50, 50, targets), undefined);
  assert.equal(hitTarget(0, 0, []), undefined);
});
