import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hitRate, missionStatsLine, seasonAge, standingRows, type PlayerStatsRow } from './standings.ts';

const p = (playerId: string, stats: Partial<PlayerStatsRow>): PlayerStatsRow => ({
  playerId,
  name: `name-${playerId}`,
  kills: 0,
  companionKills: 0,
  shots: 0,
  hits: 0,
  deaths: 0,
  rescues: 0,
  sectors: 0,
  ...stats,
});

test('the table is the top few, and the player when they are not among them', () => {
  const players = [p('a', { kills: 9, shots: 20, hits: 10, deaths: 1 }), p('b', { kills: 5 }), p('c', { kills: 2 })];
  assert.deepEqual(standingRows(players, 'b', 2), [
    { name: 'name-a', kills: '9', hitRate: '50%', killsDeaths: '9 / 1', you: false },
    { name: 'name-b', kills: '5', hitRate: '–', killsDeaths: '5 / 0', you: true },
  ]);
  const rows = standingRows(players, 'c', 2);
  assert.equal(rows.length, 3);
  assert.equal(rows[2]?.you, true, "the player's own row after the top");
  assert.equal(standingRows(players, 'nobody', 2).length, 2);
});

test("the season's age is its day and hours", () => {
  assert.equal(seasonAge(0, 26 * 3600 + 59), 'day 2 · 26 h');
  assert.equal(seasonAge(0, 3599), 'day 1 · 0 h');
  assert.equal(seasonAge(100, 0), 'day 1 · 0 h');
  assert.equal(hitRate(1, 3), '33%');
});

test('the mission line names the most kills, the best aim over enough shots, and who went down', () => {
  assert.equal(
    missionStatsLine([p('a', { kills: 12, shots: 40, hits: 20 }), p('b', { kills: 3, shots: 10, hits: 6, deaths: 1 }), p('c', { shots: 2, hits: 2 })]),
    'Most kills: name-a 12 · Best aim: name-b 60% · Went down: name-b',
  );
  assert.equal(missionStatsLine([p('a', { shots: 3 })]), 'Nobody went down', 'no kills, too few shots to name an aim');
  assert.equal(missionStatsLine([]), undefined);
});
