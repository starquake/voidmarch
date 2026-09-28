/**
 * Presentation tunables: the view, the effects and what's worth drawing or
 * hearing. The rules' numbers are the Go sim's (internal/sim/tuning.go),
 * generated into rules.gen.ts and passed on here.
 */
export {
  ENGINE_STATS,
  MAX_TICKS_PER_FRAME,
  SAFE_ZONE_RADIUS,
  SHIP_RADIUS,
  TICK_RATE,
  TICK_SECONDS,
  WEAPON_STATS,
  WORLD_EDGE_BAND,
  WORLD_HALF_SIZE,
} from './rules.gen.ts';

/** The view is at least this many art pixels; the zoom is the largest whole number that fits. */
export const VIEW_WIDTH = 640;
export const VIEW_HEIGHT = 360;

/** 0 is free rotation; 16 snaps to 16 directions (see docs/design.md, "Controls & feel"). */
export const ROTATION_SNAP_STEPS = 16;

export const ASTEROID_SEED = 20260927;
export const ASTEROID_COUNT = 60;
/** Keeps asteroids away from the home planet. */
export const ASTEROID_CLEAR_RADIUS = 260;

/**
 * Volleys from enemies farther than this from the ship are skipped: past the
 * view plus the bullets' reach, they can neither be seen nor hit you.
 */
export const ENEMY_VOLLEY_RANGE = 800;
/** Enemies explode audibly only this close to the ship, about the view. */
export const ENEMY_SOUND_RANGE = 400;

/**
 * Enemy bullets fly on a layer with one glow in this colour (0xRRGGBB), so
 * they stand out from the players' shots (#36). Quality is the filter's
 * sample count: a low one keeps software-rendered CI fast.
 */
export const ENEMY_FIRE_GLOW_COLOUR = 0x3fa8ff;
export const ENEMY_FIRE_GLOW_STRENGTH = 6;
export const ENEMY_FIRE_GLOW_QUALITY = 3;
export const ENEMY_FIRE_GLOW_DISTANCE = 4;
