import { DEFAULT_ORDERS, type OneShot, type Orders } from './sim/brain.ts';
import { TAU, type Vec } from './sim/math.ts';

/**
 * The companion modes (docs/design.md, section 13): each is a whole set of
 * standing orders, so no two orders can contradict each other.
 */
export const MODES = ['escort', 'attack', 'guard', 'hold', 'stealth'] as const;
export type Mode = (typeof MODES)[number];

/** One entry of the Q ring: a mode, or a one-shot that ends and returns to the mode. */
export type OrderItem =
  | { kind: 'mode'; mode: Mode; label: string }
  | { kind: 'oneShot'; oneShot: Exclude<OneShot['kind'], 'shieldMe'>; label: string };

/** The ring, clockwise from the top. */
export const ORDER_ITEMS: readonly OrderItem[] = [
  { kind: 'mode', mode: 'escort', label: 'Escort' },
  { kind: 'mode', mode: 'attack', label: 'Attack' },
  { kind: 'mode', mode: 'guard', label: 'Guard' },
  { kind: 'mode', mode: 'hold', label: 'Hold here' },
  { kind: 'mode', mode: 'stealth', label: 'Stealth' },
  { kind: 'oneShot', oneShot: 'focus', label: 'Focus' },
  { kind: 'oneShot', oneShot: 'regroup', label: 'Regroup' },
  { kind: 'oneShot', oneShot: 'goHome', label: 'Go home' },
];

/** The standing orders each mode stands for, as the brain reads them. */
const MODE_ORDERS: Readonly<Record<Mode, Omit<Orders, 'holdX' | 'holdY' | 'oneShot'>>> = {
  // Formation on the owner, shooting anything near.
  escort: { stance: 'escort', fire: 'free', resources: 'spend', supportFirst: false },
  // Hunt around the owner, big shots at will, Support Ships first.
  attack: { stance: 'aggressive', fire: 'free', resources: 'spend', supportFirst: true },
  // Tight, between the owner and the fire, answering attackers only, falling back when hurt.
  guard: { stance: 'defensive', fire: 'return', resources: 'conserve', supportFirst: false },
  // Stay at a point and shoot what comes in range.
  hold: { stance: 'hold', fire: 'free', resources: 'spend', supportFirst: false },
  // Follow and never fire: sneak past, don't wake a boss.
  stealth: { stance: 'escort', fire: 'hold', resources: 'conserve', supportFirst: false },
};

/** The mode a set of orders came from; every order the ring gives is a mode's. */
export function modeOf(orders: Orders): Mode {
  switch (orders.stance) {
    case 'aggressive':
      return 'attack';
    case 'defensive':
      return 'guard';
    case 'hold':
      return 'hold';
    case 'escort':
      return orders.fire === 'hold' ? 'stealth' : 'escort';
  }
}

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
 * with no enemy to focus). A mode replaces every standing order and ends a
 * one-shot in progress; a one-shot keeps the mode.
 */
export function applyOrder(item: OrderItem, orders: Orders, context: OrderContext): Orders | undefined {
  if (item.kind === 'mode') {
    return {
      ...DEFAULT_ORDERS,
      ...MODE_ORDERS[item.mode],
      holdX: item.mode === 'hold' ? context.pointX : orders.holdX,
      holdY: item.mode === 'hold' ? context.pointY : orders.holdY,
      oneShot: undefined,
    };
  }
  if (item.oneShot === 'focus') {
    return context.focusEnemyId === undefined
      ? undefined
      : { ...orders, oneShot: { kind: 'focus', enemyId: context.focusEnemyId } };
  }

  return { ...orders, oneShot: { kind: item.oneShot } };
}

const MODE_LABELS: Readonly<Record<Mode, string>> = {
  escort: 'Escort',
  attack: 'Attack',
  guard: 'Guard',
  hold: 'Holding',
  stealth: 'Stealth',
};
const ONE_SHOT_LABELS: Readonly<Record<OneShot['kind'], string>> = {
  focus: 'focusing',
  regroup: 'regrouping',
  goHome: 'going home',
  shieldMe: 'shielding you',
};

/** Orders in a word or two for the HUD: the mode, and a one-shot under way. */
export function describeOrders(orders: Orders): string {
  const mode = MODE_LABELS[modeOf(orders)];

  return orders.oneShot === undefined ? mode : `${mode} · ${ONE_SHOT_LABELS[orders.oneShot.kind]}`;
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
