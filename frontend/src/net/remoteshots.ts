import type { ShotSpawn } from '../sim/weapons.ts';

interface Pending {
  tick: number;
  from: string;
  shot: ShotSpawn;
}

/** A remote shot to spawn now, already this old, fired by player from. */
export interface DueShot {
  from: string;
  shot: ShotSpawn;
  ageSeconds: number;
}

/**
 * Holds other players' shots until the delayed timeline remote ships are
 * drawn on reaches them, so a shot leaves the muzzle as it is drawn.
 */
export class RemoteShots {
  private pending: Pending[] = [];
  private readonly tickRate: number;

  constructor(tickRate: number) {
    this.tickRate = tickRate;
  }

  add(tick: number, from: string, shot: ShotSpawn): void {
    this.pending.push({ tick, from, shot });
  }

  /** Removes and returns the shots at or before renderTick, with their age. */
  due(renderTick: number): DueShot[] {
    const due: DueShot[] = [];
    this.pending = this.pending.filter((p) => {
      if (p.tick > renderTick) {
        return true;
      }
      due.push({ from: p.from, shot: p.shot, ageSeconds: (renderTick - p.tick) / this.tickRate });

      return false;
    });

    return due;
  }
}
