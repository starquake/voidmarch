import { seededRandom } from './math.ts';
import { ASTEROID_CLEAR_RADIUS, ASTEROID_COUNT, ASTEROID_SEED, WORLD_EDGE_BAND, WORLD_HALF_SIZE } from './tuning.ts';

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
