import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { CHARGE_SOUNDS, ENGINE_LOOPS, EXPIRE_SOUNDS, MUSIC, PART_SWITCH_SOUND, SHIELD_SOUND, SHOT_SOUNDS, effectFiles, musicFiles } from './sounds.ts';

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
    PART_SWITCH_SOUND,
    ...MUSIC,
  ];
  for (const key of used) {
    assert.ok(loaded.has(key), key);
  }
});
