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
  return targets.find((t) => Math.hypot(t.x - x, t.y - y) <= t.radius + SHOT_RADIUS);
}
