import type { EnemyKind } from './enemies.ts';
import type { ShipCommand } from './input.ts';
import { rotateOffset, type Vec } from './math.ts';
import type { Ship } from './ship.ts';
import {
  BRAIN_ARRIVE_SECONDS,
  BRAIN_LOOK_AHEAD,
  BRAIN_TIGHT_FORMATION,
  ENGINE_STATS,
  FORMATION_SLOTS,
  TICK_SECONDS,
} from './tuning.ts';

/** How a companion positions itself (docs/design.md, section 13). */
export const STANCES = ['escort', 'aggressive', 'defensive', 'hold'] as const;
export type Stance = (typeof STANCES)[number];

/** When a companion may shoot. */
export const FIRE_ORDERS = ['free', 'return', 'hold'] as const;
export type FireOrder = (typeof FIRE_ORDERS)[number];

/** Whether a companion spends its big shots and its hull freely, or saves them. */
export const RESOURCE_ORDERS = ['spend', 'conserve'] as const;
export type ResourceOrder = (typeof RESOURCE_ORDERS)[number];

/** An order that runs until it is done, then gives way to the standing orders. */
export type OneShot =
  | { kind: 'focus'; enemyId: number }
  | { kind: 'regroup' }
  | { kind: 'goHome' }
  | { kind: 'shieldMe' };

/** A companion's standing orders, plus the one-shot it is carrying out, if any. */
export interface Orders {
  stance: Stance;
  fire: FireOrder;
  resources: ResourceOrder;
  /** Go for Support Ships before anything else. */
  supportFirst: boolean;
  /** Where the hold stance holds. */
  holdX: number;
  holdY: number;
  oneShot: OneShot | undefined;
}

export const DEFAULT_ORDERS: Readonly<Orders> = {
  stance: 'escort',
  fire: 'free',
  resources: 'spend',
  supportFirst: false,
  holdX: 0,
  holdY: 0,
  oneShot: undefined,
};

/** A ship as another ship sees it. */
export interface Mover {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
}

/** An enemy as the owner's client draws it. */
export interface BrainEnemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  /** It has fired at this wing. */
  attackedWing: boolean;
}

/** Everything a companion knows when it decides. */
export interface BrainView {
  self: Ship;
  owner: Mover;
  /** Its place in the formation, an index into FORMATION_SLOTS. */
  slot: number;
  enemies: readonly BrainEnemy[];
}

/** One decision: the command for this tick, and whether the one-shot order is finished. */
export interface BrainStep {
  command: ShipCommand;
  done: boolean;
}

/** Where a formation slot is now, scaled toward the owner by scale. */
export function formationPoint(owner: Mover, slot: number, scale = 1): Vec {
  const offset = FORMATION_SLOTS[slot % FORMATION_SLOTS.length] ?? { forward: 0, right: 0 };
  const world = rotateOffset(offset.forward * scale, offset.right * scale, owner.angle);

  return { x: owner.x + world.x, y: owner.y + world.y };
}

/**
 * The thrust direction that brings self to goal, arriving with the goal's own
 * velocity: it steers the velocity toward the one that closes the gap in
 * BRAIN_ARRIVE_SECONDS, so it slows down as it gets there. It thrusts only
 * when a tick of thrust gets closer to that velocity than coasting under
 * drag, so it neither jitters at rest nor falls behind at full speed.
 */
export function arrive(self: Ship, goal: Vec, goalVelocity: Vec = { x: 0, y: 0 }): Vec {
  const engine = ENGINE_STATS[self.loadout.engine];
  const maxSpeed = engine.maxSpeed;
  let wantX = goalVelocity.x + (goal.x - self.x) / BRAIN_ARRIVE_SECONDS;
  let wantY = goalVelocity.y + (goal.y - self.y) / BRAIN_ARRIVE_SECONDS;
  const wantSpeed = Math.hypot(wantX, wantY);
  if (wantSpeed > maxSpeed) {
    wantX *= maxSpeed / wantSpeed;
    wantY *= maxSpeed / wantSpeed;
  }
  const coast = Math.exp(-engine.drag * TICK_SECONDS);
  const errorX = wantX - self.vx * coast;
  const errorY = wantY - self.vy * coast;
  const error = Math.hypot(errorX, errorY);
  if (error <= (engine.acceleration * TICK_SECONDS) / 2) {
    return { x: 0, y: 0 };
  }

  return { x: errorX / error, y: errorY / error };
}

/** Where the stance puts a companion, and how fast that point moves. */
function stanceGoal(view: BrainView, orders: Orders): { point: Vec; velocity: Vec } {
  const { owner } = view;
  const moving = { x: owner.vx, y: owner.vy };
  switch (orders.stance) {
    case 'hold':
      return { point: { x: orders.holdX, y: orders.holdY }, velocity: { x: 0, y: 0 } };
    case 'defensive':
      return { point: formationPoint(owner, view.slot, BRAIN_TIGHT_FORMATION), velocity: moving };
    case 'escort':
    case 'aggressive':
      return { point: formationPoint(owner, view.slot), velocity: moving };
  }
}

/** Decides what a companion does this tick. */
export function think(view: BrainView, orders: Orders): BrainStep {
  const { self, owner } = view;
  const goal = stanceGoal(view, orders);
  const move = arrive(self, goal.point, goal.velocity);
  const look = rotateOffset(BRAIN_LOOK_AHEAD, 0, owner.angle);

  return {
    command: { moveX: move.x, moveY: move.y, aimX: self.x + look.x, aimY: self.y + look.y, fire: false },
    done: false,
  };
}
