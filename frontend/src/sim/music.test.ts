import assert from 'node:assert/strict';
import { test } from 'node:test';

import { musicPlace } from './music.ts';
import { HOME_SECTOR, SECTOR_NAMES } from './sectors.ts';

const AWAY = SECTOR_NAMES.find((name) => name !== HOME_SECTOR) ?? '';

test('the home sector is home', () => {
  assert.equal(musicPlace(HOME_SECTOR, undefined), 'home');
});

test('a Dreadnought with its bar showing is a Dreadnought fight, at home too', () => {
  assert.equal(musicPlace(AWAY, 'dreadnought'), 'dreadnought');
  assert.equal(musicPlace(HOME_SECTOR, 'dreadnought'), 'dreadnought');
  assert.equal(musicPlace(undefined, 'dreadnought'), 'dreadnought');
});

test('anywhere else is elsewhere, the Frigate included', () => {
  assert.equal(musicPlace(AWAY, undefined), 'elsewhere');
  assert.equal(musicPlace(AWAY, 'frigate'), 'elsewhere');
  assert.equal(musicPlace(undefined, undefined), 'elsewhere');
});

test('the Frigate at home leaves the home music on', () => {
  assert.equal(musicPlace(HOME_SECTOR, 'frigate'), 'home');
});
