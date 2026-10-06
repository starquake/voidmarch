import Phaser from 'phaser';

import { teleportFrame, type TeleportFrame } from '../sim/teleport.ts';
import { TELEPORT_COLOR, TELEPORT_WHITE } from '../sim/tuning.ts';
import { keys } from '../sprites.ts';
import type { ShipParent } from './shipview.ts';

/** The flash's white core, as a share of its radius. */
const FLASH_CORE = 0.5;

/**
 * A teleport out (#190): the Main Ship's Invincibility Shield, tinted blue,
 * closes in round a hull, and both shrink into a flash. size scales it to
 * the hull: 1 for a Main Ship's, more for a bigger ship (#223).
 */
export class TeleportEffect {
  private readonly start: number;
  private readonly size: number;
  private readonly shield: Phaser.GameObjects.Sprite;
  private readonly flash: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, layer: ShipParent, x: number, y: number, rotation: number, now: number, size: number) {
    this.start = now;
    this.size = size;
    this.shield = scene.add
      .sprite(x, y, keys.shield('invincibility'))
      .setRotation(rotation)
      .setTint(TELEPORT_COLOR)
      .setTintMode(Phaser.TintModes.FILL)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.shield.play(keys.shield('invincibility'));
    this.flash = scene.add.graphics().setPosition(x, y).setBlendMode(Phaser.BlendModes.ADD);
    layer.add([this.shield, this.flash]);
  }

  /** Draws the shield and flash at now, in seconds, and returns the frame, for the hull to follow. */
  step(now: number): TeleportFrame {
    const f = teleportFrame(now - this.start);
    if (f.white) {
      this.shield.setTint(TELEPORT_WHITE);
    }
    this.shield
      .setScale(f.shieldScale * this.size)
      .setAlpha(f.shieldAlpha)
      .setVisible(f.shieldScale > 0 && f.shieldAlpha > 0);
    this.flash.clear();
    if (f.flashRadius > 0) {
      const radius = f.flashRadius * this.size;
      this.flash.fillStyle(TELEPORT_COLOR, f.flashAlpha).fillCircle(0, 0, radius);
      this.flash.fillStyle(TELEPORT_WHITE, f.flashAlpha).fillCircle(0, 0, radius * FLASH_CORE);
    }

    return f;
  }

  destroy(): void {
    this.shield.destroy();
    this.flash.destroy();
  }
}
