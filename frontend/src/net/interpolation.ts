import { wrapAngle } from '../sim/math.ts';

const MAX_SAMPLES = 32;

/** How far past its newest snapshot a ship or enemy flies on along its velocity (150 ms at 20 Hz). */
export const MAX_EXTRAPOLATION_TICKS = 3;

/** How long a correction from a newer snapshot takes to fade out (100 ms at 20 Hz). */
const BLEND_TICKS = 2;

/** A correction longer than this (a respawn, a takeover, a teleport) is shown at once. */
const MAX_BLEND_PX = 150;

/** Anything drawn at a position and facing, moving in px/s. */
export interface Pose {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
}

interface Sample<T extends Pose> {
  tick: number;
  state: T;
}

/**
 * A remote ship or enemy's recent states. Sampled between the two that surround a
 * tick; before the first it holds, and past the last it flies on along its
 * velocity for a few ticks, then holds.
 */
export class StateBuffer<T extends Pose> {
  private readonly samples: Sample<T>[] = [];
  private readonly ticksPerSecond: number;
  /** The tick drawn last and where sampling put it then, to see a newer snapshot move it. */
  private drawn: { tick: number; x: number; y: number } | undefined;
  /** What is left of a correction, set at a tick and fading from there. */
  private offset: { tick: number; x: number; y: number } | undefined;

  constructor(tickRate: number) {
    this.ticksPerSecond = tickRate;
  }

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
      const seconds = Math.min(tick - last.tick, MAX_EXTRAPOLATION_TICKS) / this.ticksPerSecond;
      if (seconds === 0 || (last.state.vx === 0 && last.state.vy === 0)) {
        return last.state;
      }

      return { ...last.state, x: last.state.x + last.state.vx * seconds, y: last.state.y + last.state.vy * seconds };
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

  /**
   * The state to draw this frame at renderTick. Where a newer snapshot moved
   * the tick drawn last, the difference fades out instead of showing as a jump.
   */
  draw(renderTick: number): T | undefined {
    const pose = this.sample(renderTick);
    if (pose === undefined) {
      return undefined;
    }
    const drawn = this.drawn;
    const then = drawn === undefined ? undefined : this.sample(drawn.tick);
    if (drawn !== undefined && then !== undefined && (then.x !== drawn.x || then.y !== drawn.y)) {
      const left = this.offsetAt(drawn.tick);
      const x = left.x + drawn.x - then.x;
      const y = left.y + drawn.y - then.y;
      this.offset = Math.hypot(x, y) > MAX_BLEND_PX ? undefined : { tick: drawn.tick, x, y };
    }
    this.drawn = { tick: renderTick, x: pose.x, y: pose.y };
    const offset = this.offsetAt(renderTick);

    return offset.x === 0 && offset.y === 0 ? pose : { ...pose, x: pose.x + offset.x, y: pose.y + offset.y };
  }

  private offsetAt(tick: number): { x: number; y: number } {
    const offset = this.offset;
    const share = offset === undefined ? 0 : Math.min(1, 1 - (tick - offset.tick) / BLEND_TICKS);
    if (offset === undefined || share <= 0) {
      return { x: 0, y: 0 };
    }

    return { x: offset.x * share, y: offset.y * share };
  }
}
