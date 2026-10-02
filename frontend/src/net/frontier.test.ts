import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bossFellBanner, ringsClosedBanner } from './frontier.ts';

test('the fall is announced with what it opened and the part won', () => {
  assert.deepEqual(bossFellBanner('Mega Zapper'), [
    "The Kla'ed Dreadnought has fallen",
    'Rings 2 and 3 are open.',
    'Your reward: Mega Zapper',
  ]);
  assert.equal(bossFellBanner(undefined).length, 2);
});

test('only rings closing again gets a banner', () => {
  assert.match(ringsClosedBanner(3, 1)?.[0] ?? '', /^Rings 2 and 3 have closed/);
  assert.equal(ringsClosedBanner(0, 1), undefined, 'the first frontier heard');
  assert.equal(ringsClosedBanner(1, 3), undefined, 'rings opening');
  assert.equal(ringsClosedBanner(1, 1), undefined, 'a sector opening on its own');
});
