import assert from 'node:assert/strict';
import { test } from 'node:test';

import { enemyPattern } from './patterns.ts';
import { ENEMY_AIM_JITTER, ENEMY_MUZZLE } from './tuning.ts';

test('the same seed makes the same bullets', () => {
  assert.deepEqual(enemyPattern('scout', 10, 20, 1, 42), enemyPattern('scout', 10, 20, 1, 42));
});

test('each enemy fires its own bullet', () => {
  assert.equal(enemyPattern('scout', 0, 0, 0, 1)[0]?.kind, 'klaedBullet');
  assert.equal(enemyPattern('fighter', 0, 0, 0, 1)[0]?.kind, 'klaedBigBullet');
});

test('the aim wobbles a little with the seed, never much', () => {
  const angles = new Set<number>();
  for (let seed = 0; seed < 50; seed++) {
    const [bullet] = enemyPattern('fighter', 0, 0, 1, seed);
    assert.ok(bullet !== undefined);
    assert.ok(Math.abs(bullet.angle - 1) <= ENEMY_AIM_JITTER);
    angles.add(bullet.angle);
  }
  assert.ok(angles.size > 40, 'seeds give different aims');
});

test('bullets leave from in front of the enemy', () => {
  const [bullet] = enemyPattern('scout', 100, 50, 0, 7);
  assert.ok(bullet !== undefined);
  const distance = Math.hypot(bullet.x - 100, bullet.y - 50);
  assert.ok(Math.abs(distance - ENEMY_MUZZLE) < 1e-9);
  assert.ok(bullet.x > 100);
});
