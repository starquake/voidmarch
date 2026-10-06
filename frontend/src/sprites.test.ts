import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { bakeGlow, double } from './glow.ts';
import { pieceFrames, type LayerLayout } from './layers.ts';
import { ENEMY_FACTIONS } from './sim/enemies.ts';
import { WEAPONS } from './sim/loadout.ts';
import { PROJECTILE_KINDS } from './sim/rules.gen.ts';
import { ENEMY_FIRE_GLOW_COLOR, ENEMY_FIRE_GLOW_DISTANCE, ENEMY_FIRE_GLOW_QUALITY, ENEMY_FIRE_GLOW_STRENGTH } from './sim/tuning.ts';
import { glowSheets, keys, layerSheets, sheets, weaponTiming } from './sprites.ts';

const STATIC_DIR = path.join(import.meta.dirname, '../../internal/web/static');

/** The largest texture side every WebGL GPU in use holds (#222). */
const MAX_TEXTURE_SIZE = 4096;

/** Sheets still over it, each with its ticket; the test fails once one fits, so the list shrinks with them. */
const KNOWN_OVER: Readonly<Record<string, string>> = {
  [keys.enemyWeapons('klaed', 'dreadnought')]: '#236',
  [keys.enemyWeapons('nairan', 'dreadnought')]: '#236',
  [keys.enemyWeapons('nautolan', 'dreadnought')]: '#236',
};

const staticFile = (url: string): string => path.join(STATIC_DIR, url.replace(/^\/static\//, ''));

/** Reads width and height from a PNG's IHDR chunk. */
const pngSize = (url: string): { width: number; height: number } => {
  const data = readFileSync(staticFile(url));

  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
};

const layout = (url: string): LayerLayout => JSON.parse(readFileSync(staticFile(url), 'utf8')) as LayerLayout;

test('every sheet matches its PNG: frames left to right, in rows of its columns', () => {
  for (const sheet of sheets()) {
    const { width, height } = pngSize(sheet.url);
    const columns = sheet.columns ?? sheet.frames;
    assert.equal(width, sheet.frameWidth * columns, `${sheet.key}: width ${String(width)}`);
    assert.equal(height, sheet.frameHeight * Math.ceil(sheet.frames / columns), `${sheet.key}: height ${String(height)}`);
  }
});

test("every stars layer's sheet holds each of its pieces' frames", () => {
  for (const sheet of layerSheets()) {
    const { width, height } = pngSize(sheet.url);
    for (const frame of pieceFrames(layout(sheet.layoutUrl))) {
      assert.ok(frame.x + frame.width <= width && frame.y + frame.height <= height, `${sheet.key} ${frame.name}`);
    }
  }
});

test('no texture the game loads or makes is wider or taller than 4096 px, but the known ones', () => {
  const textures = [
    ...sheets().map((s) => ({ key: s.key, ...pngSize(s.url) })),
    ...layerSheets().flatMap((s) => {
      const l = layout(s.layoutUrl);

      return [
        { key: s.key, ...pngSize(s.url) },
        { key: keys.layerFrame(s.key), width: l.width, height: l.height },
      ];
    }),
    ...glowSheets().map((s) => {
      const blank = { width: s.frameWidth, height: s.frameHeight, data: new Uint8ClampedArray(s.frameWidth * s.frameHeight * 4) };
      const glow = { color: ENEMY_FIRE_GLOW_COLOR, strength: ENEMY_FIRE_GLOW_STRENGTH, quality: ENEMY_FIRE_GLOW_QUALITY, distance: ENEMY_FIRE_GLOW_DISTANCE };
      const frame = bakeGlow(double(blank), glow);

      return { key: s.glowKey, width: frame.width * s.frames, height: frame.height };
    }),
  ];
  for (const t of textures) {
    const fits = t.width <= MAX_TEXTURE_SIZE && t.height <= MAX_TEXTURE_SIZE;
    assert.equal(fits, KNOWN_OVER[t.key] === undefined, `${t.key}: ${String(t.width)} x ${String(t.height)}, known over: ${KNOWN_OVER[t.key] ?? 'no'}`);
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
