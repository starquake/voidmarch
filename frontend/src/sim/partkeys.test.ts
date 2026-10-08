import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PartListTimer } from './partkeys.ts';
import { PART_LIST_IDLE_MS } from './tuning.ts';

type Slot = 'weapon' | 'engine' | 'shield';

test("a tapped slot's list closes the idle time after the tap, once", () => {
  const timer = new PartListTimer<Slot>();
  timer.tapped('weapon', 1000);
  assert.equal(timer.due(1000 + PART_LIST_IDLE_MS - 1, 'weapon'), false);
  assert.equal(timer.due(1000 + PART_LIST_IDLE_MS, 'weapon'), true);
  assert.equal(timer.due(1000 + PART_LIST_IDLE_MS + 1, 'weapon'), false, 'once');
});

test('every tap starts the idle time again', () => {
  const timer = new PartListTimer<Slot>();
  timer.tapped('engine', 0);
  timer.tapped('engine', 1500);
  assert.equal(timer.due(PART_LIST_IDLE_MS, 'engine'), false, 'the second tap restarted it');
  assert.equal(timer.due(1500 + PART_LIST_IDLE_MS, 'engine'), true);
});

test("another slot's tap times that slot's list", () => {
  const timer = new PartListTimer<Slot>();
  timer.tapped('weapon', 0);
  timer.tapped('shield', 1000);
  assert.equal(timer.due(PART_LIST_IDLE_MS, 'shield'), false);
  assert.equal(timer.due(1000 + PART_LIST_IDLE_MS, 'shield'), true);
});

test('a list nobody tapped stays open: the pointer opened it', () => {
  const timer = new PartListTimer<Slot>();
  assert.equal(timer.due(0, 'shield'), false);
  assert.equal(timer.due(60_000, 'shield'), false);
});

test('a list closed or moved elsewhere is forgotten, so the list the pointer opens next stays', () => {
  const timer = new PartListTimer<Slot>();
  timer.tapped('weapon', 0);
  assert.equal(timer.due(100, undefined), false, 'Esc or a click closed it');
  assert.equal(timer.due(PART_LIST_IDLE_MS, 'weapon'), false, 'the pointer opened it again');

  timer.tapped('weapon', 5000);
  assert.equal(timer.due(5100, 'engine'), false, 'the pointer opened the engine list');
  assert.equal(timer.due(5000 + PART_LIST_IDLE_MS, 'engine'), false);
  assert.equal(timer.due(5000 + PART_LIST_IDLE_MS, 'weapon'), false);
});
