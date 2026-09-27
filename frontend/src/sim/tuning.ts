import type { EngineId, ShieldId, WeaponId } from './loadout.ts';

/** The simulation runs at a fixed rate, independent of the display. */
export const TICK_RATE = 60;
export const TICK_SECONDS = 1 / TICK_RATE;
/** Caps catch-up after a stall (a background tab), so the sim never spirals. */
export const MAX_TICKS_PER_FRAME = 5;

/** The view is at least this many art pixels; the zoom is the largest whole number that fits. */
export const VIEW_WIDTH = 640;
export const VIEW_HEIGHT = 360;

/** The world is a square centred on the home planet at (0, 0). */
export const WORLD_HALF_SIZE = 2000;
/** Inside this band along the edge the ship is pushed back. */
export const WORLD_EDGE_BAND = 200;
/** Push-back acceleration at the very edge, in px/s². */
export const WORLD_EDGE_PUSH = 1400;

/** 0 is free rotation; 16 snaps to 16 directions (see docs/design.md, "Controls & feel"). */
export const ROTATION_SNAP_STEPS = 16;

export const ASTEROID_SEED = 20260927;
export const ASTEROID_COUNT = 60;
/** Keeps asteroids away from the home planet. */
export const ASTEROID_CLEAR_RADIUS = 260;

export interface EngineStats {
  /** px/s² while thrusting. */
  acceleration: number;
  /** px/s. */
  maxSpeed: number;
  /** Fraction of velocity lost per second, applied continuously. */
  drag: number;
}

/** Sidegrades: snappy and slow, drifty and fast, and between. */
export const ENGINE_STATS: Readonly<Record<EngineId, EngineStats>> = {
  base: { acceleration: 900, maxSpeed: 220, drag: 3.5 },
  bigPulse: { acceleration: 520, maxSpeed: 300, drag: 1.2 },
  burst: { acceleration: 1700, maxSpeed: 185, drag: 7 },
  supercharged: { acceleration: 1200, maxSpeed: 270, drag: 2 },
};

/** A barrel position in sprite pixels from the ship's centre: forward is up, right is right. */
export interface Muzzle {
  forward: number;
  right: number;
}

export interface WeaponStats {
  /** Seconds between shots. */
  interval: number;
  /** Seconds between pulling the trigger and the shot leaving; a started charge always fires. */
  charge: number;
  /** Launch speed in px/s. */
  speed: number;
  /** px/s², 0 for constant speed. */
  acceleration: number;
  /** Speed cap when accelerating. */
  maxSpeed: number;
  /** Seconds before the projectile expires. */
  lifetime: number;
  damage: number;
  muzzles: readonly Muzzle[];
  /** Fire one muzzle per shot in turn instead of all at once. */
  alternate: boolean;
  /** Sideways travel of a zigzagging projectile; amplitude 0 flies straight. */
  zigzag: { amplitude: number; frequency: number };
  /** Camera shake per shot, 0 for none. */
  shake: number;
}

const STRAIGHT = { amplitude: 0, frequency: 0 };

/** Sidegrades: a new player's auto cannon is useful in any fight. */
export const WEAPON_STATS: Readonly<Record<WeaponId, WeaponStats>> = {
  autoCannon: {
    interval: 0.13,
    charge: 0,
    speed: 520,
    acceleration: 0,
    maxSpeed: 520,
    lifetime: 0.9,
    damage: 1,
    muzzles: [
      { forward: 9, right: -10.5 },
      { forward: 9, right: 10.5 },
    ],
    alternate: true,
    zigzag: STRAIGHT,
    shake: 0,
  },
  rockets: {
    interval: 0.32,
    charge: 0,
    speed: 140,
    acceleration: 900,
    maxSpeed: 560,
    lifetime: 1.5,
    damage: 4,
    muzzles: [
      { forward: 7, right: -12 },
      { forward: 7, right: 12 },
    ],
    alternate: true,
    zigzag: STRAIGHT,
    shake: 0,
  },
  bigSpaceGun: {
    interval: 0.9,
    charge: 0.45,
    speed: 300,
    acceleration: 0,
    maxSpeed: 300,
    lifetime: 2,
    damage: 12,
    muzzles: [{ forward: 16, right: 0 }],
    alternate: false,
    zigzag: STRAIGHT,
    shake: 0.006,
  },
  zapper: {
    interval: 0.24,
    charge: 0.1,
    speed: 430,
    acceleration: 0,
    maxSpeed: 430,
    lifetime: 0.75,
    damage: 2,
    muzzles: [
      { forward: 15, right: -11 },
      { forward: 15, right: 11 },
    ],
    alternate: false,
    zigzag: { amplitude: 7, frequency: 5 },
    shake: 0,
  },
};

export interface ShieldStats {
  /** Arc the shield blocks, centred on the aim direction, in radians. */
  coverage: number;
  /** Hits absorbed before it drops. */
  strength: number;
  /** Seconds out of combat to recharge fully. */
  recharge: number;
}

/** Coverage against strength against recharge; used from milestone 4 (#5). */
export const SHIELD_STATS: Readonly<Record<ShieldId, ShieldStats>> = {
  front: { coverage: Math.PI * 0.5, strength: 3, recharge: 5 },
  frontAndSide: { coverage: Math.PI, strength: 2, recharge: 5 },
  round: { coverage: Math.PI * 2, strength: 1, recharge: 3 },
  invincibility: { coverage: Math.PI * 2, strength: 3, recharge: 12 },
};
