import { STATIC } from './net/static.ts';
import type { EngineId, WeaponId } from './sim/loadout.ts';
import type { MusicPlace } from './sim/music.ts';

const AUDIO = `${STATIC}audio`;

/** A sound and its files, best format first; Phaser plays the first the browser supports. */
export interface SoundFile {
  key: string;
  urls: string[];
}

const both = (key: string, path: string): SoundFile => ({ key, urls: [`${AUDIO}/${path}.ogg`, `${AUDIO}/${path}.mp3`] });

/** Shot sounds per weapon: variants are played in turn so rapid fire doesn't repeat one sample. */
export const SHOT_SOUNDS: Readonly<Record<WeaponId, readonly string[]>> = {
  autoCannon: ['sfx-auto-cannon-0', 'sfx-auto-cannon-1', 'sfx-auto-cannon-2'],
  rockets: ['sfx-rocket-launch'],
  bigSpaceGun: ['sfx-big-space-gun-0', 'sfx-big-space-gun-1'],
  zapper: ['sfx-zapper-0', 'sfx-zapper-1', 'sfx-zapper-2'],
};

/** Sounds when a projectile runs out; the small, fast shots expire silently. */
export const EXPIRE_SOUNDS: Readonly<Partial<Record<WeaponId, string>>> = {
  rockets: 'sfx-rocket-blast',
  bigSpaceGun: 'sfx-big-blast',
};

/** Sounds while a weapon charges, before its shot sound. */
export const CHARGE_SOUNDS: Readonly<Partial<Record<WeaponId, string>>> = {
  bigSpaceGun: 'sfx-charge',
};

export const ENGINE_LOOPS: Readonly<Record<EngineId, string>> = {
  base: 'sfx-engine-base',
  bigPulse: 'sfx-engine-big-pulse',
  burst: 'sfx-engine-burst',
  supercharged: 'sfx-engine-supercharged',
};

export const SHIELD_SOUND = 'sfx-shield';
export const ENEMY_EXPLOSION_SOUND = 'sfx-enemy-explosion';
/** A laser of their own, so incoming fire doesn't sound like yours. */
export const ENEMY_SHOT_SOUND = 'sfx-enemy-shot';
export const PART_SWITCH_SOUND = 'sfx-part-switch';
/** A derelict teleporting away (#190). */
export const TELEPORT_SOUND = 'sfx-teleport';
/** The force field's zaps (#127), played in random order. */
export const FIELD_ZAP_SOUNDS = ['sfx-field-zap-0', 'sfx-field-zap-1', 'sfx-field-zap-2'];

/** Each place's music track (#187), looped: Juhani Junkala's 5 Action Chiptunes. */
export const MUSIC: Readonly<Record<MusicPlace, string>> = {
  home: 'music-title-screen',
  ring1: 'music-level-1',
  ring2: 'music-level-2',
  ring3: 'music-level-3',
  ending: 'music-ending',
};

/** Effects, small enough to load before the game starts. */
export function effectFiles(): SoundFile[] {
  const files = [
    ...[0, 1, 2].map((i) => both(`sfx-auto-cannon-${i}`, `sfx/auto-cannon-${i}`)),
    ...[0, 1, 2].map((i) => both(`sfx-zapper-${i}`, `sfx/zapper-${i}`)),
    ...[0, 1].map((i) => both(`sfx-big-space-gun-${i}`, `sfx/big-space-gun-${i}`)),
    both('sfx-rocket-launch', 'sfx/rocket-launch'),
    both('sfx-rocket-blast', 'sfx/rocket-blast'),
    both('sfx-big-blast', 'sfx/big-blast'),
    both('sfx-charge', 'sfx/charge'),
    both(ENEMY_EXPLOSION_SOUND, 'sfx/enemy-explosion'),
    both(ENEMY_SHOT_SOUND, 'sfx/enemy-shot'),
    both(SHIELD_SOUND, 'sfx/shield'),
    both(PART_SWITCH_SOUND, 'sfx/part-switch'),
    both(TELEPORT_SOUND, 'sfx/teleport'),
    ...[0, 1, 2].map((i) => both(`sfx-field-zap-${i}`, `sfx/field-zap-${i}`)),
    both('sfx-engine-base', 'sfx/engine-base'),
    both('sfx-engine-big-pulse', 'sfx/engine-big-pulse'),
    both('sfx-engine-burst', 'sfx/engine-burst'),
    both('sfx-engine-supercharged', 'sfx/engine-supercharged'),
  ];

  return files;
}

/** Music, loaded in the background once the game runs. */
export function musicFiles(): SoundFile[] {
  return Object.values(MUSIC).map((key) => both(key, `music/${key.replace(/^music-/, '')}`));
}
