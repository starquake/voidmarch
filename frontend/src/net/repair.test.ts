import assert from 'node:assert/strict';
import { test } from 'node:test';

import { repairLines, type RepairingEnemy } from './repair.ts';

test('a repairing Support Ship draws a line to the ship it repairs', () => {
  const enemies = new Map<number, RepairingEnemy>([
    [1, { drawn: { x: 10, y: 20 }, repairing: 2 }],
    [2, { drawn: { x: 40, y: 60 }, repairing: 0 }],
  ]);
  assert.deepEqual(repairLines(enemies), [{ fromX: 10, fromY: 20, toX: 40, toY: 60 }]);
});

test('no line without a repair, or with either end not drawn', () => {
  const enemies = new Map<number, RepairingEnemy>([
    [1, { drawn: { x: 0, y: 0 }, repairing: 0 }],
    [2, { drawn: { x: 0, y: 0 }, repairing: 9 }],
    [3, { drawn: undefined, repairing: 1 }],
    [4, { drawn: { x: 0, y: 0 }, repairing: 5 }],
    [5, { drawn: undefined, repairing: 0 }],
  ]);
  assert.deepEqual(repairLines(enemies), []);
});
