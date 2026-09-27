import type { WeaponId } from './loadout.ts';
import { rotateOffset } from './math.ts';
import type { Ship } from './ship.ts';
import { WEAPON_STATS } from './tuning.ts';

/** A projectile to create: where, which way, and from which weapon. */
export interface ShotSpawn {
  weapon: WeaponId;
  x: number;
  y: number;
  angle: number;
}

/**
 * Advances the weapon cooldown by dt and returns the shots fired this tick.
 * Holding fire keeps the cadence exact across ticks.
 */
export function stepWeapon(ship: Ship, fire: boolean, dt: number): ShotSpawn[] {
  const stats = WEAPON_STATS[ship.loadout.weapon];
  const shots: ShotSpawn[] = [];

  ship.cooldown -= dt;
  if (!fire) {
    ship.cooldown = Math.max(ship.cooldown, 0);

    return shots;
  }

  while (ship.cooldown <= 0) {
    ship.cooldown += stats.interval;

    const muzzles = stats.alternate ? [stats.muzzles[ship.nextMuzzle % stats.muzzles.length]] : stats.muzzles;
    ship.nextMuzzle = (ship.nextMuzzle + 1) % stats.muzzles.length;

    for (const muzzle of muzzles) {
      if (muzzle === undefined) {
        continue;
      }
      const offset = rotateOffset(muzzle.forward, muzzle.right, ship.angle);
      shots.push({ weapon: ship.loadout.weapon, x: ship.x + offset.x, y: ship.y + offset.y, angle: ship.angle });
    }
  }

  return shots;
}
