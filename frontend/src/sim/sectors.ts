import { GRID_SIZE, SECTOR_SIZE, WORLD_HALF_SIZE } from './rules.gen.ts';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The name of the sector (x, y) is in ("D4"), as the Go sim names it (#99); undefined outside the world. */
export function sectorName(x: number, y: number): string | undefined {
  const col = Math.floor((x + WORLD_HALF_SIZE) / SECTOR_SIZE);
  const row = Math.floor((y + WORLD_HALF_SIZE) / SECTOR_SIZE);
  if (col < 0 || col >= GRID_SIZE || row < 0 || row >= GRID_SIZE) {
    return undefined;
  }

  return `${LETTERS.charAt(col)}${String(row + 1)}`;
}

/** The home planet's sector, the middle one. */
export const HOME_SECTOR = sectorName(0, 0) ?? '';

/** What a sector is to the HUD: home, or cleared or hostile; just "unknown" offline. */
export type SectorState = 'home' | 'cleared' | 'hostile' | 'unknown';

export function sectorState(name: string, cleared: ReadonlySet<string> | undefined): SectorState {
  if (name === HOME_SECTOR) {
    return 'home';
  }
  if (cleared === undefined) {
    return 'unknown';
  }

  return cleared.has(name) ? 'cleared' : 'hostile';
}

/** The HUD's sector line: "Sector B3 · hostile". */
export function sectorLine(x: number, y: number, cleared: ReadonlySet<string> | undefined): string {
  const name = sectorName(x, y);
  if (name === undefined) {
    return '';
  }
  const state = sectorState(name, cleared);

  return state === 'unknown' ? `Sector ${name}` : `Sector ${name} · ${state}`;
}

/** Where the sector edges run, the same on both axes: every SECTOR_SIZE across the world. */
export function sectorEdges(): number[] {
  return Array.from({ length: GRID_SIZE + 1 }, (_, i) => i * SECTOR_SIZE - WORLD_HALF_SIZE);
}
