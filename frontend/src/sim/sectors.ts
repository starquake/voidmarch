import { GRID_RINGS, SECTOR_RADIUS } from './rules.gen.ts';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SQRT3 = Math.sqrt(3);

/** A sector in axial coordinates, as the Go sim keeps it (#117): home is (0, 0). */
interface Hex {
  q: number;
  r: number;
}

function ring({ q, r }: Hex): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

function hexName({ q, r }: Hex): string {
  const row = r + (q - (q & 1)) / 2 + GRID_RINGS;

  return `${LETTERS.charAt(q + GRID_RINGS)}${String(row + 1)}`;
}

/** A sector's axial coordinates, as the Go sim keeps them; undefined off the grid. */
export function sectorAxial(name: string): Hex | undefined {
  return parseHex(name);
}

function parseHex(name: string): Hex | undefined {
  const col = LETTERS.indexOf(name.charAt(0));
  const row = Number(name.slice(1)) - 1;
  if (col < 0 || !/^[1-9]\d*$/.test(name.slice(1))) {
    return undefined;
  }
  const q = col - GRID_RINGS;
  const hex = { q, r: row - GRID_RINGS - (q - (q & 1)) / 2 };

  return ring(hex) <= GRID_RINGS ? hex : undefined;
}

function hexCenter({ q, r }: Hex): { x: number; y: number } {
  return { x: SECTOR_RADIUS * 1.5 * q, y: SECTOR_RADIUS * SQRT3 * (r + q / 2) };
}

/** The name of the sector (x, y) is in ("D4"), as the Go sim names it; undefined outside the grid. */
export function sectorName(x: number, y: number): string | undefined {
  const q = ((2 / 3) * x) / SECTOR_RADIUS;
  const r = (-x / 3 + (SQRT3 * y) / 3) / SECTOR_RADIUS;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  const hex = { q: rq + 0, r: rr + 0 };

  return ring(hex) <= GRID_RINGS ? hexName(hex) : undefined;
}

/** How far the grid reaches from home's center, to its outer corners across and its outer sides down. */
export const GRID_EXTENT = { x: SECTOR_RADIUS * (1.5 * GRID_RINGS + 1), y: SECTOR_RADIUS * SQRT3 * (GRID_RINGS + 0.5) };

/** A sector's ring: 0 for home, 1 for the six around it, and so on; undefined off the grid. */
export function sectorRing(name: string): number | undefined {
  const hex = parseHex(name);

  return hex === undefined ? undefined : ring(hex);
}

/** Every sector's name, home and the rings around it. */
export const SECTOR_NAMES: readonly string[] = (() => {
  const names: string[] = [];
  for (let q = -GRID_RINGS; q <= GRID_RINGS; q++) {
    for (let r = -GRID_RINGS; r <= GRID_RINGS; r++) {
      if (ring({ q, r }) <= GRID_RINGS) {
        names.push(hexName({ q, r }));
      }
    }
  }

  return names;
})();

/** The home planet's sector, the middle one. */
export const HOME_SECTOR = sectorName(0, 0) ?? '';

/** What a sector is to the HUD: home, or cleared or hostile; just "unknown" offline. */
export type SectorState = 'home' | 'cleared' | 'hostile' | 'closed' | 'unknown';

/** Which sectors are open (#123), as the server says: the rings up to openRings, 0 for all, and those opened on their own. */
export interface Frontier {
  openRings: number;
  opened: ReadonlySet<string>;
}

/** Every sector open: offline, and before the server says otherwise. */
export const ALL_OPEN: Frontier = { openRings: 0, opened: new Set() };

/** Whether ships may fly in the named sector, as the Go sim's Frontier.Open says. */
export function sectorOpen(name: string, frontier: Frontier): boolean {
  const ring = sectorRing(name);

  return ring !== undefined && (frontier.openRings === 0 || ring <= frontier.openRings || frontier.opened.has(name));
}

/** The sides where an open sector meets a closed one, to draw as the closed rings' edge (#123). */
export function closedEdges(frontier: Frontier): { a: { x: number; y: number }; b: { x: number; y: number } }[] {
  const edges: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  for (const name of SECTOR_NAMES) {
    if (sectorOpen(name, frontier)) {
      continue;
    }
    const center = sectorCenter(name) ?? { x: 0, y: 0 };
    const corners = sectorCorners(name);
    corners.forEach((a, i) => {
      const b = corners[(i + 1) % corners.length] ?? a;
      const side = ((2 * i + 1) * Math.PI) / 6;
      const across = sectorName(center.x + SQRT3 * SECTOR_RADIUS * Math.cos(side), center.y + SQRT3 * SECTOR_RADIUS * Math.sin(side));
      if (across !== undefined && sectorOpen(across, frontier)) {
        edges.push({ a, b });
      }
    });
  }

  return edges;
}

export function sectorState(name: string, cleared: ReadonlySet<string> | undefined, frontier: Frontier = ALL_OPEN): SectorState {
  if (name === HOME_SECTOR) {
    return 'home';
  }
  if (!sectorOpen(name, frontier)) {
    return 'closed';
  }
  if (cleared === undefined) {
    return 'unknown';
  }

  return cleared.has(name) ? 'cleared' : 'hostile';
}

/** The HUD's sector line: "Sector B3 · hostile". */
export function sectorLine(x: number, y: number, cleared: ReadonlySet<string> | undefined, frontier: Frontier = ALL_OPEN): string {
  const name = sectorName(x, y);
  if (name === undefined) {
    return '';
  }
  const state = sectorState(name, cleared, frontier);

  return state === 'unknown' ? `Sector ${name}` : `Sector ${name} · ${state}`;
}

/** A sector's six corners, clockwise from its right one, in world pixels. */
export function sectorCorners(name: string): { x: number; y: number }[] {
  const hex = parseHex(name);
  if (hex === undefined) {
    return [];
  }
  const center = hexCenter(hex);

  return Array.from({ length: 6 }, (_, i) => ({
    x: center.x + SECTOR_RADIUS * Math.cos((i * Math.PI) / 3),
    y: center.y + SECTOR_RADIUS * Math.sin((i * Math.PI) / 3),
  }));
}

/** Where a sector's middle is, in world pixels. */
export function sectorCenter(name: string): { x: number; y: number } | undefined {
  const hex = parseHex(name);

  return hex === undefined ? undefined : hexCenter(hex);
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
