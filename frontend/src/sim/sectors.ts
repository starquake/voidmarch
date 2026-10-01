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

/** Where a sector's middle is, in world pixels. */
export function sectorCenter(name: string): { x: number; y: number } | undefined {
  const col = LETTERS.indexOf(name.charAt(0));
  const row = Number(name.slice(1)) - 1;
  if (col < 0 || col >= GRID_SIZE || !Number.isInteger(row) || row < 0 || row >= GRID_SIZE) {
    return undefined;
  }

  return { x: (col + 0.5) * SECTOR_SIZE - WORLD_HALF_SIZE, y: (row + 0.5) * SECTOR_SIZE - WORLD_HALF_SIZE };
}

/**
 * Where the mission arrow sits on a width by height screen, margin in from
 * its edge, and which way it points: toward target's middle from the ship at
 * the center (#101). Undefined while the ship is in the target sector.
 */
export function missionArrow(
  ship: { x: number; y: number },
  target: string,
  width: number,
  height: number,
  margin: number,
): { x: number; y: number; angle: number } | undefined {
  const center = sectorCenter(target);
  if (center === undefined || sectorName(ship.x, ship.y) === target) {
    return undefined;
  }
  const angle = Math.atan2(center.y - ship.y, center.x - ship.x);
  const halfW = width / 2 - margin;
  const halfH = height / 2 - margin;
  const scale = Math.min(halfW / Math.max(Math.abs(Math.cos(angle)), 1e-9), halfH / Math.max(Math.abs(Math.sin(angle)), 1e-9));

  return { x: width / 2 + Math.cos(angle) * scale, y: height / 2 + Math.sin(angle) * scale, angle };
}

/** The lines that announce a new mission in the middle of the screen (#101, decision 8). */
export function missionBanner(sector: string): string[] {
  return [
    `New mission: sector ${sector}`,
    `Destroy every Kla'ed ship in ${sector} to clear it.`,
    'Follow the gold arrow at the edge of the screen.',
  ];
}

/** The lines that announce the squadron's mission is done, and the part it gave this player, if any. */
export function missionCompleteBanner(sector: string, part: string | undefined): string[] {
  const lines = [`Mission complete: sector ${sector} cleared`];
  if (part !== undefined) {
    lines.push(`Your reward: ${part}`);
  }

  return lines;
}
