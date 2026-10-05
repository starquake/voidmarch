import Phaser from 'phaser';

import {
  canPick,
  drawnMap,
  layoutForHeight,
  layoutForWidth,
  mapLegend,
  mapSize,
  mapTitle,
  minimapLayout,
  missionsLine,
  sectorAtScreen,
  type DrawnMap,
  type MapLayout,
  type MapState,
} from '../sim/sectormap.ts';
import type { Frontier } from '../sim/sectors.ts';
import { SECTOR_RADIUS } from '../sim/rules.gen.ts';
import {
  FULL_MAP_HEIGHT_PX,
  MAP_EDGE_COLOR,
  MAP_FILL_ALPHA,
  MINIMAP_FILL_ALPHA,
  MAP_FLASH_MS,
  MAP_FRIGATE_COLOR,
  MAP_MARGIN_PX,
  MAP_PANEL_ALPHA,
  MAP_PANEL_COLOR,
  MAP_YOU_COLOR,
  MINIMAP_WIDTH_PX,
  UI_FONT,
} from '../sim/tuning.ts';

const FONT_PX = 12;
const SMALL_FONT_PX = 11;
/** The full map's panel reaches this far past the grid, for its title and legend. */
const PANEL_PAD_X_PX = 60;
const PANEL_PAD_TOP_PX = 34;
const PANEL_PAD_BOTTOM_PX = 56;
const PANEL_CORNER_PX = 6;
/** The gap between the panel's edge or the grid and the title and legend. */
const TEXT_GAP_PX = 10;
/** Marker sizes as shares of a sector's drawn radius, with a floor in CSS pixels. */
const FRIGATE_SHARE = 0.3;
const FRIGATE_MIN_PX = 4;
const YOU_SHARE_OF_FRIGATE = 0.45;
const YOU_MIN_PX = 2;
const SQUADMATE_SHARE_OF_YOU = 0.8;
/** How high above a sector's center its name sits, as a share of its radius. */
const NAME_LIFT_SHARE = 0.55;
/** The Dreadnought's marker against a Frigate's (#124). */
const DREADNOUGHT_MARKER = 1.7;
/** Above the rest of the HUD; the sector names above the full map's grid. */
const MAP_DEPTH = 10;

/** The minimap in the top right and the full map on Tab (#100), drawn on the HUD camera. */
export class MapView {
  open = false;
  private readonly mini: Phaser.GameObjects.Graphics;
  private readonly miniLabel: Phaser.GameObjects.Text;
  private readonly full: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly legend: Phaser.GameObjects.Text;
  private readonly names: Phaser.GameObjects.Text[] = [];
  private miniLayout: MapLayout = layoutForWidth(0, 0, MINIMAP_WIDTH_PX);
  private fullLayout: MapLayout = layoutForHeight(0, 0, FULL_MAP_HEIGHT_PX);
  private dpr = 1;
  private readonly scene: Phaser.Scene;
  private readonly hideFromWorld: (objects: Phaser.GameObjects.GameObject[]) => void;

  constructor(scene: Phaser.Scene, hideFromWorld: (objects: Phaser.GameObjects.GameObject[]) => void) {
    const text = (size: number): Phaser.GameObjects.Text =>
      scene.add
        .text(0, 0, '', { fontFamily: UI_FONT, fontSize: `${String(size)}px`, color: '#d8f8ff', align: 'center' })
        .setShadow(1, 1, '#000000', 0);
    this.mini = scene.add.graphics();
    this.miniLabel = text(SMALL_FONT_PX).setOrigin(0.5, 0);
    this.full = scene.add.graphics();
    this.title = text(FONT_PX).setOrigin(0.5, 0);
    this.legend = text(FONT_PX).setOrigin(0.5, 0);
    const objects: Phaser.GameObjects.GameObject[] = [this.mini, this.miniLabel, this.full, this.title, this.legend];
    for (const o of [this.mini, this.miniLabel, this.full, this.title, this.legend]) {
      o.setDepth(MAP_DEPTH);
    }
    this.setFullVisible(false);
    hideFromWorld(objects);
    this.scene = scene;
    this.hideFromWorld = hideFromWorld;
  }

  /** Places both maps for a screen of width by height device pixels. */
  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.miniLayout = minimapLayout(width, dpr);
    const miniBottom = this.miniLayout.y + mapSize(this.miniLayout).height / 2;
    this.miniLabel.setFontSize(SMALL_FONT_PX * dpr).setPosition(this.miniLayout.x, miniBottom + (MAP_MARGIN_PX * dpr) / 2);
    const fullHeight = Math.min(FULL_MAP_HEIGHT_PX * dpr, height - (PANEL_PAD_TOP_PX + PANEL_PAD_BOTTOM_PX) * dpr);
    this.fullLayout = layoutForHeight(width / 2, height / 2 - ((PANEL_PAD_BOTTOM_PX - PANEL_PAD_TOP_PX) * dpr) / 2, fullHeight);
    this.title.setFontSize(FONT_PX * dpr);
    this.legend.setFontSize(FONT_PX * dpr);
    for (const name of this.names) {
      name.setFontSize(SMALL_FONT_PX * dpr);
    }
  }

  /** Where the full map's grid sits. */
  get layout(): MapLayout {
    return this.fullLayout;
  }

  /** Opens or closes the full map. */
  toggle(): void {
    this.open = !this.open;
    this.setFullVisible(this.open);
  }

  close(): void {
    this.open = false;
    this.setFullVisible(false);
  }

  /** Draws both maps; nothing when there's no state, offline. */
  draw(state: MapState | undefined, mapName: string, nowMs: number): void {
    this.mini.clear();
    this.full.clear();
    if (state === undefined) {
      this.miniLabel.setText('');
      this.close();

      return;
    }
    const flash = Math.floor(nowMs / MAP_FLASH_MS) % 2 === 0;
    this.drawGrid(this.mini, drawnMap(state, this.miniLayout, flash), this.miniLayout, 1, 2, MINIMAP_FILL_ALPHA);
    this.miniLabel.setText(missionsLine(state.missions));
    if (!this.open) {
      return;
    }
    const drawn = drawnMap(state, this.fullLayout, flash);
    const size = mapSize(this.fullLayout);
    const top = this.fullLayout.y - size.height / 2 - PANEL_PAD_TOP_PX * this.dpr;
    const bottom = this.fullLayout.y + size.height / 2 + PANEL_PAD_BOTTOM_PX * this.dpr;
    const halfWidth = size.width / 2 + PANEL_PAD_X_PX * this.dpr;
    this.full
      .fillStyle(MAP_PANEL_COLOR, MAP_PANEL_ALPHA)
      .fillRoundedRect(this.fullLayout.x - halfWidth, top, halfWidth * 2, bottom - top, PANEL_CORNER_PX * this.dpr);
    this.drawGrid(this.full, drawn, this.fullLayout, 2, 3, MAP_FILL_ALPHA);
    this.drawNames(drawn);
    this.title.setText(mapTitle(mapName, state.cleared)).setPosition(this.fullLayout.x, top + TEXT_GAP_PX * this.dpr);
    const legendY = this.fullLayout.y + size.height / 2 + TEXT_GAP_PX * this.dpr;
    this.legend.setText(mapLegend(state.missions, state.dreadnoughts.length > 0).join('\n')).setPosition(this.fullLayout.x, legendY);
  }

  /** Whether (x, y) is on the minimap, which a tap opens the full map from (#180). */
  onMinimap(x: number, y: number): boolean {
    return within(this.miniLayout, x, y);
  }

  /** Whether (x, y) is on the open full map's grid, so a tap beside it closes it (#180). */
  onFull(x: number, y: number): boolean {
    return this.open && within(this.fullLayout, x, y);
  }

  /** The sector a click on the open full map picks as the mission, if it can be picked. */
  pick(x: number, y: number, cleared: ReadonlySet<string>, frontier: Frontier): string | undefined {
    if (!this.open) {
      return undefined;
    }
    const name = sectorAtScreen(this.fullLayout, x, y);

    return canPick(name, cleared, frontier) ? name : undefined;
  }

  private drawGrid(g: Phaser.GameObjects.Graphics, drawn: DrawnMap, layout: MapLayout, edge: number, outline: number, fill: number): void {
    const scale = this.dpr;
    for (const s of drawn.sectors) {
      g.fillStyle(s.fill, fill);
      polygon(g, s.corners);
      g.fillPath();
      g.lineStyle(edge * scale, MAP_EDGE_COLOR, 1);
      polygon(g, s.corners);
      g.strokePath();
    }
    for (const s of drawn.sectors) {
      if (s.outline !== undefined) {
        g.lineStyle(outline * scale, s.outline, 1);
        polygon(g, s.corners);
        g.strokePath();
      }
    }
    const marker = Math.max(FRIGATE_MIN_PX * scale, SECTOR_RADIUS * layout.scale * FRIGATE_SHARE);
    g.fillStyle(MAP_FRIGATE_COLOR, 1);
    for (const f of drawn.frigates) {
      g.fillTriangle(f.x, f.y - marker, f.x - marker, f.y + marker, f.x + marker, f.y + marker);
    }
    const big = marker * DREADNOUGHT_MARKER;
    for (const d of drawn.dreadnoughts) {
      g.fillTriangle(d.x, d.y - big, d.x - big, d.y + big, d.x + big, d.y + big);
    }
    const dot = Math.max(YOU_MIN_PX * scale, marker * YOU_SHARE_OF_FRIGATE);
    for (const s of drawn.squadmates) {
      g.fillStyle(s.color, 1).fillCircle(s.x, s.y, dot * SQUADMATE_SHARE_OF_YOU);
    }
    g.fillStyle(MAP_YOU_COLOR, 1).fillCircle(drawn.you.x, drawn.you.y, dot);
  }

  private drawNames(drawn: DrawnMap): void {
    while (this.names.length < drawn.sectors.length) {
      const text = this.scene.add
        .text(0, 0, '', { fontFamily: UI_FONT, fontSize: `${String(SMALL_FONT_PX * this.dpr)}px`, color: '#d8f8ff' })
        .setOrigin(0.5)
        .setDepth(MAP_DEPTH + 1)
        .setShadow(1, 1, '#000000', 0);
      this.hideFromWorld([text]);
      this.names.push(text);
    }
    const lift = SECTOR_RADIUS * this.fullLayout.scale * NAME_LIFT_SHARE;
    drawn.sectors.forEach((s, i) => {
      this.names[i]?.setText(s.name).setPosition(s.center.x, s.center.y - lift).setVisible(true);
    });
  }

  private setFullVisible(visible: boolean): void {
    this.full.setVisible(visible);
    this.title.setVisible(visible);
    this.legend.setVisible(visible);
    for (const name of this.names) {
      name.setVisible(visible);
    }
  }
}

function polygon(g: Phaser.GameObjects.Graphics, corners: readonly { x: number; y: number }[]): void {
  const [first, ...rest] = corners;
  if (first === undefined) {
    return;
  }
  g.beginPath().moveTo(first.x, first.y);
  for (const c of rest) {
    g.lineTo(c.x, c.y);
  }
  g.closePath();
}

/** Whether (x, y) is within the grid drawn at layout. */
function within(layout: MapLayout, x: number, y: number): boolean {
  const size = mapSize(layout);

  return Math.abs(x - layout.x) <= size.width / 2 && Math.abs(y - layout.y) <= size.height / 2;
}
