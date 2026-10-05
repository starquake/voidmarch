import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { ENEMY_FACTIONS } from './sim/enemies.ts';
import { WEAPONS } from './sim/loadout.ts';
import { PROJECTILE_KINDS } from './sim/rules.gen.ts';
import { RING_LAYER_IDS } from './sim/tuning.ts';
import { keys, loadableSheets, sheets, weaponTiming } from './sprites.ts';

const STATIC_DIR = path.join(import.meta.dirname, '../../internal/web/static');

/** Reads width and height from a PNG's IHDR chunk. */
const pngSize = (file: string): { width: number; height: number } => {
  const data = readFileSync(file);

  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
};

test('every sheet matches its PNG: frames laid out in one row', () => {
  for (const sheet of sheets()) {
    const file = path.join(STATIC_DIR, sheet.url.replace(/^\/static\//, ''));
    const { width, height } = pngSize(file);
    assert.equal(width, sheet.frameWidth * sheet.frames, `${sheet.key}: width ${width}`);
    assert.equal(height, sheet.frameHeight, `${sheet.key}: height ${height}`);
  }
});

test("every faction's Scouts and Fighters, and every enemy bullet, have their sheets", () => {
  const loaded = new Set(sheets().map((s) => s.key));
  for (const faction of ENEMY_FACTIONS) {
    for (const kind of ['scout', 'fighter'] as const) {
      for (const key of [keys.enemyBase, keys.enemyEngine, keys.enemyWeapons, keys.enemyDestruction]) {
        assert.ok(loaded.has(key(faction, kind)), key(faction, kind));
      }
    }
  }
  const weapons: readonly string[] = WEAPONS;
  for (const id of PROJECTILE_KINDS) {
    if (!weapons.includes(id) && id !== 'shard') {
      assert.ok(loaded.has(keys.enemyBullet(id as Parameters<typeof keys.enemyBullet>[0])), id);
    }
  }
});

test("each faction's fodder telegraphs a volley for about as long as the Kla'ed", () => {
  const klaed = sheets().find((s) => s.key === keys.enemyWeapons('klaed', 'scout'));
  assert.ok(klaed !== undefined);
  for (const faction of ENEMY_FACTIONS) {
    for (const kind of ['scout', 'fighter'] as const) {
      const sheet = sheets().find((s) => s.key === keys.enemyWeapons(faction, kind));
      assert.ok(sheet !== undefined);
      assert.ok(Math.abs(sheet.frames / sheet.fps - klaed.frames / klaed.fps) < 0.01, `${faction} ${kind}: ${String(sheet.frames / sheet.fps)} s`);
    }
  }
});

test("the ring layers load where the GPU holds their strip, and only they are left out where it can't (#186)", () => {
  const ringKeys = RING_LAYER_IDS.map((id) => keys.ringLayer(id));
  const all = sheets().map((s) => s.key);
  for (const key of ringKeys) {
    assert.ok(all.includes(key), key);
  }
  assert.deepEqual(
    loadableSheets(16384).map((s) => s.key),
    all,
  );
  const small = loadableSheets(4096).map((s) => s.key);
  assert.deepEqual(
    small,
    all.filter((key) => !ringKeys.includes(key)),
  );
});

test('sheet keys are unique', () => {
  const all = sheets().map((s) => s.key);
  assert.equal(new Set(all).size, all.length);
});

test('release frames are inside each weapon sheet, in order', () => {
  for (const id of WEAPONS) {
    const timing = weaponTiming(id);
    let previous = 0;
    for (const frame of timing.releaseFrames) {
      assert.ok(frame > previous && frame < timing.frames, `${id}: release frame ${frame}`);
      previous = frame;
    }
  }
});
