import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canPick,
  drawnMap,
  layoutForHeight,
  layoutForWidth,
  mapLegend,
  mapSize,
  mapTitle,
  missionsLine,
  sectorAtScreen,
  sectorFill,
  type MapState,
} from './sectormap.ts';
import { GRID_EXTENT, sectorCenter, sectorRing } from './sectors.ts';
import {
  EVENT_COLOR,
  MAP_CLEARED_COLOR,
  MAP_HOME_COLOR,
  MAP_HOSTILE_COLORS,
  MAP_OTHER_MISSION_COLOR,
  MISSION_COLOR,
} from './tuning.ts';

const state = (over: Partial<MapState> = {}): MapState => ({
  cleared: new Set(['D3', 'E3', 'E4']),
  frigates: [],
  missions: [
    { squadron: 'Alpha', sector: 'C3', own: true },
    { squadron: 'Beta', sector: 'C4', own: false },
  ],
  attack: undefined,
  you: { x: 0, y: 0 },
  squadmates: [],
  ...over,
});

test('a layout fits the whole grid to a width or a height', () => {
  const mini = layoutForWidth(100, 50, 170);
  assert.ok(Math.abs(mapSize(mini).width - 170) < 1e-9);
  const full = layoutForHeight(640, 360, 470);
  assert.ok(Math.abs(mapSize(full).height - 470) < 1e-9);
  assert.ok(mapSize(full).width < 470, 'the grid is taller than wide');
  assert.equal(GRID_EXTENT.x, 5445);
});

test('sectors are home blue, cleared green and hostile red, darker by ring', () => {
  const s = state();
  assert.equal(sectorFill('D4', s, false), MAP_HOME_COLOR);
  assert.equal(sectorFill('E4', s, false), MAP_CLEARED_COLOR);
  assert.equal(sectorFill('C3', s, false), MAP_HOSTILE_COLORS[1]);
  assert.equal(sectorFill('D1', s, false), MAP_HOSTILE_COLORS[3]);
  assert.equal(sectorRing('D1'), 3);
});

test('a sector under attack flashes, and only on the flash phase', () => {
  const s = state({ attack: 'E4' });
  assert.equal(sectorFill('E4', s, true), EVENT_COLOR);
  assert.equal(sectorFill('E4', s, false), MAP_CLEARED_COLOR);
  assert.equal(sectorFill('E3', s, true), MAP_CLEARED_COLOR);
});

test('the drawn map has every sector, mission outlines, Frigates by sector and ships', () => {
  const layout = layoutForWidth(0, 0, 170);
  const c4 = sectorCenter('C4') ?? { x: 0, y: 0 };
  const drawn = drawnMap(
    state({
      frigates: [
        { x: c4.x + 50, y: c4.y },
        { x: c4.x - 50, y: c4.y },
      ],
      you: { x: 1000, y: -500 },
      squadmates: [{ x: 0, y: 2000, color: 0x00ff00 }],
    }),
    layout,
    false,
  );
  assert.equal(drawn.sectors.length, 37);
  const outline = (name: string): number | undefined => drawn.sectors.find((s) => s.name === name)?.outline;
  assert.equal(outline('C3'), MISSION_COLOR);
  assert.equal(outline('C4'), MAP_OTHER_MISSION_COLOR);
  assert.equal(outline('D5'), undefined);
  assert.equal(drawn.frigates.length, 1, 'two Frigates in one sector make one marker');
  assert.ok(Math.abs((drawn.frigates[0]?.x ?? 0) - c4.x * layout.scale) < 1e-9);
  assert.deepEqual(drawn.you, { x: 1000 * layout.scale, y: -500 * layout.scale });
  assert.equal(drawn.squadmates[0]?.color, 0x00ff00);
  const home = drawn.sectors.find((s) => s.name === 'D4');
  assert.equal(home?.corners.length, 6);
});

test('your squadron\'s mission outline wins over another\'s on the same sector', () => {
  const drawn = drawnMap(
    state({
      missions: [
        { squadron: 'Beta', sector: 'C3', own: false },
        { squadron: 'Alpha', sector: 'C3', own: true },
      ],
    }),
    layoutForWidth(0, 0, 170),
    false,
  );
  assert.equal(drawn.sectors.find((s) => s.name === 'C3')?.outline, MISSION_COLOR);
});

test('a click names the sector under it, and only uncleared ones can be picked', () => {
  const layout = layoutForHeight(640, 360, 470);
  const c3 = sectorCenter('C3') ?? { x: 0, y: 0 };
  const name = sectorAtScreen(layout, 640 + c3.x * layout.scale, 360 + c3.y * layout.scale);
  assert.equal(name, 'C3');
  assert.equal(sectorAtScreen(layout, 0, 0), undefined);
  const cleared = new Set(['E4']);
  assert.ok(canPick('C3', cleared));
  assert.ok(!canPick('E4', cleared));
  assert.ok(!canPick('D4', cleared));
  assert.ok(!canPick(undefined, cleared));
});

test('the title counts ring 1, and the lines name every squadron\'s mission', () => {
  assert.equal(mapTitle('frontier', new Set(['D3', 'E3', 'B2'])), 'FRONTIER  ·  2 of 6 ring-1 sectors cleared  ·  Tab closes');
  assert.match(mapTitle('', new Set()), /^SECTORS {2}· {2}0 of 6/);
  const missions = state().missions;
  assert.equal(missionsLine(missions), 'Alpha → C3 · Beta → C4');
  const [legend, hint] = mapLegend(missions);
  assert.match(legend ?? '', /^■ Alpha \(you\): C3 {5}■ Beta: C4 {5}▲ Frigate/);
  assert.equal(hint, 'Click an uncleared sector to send Alpha there.');
  assert.equal(mapLegend([])[1], '');
});
