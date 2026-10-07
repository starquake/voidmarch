import { GRID_EXTENT, HOME_SECTOR, SECTOR_NAMES, sectorCenter, sectorCorners, sectorName, sectorOpen, sectorRing, type Frontier } from './sectors.ts';
import {
  EVENT_COLOR,
  MAP_CLEARED_COLOR,
  MAP_CLOSED_COLOR,
  MAP_HOME_COLOR,
  MAP_HOSTILE_COLORS,
  MAP_OTHER_MISSION_COLOR,
  MINIMAP_INSET_PX,
  MINIMAP_WIDTH_PX,
  MISSION_COLOR,
} from './tuning.ts';

/** Where a map sits on screen: its middle, and screen pixels per world pixel. */
export interface MapLayout {
  x: number;
  y: number;
  scale: number;
}

interface Point {
  x: number;
  y: number;
}

/** A squadron's mission, as the squadron list names it (#101). */
export interface MapMission {
  squadron: string;
  sector: string;
  own: boolean;
}

/** What the maps show (#100): the client's own view of the world. */
export interface MapState {
  cleared: ReadonlySet<string>;
  /** Which sectors are open (#123). */
  frontier: Frontier;
  /** Where the Frigates still up are. */
  frigates: readonly Point[];
  /** Where the Dreadnought is while it's awake (#124). */
  dreadnoughts: readonly Point[];
  missions: readonly MapMission[];
  /** The sector under attack, if any (#102). */
  attack: string | undefined;
  you: Point;
  squadmates: readonly (Point & { color: number })[];
}

export interface DrawnSector {
  name: string;
  center: Point;
  corners: Point[];
  fill: number;
  /** The mission outline's color, if a squadron is sent here. */
  outline: number | undefined;
}

export interface DrawnMap {
  sectors: DrawnSector[];
  frigates: Point[];
  dreadnoughts: Point[];
  you: Point;
  squadmates: (Point & { color: number })[];
}

/** The layout that fits the whole grid width pixels wide, centered on (x, y). */
export function layoutForWidth(x: number, y: number, width: number): MapLayout {
  return { x, y, scale: width / (2 * GRID_EXTENT.x) };
}

/** The layout that fits the whole grid height pixels tall, centered on (x, y). */
export function layoutForHeight(x: number, y: number, height: number): MapLayout {
  return { x, y, scale: height / (2 * GRID_EXTENT.y) };
}

/** The minimap's layout on a screen width device pixels wide, in from its top right corner. */
export function minimapLayout(width: number, dpr: number): MapLayout {
  const miniWidth = MINIMAP_WIDTH_PX * dpr;
  const inset = MINIMAP_INSET_PX * dpr;
  const miniHeight = mapSize(layoutForWidth(0, 0, miniWidth)).height;

  return layoutForWidth(width - inset - miniWidth / 2, inset + miniHeight / 2, miniWidth);
}

/** How big the grid is drawn at this layout, in screen pixels. */
export function mapSize(layout: MapLayout): { width: number; height: number } {
  return { width: 2 * GRID_EXTENT.x * layout.scale, height: 2 * GRID_EXTENT.y * layout.scale };
}

const toScreen = (layout: MapLayout, p: Point): Point => ({ x: layout.x + p.x * layout.scale, y: layout.y + p.y * layout.scale });

/** A sector's fill: home blue, cleared green, hostile red darker by ring; flashing while attacked. */
export function sectorFill(name: string, state: MapState, flash: boolean): number {
  if (flash && state.attack === name) {
    return EVENT_COLOR;
  }
  if (!sectorOpen(name, state.frontier)) {
    return MAP_CLOSED_COLOR;
  }
  if (name === HOME_SECTOR) {
    return MAP_HOME_COLOR;
  }
  if (state.cleared.has(name)) {
    return MAP_CLEARED_COLOR;
  }
  const ring = sectorRing(name) ?? 0;

  return MAP_HOSTILE_COLORS[Math.min(ring, MAP_HOSTILE_COLORS.length - 1)] ?? EVENT_COLOR;
}

/** Everything to draw for a map at layout; flash is the attack flash's phase. */
export function drawnMap(state: MapState, layout: MapLayout, flash: boolean): DrawnMap {
  const outlines = new Map<string, number>();
  for (const m of state.missions) {
    if (m.own || !outlines.has(m.sector)) {
      outlines.set(m.sector, m.own ? MISSION_COLOR : MAP_OTHER_MISSION_COLOR);
    }
  }
  const sectors = SECTOR_NAMES.map((name) => ({
    name,
    center: toScreen(layout, sectorCenter(name) ?? { x: 0, y: 0 }),
    corners: sectorCorners(name).map((c) => toScreen(layout, c)),
    fill: sectorFill(name, state, flash),
    outline: outlines.get(name),
  }));
  const bySector = (points: readonly Point[]): Point[] =>
    [...new Set(points.flatMap((p) => sectorName(p.x, p.y) ?? []))].map((name) => toScreen(layout, sectorCenter(name) ?? { x: 0, y: 0 }));
  const frigates = bySector(state.frigates);
  const dreadnoughts = bySector(state.dreadnoughts);

  return {
    sectors,
    frigates,
    dreadnoughts,
    you: toScreen(layout, state.you),
    squadmates: state.squadmates.map((s) => ({ ...toScreen(layout, s), color: s.color })),
  };
}

/** What a map's hexagons look like, without the markers: equal keys draw the same grid (#265). */
export function gridKey(drawn: DrawnMap): string {
  return drawn.sectors.map((s) => `${String(s.center.x)},${String(s.center.y)}:${String(s.fill)}:${String(s.outline ?? '')}`).join(' ');
}

/** The sector under a screen point at layout, for a click on the full map. */
export function sectorAtScreen(layout: MapLayout, x: number, y: number): string | undefined {
  return sectorName((x - layout.x) / layout.scale, (y - layout.y) / layout.scale);
}

/** Whether a squadron can be sent to the sector: on the grid, open, not home and not cleared. */
export function canPick(name: string | undefined, cleared: ReadonlySet<string>, frontier: Frontier): name is string {
  return name !== undefined && name !== HOME_SECTOR && !cleared.has(name) && sectorOpen(name, frontier);
}

/** The full map's title: the map's name and ring 1's progress. */
export function mapTitle(mapName: string, cleared: ReadonlySet<string>): string {
  const ringOne = SECTOR_NAMES.filter((name) => sectorRing(name) === 1);
  const done = ringOne.filter((name) => cleared.has(name)).length;
  const title = mapName === '' ? 'SECTORS' : mapName.toUpperCase();

  return `${title}  ·  ${String(done)} of ${String(ringOne.length)} ring-1 sectors cleared  ·  Tab closes`;
}

/** The line under the minimap: each squadron's mission. */
export function missionsLine(missions: readonly MapMission[]): string {
  return missions.map((m) => `${m.squadron} → ${m.sector}`).join(' · ');
}

/** The full map's legend, then how to pick a mission. */
export function mapLegend(missions: readonly MapMission[], dreadnought = false): string[] {
  const own = missions.find((m) => m.own);
  const sent = missions.map((m) => `■ ${m.squadron}${m.own ? ' (you)' : ''}: ${m.sector}`);
  const bosses = dreadnought ? ['▲ Frigate', '▲ Dreadnought'] : ['▲ Frigate'];

  return [
    [...sent, ...bosses, '● you', '● squadmate'].join('     '),
    own === undefined ? '' : `Click an uncleared sector to send ${own.squadron} there.`,
  ];
}
