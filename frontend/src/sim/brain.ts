import { ENEMY_HP, SUPPORT_KINDS, type EnemyKind } from './enemies.ts';
import type { ShipCommand } from './input.ts';
import { rotateOffset, wrapAngle, type Vec } from './math.ts';
import { travelled } from './projectiles.ts';
import type { Ship } from './ship.ts';
import {
  BRAIN_AIM_JITTER,
  BRAIN_ARRIVE_SECONDS,
  BRAIN_ATTACK_DISTANCE,
  BRAIN_BADLY_DAMAGED,
  BRAIN_ESCORT_RANGE,
  BRAIN_FIRE_CONE,
  BRAIN_HOME_RADIUS,
  BRAIN_IN_FORMATION,
  BRAIN_LEASH,
  BRAIN_LOOK_AHEAD,
  BRAIN_SHIELD_DISTANCE,
  BRAIN_TIGHT_FORMATION,
  ENGINE_STATS,
  FORMATION_SLOTS,
  TICK_SECONDS,
  WEAPON_STATS,
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

/**
 * Where a formation slot is now, scaled toward the owner by scale. Slots past
 * the first few (more companions than slots) repeat the pattern on
 * wider rings, so no two companions share a point.
 */
export function formationPoint(owner: Mover, slot: number, scale = 1): Vec {
  const offset = FORMATION_SLOTS[slot % FORMATION_SLOTS.length] ?? { forward: 0, right: 0 };
  const ring = 1 + Math.floor(slot / FORMATION_SLOTS.length);
  const world = rotateOffset(offset.forward * scale * ring, offset.right * scale * ring, owner.angle);

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

interface Goal {
  point: Vec;
  velocity: Vec;
}

const STILL: Vec = { x: 0, y: 0 };

const distance = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

/** How far the ship's weapon reaches before its shots expire. */
function weaponRange(self: Ship): number {
  const stats = WEAPON_STATS[self.loadout.weapon];

  return travelled(stats, stats.lifetime);
}

/** Where the stance puts a companion, and how fast that point moves. */
function stanceGoal(view: BrainView, orders: Orders): Goal {
  const { owner } = view;
  const moving = { x: owner.vx, y: owner.vy };
  switch (orders.stance) {
    case 'hold':
      return { point: { x: orders.holdX, y: orders.holdY }, velocity: STILL };
    case 'defensive':
      return { point: formationPoint(owner, view.slot, BRAIN_TIGHT_FORMATION), velocity: moving };
    case 'escort':
    case 'aggressive':
      return { point: formationPoint(owner, view.slot), velocity: moving };
  }
}

/** The enemies the standing orders allow this companion to shoot. */
function candidates(view: BrainView, orders: Orders): BrainEnemy[] {
  const { self, owner, enemies } = view;
  const attackersOnly = orders.fire === 'return' || orders.stance === 'defensive';
  const inReach = (e: BrainEnemy): boolean => {
    switch (orders.stance) {
      case 'aggressive':
        return distance(e, owner) <= BRAIN_LEASH;
      case 'hold':
        return distance(e, self) <= weaponRange(self);
      case 'escort':
      case 'defensive':
        return distance(e, owner) <= BRAIN_ESCORT_RANGE;
    }
  };

  return enemies.filter((e) => inReach(e) && (!attackersOnly || e.attackedWing));
}

/**
 * The enemy to shoot, if any. A focus order names it; hold fire means none;
 * otherwise Support Ships come first when ordered, the weakest first when
 * aggressive, and then the nearest.
 */
function chooseTarget(view: BrainView, orders: Orders): BrainEnemy | undefined {
  const focus = orders.oneShot;
  if (focus?.kind === 'focus') {
    return view.enemies.find((e) => e.id === focus.enemyId);
  }
  if (orders.fire === 'hold') {
    return undefined;
  }
  const { self } = view;
  const rank = (e: BrainEnemy): number[] => [
    orders.supportFirst && SUPPORT_KINDS.includes(e.kind) ? 0 : 1,
    orders.stance === 'aggressive' ? ENEMY_HP[e.kind] : 0,
    distance(e, self),
  ];
  const before = (a: number[], b: number[]): boolean => {
    const i = a.findIndex((value, k) => value !== b[k]);

    return i >= 0 && (a[i] ?? 0) < (b[i] ?? 0);
  };

  return candidates(view, orders).reduce<BrainEnemy | undefined>(
    (best, e) => (best === undefined || before(rank(e), rank(best)) ? e : best),
    undefined,
  );
}

/** A point at attack distance from the target, on the companion's side of it. */
function attackGoal(self: Ship, target: BrainEnemy): Goal {
  const away = Math.atan2(self.y - target.y, self.x - target.x);

  return {
    point: {
      x: target.x + BRAIN_ATTACK_DISTANCE * Math.cos(away),
      y: target.y + BRAIN_ATTACK_DISTANCE * Math.sin(away),
    },
    velocity: STILL,
  };
}

/** Attackers near the owner: the fire a shielding companion blocks. */
function attackersNearOwner(view: BrainView): BrainEnemy[] {
  return view.enemies.filter((e) => e.attackedWing && distance(e, view.owner) <= BRAIN_ESCORT_RANGE);
}

/** Between the owner and the attackers' average position, moving with the owner. */
function shieldGoal(view: BrainView, attackers: readonly BrainEnemy[]): Goal {
  const { owner } = view;
  const cx = attackers.reduce((sum, e) => sum + e.x, 0) / attackers.length;
  const cy = attackers.reduce((sum, e) => sum + e.y, 0) / attackers.length;
  const toward = Math.atan2(cy - owner.y, cx - owner.x);

  return {
    point: {
      x: owner.x + BRAIN_SHIELD_DISTANCE * Math.cos(toward),
      y: owner.y + BRAIN_SHIELD_DISTANCE * Math.sin(toward),
    },
    velocity: { x: owner.vx, y: owner.vy },
  };
}

/** Where to fly this tick: the one-shot's goal first, then falling back, hunting, or the stance. */
function chooseGoal(view: BrainView, orders: Orders, target: BrainEnemy | undefined): Goal {
  const { self, owner } = view;
  const oneShot = orders.oneShot;
  switch (oneShot?.kind) {
    case 'regroup':
      return { point: formationPoint(owner, view.slot), velocity: { x: owner.vx, y: owner.vy } };
    case 'goHome':
      return { point: { x: 0, y: 0 }, velocity: STILL };
    case 'shieldMe': {
      const attackers = attackersNearOwner(view);
      if (attackers.length > 0) {
        return shieldGoal(view, attackers);
      }
      break;
    }
    case 'focus':
      if (target !== undefined) {
        return attackGoal(self, target);
      }
      break;
    case undefined:
      break;
  }
  const fallingBack =
    self.damage >= BRAIN_BADLY_DAMAGED && (orders.stance === 'defensive' || orders.resources === 'conserve');
  if (fallingBack) {
    return { point: formationPoint(owner, view.slot, BRAIN_TIGHT_FORMATION), velocity: { x: owner.vx, y: owner.vy } };
  }
  if (target !== undefined && orders.stance === 'aggressive') {
    return attackGoal(self, target);
  }

  return stanceGoal(view, orders);
}

/** Whether the one-shot order is finished. */
function oneShotDone(view: BrainView, orders: Orders, target: BrainEnemy | undefined): boolean {
  switch (orders.oneShot?.kind) {
    case 'focus':
      return target === undefined;
    case 'regroup':
      return distance(view.self, formationPoint(view.owner, view.slot)) <= BRAIN_IN_FORMATION;
    case 'goHome':
      return Math.hypot(view.self.x, view.self.y) <= BRAIN_HOME_RADIUS;
    case 'shieldMe':
      return attackersNearOwner(view).length === 0;
    case undefined:
      return false;
  }
}

/** Conserving, the big space gun saves its volleys for Support Ships and focus targets. */
function holdsVolley(self: Ship, orders: Orders, target: BrainEnemy): boolean {
  return (
    orders.resources === 'conserve' &&
    self.loadout.weapon === 'bigSpaceGun' &&
    orders.oneShot?.kind !== 'focus' &&
    !SUPPORT_KINDS.includes(target.kind)
  );
}

/** Decides what a companion does this tick; random wobbles its aim. */
export function think(view: BrainView, orders: Orders, random: () => number): BrainStep {
  const { self, owner } = view;
  // Regrouping disengages: no targets until back in formation.
  const target = orders.oneShot?.kind === 'regroup' ? undefined : chooseTarget(view, orders);
  const goal = chooseGoal(view, orders, target);
  const move = arrive(self, goal.point, goal.velocity);

  let aim: Vec;
  let fire = false;
  if (target === undefined) {
    const look = rotateOffset(BRAIN_LOOK_AHEAD, 0, owner.angle);
    aim = { x: self.x + look.x, y: self.y + look.y };
  } else {
    const toTarget = Math.atan2(target.y - self.y, target.x - self.x);
    const wobble = (random() * 2 - 1) * BRAIN_AIM_JITTER;
    const reach = distance(self, target);
    aim = { x: self.x + reach * Math.cos(toTarget + wobble), y: self.y + reach * Math.sin(toTarget + wobble) };
    fire =
      reach <= weaponRange(self) &&
      Math.abs(wrapAngle(self.angle - toTarget)) <= BRAIN_FIRE_CONE &&
      !holdsVolley(self, orders, target);
  }

  return {
    command: { moveX: move.x, moveY: move.y, aimX: aim.x, aimY: aim.y, fire },
    done: oneShotDone(view, orders, target),
  };
}
