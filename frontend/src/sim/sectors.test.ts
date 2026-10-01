import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HOME_SECTOR, missionArrow, sectorCenter, sectorEdges, sectorLine, sectorName, sectorState } from './sectors.ts';
import { WORLD_HALF_SIZE } from './rules.gen.ts';

test('sectors are named like the Go sim names them', () => {
  assert.equal(sectorName(0, 0), 'D4');
  assert.equal(sectorName(0, -1600), 'D3');
  assert.equal(sectorName(-1600, -1600), 'C3');
  assert.equal(sectorName(800, 0), 'E4');
  assert.equal(sectorName(-WORLD_HALF_SIZE, -WORLD_HALF_SIZE), 'A1');
  assert.equal(sectorName(WORLD_HALF_SIZE + 1, 0), undefined);
  assert.equal(HOME_SECTOR, 'D4');
});

test('the HUD line names the sector and its state', () => {
  const cleared = new Set(['E4']);
  assert.equal(sectorLine(0, 300, cleared), 'Sector D4 · home');
  assert.equal(sectorLine(1600, 0, cleared), 'Sector E4 · cleared');
  assert.equal(sectorLine(-1600, 0, cleared), 'Sector C4 · hostile');
  assert.equal(sectorLine(-1600, 0, undefined), 'Sector C4');
  assert.equal(sectorLine(WORLD_HALF_SIZE * 2, 0, cleared), '');
  assert.equal(sectorState('D4', undefined), 'home');
});

test('the edges run every sector across the world', () => {
  const edges = sectorEdges();
  assert.equal(edges.length, 8);
  assert.equal(edges[0], -WORLD_HALF_SIZE);
  assert.equal(edges.at(-1), WORLD_HALF_SIZE);
  assert.ok(edges.includes(800) && edges.includes(-800));
});

test('sector centers come from their names', () => {
  assert.deepEqual(sectorCenter('D4'), { x: 0, y: 0 });
  assert.deepEqual(sectorCenter('C3'), { x: -1600, y: -1600 });
  assert.equal(sectorCenter('H1'), undefined);
  assert.equal(sectorCenter('A0'), undefined);
  assert.equal(sectorCenter(''), undefined);
});

test('the mission arrow points from the screen edge toward the mission', () => {
  const right = missionArrow({ x: 0, y: 0 }, 'E4', 1000, 600, 20);
  assert.ok(right !== undefined);
  assert.equal(Math.round(right.x), 980);
  assert.equal(Math.round(right.y), 300);
  assert.equal(right.angle, 0);
  const up = missionArrow({ x: 0, y: 0 }, 'D3', 1000, 600, 20);
  assert.ok(up !== undefined);
  assert.equal(Math.round(up.x), 500);
  assert.equal(Math.round(up.y), 20);
  const corner = missionArrow({ x: 0, y: 0 }, 'E5', 1000, 600, 20);
  assert.ok(corner !== undefined && Math.round(corner.y) === 580 && corner.x > 500);
  assert.equal(missionArrow({ x: 1600, y: 10 }, 'E4', 1000, 600, 20), undefined);
  assert.equal(missionArrow({ x: 0, y: 0 }, 'Z9', 1000, 600, 20), undefined);
});
