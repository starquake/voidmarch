import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createShip } from './ship.ts';
import { ASTEROID_CLEAR_RADIUS, TICK_SECONDS, WORLD_EDGE_BAND, WORLD_HALF_SIZE } from './tuning.ts';
import { applyWorldEdge, asteroidField, projectileInBounds } from './world.ts';

test('the edge band pushes the ship back toward the centre', () => {
  const ship = createShip(WORLD_HALF_SIZE - WORLD_EDGE_BAND / 2, -(WORLD_HALF_SIZE - WORLD_EDGE_BAND / 2));
  applyWorldEdge(ship, TICK_SECONDS);
  assert.ok(ship.vx < 0);
  assert.ok(ship.vy > 0);
});

test('the middle of the world has no push', () => {
  const ship = createShip(100, 100);
  applyWorldEdge(ship, TICK_SECONDS);
  assert.deepEqual([ship.vx, ship.vy], [0, 0]);
});

test('the ship stops at the edge', () => {
  const ship = createShip(WORLD_HALF_SIZE + 50, 0);
  ship.vx = 300;
  applyWorldEdge(ship, TICK_SECONDS);
  assert.equal(ship.x, WORLD_HALF_SIZE);
  assert.equal(ship.vx, 0);
});

test('a ship past the edge keeps an inward velocity', () => {
  const ship = createShip(-(WORLD_HALF_SIZE + 50), 0);
  ship.vx = 300;
  applyWorldEdge(ship, TICK_SECONDS);
  assert.equal(ship.x, -WORLD_HALF_SIZE);
  assert.ok(ship.vx > 0);
});

test('projectiles are dropped a little outside the world', () => {
  assert.equal(projectileInBounds(0, 0), true);
  assert.equal(projectileInBounds(WORLD_HALF_SIZE + 10, 0), true);
  assert.equal(projectileInBounds(0, -(WORLD_HALF_SIZE + 500)), false);
});

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
