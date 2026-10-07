import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PartKeys } from './partkeys.ts';
import { PART_HOLD_MS } from './tuning.ts';

type Slot = 'weapon' | 'engine' | 'shield';

test('a key released before the hold time cycles its slot, on release', () => {
  const keys = new PartKeys<Slot>();
  assert.deepEqual(keys.down('weapon', 1000), []);
  assert.deepEqual(keys.tick(1000 + PART_HOLD_MS - 1), []);
  assert.deepEqual(keys.up('weapon', 1000 + PART_HOLD_MS - 1), [{ kind: 'cycle', slot: 'weapon' }]);
  assert.deepEqual(keys.up('weapon', 1100), [], 'one release, one cycle');
});

test('a key held for the hold time opens its slot once, and its release does nothing', () => {
  const keys = new PartKeys<Slot>();
  keys.down('engine', 0);
  assert.deepEqual(keys.tick(PART_HOLD_MS), [{ kind: 'open', slot: 'engine' }]);
  assert.deepEqual(keys.tick(PART_HOLD_MS + 500), []);
  assert.deepEqual(keys.up('engine', PART_HOLD_MS + 600), []);
});

test('a release after the hold time opens, even when no frame ticked in between', () => {
  const keys = new PartKeys<Slot>();
  keys.down('shield', 0);
  assert.deepEqual(keys.up('shield', PART_HOLD_MS), [{ kind: 'open', slot: 'shield' }]);
  assert.deepEqual(keys.tick(PART_HOLD_MS + 1), []);
});

test('cancel drops a pending press', () => {
  const keys = new PartKeys<Slot>();
  keys.down('weapon', 0);
  keys.cancel();
  assert.deepEqual(keys.tick(PART_HOLD_MS), []);
  assert.deepEqual(keys.up('weapon', PART_HOLD_MS + 1), []);
  keys.down('weapon', 1000);
  keys.cancel();
  assert.deepEqual(keys.up('weapon', 1010), []);
});

test('the latest key down is the press: an earlier key released does nothing', () => {
  const keys = new PartKeys<Slot>();
  keys.down('weapon', 0);
  keys.down('engine', 10);
  assert.deepEqual(keys.up('weapon', 20), []);
  assert.deepEqual(keys.up('engine', 30), [{ kind: 'cycle', slot: 'engine' }]);
});

test('nothing happens with no key down', () => {
  const keys = new PartKeys<Slot>();
  assert.deepEqual(keys.tick(10_000), []);
  assert.deepEqual(keys.up('weapon', 10_000), []);
});
