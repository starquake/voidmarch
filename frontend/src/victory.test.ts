import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatTook, victoryRows, type PlayerResult } from './victory.ts';

const player = (playerId: string, stats: Partial<PlayerResult>): PlayerResult => ({
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

test('the time a season took is hours and minutes', () => {
  assert.equal(formatTook((41 * 60 + 12) * 60 + 59), '41 h 12 min');
  assert.equal(formatTook(12 * 60), '12 min');
  assert.equal(formatTook(-5), '0 min');
});

test('the rows show each player, their own marked, and everyone', () => {
  const rows = victoryRows(
    {
      season: '1800000000',
      seconds: 3600,
      sectors: 37,
      players: [
        player('a', { kills: 212, companionKills: 64, shots: 4310, hits: 2245, deaths: 6, rescues: 4, sectors: 17 }),
        player('b', { kills: 41, companionKills: 12, rescues: 1, sectors: 6 }),
      ],
    },
    'b',
  );
  assert.deepEqual(rows[0], {
    name: 'name-a',
    kills: '212',
    companionKills: '64',
    hitRate: '52%',
    killsDeaths: '212 / 6',
    rescues: '4',
    sectors: '17',
    you: false,
  });
  const own = rows[1];
  assert.ok(own);
  assert.equal(own.you, true);
  assert.equal(own.hitRate, '–', 'no shots fired');
  assert.deepEqual(rows[2], {
    name: 'Everyone',
    kills: '253',
    companionKills: '76',
    hitRate: '52%',
    killsDeaths: '253 / 6',
    rescues: '5',
    sectors: '37',
    you: false,
  });
});
