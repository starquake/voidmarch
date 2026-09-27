import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TimedQueue } from './remoteshots.ts';

test('an item waits until the delayed timeline reaches it', () => {
  const queue = new TimedQueue<string>(20);
  queue.add(10, 'shot');
  assert.deepEqual(queue.due(9.5), []);

  const [due] = queue.due(10.5);
  assert.ok(due !== undefined);
  assert.equal(due.item, 'shot');
  assert.ok(Math.abs(due.ageSeconds - 0.025) < 1e-9);
  assert.deepEqual(queue.due(20), [], 'each item is due once');
});

test('late items are aged by how late they are', () => {
  const queue = new TimedQueue<string>(20);
  queue.add(10, 'a');
  queue.add(12, 'b');
  assert.deepEqual(
    queue.due(14).map((d) => [d.item, d.ageSeconds]),
    [
      ['a', 0.2],
      ['b', 0.1],
    ],
  );
});
