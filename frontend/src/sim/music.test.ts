import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calmDown, fighting, musicPlace } from './music.ts';
import { HOME_SECTOR, SECTOR_NAMES } from './sectors.ts';
import { BATTLE_MUSIC_CALM_SECONDS, BATTLE_MUSIC_RANGE } from './tuning.ts';

const AWAY = SECTOR_NAMES.find((name) => name !== HOME_SECTOR) ?? '';

test('the home sector is home', () => {
  assert.equal(musicPlace(HOME_SECTOR, undefined, false), 'home');
});

test('a Dreadnought with its bar showing is a Dreadnought fight, at home and in a battle too', () => {
  assert.equal(musicPlace(AWAY, 'dreadnought', false), 'dreadnought');
  assert.equal(musicPlace(HOME_SECTOR, 'dreadnought', false), 'dreadnought');
  assert.equal(musicPlace(undefined, 'dreadnought', false), 'dreadnought');
  assert.equal(musicPlace(AWAY, 'dreadnought', true), 'dreadnought');
});

test('a battle beats home and anywhere else', () => {
  assert.equal(musicPlace(HOME_SECTOR, undefined, true), 'battle');
  assert.equal(musicPlace(AWAY, undefined, true), 'battle');
  assert.equal(musicPlace(AWAY, 'frigate', true), 'battle');
  assert.equal(musicPlace(undefined, undefined, true), 'battle');
});

test('anywhere else, with no battle, is elsewhere', () => {
  assert.equal(musicPlace(AWAY, undefined, false), 'elsewhere');
  assert.equal(musicPlace(undefined, undefined, false), 'elsewhere');
});

test('an enemy within range is a fight, one beyond it is not', () => {
  assert.equal(fighting([], undefined, 0, 0), false);
  assert.equal(fighting([{ x: 100, y: 100 + BATTLE_MUSIC_RANGE }], undefined, 100, 100), true);
  assert.equal(fighting([{ x: 100, y: 101 + BATTLE_MUSIC_RANGE }], undefined, 100, 100), false);
  assert.equal(fighting([{ x: 5000, y: 0 }, { x: -300, y: 200 }], undefined, 0, 0), true);
});

test("the Frigate's bar showing is a fight, with no enemy in range", () => {
  assert.equal(fighting([], 'frigate', 0, 0), true);
  assert.equal(fighting([], 'dreadnought', 0, 0), false);
});

test('the battle music plays during a fight and calms down after it', () => {
  assert.deepEqual(calmDown(false, 10, undefined), { lastFight: undefined, battle: false });
  assert.deepEqual(calmDown(true, 10, undefined), { lastFight: 10, battle: true });
  assert.deepEqual(calmDown(true, 12, 10), { lastFight: 12, battle: true });
  assert.deepEqual(calmDown(false, 12 + BATTLE_MUSIC_CALM_SECONDS - 0.1, 12), { lastFight: 12, battle: true });
  assert.deepEqual(calmDown(false, 12 + BATTLE_MUSIC_CALM_SECONDS, 12), { lastFight: 12, battle: false });
});

test('a fight starting again during the calm-down keeps the battle music on, and restarts the wait', () => {
  const back = calmDown(true, 14, 12);
  assert.deepEqual(back, { lastFight: 14, battle: true });
  assert.equal(calmDown(false, 12 + BATTLE_MUSIC_CALM_SECONDS + 1, back.lastFight).battle, true);
});
