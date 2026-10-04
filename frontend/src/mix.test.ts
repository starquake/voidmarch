import assert from 'node:assert/strict';
import { test } from 'node:test';

import { engineMix, nextVariant, randomVariant, shotDetune } from './mix.ts';

test('the engine is louder when thrusting than when idle', () => {
  assert.ok(engineMix(0, 200, true).volume > engineMix(0, 200, false).volume);
});

test('engine pitch rises with speed and is capped at top speed', () => {
  const slow = engineMix(0, 200, true).rate;
  const fast = engineMix(200, 200, true).rate;
  assert.ok(fast > slow);
  assert.equal(engineMix(1000, 200, true).rate, fast);
});

test('a coasting engine still hums a little louder at speed', () => {
  assert.ok(engineMix(200, 200, false).volume > engineMix(0, 200, false).volume);
});

test('an engine with no top speed stays at base pitch', () => {
  assert.equal(engineMix(50, 0, false).rate, engineMix(0, 200, false).rate);
});

test('nextVariant cycles through the variants', () => {
  const variants = ['a', 'b', 'c'];
  assert.deepEqual([0, 1, 2, 3].map((i) => nextVariant(variants, i)), ['a', 'b', 'c', 'a']);
  assert.equal(nextVariant([], 3), undefined);
});

test('randomVariant picks at random, never the last one twice in a row', () => {
  const variants = ['a', 'b', 'c'];
  assert.equal(randomVariant(variants, undefined, () => 0), 'a');
  assert.equal(randomVariant(variants, undefined, () => 0.99), 'c');
  assert.equal(randomVariant(variants, 'a', () => 0), 'b');
  assert.equal(randomVariant(variants, 'a', () => 0.99), 'c');
  let last: string | undefined;
  for (let i = 0; i < 50; i++) {
    const next = randomVariant(variants, last, Math.random);
    assert.notEqual(next, last);
    last = next;
  }
  assert.equal(randomVariant(['only'], 'only', () => 0.5), 'only');
  assert.equal(randomVariant([], undefined, () => 0.5), undefined);
});

test('shotDetune stays within a small range', () => {
  assert.equal(shotDetune(() => 0.5), 0);
  assert.ok(shotDetune(() => 0) < 0 && shotDetune(() => 0.999) > 0);
  assert.ok(Math.abs(shotDetune(() => 0)) <= 80);
});
