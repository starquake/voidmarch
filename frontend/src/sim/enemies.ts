/** Enemy classes, matching the server's EnemyKind. */
export const ENEMY_KINDS = ['scout', 'fighter'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

/** Enemy bullets, from the Kla'ed projectiles. */
export type EnemyBulletId = 'klaedBullet' | 'klaedBigBullet';

/** Each enemy's bullet: the Scout's small one, the Fighter's big one. */
export const ENEMY_BULLET: Readonly<Record<EnemyKind, EnemyBulletId>> = {
  scout: 'klaedBullet',
  fighter: 'klaedBigBullet',
};

/** Hit circles in art pixels, from the sprites' opaque extent. */
export const ENEMY_RADIUS: Readonly<Record<EnemyKind, number>> = {
  scout: 11,
  fighter: 12,
};
