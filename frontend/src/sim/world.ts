import { seededRandom } from './math.ts';
import type { Ship } from './ship.ts';
import {
  ASTEROID_CLEAR_RADIUS,
  ASTEROID_COUNT,
  ASTEROID_SEED,
  WORLD_EDGE_BAND,
  WORLD_EDGE_PUSH,
  WORLD_HALF_SIZE,
} from './tuning.ts';

/** Projectiles may leave the world by this much before they are dropped. */
const PROJECTILE_MARGIN = 64;

/** Pushes the ship back inside the edge band, and stops it at the edge itself. */
export function applyWorldEdge(ship: Ship, dt: number): void {
  const inner = WORLD_HALF_SIZE - WORLD_EDGE_BAND;

  for (const axis of ['x', 'y'] as const) {
    const v = axis === 'x' ? 'vx' : 'vy';
    const distance = Math.abs(ship[axis]);
    if (distance > inner) {
      const depth = Math.min(1, (distance - inner) / WORLD_EDGE_BAND);
      ship[v] -= Math.sign(ship[axis]) * depth * WORLD_EDGE_PUSH * dt;
    }
    if (distance > WORLD_HALF_SIZE) {
      ship[axis] = Math.sign(ship[axis]) * WORLD_HALF_SIZE;
      if (Math.sign(ship[v]) === Math.sign(ship[axis])) {
        ship[v] = 0;
      }
    }
  }
}

/** Reports whether a projectile at (x, y) is still worth simulating. */
export function projectileInBounds(x: number, y: number): boolean {
  const limit = WORLD_HALF_SIZE + PROJECTILE_MARGIN;

  return Math.abs(x) <= limit && Math.abs(y) <= limit;
}

export interface AsteroidPlacement {
  x: number;
  y: number;
  /** Quarter turns only, so the pixel grid stays square with the world. */
  rotation: number;
  flip: boolean;
}

/** Scatters decorative asteroids the same way every time, clear of the home planet. */
export function asteroidField(seed = ASTEROID_SEED, count = ASTEROID_COUNT): AsteroidPlacement[] {
  const random = seededRandom(seed);
  const field: AsteroidPlacement[] = [];
  const span = WORLD_HALF_SIZE - WORLD_EDGE_BAND;

  while (field.length < count) {
    const x = (random() * 2 - 1) * span;
    const y = (random() * 2 - 1) * span;
    const rotation = Math.floor(random() * 4) * (Math.PI / 2);
    const flip = random() < 0.5;
    if (Math.hypot(x, y) >= ASTEROID_CLEAR_RADIUS) {
      field.push({ x, y, rotation, flip });
    }
  }

  return field;
}
