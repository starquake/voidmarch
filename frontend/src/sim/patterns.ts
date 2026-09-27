import { ENEMY_BULLET, type EnemyKind } from './enemies.ts';
import { rotateOffset, seededRandom } from './math.ts';
import type { ProjectileSpawn } from './projectiles.ts';
import { ENEMY_AIM_JITTER, ENEMY_MUZZLE } from './tuning.ts';

/**
 * Expands "enemy fired at angle with seed" into its bullets. Pure and seeded,
 * so every client makes the same bullets from the server's one message.
 */
export function enemyPattern(kind: EnemyKind, x: number, y: number, angle: number, seed: number): ProjectileSpawn[] {
  const random = seededRandom(seed);
  const aim = angle + (random() * 2 - 1) * ENEMY_AIM_JITTER;
  const muzzle = rotateOffset(ENEMY_MUZZLE, 0, aim);

  return [{ kind: ENEMY_BULLET[kind], x: x + muzzle.x, y: y + muzzle.y, angle: aim }];
}
