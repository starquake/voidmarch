import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ENEMY_VOLLEY_RANGE, INTEREST_RADIUS } from './tuning.ts';

/** The farthest an enemy moves while its weapon warns: TestVolleyRange_InsideInterest computes it from the hub's stats. */
const WARNING_TRAVEL = 60;

test('every volley the client draws comes from an enemy the server sends it', () => {
  assert.ok(
    ENEMY_VOLLEY_RANGE + WARNING_TRAVEL < INTEREST_RADIUS,
    `ENEMY_VOLLEY_RANGE ${String(ENEMY_VOLLEY_RANGE)} + ${String(WARNING_TRAVEL)} should stay under INTEREST_RADIUS ${String(INTEREST_RADIUS)}`,
  );
});
