import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bossFellBanner, raidBanner, raidEndedBanner, ringOpenedBy, ringsClosedBanner } from './frontier.ts';

test('the fall is announced with what it opened and the part won', () => {
  assert.deepEqual(bossFellBanner('klaed', 'Mega Zapper'), [
    "The Kla'ed Dreadnought has fallen",
    'Ring 2 is open.',
    'Your reward: Mega Zapper',
  ]);
  assert.deepEqual(bossFellBanner('nairan', undefined), ['The Nairan Dreadnought has fallen', 'Ring 3 is open.']);
  assert.deepEqual(bossFellBanner('nautolan', undefined), ['The Nautolan Dreadnought has fallen', 'The season is won.']);
});

test("each faction's Dreadnought opens the ring beyond its own", () => {
  assert.equal(ringOpenedBy('klaed'), 2);
  assert.equal(ringOpenedBy('nairan'), 3);
});

test('only rings closing again gets a banner', () => {
  assert.deepEqual(ringsClosedBanner(3, 1), [
    'Rings 2 and 3 have closed',
    'Ring 1 fell below 4 cleared sectors. Take them back to wake a new Dreadnought.',
  ]);
  assert.match(ringsClosedBanner(2, 1)?.[0] ?? '', /^Ring 2 has closed/);
  assert.match(ringsClosedBanner(3, 2)?.[1] ?? '', /^Ring 2 fell below/);
  assert.equal(ringsClosedBanner(0, 1), undefined, 'the first frontier heard');
  assert.equal(ringsClosedBanner(1, 3), undefined, 'rings opening');
  assert.equal(ringsClosedBanner(1, 1), undefined, 'a sector opening on its own');
});

test('a raid is announced without how to end it', () => {
  assert.deepEqual(raidBanner('klaed'), ["The Kla'ed Dreadnought is coming"]);
  assert.deepEqual(raidBanner('nairan'), ['The Nairan Dreadnought is coming']);
});

test("a raid's end says whether it was driven off, and the part won", () => {
  assert.deepEqual(raidEndedBanner('nairan', true, 'Super Rockets'), [
    'The Nairan Dreadnought was driven off',
    'The damage stays on it.',
    'Your reward: Super Rockets',
  ]);
  assert.deepEqual(raidEndedBanner('klaed', true, undefined), ["The Kla'ed Dreadnought was driven off", 'The damage stays on it.']);
  assert.deepEqual(raidEndedBanner('klaed', false, undefined), ["The Kla'ed Dreadnought teleported away"]);
});
