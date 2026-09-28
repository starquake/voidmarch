import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FOCUS_LAST_HIT_MS,
  ORDER_ITEMS,
  chooseFocus,
  itemPosition,
  nearestWithin,
  pickItem,
} from './ordermenu.ts';

test('pointing at an item from the centre picks it, all the way around the ring', () => {
  ORDER_ITEMS.forEach((_, i) => {
    const p = itemPosition(i, 100);
    assert.equal(pickItem(p.x, p.y, 20), i);
    assert.equal(pickItem(p.x * 0.5, p.y * 0.5, 20), i, 'halfway there too');
  });
});

test('the ring is a circle: every item sits at the same distance', () => {
  for (const [i] of ORDER_ITEMS.entries()) {
    const at = itemPosition(i, 100);
    assert.ok(Math.abs(Math.hypot(at.x, at.y) - 100) < 1e-9);
  }
});

test('the first item is at the top, and the dead zone picks nothing', () => {
  assert.equal(pickItem(0, -100, 20), 0);
  assert.equal(pickItem(3, 4, 20), undefined);
});

test('a pointer between two items picks the nearer', () => {
  const a = itemPosition(1, 100);
  const b = itemPosition(2, 100);
  assert.equal(pickItem(a.x * 0.8 + b.x * 0.2, a.y * 0.8 + b.y * 0.2, 1), 1);
});

test('the ring has the five modes and three one-shots', () => {
  assert.deepEqual(
    ORDER_ITEMS.map((i) => i.label),
    ['Escort', 'Attack', 'Guard', 'Hold here', 'Stealth', 'Focus', 'Regroup', 'Go home'],
  );
});

test('focus picks the enemy under the cursor first', () => {
  const enemies = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 200, y: 0 },
  ];
  assert.equal(chooseFocus(enemies, 10, 5, { id: 2, atMs: 900 }, 1000), 1);
});

test('with nothing under the cursor, focus picks what the player is shooting at', () => {
  const enemies = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 400, y: 0 },
  ];
  assert.equal(chooseFocus(enemies, 60, 60, { id: 2, atMs: 900 }, 1000), 2);
  assert.equal(chooseFocus(enemies, 60, 60, { id: 2, atMs: 900 }, 900 + FOCUS_LAST_HIT_MS + 1), 1, 'too long ago');
  assert.equal(chooseFocus([{ id: 1, x: 0, y: 0 }], 60, 60, { id: 2, atMs: 900 }, 1000), 1, 'the last hit is gone');
});

test('otherwise focus picks the nearest enemy within a wider reach, or none', () => {
  const enemies = [{ id: 1, x: 0, y: 0 }];
  assert.equal(chooseFocus(enemies, 80, 0, undefined, 0), 1);
  assert.equal(chooseFocus(enemies, 500, 0, undefined, 0), undefined);
});

test('nearestWithin picks the closest in reach', () => {
  const items = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 10, y: 0 },
  ];
  assert.equal(nearestWithin(items, 8, 0, 30)?.id, 2);
  assert.equal(nearestWithin(items, 100, 0, 30), undefined);
});
