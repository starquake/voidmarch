import type { EnemyKind } from './rules.gen.ts';
import { HOME_SECTOR } from './sectors.ts';

/** Where the ship is, as the music hears it (#187): each place has its own tracks. */
export type MusicPlace = 'home' | 'dreadnought' | 'elsewhere';

/** The place for a ship in sector, with the boss bar showing boss: a Dreadnought fight wins over home. */
export function musicPlace(sector: string | undefined, boss: EnemyKind | undefined): MusicPlace {
  if (boss === 'dreadnought') {
    return 'dreadnought';
  }

  return sector === HOME_SECTOR ? 'home' : 'elsewhere';
}
