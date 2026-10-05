import type { EnemyKind } from './rules.gen.ts';
import { HOME_SECTOR } from './sectors.ts';
import { BATTLE_MUSIC_CALM_SECONDS, BATTLE_MUSIC_RANGE } from './tuning.ts';

/** Where the ship is, as the music hears it (#187): each place has its own tracks. */
export type MusicPlace = 'dreadnought' | 'battle' | 'home' | 'elsewhere';

/** Whether a fight is on for a ship at (x, y): an enemy within BATTLE_MUSIC_RANGE, or the Frigate's bar showing. */
export function fighting(enemies: readonly { x: number; y: number }[], boss: EnemyKind | undefined, x: number, y: number): boolean {
  return boss === 'frigate' || enemies.some((e) => Math.hypot(e.x - x, e.y - y) <= BATTLE_MUSIC_RANGE);
}

/** The battle music's calm-down at now, in seconds: when the fight was last on, and whether the music still plays. */
export interface Calm {
  lastFight: number | undefined;
  battle: boolean;
}

/** Steps the calm-down: the battle music plays on BATTLE_MUSIC_CALM_SECONDS after the fight was last on. */
export function calmDown(fight: boolean, now: number, lastFight: number | undefined): Calm {
  const last = fight ? now : lastFight;

  return { lastFight: last, battle: last !== undefined && now - last < BATTLE_MUSIC_CALM_SECONDS };
}

/** The place for a ship in sector, with the boss bar showing boss: a Dreadnought fight, then a battle, then home. */
export function musicPlace(sector: string | undefined, boss: EnemyKind | undefined, battle: boolean): MusicPlace {
  if (boss === 'dreadnought') {
    return 'dreadnought';
  }
  if (battle) {
    return 'battle';
  }

  return sector === HOME_SECTOR ? 'home' : 'elsewhere';
}
