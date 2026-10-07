import { wrapAngle } from '../sim/math.ts';

const MAX_SAMPLES = 32;

/** Anything drawn at a position and facing. */
export interface Pose {
  x: number;
  y: number;
  angle: number;
}

interface Sample<T extends Pose> {
  tick: number;
  state: T;
}

/**
 * A remote ship or enemy's recent states. Sampled between the two that surround a
 * tick; before the first or after the last it holds, never guessing ahead.
 */
export class StateBuffer<T extends Pose> {
  private readonly samples: Sample<T>[] = [];

  push(tick: number, state: T): void {
    const last = this.samples.at(-1);
    if (last !== undefined && tick <= last.tick) {
      return;
    }
    this.samples.push({ tick, state });
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.shift();
    }
  }

  get empty(): boolean {
    return this.samples.length === 0;
  }

  /** The state at a (fractional) tick, or undefined with no samples. */
  sample(tick: number): T | undefined {
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (first === undefined || last === undefined) {
      return undefined;
    }
    if (tick <= first.tick) {
      return first.state;
    }
    if (tick >= last.tick) {
      return last.state;
    }

    let i = this.samples.length - 1;
    while (i > 0 && (this.samples[i - 1]?.tick ?? 0) > tick) {
      i--;
    }
    const a = this.samples[i - 1];
    const b = this.samples[i];
    if (a === undefined || b === undefined) {
      return last.state;
    }

    const t = (tick - a.tick) / (b.tick - a.tick);

    return {
      ...a.state,
      x: a.state.x + (b.state.x - a.state.x) * t,
      y: a.state.y + (b.state.y - a.state.y) * t,
      angle: wrapAngle(a.state.angle + wrapAngle(b.state.angle - a.state.angle) * t),
    };
  }
}
