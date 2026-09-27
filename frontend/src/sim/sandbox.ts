import { relativeTo, toCommand, type ControlMode, type InputSnapshot, type ShipCommand } from './input.ts';
import { ProjectilePool, type Faction, type ProjectileKind } from './projectiles.ts';
import { createShip, stepShip, type Ship } from './ship.ts';
import type { WeaponId } from './loadout.ts';
import { MAX_TICKS_PER_FRAME, TICK_SECONDS } from './tuning.ts';
import { stepWeapon, type ShotSpawn } from './weapons.ts';
import { applyWorldEdge, projectileInBounds } from './world.ts';

const PROJECTILE_CAPACITY = 256;

/** A shot the local ship fired, with its id in the projectile pool. */
export type FiredShot = ShotSpawn & { id: number };

/** What happened during one frame's ticks, for effects and sounds. */
export interface FrameEvents {
  ticks: number;
  /** Weapons whose charge started this frame. */
  charges: WeaponId[];
  shots: FiredShot[];
  expired: { kind: ProjectileKind; faction: Faction; x: number; y: number }[];
}

/** The single-player world: one ship and its projectiles, stepped at a fixed rate. */
export class Sandbox {
  readonly ship: Ship = createShip(0, 160);
  readonly projectiles = new ProjectilePool(PROJECTILE_CAPACITY);
  /** Ship position before the last tick, for smooth drawing between ticks. */
  readonly previous = { x: this.ship.x, y: this.ship.y };
  /** How WASD maps to movement; ship-relative unless the player switched. */
  controlMode: ControlMode = 'ship';
  private accumulator = 0;

  /** How far the display is between the last two ticks, from 0 to 1. */
  get alpha(): number {
    return this.accumulator / TICK_SECONDS;
  }

  /** Runs as many fixed ticks as frameSeconds covers, using the same input for each. */
  advance(frameSeconds: number, input: InputSnapshot): FrameEvents {
    const events: FrameEvents = { ticks: 0, charges: [], shots: [], expired: [] };
    this.accumulator = Math.min(this.accumulator + frameSeconds, TICK_SECONDS * MAX_TICKS_PER_FRAME);

    const cmd = toCommand(input);
    while (this.accumulator >= TICK_SECONDS) {
      this.accumulator -= TICK_SECONDS;
      this.tick(cmd, events);
    }

    return events;
  }

  private tick(screenCmd: ShipCommand, events: FrameEvents): void {
    this.previous.x = this.ship.x;
    this.previous.y = this.ship.y;

    const cmd = this.controlMode === 'ship' ? relativeTo(screenCmd, this.ship.angle) : screenCmd;
    stepShip(this.ship, cmd, TICK_SECONDS);
    applyWorldEdge(this.ship, TICK_SECONDS);

    const weapon = stepWeapon(this.ship, cmd.fire, TICK_SECONDS);
    if (weapon.chargeStarted) {
      events.charges.push(this.ship.loadout.weapon);
    }
    for (const shot of weapon.shots) {
      const p = this.projectiles.spawn({ kind: shot.weapon, x: shot.x, y: shot.y, angle: shot.angle });
      events.shots.push({ ...shot, id: p.shotId });
    }
    for (const p of this.projectiles.step(TICK_SECONDS, projectileInBounds)) {
      events.expired.push({ kind: p.kind, faction: p.faction, x: p.x, y: p.y });
    }
    events.ticks++;
  }
}
