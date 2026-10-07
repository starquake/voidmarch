import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PartKeys, stepIndex } from './partkeys.ts';
import { PART_HOLD_MS, PART_LIST_IDLE_MS } from './tuning.ts';

type Slot = 'weapon' | 'engine' | 'shield';

/** Holds a key until its list opens and lets go at release, as the scene would; returns the list's slot. */
function holdOpen(keys: PartKeys<Slot>, slot: Slot, at: number, release: number): Slot {
  keys.down(slot, at, undefined);
  assert.deepEqual(keys.tick(at + PART_HOLD_MS, undefined), [{ kind: 'open', slot }]);
  assert.deepEqual(keys.up(slot, release, slot), []);

  return slot;
}

test('a key released before the hold time cycles its slot, on release', () => {
  const keys = new PartKeys<Slot>();
  assert.deepEqual(keys.down('weapon', 1000, undefined), []);
  assert.deepEqual(keys.tick(1000 + PART_HOLD_MS - 1, undefined), []);
  assert.deepEqual(keys.up('weapon', 1000 + PART_HOLD_MS - 1, undefined), [{ kind: 'cycle', slot: 'weapon' }]);
  assert.deepEqual(keys.up('weapon', 1100, undefined), [], 'one release, one cycle');
});

test('a key held for the hold time opens its slot once, and its release does nothing', () => {
  const keys = new PartKeys<Slot>();
  keys.down('engine', 0, undefined);
  assert.deepEqual(keys.tick(PART_HOLD_MS, undefined), [{ kind: 'open', slot: 'engine' }]);
  assert.deepEqual(keys.tick(PART_HOLD_MS + 500, 'engine'), []);
  assert.deepEqual(keys.up('engine', PART_HOLD_MS + 600, 'engine'), []);
});

test('a release after the hold time opens, even when no frame ticked in between', () => {
  const keys = new PartKeys<Slot>();
  keys.down('shield', 0, undefined);
  assert.deepEqual(keys.up('shield', PART_HOLD_MS, undefined), [{ kind: 'open', slot: 'shield' }]);
  assert.deepEqual(keys.tick(PART_HOLD_MS + 1, 'shield'), []);
});

test('cancel drops a pending press', () => {
  const keys = new PartKeys<Slot>();
  keys.down('weapon', 0, undefined);
  keys.cancel();
  assert.deepEqual(keys.tick(PART_HOLD_MS, undefined), []);
  assert.deepEqual(keys.up('weapon', PART_HOLD_MS + 1, undefined), []);
  keys.down('weapon', 1000, undefined);
  keys.cancel();
  assert.deepEqual(keys.up('weapon', 1010, undefined), []);
});

test('the latest key down is the press: an earlier key released does nothing', () => {
  const keys = new PartKeys<Slot>();
  keys.down('weapon', 0, undefined);
  keys.down('engine', 10, undefined);
  assert.deepEqual(keys.up('weapon', 20, undefined), []);
  assert.deepEqual(keys.up('engine', 30, undefined), [{ kind: 'cycle', slot: 'engine' }]);
});

test('nothing happens with no key down', () => {
  const keys = new PartKeys<Slot>();
  assert.deepEqual(keys.tick(10_000, undefined), []);
  assert.deepEqual(keys.up('weapon', 10_000, undefined), []);
});

test("while a slot's list is open, its key fits the next part at once and the list stays", () => {
  const keys = new PartKeys<Slot>();
  const open = holdOpen(keys, 'weapon', 0, 400);
  assert.deepEqual(keys.down('weapon', 500, open), [{ kind: 'cycle', slot: 'weapon' }]);
  assert.deepEqual(keys.tick(500 + PART_HOLD_MS, open), [], 'no hold to tell');
  assert.deepEqual(keys.up('weapon', 900, open), []);
  assert.deepEqual(keys.down('weapon', 1000, open), [{ kind: 'cycle', slot: 'weapon' }]);
});

test("another slot's tap cycles that slot and closes the list; its hold opens that slot's list", () => {
  const keys = new PartKeys<Slot>();
  let open = holdOpen(keys, 'weapon', 0, 400);
  assert.deepEqual(keys.down('engine', 500, open), []);
  assert.deepEqual(keys.up('engine', 550, open), [{ kind: 'cycle', slot: 'engine' }, { kind: 'close' }]);

  open = holdOpen(keys, 'weapon', 1000, 1400);
  keys.down('shield', 1500, open);
  assert.deepEqual(keys.tick(1500 + PART_HOLD_MS, open), [{ kind: 'open', slot: 'shield' }]);
  assert.deepEqual(keys.up('shield', 2000, 'shield'), []);
});

test('the list closes after the idle time from the last press, not while the key that opened it is held', () => {
  const keys = new PartKeys<Slot>();
  keys.down('weapon', 0, undefined);
  keys.tick(PART_HOLD_MS, undefined);
  assert.deepEqual(keys.tick(PART_HOLD_MS + PART_LIST_IDLE_MS + 1000, 'weapon'), [], 'still held');
  keys.up('weapon', 5000, 'weapon');
  assert.deepEqual(keys.tick(5000 + PART_LIST_IDLE_MS - 1, 'weapon'), []);
  assert.deepEqual(keys.tick(5000 + PART_LIST_IDLE_MS, 'weapon'), [{ kind: 'close' }]);
  assert.deepEqual(keys.tick(5000 + PART_LIST_IDLE_MS + 1, undefined), [], 'once');
});

test('every press on the list restarts its idle time: a tap, an arrow or Enter', () => {
  const keys = new PartKeys<Slot>();
  const open = holdOpen(keys, 'engine', 0, 300);
  keys.down('engine', 1500, open);
  assert.deepEqual(keys.tick(300 + PART_LIST_IDLE_MS, open), [], 'the tap restarted it');
  keys.touch(3000, open);
  assert.deepEqual(keys.tick(1500 + PART_LIST_IDLE_MS, open), [], 'the arrow restarted it');
  assert.deepEqual(keys.tick(3000 + PART_LIST_IDLE_MS, open), [{ kind: 'close' }]);
});

test('a list the pointer opened stays until a key acts on it, then idles like any other', () => {
  const keys = new PartKeys<Slot>();
  assert.deepEqual(keys.tick(0, 'shield'), []);
  assert.deepEqual(keys.tick(60_000, 'shield'), [], 'no key, no idle close');
  keys.touch(60_000, 'shield');
  assert.deepEqual(keys.tick(60_000 + PART_LIST_IDLE_MS, 'shield'), [{ kind: 'close' }]);
});

test('a list closed elsewhere is forgotten: reopened by the pointer, it stays', () => {
  const keys = new PartKeys<Slot>();
  holdOpen(keys, 'weapon', 0, 300);
  assert.deepEqual(keys.tick(400, undefined), [], 'Esc or a click closed it');
  assert.deepEqual(keys.tick(500 + PART_LIST_IDLE_MS, 'weapon'), []);
  keys.touch(600, 'engine');
  assert.deepEqual(keys.tick(700 + PART_LIST_IDLE_MS, 'weapon'), [], 'the pointer moved to another slot');
});

test('a list opened by a hold the window lost still closes when idle', () => {
  const keys = new PartKeys<Slot>();
  keys.down('shield', 0, undefined);
  keys.tick(PART_HOLD_MS, undefined);
  keys.cancel();
  assert.deepEqual(keys.tick(PART_HOLD_MS + PART_LIST_IDLE_MS, 'shield'), [{ kind: 'close' }]);
});

test('stepIndex moves through a list and wraps both ways', () => {
  assert.equal(stepIndex(0, 1, 4), 1);
  assert.equal(stepIndex(3, 1, 4), 0);
  assert.equal(stepIndex(0, -1, 4), 3);
  assert.equal(stepIndex(2, -1, 4), 1);
  assert.equal(stepIndex(0, 1, 1), 0);
  assert.equal(stepIndex(0, 1, 0), 0, 'an empty list stays at 0');
});
