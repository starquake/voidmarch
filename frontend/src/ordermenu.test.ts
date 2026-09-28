import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FOCUS_LAST_HIT_MS,
  MODES,
  ORDER_ITEMS,
  applyOrder,
  chooseFocus,
  describeOrders,
  modeOf,
  itemPosition,
  nearestWithin,
  pickItem,
  type OrderItem,
} from './ordermenu.ts';
import { DEFAULT_ORDERS, type Orders } from './sim/brain.ts';

const item = (label: string): OrderItem => {
  const found = ORDER_ITEMS.find((i) => i.label === label);
  assert.ok(found !== undefined, label);

  return found;
};

const context = { pointX: 10, pointY: 20, focusEnemyId: 7 };

test('pointing at an item from the centre picks it, all the way around the ring', () => {
  ORDER_ITEMS.forEach((_, i) => {
    const p = itemPosition(i, 100);
    assert.equal(pickItem(p.x, p.y, 20), i);
    assert.equal(pickItem(p.x * 0.5, p.y * 0.5, 20), i, 'halfway there too');
  });
});

test('the ring is wider than tall', () => {
  const right = itemPosition(ORDER_ITEMS.length / 4, 100);
  const top = itemPosition(0, 100);
  assert.ok(right.x > -top.y);
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

test('each mode is a whole, consistent set of standing orders', () => {
  const orders = (label: string): Orders | undefined => applyOrder(item(label), DEFAULT_ORDERS, context);
  assert.deepEqual(orders('Escort'), DEFAULT_ORDERS, 'Escort is the default');
  assert.deepEqual(orders('Attack'), { ...DEFAULT_ORDERS, stance: 'aggressive', supportFirst: true });
  assert.deepEqual(orders('Guard'), { ...DEFAULT_ORDERS, stance: 'defensive', fire: 'return', resources: 'conserve' });
  assert.deepEqual(orders('Hold here'), { ...DEFAULT_ORDERS, stance: 'hold', holdX: 10, holdY: 20 });
  assert.deepEqual(orders('Stealth'), { ...DEFAULT_ORDERS, fire: 'hold', resources: 'conserve' });
});

test('a mode replaces everything, even from a clashing set, and ends a one-shot', () => {
  const clash = { ...DEFAULT_ORDERS, stance: 'aggressive' as const, fire: 'hold' as const, oneShot: { kind: 'regroup' as const } };
  assert.deepEqual(applyOrder(item('Escort'), clash, context), DEFAULT_ORDERS);
});

test('every mode reads back as itself', () => {
  for (const mode of MODES) {
    const it = ORDER_ITEMS.find((i) => i.kind === 'mode' && i.mode === mode);
    assert.ok(it !== undefined);
    const orders = applyOrder(it, DEFAULT_ORDERS, context);
    assert.ok(orders !== undefined);
    assert.equal(modeOf(orders), mode);
  }
});

test('one-shots keep the mode; focus needs an enemy', () => {
  const attacking = applyOrder(item('Attack'), DEFAULT_ORDERS, context);
  assert.ok(attacking !== undefined);
  const regroup = applyOrder(item('Regroup'), attacking, context);
  assert.equal(regroup?.stance, 'aggressive');
  assert.deepEqual(regroup.oneShot, { kind: 'regroup' });
  assert.deepEqual(applyOrder(item('Focus'), attacking, context)?.oneShot, { kind: 'focus', enemyId: 7 });
  assert.equal(applyOrder(item('Focus'), attacking, { ...context, focusEnemyId: undefined }), undefined);
});

test('the HUD names the mode, and a one-shot under way', () => {
  assert.equal(describeOrders(DEFAULT_ORDERS), 'Escort');
  assert.equal(describeOrders({ ...DEFAULT_ORDERS, stance: 'aggressive', oneShot: { kind: 'goHome' } }), 'Attack · going home');
  assert.equal(describeOrders({ ...DEFAULT_ORDERS, fire: 'hold' }), 'Stealth');
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
