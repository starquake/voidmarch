import { DEFAULT_ORDERS, think, type BrainEnemy, type Orders } from './brain.ts';
import { relativeTo, toCommand, type ControlMode, type InputSnapshot, type ShipCommand } from './input.ts';
import { seededRandom } from './math.ts';
import { ProjectilePool, type Faction, type ProjectileKind } from './projectiles.ts';
import { createShip, stepShip, type Ship } from './ship.ts';
import type { WeaponId } from './loadout.ts';
import { MAX_TICKS_PER_FRAME, TICK_SECONDS } from './tuning.ts';
import { stepWeapon, type ShotSpawn } from './weapons.ts';
import { applyWorldEdge, projectileInBounds } from './world.ts';

const PROJECTILE_CAPACITY = 256;

/** A shot the local ship or one of its companions fired, with its id in the projectile pool. */
export type FiredShot = ShotSpawn & {
  id: number;
  /** 0 for the player's own ship, n for companion n. */
  companion: number;
};

/** A wingmate this client flies with a brain (docs/design.md, section 13). */
export interface Companion {
  /** Its number from the server; its seat is "<playerId>/<number>". */
  readonly number: number;
  readonly ship: Ship;
  /** Position before the last tick, for smooth drawing between ticks. */
  readonly previous: { x: number; y: number };
  orders: Orders;
  readonly random: () => number;
}

/** Seeds each companion's brain from its number, so a replay flies the same. */
const COMPANION_SEED = 0x5eed;

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
  /** In formation-slot order. */
  readonly companions: Companion[] = [];
  private accumulator = 0;

  /** How far the display is between the last two ticks, from 0 to 1. */
  get alpha(): number {
    return this.accumulator / TICK_SECONDS;
  }

  /** Adds a companion the server granted, at (x, y), with the default parts until unlocks exist. */
  addCompanion(number: number, x: number, y: number): Companion {
    this.removeCompanion(number);
    const companion: Companion = {
      number,
      ship: createShip(x, y),
      previous: { x, y },
      orders: { ...DEFAULT_ORDERS },
      random: seededRandom(COMPANION_SEED + number),
    };
    this.companions.push(companion);

    return companion;
  }

  /** Removes a companion, and its shots still in flight, which could no longer be reported. */
  removeCompanion(number: number): void {
    const i = this.companions.findIndex((c) => c.number === number);
    if (i >= 0) {
      this.companions.splice(i, 1);
    }
    for (const p of this.projectiles.items) {
      if (p.faction === 'own' && p.owner === String(number)) {
        p.active = false;
      }
    }
  }

  /**
   * Runs as many fixed ticks as frameSeconds covers, using the same input for
   * each. Companions decide from the enemies as drawn.
   */
  advance(frameSeconds: number, input: InputSnapshot, enemies: readonly BrainEnemy[] = []): FrameEvents {
    const events: FrameEvents = { ticks: 0, charges: [], shots: [], expired: [] };
    this.accumulator = Math.min(this.accumulator + frameSeconds, TICK_SECONDS * MAX_TICKS_PER_FRAME);

    const cmd = toCommand(input);
    while (this.accumulator >= TICK_SECONDS) {
      this.accumulator -= TICK_SECONDS;
      this.tick(cmd, enemies, events);
    }

    return events;
  }

  private tick(screenCmd: ShipCommand, enemies: readonly BrainEnemy[], events: FrameEvents): void {
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
      events.shots.push({ ...shot, id: p.shotId, companion: 0 });
    }
    this.companions.forEach((companion, slot) => {
      this.tickCompanion(companion, slot, enemies, events);
    });
    for (const p of this.projectiles.step(TICK_SECONDS, projectileInBounds)) {
      events.expired.push({ kind: p.kind, faction: p.faction, x: p.x, y: p.y });
    }
    events.ticks++;
  }

  private tickCompanion(companion: Companion, slot: number, enemies: readonly BrainEnemy[], events: FrameEvents): void {
    const { ship, previous } = companion;
    previous.x = ship.x;
    previous.y = ship.y;
    const step = think({ self: ship, owner: this.ship, slot, enemies }, companion.orders, companion.random);
    if (step.done) {
      companion.orders = { ...companion.orders, oneShot: undefined };
    }
    stepShip(ship, step.command, TICK_SECONDS);
    applyWorldEdge(ship, TICK_SECONDS);
    for (const shot of stepWeapon(ship, step.command.fire, TICK_SECONDS).shots) {
      const p = this.projectiles.spawn(
        { kind: shot.weapon, x: shot.x, y: shot.y, angle: shot.angle },
        { owner: String(companion.number) },
      );
      events.shots.push({ ...shot, id: p.shotId, companion: companion.number });
    }
  }
}
