import assert from 'node:assert/strict';
import { test } from 'node:test';

import { derelictLabel, heldLabel, holders, rescueNotice } from './derelict.ts';
import { DERELICT_HOLD_RADIUS } from '../sim/rules.gen.ts';

test('a derelict counts down the time it has left', () => {
  assert.equal(derelictLabel(2400, 0, 20), 'DERELICT 2:00');
  assert.equal(derelictLabel(2400, 360, 20), 'DERELICT 1:42');
  assert.equal(derelictLabel(2400, 2399, 20), 'DERELICT 0:01');
  assert.equal(derelictLabel(2400, 2500, 20), 'DERELICT 0:00');
});

test('a held derelict names how many hold it, counting only the enemies near enough', () => {
  const enemies = [
    { x: 100, y: 0 },
    { x: 0, y: DERELICT_HOLD_RADIUS - 1 },
    { x: DERELICT_HOLD_RADIUS + 1, y: 0 },
  ];
  assert.equal(holders(0, 0, enemies), 2);
  assert.equal(heldLabel(holders(0, 0, enemies)), 'DERELICT · HELD BY 2');
  assert.equal(heldLabel(0), 'DERELICT · HELD');
});

test('a rescue names who did it and the hangar now', () => {
  assert.equal(rescueNotice('Sanne', 4, true), 'Sanne rescued a ship · hangar 4');
  assert.equal(rescueNotice('Sanne', 16, false), 'Sanne rescued a ship · the hangar is full');
});
