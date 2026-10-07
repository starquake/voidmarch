import { DAMAGE_STATES, ENGINES, SHIELDS, WEAPONS, type DamageState, type EngineId, type ShieldId, type WeaponId } from './sim/loadout.ts';
import { PARTS, type PartId } from './sim/parts.ts';
import { ENEMY_FACTIONS, ENEMY_KINDS, type EnemyBulletId, type EnemyFaction, type EnemyKind } from './sim/enemies.ts';
import { WEAPON_STATS } from './sim/tuning.ts';
import type { WeaponTiming } from './weaponframes.ts';
import { STATIC } from './net/static.ts';

export const ASSETS = `${STATIC}assets`;

/** A PNG of equal frames, laid out left to right and, past `columns`, in rows below. */
export interface Sheet {
  key: string;
  url: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  /** Frames per row, where cmd/cutsheets laid the sheet out as a grid (#222, #236); one row without. */
  columns?: number;
  /** The frames its animation plays, in order, where that isn't each frame once (#236). */
  animation?: readonly number[];
  /** Animation speed; 0 for a still image. */
  fps: number;
  loop: boolean;
}

/** The frames a sheet's animation plays, in order. */
export const animationFrames = (sheet: Sheet): number[] =>
  sheet.animation === undefined ? Array.from({ length: sheet.frames }, (_, i) => i) : [...sheet.animation];

const still = (key: string, url: string, size: number): Sheet => ({
  key,
  url,
  frameWidth: size,
  frameHeight: size,
  frames: 1,
  fps: 0,
  loop: false,
});


/** A ship's strips, by part. */
type EnemyPart = 'base' | 'engine' | 'weapons' | 'destruction' | 'shield';

/**
 * A strip cmd/cutsheets laid out again (#236): each different frame once, in
 * the order the pack's strip first shows it, cropped around its center, in
 * rows of columns.
 */
interface Cut {
  width: number;
  height: number;
  frames: number;
  columns: number;
  /** The frames its animation plays, where the pack's strip shows some more than once. */
  animation?: readonly number[];
}

/** The Dreadnoughts' strips, cut so each fits a 4096 px texture and holds no frame twice (#236). */
const DREADNOUGHT_CUTS: Record<EnemyFaction, Record<EnemyPart, Cut>> = {
  klaed: {
    base: { width: 72, height: 102, frames: 1, columns: 1 },
    engine: { width: 70, height: 104, frames: 6, columns: 6, animation: [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5] },
    weapons: {
      width: 72,
      height: 102,
      frames: 39,
      columns: 13,
      animation: [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 20, 27, 22, 23, 24, 25, 26, 20, 21, 22, 23, 24, 25,
        26, 20, 27, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 34, 12, 35, 36, 37, 38,
      ],
    },
    destruction: { width: 126, height: 106, frames: 12, columns: 6 },
    shield: { width: 118, height: 118, frames: 10, columns: 5 },
  },
  nairan: {
    base: { width: 68, height: 102, frames: 1, columns: 1 },
    engine: { width: 34, height: 116, frames: 8, columns: 8 },
    weapons: {
      width: 68,
      height: 102,
      frames: 7,
      columns: 7,
      animation: [0, 1, 2, 3, 4, 5, 5, 0, 0, 5, 5, 5, 0, 0, 5, 5, 5, 0, 0, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
    },
    destruction: { width: 112, height: 108, frames: 18, columns: 6 },
    shield: { width: 124, height: 124, frames: 8, columns: 8 },
  },
  nautolan: {
    base: { width: 72, height: 104, frames: 1, columns: 1 },
    engine: { width: 36, height: 116, frames: 7, columns: 7, animation: [0, 1, 2, 3, 0, 4, 5, 6] },
    weapons: {
      width: 72,
      height: 104,
      frames: 22,
      columns: 11,
      animation: [0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 9, 9, 10, 11, 12, 13, 14, 15, 16, 17, 14, 15, 16, 17, 14, 15, 16, 17, 14, 15, 16, 18, 19, 20, 21],
    },
    destruction: { width: 72, height: 106, frames: 12, columns: 6 },
    shield: { width: 112, height: 116, frames: 20, columns: 5 },
  },
};

/** sheet as cut lays it out, where cmd/cutsheets laid it out again. */
const withCut = (sheet: Sheet, cut: Cut | undefined): Sheet =>
  cut === undefined
    ? sheet
    : {
        ...sheet,
        frameWidth: cut.width,
        frameHeight: cut.height,
        frames: cut.frames,
        columns: cut.columns,
        ...(cut.animation === undefined ? {} : { animation: cut.animation }),
      };

interface EnemyFiles {
  size: number;
  engine: number;
  /** No pack draws a Bomber's weapons, so it has none and glows instead (#137). */
  weapons?: number;
  destruction: number;
  shield?: number;
  /** The shield strip's frame size where it isn't the ship's: the Nautolan Frigate's is 63 px. */
  shieldSize?: number;
  /** The weapon strip's speed; longer strips play faster, so every telegraph lasts about as long as the Kla'ed fodder's 6 frames at 18 fps, a Torpedo Ship's as long as its longer hold, and a Dreadnought's as long as the Kla'ed one's over its faction's fire rate (#153). */
  weaponsFps?: number;
  /** Its strips as cmd/cutsheets laid them out again, where it did (#236); the counts above are still the pack's. */
  cuts?: Record<EnemyPart, Cut>;
}

/** The weapon strips' speed unless a ship's files say otherwise. */
const WEAPONS_FPS = 18;

/** Each faction's ships, by the frame counts of their pack's strips; a faction has only the classes it fields so far. */
const ENEMY_FILES: Record<EnemyFaction, Partial<Record<EnemyKind, EnemyFiles>>> = {
  klaed: {
    scout: { size: 64, engine: 10, weapons: 6, destruction: 10 },
    fighter: { size: 64, engine: 10, weapons: 6, destruction: 9 },
    bomber: { size: 64, engine: 10, destruction: 8 },
    torpedo: { size: 64, engine: 10, weapons: 16, destruction: 10, weaponsFps: 21 },
    frigate: { size: 64, engine: 12, weapons: 6, destruction: 9, shield: 40 },
    dreadnought: { size: 128, engine: 12, weapons: 60, destruction: 12, shield: 10, cuts: DREADNOUGHT_CUTS.klaed },
    support: { size: 64, engine: 10, destruction: 10 },
  },
  nairan: {
    scout: { size: 64, engine: 8, weapons: 6, destruction: 16 },
    fighter: { size: 64, engine: 8, weapons: 28, destruction: 18, weaponsFps: 84 },
    bomber: { size: 64, engine: 8, destruction: 16 },
    torpedo: { size: 64, engine: 8, weapons: 12, destruction: 16, weaponsFps: 16 },
    frigate: { size: 64, engine: 8, weapons: 5, destruction: 16, shield: 8, weaponsFps: 15 },
    dreadnought: { size: 128, engine: 8, weapons: 34, destruction: 18, shield: 8, weaponsFps: 15, cuts: DREADNOUGHT_CUTS.nairan },
    support: { size: 64, engine: 8, destruction: 16 },
  },
  nautolan: {
    scout: { size: 64, engine: 8, weapons: 7, destruction: 9, weaponsFps: 21 },
    fighter: { size: 64, engine: 8, weapons: 9, destruction: 9, weaponsFps: 27 },
    bomber: { size: 64, engine: 8, destruction: 10 },
    torpedo: { size: 64, engine: 8, weapons: 16, destruction: 8, weaponsFps: 21 },
    frigate: { size: 64, engine: 8, weapons: 9, destruction: 9, shield: 36, shieldSize: 63, weaponsFps: 27 },
    dreadnought: { size: 128, engine: 8, weapons: 35, destruction: 12, shield: 20, weaponsFps: 21, cuts: DREADNOUGHT_CUTS.nautolan },
    support: { size: 64, engine: 8, destruction: 8 },
  },
};

/** Enemy bullets are drawn in the blue recolor, apart from the players' orange shots (#36), unless plain. */
const BULLET_VARIANT = 'blue';
/** How fast enemy bullets animate. */
const BULLET_FPS = 12;

/** The fleets' bullets: every enemy bullet but a burst's shard, drawn from the player's own shot. */
type FleetBulletId = Exclude<EnemyBulletId, 'shard'>;

/** An enemy bullet's strip, in its faction's folder. */
interface BulletFiles {
  faction: EnemyFaction;
  file: string;
  width: number;
  height: number;
  frames: number;
  /** Drawn in the pack's own colors, for a shot that isn't orange to begin with (#185). */
  plain?: true;
}

/** Enemy bullet strips, each in its faction's folder. */
const BULLET_FRAMES: Record<FleetBulletId, BulletFiles> = {
  klaedBullet: { faction: 'klaed', file: 'bullet', width: 4, height: 16, frames: 4 },
  klaedBigBullet: { faction: 'klaed', file: 'big-bullet', width: 8, height: 16, frames: 4 },
  // The Dreadnought's (#124): a beam segment, and a wave arc.
  klaedRay: { faction: 'klaed', file: 'ray', width: 18, height: 38, frames: 4 },
  klaedWave: { faction: 'klaed', file: 'wave', width: 64, height: 64, frames: 6 },
  nairanBolt: { faction: 'nairan', file: 'bolt', width: 9, height: 9, frames: 5 },
  nairanRay: { faction: 'nairan', file: 'ray', width: 18, height: 38, frames: 4 },
  nautolanBullet: { faction: 'nautolan', file: 'bullet', width: 12, height: 12, frames: 6 },
  nautolanSpinningBullet: { faction: 'nautolan', file: 'spinning-bullet', width: 8, height: 8, frames: 8 },
  // The heavy hitters' (#137): the Bombers' Rockets and Bombs, the Torpedo Ships' Torpedoes and Waves.
  nairanRocket: { faction: 'nairan', file: 'rocket', width: 9, height: 16, frames: 4 },
  nairanTorpedo: { faction: 'nairan', file: 'torpedo', width: 9, height: 24, frames: 3 },
  // The Kla'ed Torpedo keeps the pack's colors: its teal exhaust already stands apart from the players' orange.
  klaedTorpedo: { faction: 'klaed', file: 'torpedo', width: 11, height: 32, frames: 3, plain: true },
  nautolanBomb: { faction: 'nautolan', file: 'bomb', width: 16, height: 16, frames: 16 },
  nautolanWave: { faction: 'nautolan', file: 'wave', width: 64, height: 64, frames: 6 },
  // The Nautolan Dreadnought's beam (#153).
  nautolanRay: { faction: 'nautolan', file: 'ray', width: 18, height: 38, frames: 4 },
};

const strip = (key: string, url: string, size: number, frames: number, fps: number, loop = true, columns?: number): Sheet => ({
  key,
  url,
  frameWidth: size,
  frameHeight: size,
  frames,
  ...(columns === undefined ? {} : { columns }),
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
  /** A pieced background layer's layout (#222), and the texture its frame is drawn into. */
  layerLayout: (key: string): string => `${key}-layout`,
  layerFrame: (key: string): string => `${key}-frame`,
  planet: 'planet',
  asteroid: 'asteroid',
  enemyBase: (faction: EnemyFaction, kind: EnemyKind): string => `${faction}-${kind}-base`,
  enemyEngine: (faction: EnemyFaction, kind: EnemyKind): string => `${faction}-${kind}-engine`,
  enemyWeapons: (faction: EnemyFaction, kind: EnemyKind): string => `${faction}-${kind}-weapons`,
  enemyDestruction: (faction: EnemyFaction, kind: EnemyKind): string => `${faction}-${kind}-destruction`,
  enemyShield: (faction: EnemyFaction, kind: EnemyKind): string => `${faction}-${kind}-shield`,
  enemyBullet: (id: FleetBulletId): string => `${BULLET_FRAMES[id].faction}-${BULLET_FRAMES[id].file}`,
  /** An enemy bullet with its glow baked in at boot (#143), drawn at half scale. */
  enemyBulletGlow: (id: FleetBulletId): string => `${BULLET_FRAMES[id].faction}-${BULLET_FRAMES[id].file}-glow`,
  pickup: (part: PartId): string => `pickup-${part}`,
};

/** The background layers' frame size, and their animation's frame count and speed. */
const LAYER_WIDTH = 640;
const LAYER_HEIGHT = 360;
export const LAYER_FRAMES = 9;
export const LAYER_FPS = 6;

/** The void's shimmer covers the whole layer, so its frames stay whole, as a 3 x 3 grid. */
const VOID = keys.background[0];

/** A background layer cut into a still piece and the regions that animate (#222), with their layout. */
export interface LayerSheet {
  key: string;
  url: string;
  layoutUrl: string;
}

/** The stars layers, each one sheet of pieces that cmd/cutsheets cut. */
export function layerSheets(): LayerSheet[] {
  const env = `${ASSETS}/environment`;

  return keys.background
    .filter((key) => key !== VOID)
    .map((key) => ({ key, url: `${env}/${key}.png`, layoutUrl: `${env}/${key}.json` }));
}

/** A pickup's sheet (#77): its slot, then its part in kebab case, as in assets/pickups. */
export const pickupFile = (part: PartId): string =>
  `${(WEAPONS as readonly string[]).includes(part) ? 'weapon' : (ENGINES as readonly string[]).includes(part) ? 'engine' : 'shield'}-${part.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** The Pickups Pack's strips: 15 frames of 32 px, a wipe that blinks the icon out and back. */
const PICKUP_FRAMES = 15;

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
    {
      key: VOID,
      url: `${env}/${VOID}.png`,
      frameWidth: LAYER_WIDTH,
      frameHeight: LAYER_HEIGHT,
      frames: LAYER_FRAMES,
      columns: 3,
      fps: LAYER_FPS,
      loop: true,
    },
    // Cropped to the 76 px its back glow reaches, around the same center (#222).
    strip(keys.planet, `${env}/planet-earth-like.png`, 76, 77, 8, true, 9),
    ...PARTS.map((part) => strip(keys.pickup(part), `${ASSETS}/pickups/${pickupFile(part)}.png`, 32, PICKUP_FRAMES, 12)),
    still(keys.asteroid, `${env}/asteroid.png`, 96),
    ...ENEMY_FACTIONS.flatMap((faction) =>
      ENEMY_KINDS.flatMap((kind) => {
        const f = ENEMY_FILES[faction][kind];
        if (f === undefined) {
          return [];
        }
        const dir = `${ASSETS}/${faction}`;
        const cut = (part: EnemyPart, sheet: Sheet): Sheet => withCut(sheet, f.cuts?.[part]);

        return [
          cut('base', still(keys.enemyBase(faction, kind), `${dir}/${kind}-base.png`, f.size)),
          cut('engine', strip(keys.enemyEngine(faction, kind), `${dir}/${kind}-engine.png`, f.size, f.engine, 12)),
          ...(f.weapons === undefined
            ? []
            : [cut('weapons', strip(keys.enemyWeapons(faction, kind), `${dir}/${kind}-weapons.png`, f.size, f.weapons, f.weaponsFps ?? WEAPONS_FPS, false))]),
          cut('destruction', strip(keys.enemyDestruction(faction, kind), `${dir}/${kind}-destruction.png`, f.size, f.destruction, 14, false)),
          ...(f.shield === undefined
            ? []
            : [cut('shield', strip(keys.enemyShield(faction, kind), `${dir}/${kind}-shield.png`, f.shieldSize ?? f.size, f.shield, 20))]),
        ];
      }),
    ),
    ...Object.values(BULLET_FRAMES).map((f) => ({
      key: `${f.faction}-${f.file}`,
      url: `${ASSETS}/${f.faction}/${f.file}${f.plain === true ? '' : `-${BULLET_VARIANT}`}.png`,
      frameWidth: f.width,
      frameHeight: f.height,
      frames: f.frames,
      fps: BULLET_FPS,
      loop: true,
    })),
  ];
}

/** An enemy bullet sheet to bake a glowing copy of: its key, the copy's, and its frames. */
export interface GlowSheet {
  key: string;
  glowKey: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  fps: number;
}

/** Every enemy bullet sheet, for the glowing copies the boot scene bakes (#143). */
export function glowSheets(): GlowSheet[] {
  return (Object.keys(BULLET_FRAMES) as FleetBulletId[]).map((id) => ({
    key: keys.enemyBullet(id),
    glowKey: keys.enemyBulletGlow(id),
    frameWidth: BULLET_FRAMES[id].width,
    frameHeight: BULLET_FRAMES[id].height,
    frames: BULLET_FRAMES[id].frames,
    fps: BULLET_FPS,
  }));
}
