import assert from 'node:assert/strict';
import { test } from 'node:test';

import { publishDebugState, type DebugState } from './debug.ts';

test('the debug state is built when it is read, never ahead of it', () => {
  const target: { voidmarch?: DebugState } = {};
  const state = { ready: true, scene: 'sandbox' } as DebugState;
  let builds = 0;
  publishDebugState(() => {
    builds++;

    return state;
  }, target);
  assert.equal(builds, 0, 'publishing builds nothing');
  assert.equal(target.voidmarch, state);
  assert.equal(target.voidmarch.scene, 'sandbox');
  assert.equal(builds, 2, 'once per read');
});

test('publishing again replaces the reader', () => {
  const target: { voidmarch?: DebugState } = {};
  publishDebugState(() => ({ scene: 'first' }) as DebugState, target);
  publishDebugState(() => ({ scene: 'second' }) as DebugState, target);
  assert.equal(target.voidmarch?.scene, 'second');
});
