import assert from 'node:assert/strict';
import { test } from 'node:test';

import { musicPlace } from './music.ts';
import { HOME_SECTOR, SECTOR_NAMES, sectorRing } from './sectors.ts';

const inRing = (ring: number): string => SECTOR_NAMES.find((name) => sectorRing(name) === ring) ?? '';

test('the home sector is home', () => {
  assert.equal(musicPlace(HOME_SECTOR, false), 'home');
});

test('each ring has its own place', () => {
  assert.equal(musicPlace(inRing(1), false), 'ring1');
  assert.equal(musicPlace(inRing(2), false), 'ring2');
  assert.equal(musicPlace(inRing(3), false), 'ring3');
});

test('outside the map counts as ring 3', () => {
  assert.equal(musicPlace(undefined, false), 'ring3');
});

test('the victory screen plays the ending, wherever the ship is', () => {
  assert.equal(musicPlace(HOME_SECTOR, true), 'ending');
  assert.equal(musicPlace(inRing(2), true), 'ending');
  assert.equal(musicPlace(undefined, true), 'ending');
});
