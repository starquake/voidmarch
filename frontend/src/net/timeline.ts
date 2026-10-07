import { ServerClock } from './clock.ts';
import { DelayEstimator, type DelayRange } from './delay.ts';

/** How much slower than real time the render clock may run while the delay grows. */
const MAX_SLOWDOWN = 0.1;

/** How much faster it may run while the delay shrinks, or the server clock jumps ahead. */
const MAX_SPEEDUP = 0.05;

/** How far behind its goal the render clock may fall before it jumps there (1 s at 20 Hz). */
const SNAP_TICKS = 20;

/** The ?diag=1 HUD's line about the delay: the current one, then the one it heads for. */
export function delayLine(delayTicks: number, targetTicks: number): string {
  return `delay ${delayTicks.toFixed(1)} / ${targetTicks.toFixed(1)} ticks`;
}

/**
 * The delayed timeline others are drawn on (#232): the server's tick, as the
 * snapshots tell it, less a delay that follows how late they arrive. The
 * render clock runs at real time, stretched a little toward that goal, so a
 * change in the delay or the clock never shows as a jump.
 */
export class Timeline {
  private readonly clock: ServerClock;
  private readonly estimator: DelayEstimator;
  private readonly ticksPerMs: number;
  private render: { tick: number; atMs: number } | undefined;
  private lastDelay = 0;

  constructor(tickRate: number, range?: DelayRange) {
    this.clock = new ServerClock(tickRate);
    this.estimator = new DelayEstimator(range);
    this.ticksPerMs = tickRate / 1000;
  }

  /** Records a report of the server's tick (a snapshot, a welcome) that arrived at nowMs. */
  snapshot(tick: number, nowMs: number): void {
    const expected = this.clock.tickAt(nowMs);
    if (expected !== undefined) {
      this.estimator.observe(Math.max(0, expected - tick));
    }
    this.clock.observe(tick, nowMs);
  }

  /** The estimated server tick at nowMs; undefined before any report. */
  serverTick(nowMs: number): number | undefined {
    return this.clock.tickAt(nowMs);
  }

  /** The tick to draw others at, at nowMs; undefined before any report. It never goes back. */
  renderTick(nowMs: number): number | undefined {
    const serverTick = this.clock.tickAt(nowMs);
    if (serverTick === undefined) {
      return undefined;
    }
    const goal = serverTick - this.estimator.target;
    const render = this.render;
    if (render === undefined || goal - render.tick > SNAP_TICKS) {
      this.render = { tick: goal, atMs: nowMs };
    } else {
      const elapsed = Math.max(0, nowMs - render.atMs) * this.ticksPerMs;
      const step = Math.min(elapsed * (1 + MAX_SPEEDUP), Math.max(elapsed * (1 - MAX_SLOWDOWN), goal - render.tick));
      this.render = { tick: render.tick + step, atMs: Math.max(nowMs, render.atMs) };
    }
    this.lastDelay = serverTick - this.render.tick;

    return this.render.tick;
  }

  /** How far behind the server the last frame was drawn, in ticks. */
  get delay(): number {
    return this.lastDelay;
  }

  /** The delay the render clock is heading for, in ticks. */
  get target(): number {
    return this.estimator.target;
  }
}
