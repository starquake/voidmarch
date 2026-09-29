import { TAU, type Vec } from './sim/math.ts';

/**
 * The companion modes (docs/design.md, section 13): each is a whole set of
 * standing orders, so no two orders can contradict each other.
 */
export const MODES = ['escort', 'attack', 'guard', 'hold', 'stealth'] as const;
export type Mode = (typeof MODES)[number];

/** The one-shots on the ring: each runs until done, then the mode resumes. */
export type OneShotOrder = 'focus' | 'regroup' | 'goHome';

/** One entry of the Q ring: a mode, or a one-shot that ends and returns to the mode. */
export type OrderItem =
  | { kind: 'mode'; mode: Mode; label: string }
  | { kind: 'oneShot'; oneShot: OneShotOrder; label: string };

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

/** The ring's width over its height: 1 is a circle, which 8 items fit without crowding. */
export const RING_ASPECT = 1;

/** Where item index sits on a ring of the given height radius (y down), the first at the top. */
export function itemPosition(index: number, radius: number, count = ORDER_ITEMS.length): Vec {
  const angle = -Math.PI / 2 + (index * TAU) / count;

  return { x: Math.cos(angle) * radius * RING_ASPECT, y: Math.sin(angle) * radius };
}

/**
 * The item the pointer points at from the ring's center, or undefined inside
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
