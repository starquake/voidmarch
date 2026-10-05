import Phaser from 'phaser';

import { teleportFrame } from '../sim/teleport.ts';
import { TELEPORT_COLOR, TELEPORT_WHITE, UI_FONT } from '../sim/tuning.ts';
import { keys } from '../sprites.ts';
import { DOWN_COLOR, DOWN_OFFSET, REVIVE_BAR_BELOW, REVIVE_BAR_WIDTH, SPRITE_FACING, drawReviveBar, type ShipParent } from './shipview.ts';

/** A derelict's hull is the Main Ship's most damaged, grayed out (#52's mockup). */
const DERELICT_TINT = 0x8a8f99;
/** Darker while enemies hold it (#114). */
const DERELICT_HELD_TINT = 0x4a4e5c;
/** The flash's white core, as a share of its radius. */
const FLASH_CORE = 0.5;

/** A teleport under way (#190): when it started, in seconds, and what it adds to the hull. */
interface Teleport {
  start: number;
  shield: Phaser.GameObjects.Sprite;
  flash: Phaser.GameObjects.Graphics;
}

/**
 * A derelict ship waiting to be rescued (#52): the hull alone, no engine,
 * weapon or shield, with its time left and a rescue bar under it. Once it
 * leaves, it teleports away (#190).
 */
export class DerelictView {
  private readonly scene: Phaser.Scene;
  private readonly layer: ShipParent;
  private readonly hull: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  private readonly bar: Phaser.GameObjects.Graphics;
  private fill = -1;
  private teleporting: Teleport | undefined;

  constructor(scene: Phaser.Scene, layer: ShipParent, x: number, y: number, angle: number, resolution: number) {
    this.scene = scene;
    this.layer = layer;
    this.hull = scene.add
      .image(x, y, keys.hull('veryDamaged'))
      .setRotation(angle + SPRITE_FACING)
      .setTint(DERELICT_TINT)
      .setTintMode(Phaser.TintModes.MULTIPLY);
    this.label = scene.add
      .text(x, y, '', { fontFamily: UI_FONT, fontSize: '8px', color: DOWN_COLOR, resolution })
      .setOrigin(0.5, 0)
      .setShadow(1, 1, '#000000', 0);
    this.bar = scene.add.graphics();
    this.place(x, y);
    layer.add([this.hull, this.label, this.bar]);
  }

  /** Where the hull is drawn. */
  get x(): number {
    return this.hull.x;
  }

  get y(): number {
    return this.hull.y;
  }

  /** Moves it to (x, y), with its label and bar: a held one goes where its Frigate tows it (#121). */
  place(x: number, y: number): void {
    this.hull.setPosition(x, y);
    this.label.setPosition(x, y + DOWN_OFFSET);
    this.bar.setPosition(x - REVIVE_BAR_WIDTH / 2, y + DOWN_OFFSET + REVIVE_BAR_BELOW);
  }

  /** Shows the label, whether it's held, and the rescue's progress (0 to 1); the bar shows once there is some. */
  update(label: string, held: boolean, rescue: number): void {
    this.hull.setTint(held ? DERELICT_HELD_TINT : DERELICT_TINT);
    if (this.label.text !== label) {
      this.label.setText(label);
    }
    const fill = Math.round(Math.min(Math.max(rescue, 0), 1) * REVIVE_BAR_WIDTH) / REVIVE_BAR_WIDTH;
    if (fill === this.fill) {
      return;
    }
    this.fill = fill;
    this.bar.clear();
    if (fill > 0) {
      drawReviveBar(this.bar, fill);
    }
  }

  /** Starts teleporting away at now, in seconds: the label and bar go, and the Invincibility Shield closes in (#190). */
  teleport(now: number): void {
    if (this.teleporting !== undefined) {
      return;
    }
    this.label.setVisible(false);
    this.bar.setVisible(false);
    const shield = this.scene.add
      .sprite(this.hull.x, this.hull.y, keys.shield('invincibility'))
      .setRotation(this.hull.rotation)
      .setTint(TELEPORT_COLOR)
      .setTintMode(Phaser.TintModes.FILL)
      .setBlendMode(Phaser.BlendModes.ADD);
    shield.play(keys.shield('invincibility'));
    const flash = this.scene.add.graphics().setPosition(this.hull.x, this.hull.y).setBlendMode(Phaser.BlendModes.ADD);
    this.layer.add([shield, flash]);
    this.teleporting = { start: now, shield, flash };
    this.step(now);
  }

  /** Draws the teleport at now, in seconds; true once it's over, false while it runs or before it starts. */
  step(now: number): boolean {
    const t = this.teleporting;
    if (t === undefined) {
      return false;
    }
    const f = teleportFrame(now - t.start);
    if (f.white) {
      this.hull.setTint(TELEPORT_WHITE).setTintMode(Phaser.TintModes.FILL);
      t.shield.setTint(TELEPORT_WHITE);
    }
    this.hull.setScale(f.hullScale).setVisible(f.hullScale > 0);
    t.shield.setScale(f.shieldScale).setAlpha(f.shieldAlpha).setVisible(f.shieldScale > 0 && f.shieldAlpha > 0);
    t.flash.clear();
    if (f.flashRadius > 0) {
      t.flash.fillStyle(TELEPORT_COLOR, f.flashAlpha).fillCircle(0, 0, f.flashRadius);
      t.flash.fillStyle(TELEPORT_WHITE, f.flashAlpha).fillCircle(0, 0, f.flashRadius * FLASH_CORE);
    }

    return f.done;
  }

  destroy(): void {
    this.hull.destroy();
    this.label.destroy();
    this.bar.destroy();
    this.teleporting?.shield.destroy();
    this.teleporting?.flash.destroy();
    this.teleporting = undefined;
  }
}
