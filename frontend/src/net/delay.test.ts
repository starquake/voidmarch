import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DelayEstimator, MAX_DELAY_TICKS, MIN_DELAY_TICKS } from './delay.ts';

const close = (actual: number, expected: number): void => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${String(actual)} is not ${String(expected)}`);
};

/** Observes n snapshots, every one late by lateTicks. */
const feed = (estimator: DelayEstimator, n: number, lateTicks: number): void => {
  for (let i = 0; i < n; i++) {
    estimator.observe(lateTicks);
  }
};

test('the delay starts at the minimum', () => {
  assert.equal(new DelayEstimator().target, MIN_DELAY_TICKS);
});

test('snapshots on time keep the minimum delay', () => {
  const estimator = new DelayEstimator();
  feed(estimator, 400, 0);
  assert.equal(estimator.target, MIN_DELAY_TICKS);
});

test('a steady lateness is waited out, with a tick to spare', () => {
  const estimator = new DelayEstimator();
  feed(estimator, 200, 2.3);
  close(estimator.target, 3.3);
});

test('a few late snapshots leave the delay alone and more of them move it', () => {
  const few = new DelayEstimator();
  for (let i = 0; i < 200; i++) {
    few.observe(i % 25 === 0 ? 4 : 0); // 4%
  }
  assert.equal(few.target, MIN_DELAY_TICKS);

  const many = new DelayEstimator();
  for (let i = 0; i < 200; i++) {
    many.observe(i % 10 === 0 ? 3 : 0); // 10%
  }
  close(many.target, 4);
});

test('the delay stops at the maximum', () => {
  const estimator = new DelayEstimator();
  feed(estimator, 200, 20);
  assert.equal(estimator.target, MAX_DELAY_TICKS);
});

test('a calm 10 seconds forgets an old spike', () => {
  const estimator = new DelayEstimator();
  feed(estimator, 50, 3);
  close(estimator.target, 4);
  feed(estimator, 200, 0);
  assert.equal(estimator.target, MIN_DELAY_TICKS);
});

test('the range is an option, so a fixed delay can be measured against', () => {
  const fixed = new DelayEstimator({ minTicks: 2, maxTicks: 2 });
  feed(fixed, 200, 3);
  assert.equal(fixed.target, 2);
});
