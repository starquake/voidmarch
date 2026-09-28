import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ASTEROID_CLEAR_RADIUS, WORLD_HALF_SIZE } from './tuning.ts';
import { asteroidField } from './world.ts';

test('the asteroid field is the same every time and clear of the planet', () => {
  const a = asteroidField(7, 30);
  assert.deepEqual(a, asteroidField(7, 30));
  assert.equal(a.length, 30);
  for (const rock of a) {
    assert.ok(Math.hypot(rock.x, rock.y) >= ASTEROID_CLEAR_RADIUS);
    assert.ok(Math.abs(rock.x) <= WORLD_HALF_SIZE && Math.abs(rock.y) <= WORLD_HALF_SIZE);
    const quarterTurns = rock.rotation / (Math.PI / 2);
    assert.ok(Math.abs(quarterTurns - Math.round(quarterTurns)) < 1e-9);
  }
  assert.equal(asteroidField().length > 0, true);
});
