import Phaser from 'phaser';

import { keys } from '../sprites.ts';
import { damageState, type Loadout } from '../sim/loadout.ts';

/** Sprites face up; Phaser's rotation 0 faces right. */
export const SPRITE_FACING = Math.PI / 2;

/** What ships and their names are added to. */
export type ShipParent = Phaser.GameObjects.Layer | Phaser.GameObjects.Container;

/** How long a hit flashes the hull or shield white. */
const HIT_FLASH_MS = 70;

/** Where a name sits below the ship's centre, in art pixels. */
const LABEL_OFFSET = 26;

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
  private loadout: Loadout | undefined;
  private tint: number | undefined;
  private thrusting = false;
  /** The state last drawn, so a drop flashes; undefined until the first. */
  private damage: number | undefined;
  private charges: number | undefined;

  constructor(scene: Phaser.Scene, layer: ShipParent, x: number, y: number) {
    this.scene = scene;
    this.engine = scene.add.image(0, 0, keys.engine('base'));
    this.flame = scene.add.sprite(0, 0, keys.flameIdle('base'));
    this.hull = scene.add.image(0, 0, keys.hull('fullHealth'));
    this.weapon = scene.add.sprite(0, 0, keys.weapon('autoCannon'), 0);
    this.shield = scene.add.sprite(0, 0, keys.shield('front'));
    this.root = scene.add.container(x, y, [this.engine, this.flame, this.hull, this.weapon, this.shield]);
    layer.add(this.root);
  }

  /** Shows a name under the ship in the player's colour (0xRRGGBB). */
  setLabel(scene: Phaser.Scene, layer: ShipParent, name: string, colour: number, resolution: number): void {
    this.label?.destroy();
    this.label = scene.add
      .text(this.root.x, this.root.y + LABEL_OFFSET, name, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: `#${colour.toString(16).padStart(6, '0')}`,
        resolution,
      })
      .setOrigin(0.5, 0)
      .setShadow(1, 1, '#000000', 0);
    layer.add(this.label);
  }

  /** Tints every part, for a companion in its owner's colour (0xRRGGBB). */
  setTint(colour: number): void {
    this.tint = colour;
    for (const part of [this.engine, this.flame, this.hull, this.weapon, this.shield]) {
      part.setTint(colour).setTintMode(Phaser.TintModes.MULTIPLY);
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
  }

  /** Whether the shield is drawn, for the E2E tests. */
  get shieldShown(): boolean {
    return this.shield.visible;
  }

  /** A short white flash of a part; the shield then shows only while charged. */
  private flash(part: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite): void {
    part.setVisible(true).setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(HIT_FLASH_MS, () => {
      part.setTintMode(Phaser.TintModes.MULTIPLY);
      if (this.tint === undefined) {
        part.clearTint();
      } else {
        part.setTint(this.tint);
      }
      if (part === this.shield) {
        part.setVisible((this.charges ?? 0) > 0);
      }
    });
  }

  destroy(): void {
    this.root.destroy();
    this.label?.destroy();
  }
}
