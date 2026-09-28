import { DEFAULT_ORDERS, think, type BrainEnemy, type Mover, type Orders } from './brain.ts';
import { relativeTo, toCommand, type ControlMode, type InputSnapshot, type ShipCommand } from './input.ts';
import { seededRandom } from './math.ts';
import { ProjectilePool, type Faction, type ProjectileKind } from './projectiles.ts';
import { createShip, stepShip, type Ship } from './ship.ts';
import type { WeaponId } from './loadout.ts';
import {
  BRAIN_ORDER_JITTER,
  BRAIN_REACTION_MAX,
  BRAIN_REACTION_MIN,
  MAX_TICKS_PER_FRAME,
  TICK_SECONDS,
} from './tuning.ts';
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
  /** An order on its way: it takes effect after the ticks left. */
  pending: { orders: Orders; ticksLeft: number } | undefined;
  /** How many ticks late it reacts, from its seed. */
  readonly reactionTicks: number;
  readonly random: () => number;
}

/** The owner's recent poses, newest last, long enough for the slowest reaction. */
const OWNER_TRAIL_TICKS = Math.ceil(BRAIN_REACTION_MAX / TICK_SECONDS) + 1;

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
  private readonly ownerTrail: Mover[] = [];
  private accumulator = 0;

  /** How far the display is between the last two ticks, from 0 to 1. */
  get alpha(): number {
    return this.accumulator / TICK_SECONDS;
  }

  /**
   * Adds a companion the server granted, at (x, y), with the default parts
   * until unlocks exist. It joins the wing's standing orders: the wing
   * follows one set.
   */
  addCompanion(number: number, x: number, y: number): Companion {
    this.removeCompanion(number);
    const wing = this.companions[0];
    const orders: Orders = wing === undefined ? { ...DEFAULT_ORDERS } : { ...this.ordersFor(wing), oneShot: undefined };
    const random = seededRandom(COMPANION_SEED + number);
    const reaction = BRAIN_REACTION_MIN + random() * (BRAIN_REACTION_MAX - BRAIN_REACTION_MIN);
    const companion: Companion = {
      number,
      ship: createShip(x, y),
      previous: { x, y },
      orders,
      pending: undefined,
      reactionTicks: Math.round(reaction / TICK_SECONDS),
      random,
    };
    this.companions.push(companion);

    return companion;
  }

  /** The orders a companion will follow: an order on its way, else its current ones. */
  ordersFor(companion: Companion): Orders {
    return companion.pending?.orders ?? companion.orders;
  }

  /**
   * Gives a companion new orders. They arrive after its reaction time plus a
   * fresh jitter, so a wing doesn't react as one.
   */
  order(companion: Companion, orders: Orders): void {
    const delay = companion.reactionTicks + Math.round((companion.random() * BRAIN_ORDER_JITTER) / TICK_SECONDS);
    companion.pending = { orders, ticksLeft: delay };
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
    this.ownerTrail.push({ x: this.ship.x, y: this.ship.y, vx: this.ship.vx, vy: this.ship.vy, angle: this.ship.angle });
    if (this.ownerTrail.length > OWNER_TRAIL_TICKS) {
      this.ownerTrail.shift();
    }
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
    if (companion.pending !== undefined && --companion.pending.ticksLeft <= 0) {
      companion.orders = companion.pending.orders;
      companion.pending = undefined;
    }
    // It sees its owner as they were its reaction time ago.
    const seen = this.ownerTrail[Math.max(0, this.ownerTrail.length - 1 - companion.reactionTicks)] ?? this.ship;
    const step = think({ self: ship, owner: seen, slot, enemies }, companion.orders, companion.random);
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
