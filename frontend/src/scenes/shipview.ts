import Phaser from 'phaser';

import { keys } from '../sprites.ts';
import { damageState, type Loadout } from '../sim/loadout.ts';
import { tierColor } from '../sim/parts.ts';

/** Sprites face up; Phaser's rotation 0 faces right. */
export const SPRITE_FACING = Math.PI / 2;

/** What ships and their names are added to. */
export type ShipParent = Phaser.GameObjects.Layer | Phaser.GameObjects.Container;

/** How long a hit flashes the hull or shield white. */
const HIT_FLASH_MS = 70;

/** Where a name sits below the ship's center, in art pixels, and a line under it. */
const LABEL_OFFSET = 26;
const LABEL_LINE = 9;
/** Where DOWN sits below a downed ship: under its name when it has one. */
const DOWN_OFFSET = 18;
const DOWN_UNDER_NAME = 36;
/** The DOWN label's color, the mockup's gold, and the revive bar's in it. */
const DOWN_COLOR = '#ffd27a';
const REVIVE_FILL = 0xffd27a;
/** The revive bar under DOWN (#66): its size, how far below the label's top it sits, and its track. */
const REVIVE_BAR_WIDTH = 32;
const REVIVE_BAR_HEIGHT = 3;
const REVIVE_BAR_BELOW = 11;
const REVIVE_TRACK = 0x05030a;
const REVIVE_TRACK_ALPHA = 0.85;

/**
 * A Main Ship drawn from its parts, engine to shield, with an optional name
 * underneath. The local ship and every remote one use it.
 */
export class ShipView {
  readonly root: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  readonly weapon: Phaser.GameObjects.Sprite;
  private readonly engine: Phaser.GameObjects.Image;
  private readonly flame: Phaser.GameObjects.Sprite;
  private readonly hull: Phaser.GameObjects.Image;
  private readonly shield: Phaser.GameObjects.Sprite;
  private label: Phaser.GameObjects.Text | undefined;
  /** The weapon under the name, in its tier's color (#77). */
  private partLabel: Phaser.GameObjects.Text | undefined;
  private downLabel: Phaser.GameObjects.Text | undefined;
  private reviveBar: Phaser.GameObjects.Graphics | undefined;
  /** The revive progress the bar shows, from 0 to 1. */
  private revive = 0;
  private readonly layer: ShipParent;
  private loadout: Loadout | undefined;
  private tint: number | undefined;
  private thrusting = false;
  /** The state last drawn, so a drop flashes; undefined until the first. */
  private damage: number | undefined;
  private charges: number | undefined;

  constructor(scene: Phaser.Scene, layer: ShipParent, x: number, y: number) {
    this.scene = scene;
    this.layer = layer;
    this.engine = scene.add.image(0, 0, keys.engine('base'));
    this.flame = scene.add.sprite(0, 0, keys.flameIdle('base'));
    this.hull = scene.add.image(0, 0, keys.hull('fullHealth'));
    this.weapon = scene.add.sprite(0, 0, keys.weapon('autoCannon'), 0);
    this.shield = scene.add.sprite(0, 0, keys.shield('front'));
    this.root = scene.add.container(x, y, [this.engine, this.flame, this.hull, this.weapon, this.shield]);
    layer.add(this.root);
  }

  /** Shows a name under the ship in the player's color (0xRRGGBB). */
  setLabel(scene: Phaser.Scene, layer: ShipParent, name: string, color: number, resolution: number): void {
    this.label?.destroy();
    this.label = scene.add
      .text(this.root.x, this.root.y + LABEL_OFFSET, name, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: `#${color.toString(16).padStart(6, '0')}`,
        resolution,
      })
      .setOrigin(0.5, 0)
      .setShadow(1, 1, '#000000', 0);
    layer.add(this.label);
  }

  /** Shows a second line under the name, such as the weapon in its tier's color (#77, decision 11). */
  setLabelPart(text: string, color: string, resolution: number): void {
    if (this.label === undefined || (this.partLabel?.text === text && this.partLabel.style.color === color)) {
      return;
    }
    this.partLabel?.destroy();
    this.partLabel = this.scene.add
      .text(this.root.x, this.root.y + LABEL_OFFSET + LABEL_LINE, text, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color,
        resolution,
      })
      .setOrigin(0.5, 0)
      .setShadow(1, 1, '#000000', 0);
    this.layer.add(this.partLabel);
  }

  /** The weapon line under the name, for the E2E tests. */
  get labelPart(): string | undefined {
    return this.partLabel?.text;
  }

  /** Tints every part, for a companion in its owner's color (0xRRGGBB). */
  setTint(color: number): void {
    this.tint = color;
    for (const part of [this.engine, this.flame, this.hull, this.weapon, this.shield]) {
      part.setTint(color).setTintMode(Phaser.TintModes.MULTIPLY);
    }
  }

  /** Fits the parts; unchanged parts keep their animation running. */
  setLoadout(loadout: Loadout): void {
    const old = this.loadout;
    if (old?.engine !== loadout.engine) {
      this.engine.setTexture(keys.engine(loadout.engine));
      this.flame.play(this.thrusting ? keys.flamePowering(loadout.engine) : keys.flameIdle(loadout.engine));
    }
    if (old?.weapon !== loadout.weapon) {
      this.weapon.setTexture(keys.weapon(loadout.weapon), 0);
    }
    if (old?.shield !== loadout.shield) {
      this.shield.play(keys.shield(loadout.shield));
    }
    this.loadout = { ...loadout };
    for (const part of [this.weapon, this.engine, this.shield]) {
      this.restoreTint(part);
    }
  }

  /** A part's own tint: the owner's color for a companion, else its tier's (#77, decision 12). */
  private restoreTint(part: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite): void {
    part.setTintMode(Phaser.TintModes.MULTIPLY);
    const l = this.loadout;
    const tier =
      l === undefined ? 0 : part === this.weapon ? l.weaponTier : part === this.engine ? l.engineTier : part === this.shield ? l.shieldTier : 0;
    const color = this.tint ?? tierColor(tier);
    if (color === undefined) {
      part.clearTint();
    } else {
      part.setTint(color);
    }
  }

  /** Draws the hull for the hits taken; a new hit flashes it. */
  setDamage(damage: number): void {
    if (damage === this.damage) {
      return;
    }
    this.hull.setTexture(keys.hull(damageState(damage)));
    if (this.damage !== undefined && damage > this.damage) {
      this.flash(this.hull);
    }
    this.damage = damage;
  }

  /** Draws the shield while it holds a whole charge; a lost charge flashes it. */
  setShield(charges: number): void {
    const whole = Math.floor(charges);
    if (whole === this.charges) {
      return;
    }
    const lost = this.charges !== undefined && whole < this.charges;
    this.charges = whole;
    if (lost) {
      this.flash(this.shield);
    } else {
      this.shield.setVisible(whole > 0);
    }
  }

  setThrusting(thrusting: boolean): void {
    this.thrusting = thrusting;
    const engine = this.loadout?.engine ?? 'base';
    this.flame.play(thrusting ? keys.flamePowering(engine) : keys.flameIdle(engine), true);
  }

  /** Places the ship facing angle (0 is +x). */
  place(x: number, y: number, angle: number): void {
    this.root.setPosition(x, y).setRotation(angle + SPRITE_FACING);
    this.label?.setPosition(x, y + LABEL_OFFSET);
    this.partLabel?.setPosition(x, y + LABEL_OFFSET + LABEL_LINE);
    const down =
      y + (this.label === undefined ? DOWN_OFFSET : DOWN_UNDER_NAME + (this.partLabel === undefined ? 0 : LABEL_LINE));
    this.downLabel?.setPosition(x, down);
    this.reviveBar?.setPosition(x - REVIVE_BAR_WIDTH / 2, down + REVIVE_BAR_BELOW);
  }

  /**
   * Shows DOWN under a downed ship (#47), and under it a bar of its revive
   * progress once it has some (#66); gone when it's up.
   */
  setDown(down: boolean, revive: number, resolution: number): void {
    if (!down) {
      this.downLabel?.destroy();
      this.downLabel = undefined;
      this.reviveBar?.destroy();
      this.reviveBar = undefined;
      this.revive = 0;

      return;
    }
    if (this.downLabel === undefined) {
      this.downLabel = this.scene.add
        .text(0, 0, 'DOWN', { fontFamily: 'monospace', fontSize: '8px', color: DOWN_COLOR, resolution })
        .setOrigin(0.5, 0)
        .setShadow(1, 1, '#000000', 0);
      this.reviveBar = this.scene.add.graphics();
      this.layer.add([this.downLabel, this.reviveBar]);
      this.place(this.root.x, this.root.y, this.root.rotation - SPRITE_FACING);
    }
    // Redraw only when the fill moves by a pixel.
    const fill = Math.round(Math.min(Math.max(revive, 0), 1) * REVIVE_BAR_WIDTH) / REVIVE_BAR_WIDTH;
    if (fill !== this.revive) {
      this.revive = fill;
      this.drawReviveBar();
    }
  }

  private drawReviveBar(): void {
    const bar = this.reviveBar?.clear();
    if (bar === undefined || this.revive <= 0) {
      return;
    }
    bar
      .fillStyle(REVIVE_TRACK, REVIVE_TRACK_ALPHA)
      .fillRect(-1, -1, REVIVE_BAR_WIDTH + 2, REVIVE_BAR_HEIGHT + 2)
      .fillStyle(REVIVE_FILL, 1)
      .fillRect(0, 0, REVIVE_BAR_WIDTH * this.revive, REVIVE_BAR_HEIGHT);
  }

  /** Whether DOWN is shown, and its text, for the E2E tests. */
  get downText(): string | undefined {
    return this.downLabel?.text;
  }

  /** The revive bar's fill while it's shown, for the E2E tests. */
  get reviveShown(): number | undefined {
    return this.downLabel === undefined || this.revive <= 0 ? undefined : this.revive;
  }

  /** Whether the shield is drawn, for the E2E tests. */
  get shieldShown(): boolean {
    return this.shield.visible;
  }

  /** A short white flash of a part; the shield then shows only while charged. */
  private flash(part: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite): void {
    part.setVisible(true).setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(HIT_FLASH_MS, () => {
      this.restoreTint(part);
      if (part === this.shield) {
        part.setVisible((this.charges ?? 0) > 0);
      }
    });
  }

  destroy(): void {
    this.root.destroy();
    this.label?.destroy();
    this.partLabel?.destroy();
    this.downLabel?.destroy();
    this.reviveBar?.destroy();
  }
}
