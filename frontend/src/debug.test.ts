import assert from 'node:assert/strict';
import { test } from 'node:test';

import { publishDebugState, type DebugState } from './debug.ts';

/** A build that counts its calls and stamps each state with its number. */
function counting(): { build: () => DebugState; builds: () => number } {
  let n = 0;

  return {
    build: () => {
      n++;

      return { scene: `build ${String(n)}` } as DebugState;
    },
    builds: () => n,
  };
}

test('nothing is built until the debug state is first read', () => {
  const target: { voidmarch?: DebugState } = {};
  const { build, builds } = counting();
  const refresh = publishDebugState(build, target);
  refresh();
  refresh();
  assert.equal(builds(), 0, 'frames before any read build nothing');
  assert.equal(target.voidmarch?.scene, 'build 1');
});

test('once read, the debug state is rebuilt at each refresh, and reads in between see the same frame', () => {
  const target: { voidmarch?: DebugState } = {};
  const { build, builds } = counting();
  const refresh = publishDebugState(build, target);
  assert.equal(target.voidmarch?.scene, 'build 1');
  assert.equal(target.voidmarch.scene, 'build 1', 'a second read builds nothing');
  refresh();
  assert.equal(target.voidmarch.scene, 'build 2');
  assert.equal(builds(), 2);
});

test('publishing again replaces the reader', () => {
  const target: { voidmarch?: DebugState } = {};
  publishDebugState(() => ({ scene: 'first' }) as DebugState, target);
  publishDebugState(() => ({ scene: 'second' }) as DebugState, target);
  assert.equal(target.voidmarch?.scene, 'second');
});
