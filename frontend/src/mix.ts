/** Volume and playback rate for an engine loop. */
export interface EngineMix {
  volume: number;
  rate: number;
}

const ENGINE_IDLE_VOLUME = 0.12;
const ENGINE_THRUST_VOLUME = 0.32;
const ENGINE_MIN_RATE = 0.85;
const ENGINE_RATE_RANGE = 0.35;

/** The engine idles quietly and rises in volume with thrust and in pitch with speed. */
export function engineMix(speed: number, maxSpeed: number, thrusting: boolean): EngineMix {
  const fraction = maxSpeed > 0 ? Math.min(1, Math.max(0, speed / maxSpeed)) : 0;

  return {
    volume: thrusting ? ENGINE_THRUST_VOLUME : ENGINE_IDLE_VOLUME + (ENGINE_THRUST_VOLUME - ENGINE_IDLE_VOLUME) * fraction * 0.5,
    rate: ENGINE_MIN_RATE + ENGINE_RATE_RANGE * fraction,
  };
}

/**
 * Tells when a looping sound's rate or volume is worth setting again: the first
 * time, once it has moved a step from what was set, or once it settles anywhere
 * else. Phaser restarts a loop's source on every rate change (#263).
 */
export class LoopLevel {
  private readonly step: number;
  private applied: number | undefined;
  private last: number | undefined;

  constructor(step: number) {
    this.step = step;
  }

  /** The value to set now, or undefined to leave the sound as it is. */
  next(value: number): number | undefined {
    const settled = value === this.last;
    this.last = value;
    if (value === this.applied) {
      return undefined;
    }
    if (this.applied !== undefined && Math.abs(value - this.applied) < this.step && !settled) {
      return undefined;
    }
    this.applied = value;

    return value;
  }
}

/** Picks the next of several variants, cycling through them. */
export function nextVariant(variants: readonly string[], counter: number): string | undefined {
  if (variants.length === 0) {
    return undefined;
  }

  return variants[counter % variants.length];
}

/** Picks a random one of several variants, never the one played last unless it's the only one. */
export function randomVariant(variants: readonly string[], last: string | undefined, random: () => number): string | undefined {
  const others = variants.length > 1 ? variants.filter((v) => v !== last) : variants;

  return others[Math.floor(random() * others.length)];
}

const DETUNE_CENTS = 80;

/** A small random pitch shift in cents, so repeated shots don't sound machine-made. */
export function shotDetune(random: () => number): number {
  return (random() * 2 - 1) * DETUNE_CENTS;
}
