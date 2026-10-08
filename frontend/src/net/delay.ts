/** Remote ships and enemies are drawn at least this many ticks in the past. */
export const MIN_DELAY_TICKS = 2;

/** And at most this many, however late snapshots come. */
export const MAX_DELAY_TICKS = 5;

/** How many snapshots the delay follows: 10 s at 20 Hz. */
const WINDOW = 200;

/** The share of snapshots the delay waits for; the rest arrive after their tick is drawn. */
const PERCENTILE = 0.95;

/**
 * Picks how far in the past to draw the others: long enough that 95% of
 * snapshots arrive before their tick is drawn, and a tick more, so the one
 * after is there to blend toward.
 */
export class DelayEstimator {
  private readonly late: number[] = [];
  private next = 0;
  private cached = MIN_DELAY_TICKS;

  /** Records how many ticks after the clock's estimate a snapshot arrived. */
  observe(lateTicks: number): void {
    if (this.late.length < WINDOW) {
      this.late.push(lateTicks);
    } else {
      this.late[this.next] = lateTicks;
      this.next = (this.next + 1) % WINDOW;
    }
    const sorted = [...this.late].sort((a, b) => a - b);
    const p = sorted[Math.floor(PERCENTILE * (sorted.length - 1))] ?? 0;
    this.cached = Math.min(MAX_DELAY_TICKS, Math.max(MIN_DELAY_TICKS, p + 1));
  }

  /** The delay to draw at, in ticks. */
  get target(): number {
    return this.cached;
  }
}
