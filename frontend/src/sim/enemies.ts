/** Enemy classes and their hit circles, as the Go sim has them. */
import type { EnemyFaction } from './rules.gen.ts';

export { ENEMY_FACTIONS, ENEMY_KINDS, ENEMY_RADIUS, type EnemyBulletId, type EnemyFaction, type EnemyKind } from './rules.gen.ts';

/** Each faction's name as the HUD writes it. */
export const FACTION_NAMES: Readonly<Record<EnemyFaction, string>> = { klaed: "Kla'ed", nairan: 'Nairan', nautolan: 'Nautolan' };
