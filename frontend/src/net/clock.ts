/**
 * Estimates the server's tick from the ticks it reports. A report can only
 * arrive late, never early, so the estimate follows the least-delayed
 * reports and forgets slowly (drift) instead of jumping back on a slow one.
 */
export class ServerClock {
  private offset: number | undefined;
  private readonly ticksPerMs: number;

  constructor(tickRate: number) {
    this.ticksPerMs = tickRate / 1000;
  }

  /** How far a stale estimate may fall back per report, in ticks. */
  static readonly DRIFT = 0.05;

  /** Records that the server was at tick when a report arrived at nowMs. */
  observe(tick: number, nowMs: number): void {
    const sample = tick - nowMs * this.ticksPerMs;
    this.offset = this.offset === undefined ? sample : Math.max(sample, this.offset - ServerClock.DRIFT);
  }

  /** The estimated server tick at nowMs, fractional; undefined before any report. */
  tickAt(nowMs: number): number | undefined {
    return this.offset === undefined ? undefined : this.offset + nowMs * this.ticksPerMs;
  }
}
