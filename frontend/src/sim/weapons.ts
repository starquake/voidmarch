import type { WeaponId } from './loadout.ts';
import { rotateOffset } from './math.ts';
import type { Ship } from './ship.ts';
import { WEAPON_STATS, type WeaponStats } from './tuning.ts';

/** A projectile to create: where, which way, from which weapon and barrel. */
export interface ShotSpawn {
  weapon: WeaponId;
  muzzle: number;
  x: number;
  y: number;
  angle: number;
}

/** What the weapon did during one tick. */
export interface WeaponStep {
  /** A charging weapon's trigger was pulled; its shot leaves after the charge. */
  chargeStarted: boolean;
  shots: ShotSpawn[];
}

/**
 * Advances the weapon by dt and returns what it did this tick. Holding fire
 * keeps the cadence exact across ticks; a charging weapon fires when its
 * charge completes, even if the trigger was let go.
 */
export function stepWeapon(ship: Ship, fire: boolean, dt: number): WeaponStep {
  const stats = WEAPON_STATS[ship.loadout.weapon];
  const step: WeaponStep = { chargeStarted: false, shots: [] };

  ship.cooldown -= dt;
  if (ship.charging > 0) {
    ship.charging -= dt;
    if (ship.charging <= 0) {
      ship.charging = 0;
      fireVolley(ship, stats, step.shots);
    }

    return step;
  }
  if (!fire) {
    ship.cooldown = Math.max(ship.cooldown, 0);

    return step;
  }

  while (ship.cooldown <= 0) {
    ship.cooldown += stats.interval;
    if (stats.charge > 0) {
      ship.charging = stats.charge;
      step.chargeStarted = true;
      break;
    }
    fireVolley(ship, stats, step.shots);
  }

  return step;
}

/** Fires one muzzle, or all of them, from the ship's current position and aim. */
function fireVolley(ship: Ship, stats: WeaponStats, shots: ShotSpawn[]): void {
  const muzzles = stats.alternate ? [ship.nextMuzzle % stats.muzzles.length] : stats.muzzles.map((_, i) => i);
  ship.nextMuzzle = (ship.nextMuzzle + 1) % stats.muzzles.length;

  for (const index of muzzles) {
    const muzzle = stats.muzzles[index];
    if (muzzle === undefined) {
      continue;
    }
    const offset = rotateOffset(muzzle.forward, muzzle.right, ship.angle);
    shots.push({
      weapon: ship.loadout.weapon,
      muzzle: index,
      x: ship.x + offset.x,
      y: ship.y + offset.y,
      angle: ship.angle,
    });
  }
}
