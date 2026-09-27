import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_LOADOUT, ENGINES, SHIELDS, WEAPONS, nextInCycle } from './loadout.ts';

test('each slot has four parts, like the Main Ship pack', () => {
  assert.equal(WEAPONS.length, 4);
  assert.equal(ENGINES.length, 4);
  assert.equal(SHIELDS.length, 4);
});

test('the default loadout uses one part per slot', () => {
  assert.ok(WEAPONS.includes(DEFAULT_LOADOUT.weapon));
  assert.ok(ENGINES.includes(DEFAULT_LOADOUT.engine));
  assert.ok(SHIELDS.includes(DEFAULT_LOADOUT.shield));
});

test('nextInCycle walks the list and wraps', () => {
  assert.equal(nextInCycle(WEAPONS, 'autoCannon'), 'rockets');
  assert.equal(nextInCycle(WEAPONS, 'zapper'), 'autoCannon');
});

test('nextInCycle rejects an empty list', () => {
  assert.throws(() => nextInCycle([], 'x'), /empty list/);
});
