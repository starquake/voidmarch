import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ShotSpawn } from '../sim/weapons.ts';
import { RemoteShots } from './remoteshots.ts';

const shot: ShotSpawn = { weapon: 'zapper', muzzle: 0, x: 0, y: 0, angle: 0 };

test('a shot waits until the delayed timeline reaches it', () => {
  const shots = new RemoteShots(20);
  shots.add(10, 'mo', shot);
  assert.deepEqual(shots.due(9.5), []);

  const due = shots.due(10.5);
  assert.equal(due.length, 1);
  assert.equal(due[0]?.from, 'mo');
  assert.ok(Math.abs(due[0].ageSeconds - 0.025) < 1e-9);
  assert.deepEqual(shots.due(20), [], 'each shot is due once');
});

test('late shots are aged by how late they are', () => {
  const shots = new RemoteShots(20);
  shots.add(10, 'mo', shot);
  shots.add(12, 'sanne', shot);
  const ages = shots.due(14).map((d) => d.ageSeconds);
  assert.deepEqual(ages, [0.2, 0.1]);
});
