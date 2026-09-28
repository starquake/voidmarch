import { SHOT_RADIUS } from './tuning.ts';

/** Something a projectile can hit: a circle in world space. */
export interface Target<Id> {
  id: Id;
  x: number;
  y: number;
  radius: number;
}

/** The first target a projectile at (x, y) touches, or undefined. */
export function hitTarget<Id>(x: number, y: number, targets: readonly Target<Id>[]): Target<Id> | undefined {
  return hitTargetAlong(x, y, x, y, targets);
}

/**
 * The first target a projectile touches on its way from (x0, y0) to (x1, y1),
 * so a fast shot can't skip past a small target between two checks.
 */
export function hitTargetAlong<Id>(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  targets: readonly Target<Id>[],
): Target<Id> | undefined {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  let first: Target<Id> | undefined;
  let firstAlong = Infinity;
  for (const t of targets) {
    const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((t.x - x0) * dx + (t.y - y0) * dy) / lengthSquared));
    if (Math.hypot(t.x - (x0 + along * dx), t.y - (y0 + along * dy)) <= t.radius + SHOT_RADIUS && along < firstAlong) {
      first = t;
      firstAlong = along;
    }
  }

  return first;
}
