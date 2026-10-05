import {
  TELEPORT_CLOSE_S,
  TELEPORT_FLASH_RADIUS,
  TELEPORT_FLASH_S,
  TELEPORT_HOLD_S,
  TELEPORT_SHIELD_START_SCALE,
  TELEPORT_SHRINK_S,
} from './tuning.ts';

/** How long a derelict's teleport takes, in seconds (#190). */
export const TELEPORT_DURATION_S = TELEPORT_CLOSE_S + TELEPORT_HOLD_S + TELEPORT_SHRINK_S + TELEPORT_FLASH_S;

/** One moment of a teleport: the shield's and hull's scale, whether they've turned light, and the flash. */
export interface TeleportFrame {
  shieldScale: number;
  shieldAlpha: number;
  hullScale: number;
  white: boolean;
  flashRadius: number;
  flashAlpha: number;
  done: boolean;
}

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);

/** The teleport this many seconds after it started (#190). */
export function teleportFrame(elapsed: number): TeleportFrame {
  const t = Math.max(elapsed, 0);
  const shrinking = TELEPORT_CLOSE_S + TELEPORT_HOLD_S;
  const shrunk = shrinking + TELEPORT_SHRINK_S;
  if (t >= TELEPORT_DURATION_S) {
    return { shieldScale: 0, shieldAlpha: 0, hullScale: 0, white: true, flashRadius: 0, flashAlpha: 0, done: true };
  }
  if (t < shrinking) {
    const eased = 1 - (1 - clamp01(t / TELEPORT_CLOSE_S)) ** 2;

    return {
      shieldScale: TELEPORT_SHIELD_START_SCALE + (1 - TELEPORT_SHIELD_START_SCALE) * eased,
      shieldAlpha: eased,
      hullScale: 1,
      white: false,
      flashRadius: 0,
      flashAlpha: 0,
      done: false,
    };
  }
  if (t < shrunk) {
    const shrink = clamp01((t - shrinking) / TELEPORT_SHRINK_S);

    return {
      shieldScale: 1 - shrink,
      shieldAlpha: 1,
      hullScale: 1 - shrink,
      white: true,
      flashRadius: TELEPORT_FLASH_RADIUS * shrink,
      flashAlpha: shrink,
      done: false,
    };
  }
  const collapse = clamp01((t - shrunk) / TELEPORT_FLASH_S);

  return { shieldScale: 0, shieldAlpha: 0, hullScale: 0, white: true, flashRadius: TELEPORT_FLASH_RADIUS * (1 - collapse), flashAlpha: 1, done: false };
}
