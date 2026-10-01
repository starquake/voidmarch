import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ASTEROID_CLEAR_RADIUS, WORLD_APOTHEM, WORLD_EDGE_BAND } from './tuning.ts';
import { asteroidField, worldReach } from './world.ts';

test('the asteroid field is the same every time and clear of the planet', () => {
  const a = asteroidField(7, 30);
  assert.deepEqual(a, asteroidField(7, 30));
  assert.equal(a.length, 30);
  for (const rock of a) {
    assert.ok(Math.hypot(rock.x, rock.y) >= ASTEROID_CLEAR_RADIUS);
    assert.ok(worldReach(rock.x, rock.y) <= WORLD_APOTHEM - WORLD_EDGE_BAND);
    const quarterTurns = rock.rotation / (Math.PI / 2);
    assert.ok(Math.abs(quarterTurns - Math.round(quarterTurns)) < 1e-9);
  }
  assert.equal(asteroidField().length > 0, true);
});

test('the world reach is measured to the hexagon\'s sides, as the Go sim measures it', () => {
  assert.equal(worldReach(0, 0), 0);
  assert.equal(worldReach(-3000, 0), 3000);
  assert.ok(Math.abs(worldReach(0, 2000) - 1000 * Math.sqrt(3)) < 1e-9);
  assert.ok(Math.abs(worldReach(1000, 1000) - (500 + 500 * Math.sqrt(3))) < 1e-9);
});
