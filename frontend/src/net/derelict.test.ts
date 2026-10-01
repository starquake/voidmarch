import assert from 'node:assert/strict';
import { test } from 'node:test';

import { derelictLabel, rescueNotice } from './derelict.ts';

test('a derelict counts down the time it has left', () => {
  assert.equal(derelictLabel(2400, 0, 20), 'DERELICT 2:00');
  assert.equal(derelictLabel(2400, 360, 20), 'DERELICT 1:42');
  assert.equal(derelictLabel(2400, 2399, 20), 'DERELICT 0:01');
  assert.equal(derelictLabel(2400, 2500, 20), 'DERELICT 0:00');
});

test('a rescue names who did it and the hangar now', () => {
  assert.equal(rescueNotice('Sanne', 4), 'Sanne rescued a ship · hangar 4');
});
