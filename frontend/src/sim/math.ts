export const TAU = Math.PI * 2;

export interface Vec {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Wraps an angle into [-PI, PI). */
export function wrapAngle(angle: number): number {
  return angle - TAU * Math.floor((angle + Math.PI) / TAU);
}

/** Rounds an angle to the nearest of steps evenly spaced directions; 0 steps leaves it free. */
export function snapAngle(angle: number, steps: number): number {
  if (steps <= 0) {
    return wrapAngle(angle);
  }
  const step = TAU / steps;

  return wrapAngle(Math.round(angle / step) * step);
}

/** Scales (x, y) to length 1, or returns zero for a zero vector. */
export function normalize(x: number, y: number): Vec {
  const length = Math.hypot(x, y);
  if (length === 0) {
    return { x: 0, y: 0 };
  }

  return { x: x / length, y: y / length };
}

/**
 * Turns an offset in sprite space into world space for a sprite facing angle.
 * Sprites face up, so forward is the sprite's -y and right is its +x.
 */
export function rotateOffset(forward: number, right: number, angle: number): Vec {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return { x: forward * cos - right * sin, y: forward * sin + right * cos };
}

/** A triangle wave with period 1: 0 at 0, 1 at 0.25, 0 at 0.5, -1 at 0.75. */
export function triangleWave(phase: number): number {
  const shifted = phase - 0.25;

  return 1 - 4 * Math.abs(Math.round(shifted) - shifted);
}

/** Returns a deterministic pseudo-random generator (mulberry32) yielding [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
