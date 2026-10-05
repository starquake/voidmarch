import { sectorRing } from './sectors.ts';

/** Where the ship is, as the music hears it (#187): each place has its own track. */
export type MusicPlace = 'home' | 'ring1' | 'ring2' | 'ring3' | 'ending';

/** The place for a ship in sector (undefined off the map), or the ending while the victory screen is open. */
export function musicPlace(sector: string | undefined, victory: boolean): MusicPlace {
  if (victory) {
    return 'ending';
  }
  switch (sector === undefined ? undefined : sectorRing(sector)) {
    case 0:
      return 'home';
    case 1:
      return 'ring1';
    case 2:
      return 'ring2';
    default:
      return 'ring3';
  }
}
