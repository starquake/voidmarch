import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HOME_SECTOR, missionArrow, missionBanner, missionCompleteBanner, SECTOR_NAMES, sectorCenter, sectorCorners, sectorLine, sectorName, sectorState } from './sectors.ts';
import { SECTOR_RADIUS, WORLD_APOTHEM } from './rules.gen.ts';

/** Ring 1's centers, a sector's width apart from home's. */
const ACROSS = 1.5 * SECTOR_RADIUS;
const DOWN = Math.sqrt(3) * SECTOR_RADIUS;
const APOTHEM = DOWN / 2;

test('sectors are named like the Go sim names them', () => {
  assert.equal(sectorName(0, 0), 'D4');
  assert.equal(sectorName(0, -DOWN), 'D3');
  assert.equal(sectorName(ACROSS, DOWN / 2), 'E4');
  assert.equal(sectorName(ACROSS, -DOWN / 2), 'E3');
  assert.equal(sectorName(-ACROSS, -DOWN / 2), 'C3');
  assert.equal(sectorName(-ACROSS, DOWN / 2), 'C4');
  assert.equal(sectorName(0, DOWN), 'D5');
  assert.equal(sectorName(0, APOTHEM - 1), 'D4');
  assert.equal(sectorName(0, APOTHEM + 1), 'D5');
  assert.equal(sectorName(SECTOR_RADIUS - 1, 0), 'D4');
  assert.equal(sectorName(0, -3 * DOWN), 'D1');
  assert.equal(sectorName(3 * ACROSS, 1.5 * DOWN), 'G5');
  assert.equal(sectorName(-3 * ACROSS, 1.5 * DOWN), 'A5');
  assert.equal(sectorName(0, -3 * DOWN - APOTHEM - 1), undefined);
  assert.equal(sectorName(WORLD_APOTHEM, 0), undefined);
  assert.equal(HOME_SECTOR, 'D4');
});

test('the HUD line names the sector and its state', () => {
  const cleared = new Set(['E4']);
  assert.equal(sectorLine(0, 300, cleared), 'Sector D4 · home');
  assert.equal(sectorLine(ACROSS, DOWN / 2, cleared), 'Sector E4 · cleared');
  assert.equal(sectorLine(-ACROSS, DOWN / 2, cleared), 'Sector C4 · hostile');
  assert.equal(sectorLine(-ACROSS, DOWN / 2, undefined), 'Sector C4');
  assert.equal(sectorLine(WORLD_APOTHEM * 2, 0, cleared), '');
  assert.equal(sectorState('D4', undefined), 'home');
});

test('the grid is home and three rings, 37 sectors', () => {
  assert.equal(SECTOR_NAMES.length, 37);
  assert.equal(new Set(SECTOR_NAMES).size, 37);
  assert.ok(SECTOR_NAMES.includes('D4') && SECTOR_NAMES.includes('A2') && !SECTOR_NAMES.includes('A1'));
  for (const name of SECTOR_NAMES) {
    const center = sectorCenter(name);
    assert.ok(center !== undefined);
    assert.equal(sectorName(center.x, center.y), name);
  }
});

test('a sector\'s corners are its radius from its center, and home shares two with each neighbor', () => {
  const home = sectorCorners('D4');
  assert.equal(home.length, 6);
  for (const corner of home) {
    assert.ok(Math.abs(Math.hypot(corner.x, corner.y) - SECTOR_RADIUS) < 1e-9);
  }
  assert.deepEqual(home[0], { x: SECTOR_RADIUS, y: 0 });
  const shared = sectorCorners('E4').filter((c) => home.some((h) => Math.hypot(h.x - c.x, h.y - c.y) < 1e-6));
  assert.equal(shared.length, 2);
  assert.deepEqual(sectorCorners('A1'), []);
});

test('sector centers come from their names', () => {
  assert.deepEqual(sectorCenter('D4'), { x: 0, y: 0 });
  assert.deepEqual(sectorCenter('C3'), { x: -ACROSS, y: -DOWN / 2 });
  assert.equal(sectorCenter('H1'), undefined);
  assert.equal(sectorCenter('A1'), undefined);
  assert.equal(sectorCenter('A0'), undefined);
  assert.equal(sectorCenter('D04'), undefined);
  assert.equal(sectorCenter(''), undefined);
});

test('the mission arrow points from the screen edge toward the mission', () => {
  const right = missionArrow({ x: 0, y: DOWN / 2 }, 'E4', 1000, 600, 20);
  assert.ok(right !== undefined);
  assert.equal(Math.round(right.x), 980);
  assert.equal(Math.round(right.y), 300);
  assert.equal(right.angle, 0);
  const up = missionArrow({ x: 0, y: 0 }, 'D3', 1000, 600, 20);
  assert.ok(up !== undefined);
  assert.equal(Math.round(up.x), 500);
  assert.equal(Math.round(up.y), 20);
  const corner = missionArrow({ x: 0, y: 0 }, 'E4', 1000, 600, 20);
  assert.ok(corner !== undefined && Math.round(corner.x) === 980 && corner.y > 300 && corner.y < 580);
  assert.equal(missionArrow({ x: ACROSS, y: DOWN / 2 + 10 }, 'E4', 1000, 600, 20), undefined);
  assert.equal(missionArrow({ x: 0, y: 0 }, 'Z9', 1000, 600, 20), undefined);
});

test('a new mission is announced with what to do and how to find it', () => {
  const lines = missionBanner('D3');
  assert.equal(lines[0], 'New mission: sector D3');
  assert.match(lines[1] ?? '', /D3 to clear it/);
  assert.match(lines[2] ?? '', /gold arrow/);
});

test('a finished mission is announced with the part it gave', () => {
  assert.deepEqual(missionCompleteBanner('D3', 'Mega Zapper'), ['Mission complete: sector D3 cleared', 'Your reward: Mega Zapper']);
  assert.deepEqual(missionCompleteBanner('D3', undefined), ['Mission complete: sector D3 cleared']);
});
