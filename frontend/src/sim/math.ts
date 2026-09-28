export const TAU = Math.PI * 2;

export interface Vec {
  x: number;
  y: number;
}

/** Wraps an angle into [-PI, PI). */
export function wrapAngle(angle: number): number {
  return angle - TAU * Math.floor((angle + Math.PI) / TAU);
}

/** Scales (x, y) to length 1, or returns zero for a zero vector. */
export function normalize(x: number, y: number): Vec {
  const length = Math.hypot(x, y);
  if (length === 0) {
    return { x: 0, y: 0 };
  }

  return { x: x / length, y: y / length };
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
