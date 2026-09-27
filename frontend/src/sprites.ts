import { DAMAGE_STATES, ENGINES, SHIELDS, WEAPONS, type DamageState, type EngineId, type ShieldId, type WeaponId } from './sim/loadout.ts';
import { WEAPON_STATS } from './sim/tuning.ts';
import type { WeaponTiming } from './weaponframes.ts';

const ASSETS = '/static/assets';

/** A PNG strip of equal frames, laid out left to right. */
export interface Sheet {
  key: string;
  url: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  /** Animation speed; 0 for a still image. */
  fps: number;
  loop: boolean;
}

const still = (key: string, url: string, size: number): Sheet => ({
  key,
  url,
  frameWidth: size,
  frameHeight: size,
  frames: 1,
  fps: 0,
  loop: false,
});

const strip = (key: string, url: string, size: number, frames: number, fps: number, loop = true): Sheet => ({
  key,
  url,
  frameWidth: size,
  frameHeight: size,
  frames,
  fps,
  loop,
});

interface WeaponFiles {
  weapon: string;
  projectile: string;
  frames: number;
  projectileFrames: number;
  /** Frames where a shot leaves, read off the sheets: the barrel flashes, a rocket goes, the recoil starts. */
  releaseFrames: readonly number[];
  releaseFps: number;
}

const WEAPON_FILES: Record<WeaponId, WeaponFiles> = {
  // Frame 1 flashes the left barrel, frame 2 the right, then smoke.
  autoCannon: {
    weapon: 'weapon-auto-cannon',
    projectile: 'projectile-auto-cannon',
    frames: 7,
    projectileFrames: 4,
    releaseFrames: [1, 2],
    releaseFps: 16,
  },
  // Two pods of three; a rocket leaves every second frame, left pod first.
  rockets: {
    weapon: 'weapon-rockets',
    projectile: 'projectile-rocket',
    frames: 17,
    projectileFrames: 3,
    releaseFrames: [2, 4, 6, 8, 10, 12],
    releaseFps: 2 / WEAPON_STATS.rockets.interval,
  },
  // Frames 0-6 glow up while charging; the recoil starts on frame 7.
  bigSpaceGun: {
    weapon: 'weapon-big-space-gun',
    projectile: 'projectile-big-space-gun',
    frames: 12,
    projectileFrames: 10,
    releaseFrames: [7],
    releaseFps: 12,
  },
  // The prongs light up over frames 2-7 and discharge after.
  zapper: {
    weapon: 'weapon-zapper',
    projectile: 'projectile-zapper',
    frames: 14,
    projectileFrames: 8,
    releaseFrames: [7],
    releaseFps: 30,
  },
};

/** When the weapon sheet's frames happen; see WeaponAnimator. */
export function weaponTiming(id: WeaponId): WeaponTiming {
  const f = WEAPON_FILES[id];

  return { frames: f.frames, releaseFrames: f.releaseFrames, releaseFps: f.releaseFps };
}

const ENGINE_FILES: Record<EngineId, { file: string; idle: number; powering: number }> = {
  base: { file: 'engine-base', idle: 3, powering: 4 },
  bigPulse: { file: 'engine-big-pulse', idle: 4, powering: 4 },
  burst: { file: 'engine-burst', idle: 7, powering: 6 },
  supercharged: { file: 'engine-supercharged', idle: 4, powering: 4 },
};

const SHIELD_FILES: Record<ShieldId, { file: string; frames: number }> = {
  front: { file: 'shield-front', frames: 10 },
  frontAndSide: { file: 'shield-front-and-side', frames: 6 },
  round: { file: 'shield-round', frames: 12 },
  invincibility: { file: 'shield-invincibility', frames: 10 },
};

const HULL_FILES: Record<DamageState, string> = {
  fullHealth: 'hull-full-health',
  slightDamage: 'hull-slight-damage',
  damaged: 'hull-damaged',
  veryDamaged: 'hull-very-damaged',
};

export const keys = {
  hull: (state: DamageState): string => `hull-${state}`,
  engine: (id: EngineId): string => `engine-${id}`,
  flameIdle: (id: EngineId): string => `flame-${id}-idle`,
  flamePowering: (id: EngineId): string => `flame-${id}-powering`,
  shield: (id: ShieldId): string => `shield-${id}`,
  weapon: (id: WeaponId): string => `weapon-${id}`,
  projectile: (id: WeaponId): string => `projectile-${id}`,
  background: ['background-void', 'background-stars', 'background-big-stars'] as const,
  planet: 'planet',
  asteroid: 'asteroid',
};

/** Every sheet the client loads, with its frame layout from the Void packs. */
export function sheets(): Sheet[] {
  const ship = `${ASSETS}/mainship`;
  const env = `${ASSETS}/environment`;

  return [
    ...DAMAGE_STATES.map((s) => still(keys.hull(s), `${ship}/${HULL_FILES[s]}.png`, 48)),
    ...ENGINES.flatMap((id) => {
      const f = ENGINE_FILES[id];

      return [
        still(keys.engine(id), `${ship}/${f.file}.png`, 48),
        strip(keys.flameIdle(id), `${ship}/${f.file}-idle.png`, 48, f.idle, 10),
        strip(keys.flamePowering(id), `${ship}/${f.file}-powering.png`, 48, f.powering, 14),
      ];
    }),
    ...SHIELDS.map((id) => strip(keys.shield(id), `${ship}/${SHIELD_FILES[id].file}.png`, 64, SHIELD_FILES[id].frames, 12)),
    ...WEAPONS.flatMap((id) => {
      const f = WEAPON_FILES[id];

      return [
        // Frames are picked by WeaponAnimator, so no Phaser animation.
        strip(keys.weapon(id), `${ship}/${f.weapon}.png`, 48, f.frames, 0, false),
        strip(keys.projectile(id), `${ship}/${f.projectile}.png`, 32, f.projectileFrames, 12),
      ];
    }),
    ...keys.background.map((key) => ({
      key,
      url: `${env}/${key}.png`,
      frameWidth: 640,
      frameHeight: 360,
      frames: 9,
      fps: 6,
      loop: true,
    })),
    strip(keys.planet, `${env}/planet-earth-like.png`, 96, 77, 8),
    still(keys.asteroid, `${env}/asteroid.png`, 96),
  ];
}
