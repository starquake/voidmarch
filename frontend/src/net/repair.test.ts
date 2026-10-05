import assert from 'node:assert/strict';
import { test } from 'node:test';

import { REPAIR_SHIELD_KINDS, repairLines, repairShields, type RepairingEnemy } from './repair.ts';

test('a repairing Support Ship draws a line to the ship it repairs', () => {
  const enemies = new Map<number, RepairingEnemy>([
    [1, { kind: 'support', drawn: { x: 10, y: 20 }, repairing: 2 }],
    [2, { kind: 'scout', drawn: { x: 40, y: 60 }, repairing: 0 }],
  ]);
  assert.deepEqual(repairLines(enemies), [{ fromX: 10, fromY: 20, toX: 40, toY: 60 }]);
});

test('no line without a repair, or with either end not drawn', () => {
  const enemies = new Map<number, RepairingEnemy>([
    [1, { kind: 'scout', drawn: { x: 0, y: 0 }, repairing: 0 }],
    [2, { kind: 'support', drawn: { x: 0, y: 0 }, repairing: 9 }],
    [3, { kind: 'support', drawn: undefined, repairing: 1 }],
    [4, { kind: 'support', drawn: { x: 0, y: 0 }, repairing: 5 }],
    [5, { kind: 'scout', drawn: undefined, repairing: 0 }],
  ]);
  assert.deepEqual(repairLines(enemies), []);
});

test("a small ship's shield shows while a drawn Support Ship repairs it (#188)", () => {
  const enemies = new Map<number, RepairingEnemy>([
    [1, { kind: 'support', drawn: { x: 0, y: 0 }, repairing: 2 }],
    [2, { kind: 'fighter', drawn: { x: 40, y: 0 }, repairing: 0 }],
    [3, { kind: 'support', drawn: { x: 0, y: 0 }, repairing: 4 }],
    [4, { kind: 'torpedo', drawn: { x: 0, y: 40 }, repairing: 0 }],
    [5, { kind: 'scout', drawn: { x: 0, y: 80 }, repairing: 0 }],
  ]);
  assert.deepEqual(repairShields(enemies), new Set([2, 4]));
});

test('the small ships show one, and no boss or Support Ship does', () => {
  assert.deepEqual([...REPAIR_SHIELD_KINDS].sort(), ['bomber', 'fighter', 'scout', 'torpedo']);
  const enemies = new Map<number, RepairingEnemy>([
    [1, { kind: 'support', drawn: { x: 0, y: 0 }, repairing: 2 }],
    [2, { kind: 'frigate', drawn: { x: 40, y: 0 }, repairing: 0 }],
    [3, { kind: 'support', drawn: { x: 0, y: 0 }, repairing: 4 }],
    [4, { kind: 'dreadnought', drawn: { x: 0, y: 40 }, repairing: 0 }],
    [5, { kind: 'support', drawn: { x: 0, y: 0 }, repairing: 1 }],
  ]);
  assert.deepEqual(repairShields(enemies), new Set());
});

test('no shield once the repair stops, or with either ship not drawn', () => {
  const enemies = new Map<number, RepairingEnemy>([
    [1, { kind: 'support', drawn: { x: 0, y: 0 }, repairing: 0 }],
    [2, { kind: 'scout', drawn: { x: 0, y: 0 }, repairing: 0 }],
    [3, { kind: 'support', drawn: undefined, repairing: 4 }],
    [4, { kind: 'fighter', drawn: { x: 0, y: 0 }, repairing: 0 }],
    [5, { kind: 'support', drawn: { x: 0, y: 0 }, repairing: 6 }],
    [6, { kind: 'bomber', drawn: undefined, repairing: 0 }],
    [7, { kind: 'support', drawn: { x: 0, y: 0 }, repairing: 9 }],
  ]);
  assert.deepEqual(repairShields(enemies), new Set());
});
