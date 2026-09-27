import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ServerClock } from './clock.ts';

test('the clock knows nothing before the first report', () => {
  assert.equal(new ServerClock(20).tickAt(1000), undefined);
});

test('the clock runs on at the tick rate between reports', () => {
  const clock = new ServerClock(20);
  clock.observe(100, 1000);
  assert.equal(clock.tickAt(1000), 100);
  assert.equal(clock.tickAt(1500), 110);
});

test('a late report does not pull the clock back', () => {
  const clock = new ServerClock(20);
  clock.observe(100, 1000);
  clock.observe(101, 1200); // 3 ticks late
  assert.ok((clock.tickAt(1200) ?? 0) > 103.9);
});

test('an early-looking report moves the clock forward at once', () => {
  const clock = new ServerClock(20);
  clock.observe(100, 1000);
  clock.observe(110, 1100);
  assert.equal(clock.tickAt(1100), 110);
});

test('a clock that ran ahead drifts back slowly', () => {
  const clock = new ServerClock(20);
  clock.observe(100, 1000);
  for (let i = 1; i <= 10; i++) {
    clock.observe(100 + i * 2 - 1, 1000 + i * 100); // consistently one tick behind the estimate
  }
  const drifted = clock.tickAt(2000) ?? 0;
  assert.ok(drifted < 120 && drifted > 119, `tick ${drifted}`);
});
