import { wrapAngle } from '../sim/math.ts';

/** Remote ships are drawn this many ticks in the past, between two snapshots. */
export const INTERPOLATION_DELAY_TICKS = 2;

const MAX_SAMPLES = 32;

/** Anything drawn at a position and facing. */
export interface Pose {
  x: number;
  y: number;
  angle: number;
}

interface Sample<T extends Pose> {
  tick: number;
  ship: T;
}

/**
 * A remote player's recent states. Sampled between the two that surround a
 * tick; before the first or after the last it holds, never guessing ahead.
 */
export class StateBuffer<T extends Pose> {
  private readonly samples: Sample<T>[] = [];

  push(tick: number, ship: T): void {
    const last = this.samples.at(-1);
    if (last !== undefined && tick <= last.tick) {
      return;
    }
    this.samples.push({ tick, ship });
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.shift();
    }
  }

  get empty(): boolean {
    return this.samples.length === 0;
  }

  /** The ship at a (fractional) tick, or undefined with no samples. */
  sample(tick: number): T | undefined {
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (first === undefined || last === undefined) {
      return undefined;
    }
    if (tick <= first.tick) {
      return first.ship;
    }
    if (tick >= last.tick) {
      return last.ship;
    }

    let i = this.samples.length - 1;
    while (i > 0 && (this.samples[i - 1]?.tick ?? 0) > tick) {
      i--;
    }
    const a = this.samples[i - 1];
    const b = this.samples[i];
    if (a === undefined || b === undefined) {
      return last.ship;
    }

    const t = (tick - a.tick) / (b.tick - a.tick);

    return {
      ...a.ship,
      x: a.ship.x + (b.ship.x - a.ship.x) * t,
      y: a.ship.y + (b.ship.y - a.ship.y) * t,
      angle: wrapAngle(a.ship.angle + wrapAngle(b.ship.angle - a.ship.angle) * t),
    };
  }
}
