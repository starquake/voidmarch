/** Something due now, already this old. */
export interface Due<T> {
  item: T;
  ageSeconds: number;
}

/**
 * Holds things stamped with a server tick (other players' shots, enemy
 * bullets) until the delayed timeline remote ships are drawn on reaches them,
 * so a shot leaves the muzzle as it is drawn.
 */
export class TimedQueue<T> {
  private pending: { tick: number; item: T }[] = [];
  private readonly tickRate: number;

  constructor(tickRate: number) {
    this.tickRate = tickRate;
  }

  add(tick: number, item: T): void {
    this.pending.push({ tick, item });
  }

  /** Drops what matches before it is due. */
  remove(match: (item: T) => boolean): void {
    this.pending = this.pending.filter((p) => !match(p.item));
  }

  /** Removes and returns what is at or before renderTick, with its age. */
  due(renderTick: number): Due<T>[] {
    const due: Due<T>[] = [];
    this.pending = this.pending.filter((p) => {
      if (p.tick > renderTick) {
        return true;
      }
      due.push({ item: p.item, ageSeconds: (renderTick - p.tick) / this.tickRate });

      return false;
    });

    return due;
  }
}
