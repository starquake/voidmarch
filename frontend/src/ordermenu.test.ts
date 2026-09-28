import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ORDER_ITEMS, applyOrder, describeOrders, itemPosition, pickItem, type OrderItem } from './ordermenu.ts';
import { DEFAULT_ORDERS } from './sim/brain.ts';

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

test('a stance replaces the stance and ends a one-shot; hold takes the pointer', () => {
  const regrouping = { ...DEFAULT_ORDERS, oneShot: { kind: 'regroup' as const } };
  assert.deepEqual(applyOrder(item('Aggressive'), regrouping, context), { ...DEFAULT_ORDERS, stance: 'aggressive' });
  assert.deepEqual(applyOrder(item('Hold here'), DEFAULT_ORDERS, context), {
    ...DEFAULT_ORDERS,
    stance: 'hold',
    holdX: 10,
    holdY: 20,
  });
});

test('fire and resource orders set theirs, and Support first toggles', () => {
  assert.equal(applyOrder(item('Hold fire'), DEFAULT_ORDERS, context)?.fire, 'hold');
  assert.equal(applyOrder(item('Conserve'), DEFAULT_ORDERS, context)?.resources, 'conserve');
  const once = applyOrder(item('Support first'), DEFAULT_ORDERS, context);
  assert.equal(once?.supportFirst, true);
  assert.equal(applyOrder(item('Support first'), once, context)?.supportFirst, false);
});

test('one-shots start; focus needs an enemy under the cursor', () => {
  assert.deepEqual(applyOrder(item('Regroup'), DEFAULT_ORDERS, context)?.oneShot, { kind: 'regroup' });
  assert.deepEqual(applyOrder(item('Focus target'), DEFAULT_ORDERS, context)?.oneShot, { kind: 'focus', enemyId: 7 });
  assert.equal(applyOrder(item('Focus target'), DEFAULT_ORDERS, { ...context, focusEnemyId: undefined }), undefined);
});

test('the HUD describes orders in a few words', () => {
  assert.equal(describeOrders(DEFAULT_ORDERS), 'escort · weapons free · spend');
  assert.equal(
    describeOrders({ ...DEFAULT_ORDERS, stance: 'hold', supportFirst: true, oneShot: { kind: 'goHome' } }),
    'holding · weapons free · spend · support first · going home',
  );
});
