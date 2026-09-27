import { DEFAULT_LOADOUT, type WeaponId } from './loadout.ts';
import { rotateOffset, triangleWave } from './math.ts';
import { WEAPON_STATS, type WeaponStats } from './tuning.ts';
import type { ShotSpawn } from './weapons.ts';

export interface Projectile {
  active: boolean;
  weapon: WeaponId;
  originX: number;
  originY: number;
  angle: number;
  age: number;
  x: number;
  y: number;
}

/** Distance travelled after age seconds, accelerating up to maxSpeed. */
export function travelled(stats: WeaponStats, age: number): number {
  if (stats.acceleration <= 0) {
    return stats.speed * age;
  }
  const rampTime = Math.max(0, (stats.maxSpeed - stats.speed) / stats.acceleration);
  if (age <= rampTime) {
    return stats.speed * age + 0.5 * stats.acceleration * age * age;
  }
  const ramp = stats.speed * rampTime + 0.5 * stats.acceleration * rampTime * rampTime;

  return ramp + stats.maxSpeed * (age - rampTime);
}

/**
 * Places p at its age. Position is a pure function of the spawn and the age,
 * so every client can simulate the same projectile from the same spawn.
 */
export function place(p: Projectile): void {
  const stats = WEAPON_STATS[p.weapon];
  const lateral = stats.zigzag.amplitude * triangleWave(p.age * stats.zigzag.frequency);
  const offset = rotateOffset(travelled(stats, p.age), lateral, p.angle);
  p.x = p.originX + offset.x;
  p.y = p.originY + offset.y;
}

/** A fixed-size pool, so firing never allocates. When full, the oldest shot is reused. */
export class ProjectilePool {
  readonly items: Projectile[];
  private next = 0;

  constructor(capacity: number) {
    this.items = Array.from({ length: capacity }, () => ({
      active: false,
      weapon: DEFAULT_LOADOUT.weapon,
      originX: 0,
      originY: 0,
      angle: 0,
      age: 0,
      x: 0,
      y: 0,
    }));
  }

  get activeCount(): number {
    return this.items.reduce((n, p) => n + Number(p.active), 0);
  }

  spawn(shot: ShotSpawn): Projectile {
    let chosen: Projectile | undefined;
    for (let i = 0; i < this.items.length && chosen === undefined; i++) {
      const candidate = this.items[(this.next + i) % this.items.length];
      if (candidate !== undefined && !candidate.active) {
        chosen = candidate;
        this.next = (this.next + i + 1) % this.items.length;
      }
    }
    chosen ??= this.oldest();

    chosen.active = true;
    chosen.weapon = shot.weapon;
    chosen.originX = shot.x;
    chosen.originY = shot.y;
    chosen.angle = shot.angle;
    chosen.age = 0;
    place(chosen);

    return chosen;
  }

  /** Ages every projectile by dt and returns those that expired this tick. */
  step(dt: number, inBounds: (x: number, y: number) => boolean): Projectile[] {
    const expired: Projectile[] = [];
    for (const p of this.items) {
      if (!p.active) {
        continue;
      }
      p.age += dt;
      place(p);
      if (p.age >= WEAPON_STATS[p.weapon].lifetime || !inBounds(p.x, p.y)) {
        p.active = false;
        expired.push(p);
      }
    }

    return expired;
  }

  private oldest(): Projectile {
    let oldest = this.items[0];
    for (const p of this.items) {
      if (oldest === undefined || p.age > oldest.age) {
        oldest = p;
      }
    }
    if (oldest === undefined) {
      throw new Error('ProjectilePool: zero capacity');
    }

    return oldest;
  }
}
