import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { CHARGE_SOUNDS, ENEMY_EXPLOSION_SOUND, ENEMY_SHOT_SOUND, ENGINE_LOOPS, EXPIRE_SOUNDS, MUSIC, PART_SWITCH_SOUND, SHIELD_SOUND, SHOT_SOUNDS, TELEPORT_SOUND, effectFiles, musicFiles, musicTrack } from './sounds.ts';

const STATIC_DIR = path.join(import.meta.dirname, '../../internal/web/static');

test('every sound file exists in both formats', () => {
  for (const sound of [...effectFiles(), ...musicFiles()]) {
    assert.equal(sound.urls.length, 2, sound.key);
    for (const url of sound.urls) {
      assert.ok(existsSync(path.join(STATIC_DIR, url.replace(/^\/static\//, ''))), `${sound.key}: ${url}`);
    }
  }
});

test('every sound the game plays is loaded', () => {
  const loaded = new Set([...effectFiles(), ...musicFiles()].map((s) => s.key));
  const used = [
    ...Object.values(SHOT_SOUNDS).flat(),
    ...Object.values(EXPIRE_SOUNDS),
    ...Object.values(CHARGE_SOUNDS),
    ...Object.values(ENGINE_LOOPS),
    SHIELD_SOUND,
    ENEMY_EXPLOSION_SOUND,
    ENEMY_SHOT_SOUND,
    PART_SWITCH_SOUND,
    TELEPORT_SOUND,
    ...Object.values(MUSIC).flat(),
  ];
  for (const key of used) {
    assert.ok(loaded.has(key), key);
  }
});

test('each place has its own music, and the Explorer themes play everywhere else', () => {
  assert.deepEqual(MUSIC, {
    home: ['music-eerie-1'],
    dreadnought: ['music-eerie-2'],
    elsewhere: ['music-explorer-theme-1', 'music-explorer-theme-2'],
  });
});

test('a place plays its tracks in turn', () => {
  assert.equal(musicTrack('elsewhere', 0), 'music-explorer-theme-1');
  assert.equal(musicTrack('elsewhere', 1), 'music-explorer-theme-2');
  assert.equal(musicTrack('elsewhere', 2), 'music-explorer-theme-1');
  assert.equal(musicTrack('home', 3), 'music-eerie-1');
});
