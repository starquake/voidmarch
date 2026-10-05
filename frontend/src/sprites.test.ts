import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { REPAIR_SHIELD_KINDS } from './net/repair.ts';
import { ENEMY_FACTIONS } from './sim/enemies.ts';
import { WEAPONS } from './sim/loadout.ts';
import { PROJECTILE_KINDS } from './sim/rules.gen.ts';
import { keys, sheets, weaponTiming } from './sprites.ts';

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

test("every faction's Bombers and Torpedo Ships have their sheets, the Torpedo Ship's warning as long in each", () => {
  const loaded = new Map(sheets().map((s) => [s.key, s]));
  const nairan = loaded.get(keys.enemyWeapons('nairan', 'torpedo'));
  assert.ok(nairan !== undefined);
  for (const faction of ENEMY_FACTIONS) {
    for (const kind of ['bomber', 'torpedo'] as const) {
      for (const key of [keys.enemyBase, keys.enemyEngine, keys.enemyDestruction]) {
        assert.ok(loaded.has(key(faction, kind)), key(faction, kind));
      }
    }
    const weapons = loaded.get(keys.enemyWeapons(faction, 'torpedo'));
    assert.ok(weapons !== undefined, `${faction} torpedo weapons`);
    assert.ok(Math.abs(weapons.frames / weapons.fps - nairan.frames / nairan.fps) < 0.02, `${faction}: ${String(weapons.frames / weapons.fps)} s`);
  }
});

test("every faction's small ships have a looping shield sheet, for their repairs (#188)", () => {
  const loaded = new Map(sheets().map((s) => [s.key, s]));
  for (const faction of ENEMY_FACTIONS) {
    for (const kind of REPAIR_SHIELD_KINDS) {
      const shield = loaded.get(keys.enemyShield(faction, kind));
      assert.ok(shield !== undefined, `${faction} ${kind} shield`);
      assert.ok(shield.loop && shield.fps > 0, `${faction} ${kind} shield loops`);
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
