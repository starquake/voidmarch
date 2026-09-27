import type { ShipCommand } from './input.ts';
import { DEFAULT_LOADOUT, type Loadout } from './loadout.ts';
import { snapAngle } from './math.ts';
import { ENGINE_STATS } from './tuning.ts';

export interface Ship {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Facing in radians; 0 is +x, and y grows downward. */
  angle: number;
  thrusting: boolean;
  loadout: Loadout;
  /** Hits taken: an index into DAMAGE_STATES. */
  damage: number;
  /** Seconds until the weapon may fire again; at most 0 when ready. */
  cooldown: number;
  /** The muzzle an alternating weapon fires next. */
  nextMuzzle: number;
  /** 0 for free rotation, else the number of facing directions. */
  rotationSnap: number;
}

export function createShip(x: number, y: number, loadout: Loadout = DEFAULT_LOADOUT): Ship {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    thrusting: false,
    loadout: { ...loadout },
    damage: 0,
    cooldown: 0,
    nextMuzzle: 0,
    rotationSnap: 0,
  };
}

/** Advances the ship's movement and aim by dt seconds. */
export function stepShip(ship: Ship, cmd: ShipCommand, dt: number): void {
  const engine = ENGINE_STATS[ship.loadout.engine];

  ship.thrusting = cmd.moveX !== 0 || cmd.moveY !== 0;
  ship.vx += cmd.moveX * engine.acceleration * dt;
  ship.vy += cmd.moveY * engine.acceleration * dt;

  const keep = Math.exp(-engine.drag * dt);
  ship.vx *= keep;
  ship.vy *= keep;

  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > engine.maxSpeed) {
    ship.vx *= engine.maxSpeed / speed;
    ship.vy *= engine.maxSpeed / speed;
  }

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;

  const dx = cmd.aimX - ship.x;
  const dy = cmd.aimY - ship.y;
  if (dx !== 0 || dy !== 0) {
    ship.angle = snapAngle(Math.atan2(dy, dx), ship.rotationSnap);
  }
}
