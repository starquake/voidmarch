import { toCommand, type InputSnapshot } from './input.ts';
import { ProjectilePool, type Projectile } from './projectiles.ts';
import { createShip, stepShip, type Ship } from './ship.ts';
import { MAX_TICKS_PER_FRAME, TICK_SECONDS } from './tuning.ts';
import { stepWeapon, type ShotSpawn } from './weapons.ts';
import { applyWorldEdge, projectileInBounds } from './world.ts';

const PROJECTILE_CAPACITY = 256;

/** What happened during one frame's ticks, for effects and sounds. */
export interface FrameEvents {
  ticks: number;
  shots: ShotSpawn[];
  expired: { weapon: Projectile['weapon']; x: number; y: number }[];
}

/** The single-player world: one ship and its projectiles, stepped at a fixed rate. */
export class Sandbox {
  readonly ship: Ship = createShip(0, 160);
  readonly projectiles = new ProjectilePool(PROJECTILE_CAPACITY);
  /** Ship position before the last tick, for smooth drawing between ticks. */
  readonly previous = { x: this.ship.x, y: this.ship.y };
  private accumulator = 0;

  /** How far the display is between the last two ticks, from 0 to 1. */
  get alpha(): number {
    return this.accumulator / TICK_SECONDS;
  }

  /** Runs as many fixed ticks as frameSeconds covers, using the same input for each. */
  advance(frameSeconds: number, input: InputSnapshot): FrameEvents {
    const events: FrameEvents = { ticks: 0, shots: [], expired: [] };
    this.accumulator = Math.min(this.accumulator + frameSeconds, TICK_SECONDS * MAX_TICKS_PER_FRAME);

    const cmd = toCommand(input);
    while (this.accumulator >= TICK_SECONDS) {
      this.accumulator -= TICK_SECONDS;
      this.tick(cmd, events);
    }

    return events;
  }

  private tick(cmd: ReturnType<typeof toCommand>, events: FrameEvents): void {
    this.previous.x = this.ship.x;
    this.previous.y = this.ship.y;

    stepShip(this.ship, cmd, TICK_SECONDS);
    applyWorldEdge(this.ship, TICK_SECONDS);

    for (const shot of stepWeapon(this.ship, cmd.fire, TICK_SECONDS)) {
      this.projectiles.spawn(shot);
      events.shots.push(shot);
    }
    for (const p of this.projectiles.step(TICK_SECONDS, projectileInBounds)) {
      events.expired.push({ weapon: p.weapon, x: p.x, y: p.y });
    }
    events.ticks++;
  }
}
