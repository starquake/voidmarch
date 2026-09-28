import type { FireOrder, OneShot, Orders, ResourceOrder, Stance } from './sim/brain.ts';
import { TAU, type Vec } from './sim/math.ts';

/** One entry of the Q ring: an order and its label (docs/design.md, section 13). */
export type OrderItem =
  | { kind: 'stance'; stance: Stance; label: string }
  | { kind: 'fire'; fire: FireOrder; label: string }
  | { kind: 'resources'; resources: ResourceOrder; label: string }
  | { kind: 'supportFirst'; label: string }
  | { kind: 'oneShot'; oneShot: OneShot['kind']; label: string };

/** The ring, clockwise from the top. Revive and Collect join with milestones 4 and 5. */
export const ORDER_ITEMS: readonly OrderItem[] = [
  { kind: 'stance', stance: 'escort', label: 'Escort' },
  { kind: 'stance', stance: 'aggressive', label: 'Aggressive' },
  { kind: 'stance', stance: 'defensive', label: 'Defensive' },
  { kind: 'stance', stance: 'hold', label: 'Hold here' },
  { kind: 'oneShot', oneShot: 'focus', label: 'Focus target' },
  { kind: 'oneShot', oneShot: 'shieldMe', label: 'Shield me' },
  { kind: 'oneShot', oneShot: 'regroup', label: 'Regroup' },
  { kind: 'oneShot', oneShot: 'goHome', label: 'Go home' },
  { kind: 'fire', fire: 'free', label: 'Weapons free' },
  { kind: 'fire', fire: 'return', label: 'Return fire' },
  { kind: 'fire', fire: 'hold', label: 'Hold fire' },
  { kind: 'resources', resources: 'spend', label: 'Spend' },
  { kind: 'resources', resources: 'conserve', label: 'Conserve' },
  { kind: 'supportFirst', label: 'Support first' },
];

/** The ring is this much wider than tall, so the labels at its top and bottom don't collide. */
export const RING_ASPECT = 1.7;

/** Where item index sits on a ring of the given height radius (y down), the first at the top. */
export function itemPosition(index: number, radius: number, count = ORDER_ITEMS.length): Vec {
  const angle = -Math.PI / 2 + (index * TAU) / count;

  return { x: Math.cos(angle) * radius * RING_ASPECT, y: Math.sin(angle) * radius };
}

/**
 * The item the pointer points at from the ring's centre, or undefined inside
 * the dead zone. It reads the pointer on the ring's own, stretched shape.
 */
export function pickItem(dx: number, dy: number, deadZone: number, count = ORDER_ITEMS.length): number | undefined {
  const x = dx / RING_ASPECT;
  if (Math.hypot(x, dy) < deadZone) {
    return undefined;
  }
  const fromTop = Math.atan2(dy, x) + Math.PI / 2;

  return (((Math.round((fromTop * count) / TAU) % count) + count) % count);
}

/** What an order needs from where the pointer was: a point to hold, an enemy to focus. */
export interface OrderContext {
  pointX: number;
  pointY: number;
  focusEnemyId: number | undefined;
}

/**
 * The orders after giving item, or undefined when it can't be given (focus
 * with no enemy under the cursor). A new stance ends a one-shot in progress.
 */
export function applyOrder(item: OrderItem, orders: Orders, context: OrderContext): Orders | undefined {
  switch (item.kind) {
    case 'stance':
      return item.stance === 'hold'
        ? { ...orders, stance: 'hold', holdX: context.pointX, holdY: context.pointY, oneShot: undefined }
        : { ...orders, stance: item.stance, oneShot: undefined };
    case 'fire':
      return { ...orders, fire: item.fire };
    case 'resources':
      return { ...orders, resources: item.resources };
    case 'supportFirst':
      return { ...orders, supportFirst: !orders.supportFirst };
    case 'oneShot':
      if (item.oneShot === 'focus') {
        return context.focusEnemyId === undefined
          ? undefined
          : { ...orders, oneShot: { kind: 'focus', enemyId: context.focusEnemyId } };
      }

      return { ...orders, oneShot: { kind: item.oneShot } };
  }
}

const STANCE_LABELS: Readonly<Record<Stance, string>> = {
  escort: 'escort',
  aggressive: 'aggressive',
  defensive: 'defensive',
  hold: 'holding',
};
const FIRE_LABELS: Readonly<Record<FireOrder, string>> = {
  free: 'weapons free',
  return: 'return fire',
  hold: 'hold fire',
};
const ONE_SHOT_LABELS: Readonly<Record<OneShot['kind'], string>> = {
  focus: 'focusing',
  regroup: 'regrouping',
  goHome: 'going home',
  shieldMe: 'shielding you',
};

/** Orders in a few words for the HUD. */
export function describeOrders(orders: Orders): string {
  const parts = [STANCE_LABELS[orders.stance], FIRE_LABELS[orders.fire], orders.resources];
  if (orders.supportFirst) {
    parts.push('support first');
  }
  if (orders.oneShot !== undefined) {
    parts.push(ONE_SHOT_LABELS[orders.oneShot.kind]);
  }

  return parts.join(' · ');
}

/** An enemy under the cursor, in art pixels: pointing right at it picks it. */
export const FOCUS_PICK_RADIUS = 30;
/** With nothing under the cursor, the nearest enemy this close to it. */
export const FOCUS_WIDE_RADIUS = 120;
/** The enemy the player last hit counts as their target this long after, in ms. */
export const FOCUS_LAST_HIT_MS = 3000;

/** Something at a point with an id: an enemy or a companion. */
export interface Placed<Id> {
  id: Id;
  x: number;
  y: number;
}

/** The item nearest (x, y), if any is within radius. */
export function nearestWithin<T extends { x: number; y: number }>(
  items: readonly T[],
  x: number,
  y: number,
  radius: number,
): T | undefined {
  let best: T | undefined;
  let bestDistance = radius;
  for (const item of items) {
    const d = Math.hypot(item.x - x, item.y - y);
    if (d <= bestDistance) {
      best = item;
      bestDistance = d;
    }
  }

  return best;
}

/**
 * The enemy a focus order means. Small ships move too fast to point at, so
 * after the enemy under the cursor comes the one the player last hit, "what
 * I'm shooting at", then the nearest to the cursor within a wider reach.
 */
export function chooseFocus(
  enemies: readonly Placed<number>[],
  x: number,
  y: number,
  lastHit: { id: number; atMs: number } | undefined,
  nowMs: number,
): number | undefined {
  const under = nearestWithin(enemies, x, y, FOCUS_PICK_RADIUS);
  if (under !== undefined) {
    return under.id;
  }
  if (lastHit !== undefined && nowMs - lastHit.atMs <= FOCUS_LAST_HIT_MS && enemies.some((e) => e.id === lastHit.id)) {
    return lastHit.id;
  }

  return nearestWithin(enemies, x, y, FOCUS_WIDE_RADIUS)?.id;
}
