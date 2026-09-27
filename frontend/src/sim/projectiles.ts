import type { EnemyBulletId } from './enemies.ts';
import { WEAPONS, type WeaponId } from './loadout.ts';
import { rotateOffset, triangleWave } from './math.ts';
import { ENEMY_BULLET_STATS, WEAPON_STATS, type ProjectileStats } from './tuning.ts';

/** What a projectile is: a player weapon's shot or an enemy's bullet. */
export type ProjectileKind = WeaponId | EnemyBulletId;

/** Whose it is: this player's, another player's, or an enemy's. */
export type Faction = 'own' | 'remote' | 'enemy';

export function isWeapon(kind: ProjectileKind): kind is WeaponId {
  return (WEAPONS as readonly string[]).includes(kind);
}

export function projectileStats(kind: ProjectileKind): ProjectileStats {
  return isWeapon(kind) ? WEAPON_STATS[kind] : ENEMY_BULLET_STATS[kind];
}

/** Where a projectile starts, which way, and what it is. */
export interface ProjectileSpawn {
  kind: ProjectileKind;
  x: number;
  y: number;
  angle: number;
}

export interface SpawnOptions {
  /** Already this old: a shot seen late on the delayed timeline. */
  ageSeconds?: number;
  faction?: Faction;
  /** The remote player or enemy it belongs to; empty for own shots. */
  owner?: string;
  /** The shot's id for its owner; own shots get the next one. */
  shotId?: number;
}

export interface Projectile {
  active: boolean;
  kind: ProjectileKind;
  faction: Faction;
  owner: string;
  shotId: number;
  originX: number;
  originY: number;
  angle: number;
  age: number;
  x: number;
  y: number;
}

/** Distance travelled after age seconds, accelerating up to maxSpeed. */
export function travelled(stats: ProjectileStats, age: number): number {
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
  const stats = projectileStats(p.kind);
  const lateral = stats.zigzag.amplitude * triangleWave(p.age * stats.zigzag.frequency);
  const offset = rotateOffset(travelled(stats, p.age), lateral, p.angle);
  p.x = p.originX + offset.x;
  p.y = p.originY + offset.y;
}

/** A fixed-size pool, so firing never allocates. When full, the oldest shot is reused. */
export class ProjectilePool {
  readonly items: Projectile[];
  private next = 0;
  private lastShotId = 0;

  constructor(capacity: number) {
    this.items = Array.from({ length: capacity }, () => ({
      active: false,
      kind: WEAPONS[0],
      faction: 'own' satisfies Faction,
      owner: '',
      shotId: 0,
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

  spawn(shot: ProjectileSpawn, options: SpawnOptions = {}): Projectile {
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
    chosen.kind = shot.kind;
    chosen.faction = options.faction ?? 'own';
    chosen.owner = options.owner ?? '';
    chosen.shotId = options.shotId ?? ++this.lastShotId;
    chosen.originX = shot.x;
    chosen.originY = shot.y;
    chosen.angle = shot.angle;
    chosen.age = options.ageSeconds ?? 0;
    place(chosen);

    return chosen;
  }

  /** Ends a remote player's shot that hit something, and returns it. */
  end(owner: string, shotId: number): Projectile | undefined {
    const p = this.items.find((q) => q.active && q.faction === 'remote' && q.owner === owner && q.shotId === shotId);
    if (p !== undefined) {
      p.active = false;
    }

    return p;
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
      if (p.age >= projectileStats(p.kind).lifetime || !inBounds(p.x, p.y)) {
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
