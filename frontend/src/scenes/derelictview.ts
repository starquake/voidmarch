import Phaser from 'phaser';

import { UI_FONT } from '../sim/tuning.ts';
import { keys } from '../sprites.ts';
import { DOWN_COLOR, DOWN_OFFSET, REVIVE_BAR_BELOW, REVIVE_BAR_WIDTH, SPRITE_FACING, drawReviveBar, type ShipParent } from './shipview.ts';

/** A derelict's hull is the Main Ship's most damaged, grayed out (#52's mockup). */
const DERELICT_TINT = 0x8a8f99;
/** Darker while enemies hold it (#114). */
const DERELICT_HELD_TINT = 0x4a4e5c;

/**
 * A derelict ship waiting to be rescued (#52): the hull alone, no engine,
 * weapon or shield, with its time left and a rescue bar under it.
 */
export class DerelictView {
  private readonly hull: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  private readonly bar: Phaser.GameObjects.Graphics;
  private fill = -1;

  constructor(scene: Phaser.Scene, layer: ShipParent, x: number, y: number, angle: number, resolution: number) {
    this.hull = scene.add
      .image(x, y, keys.hull('veryDamaged'))
      .setRotation(angle + SPRITE_FACING)
      .setTint(DERELICT_TINT)
      .setTintMode(Phaser.TintModes.MULTIPLY);
    this.label = scene.add
      .text(x, y + DOWN_OFFSET, '', { fontFamily: UI_FONT, fontSize: '8px', color: DOWN_COLOR, resolution })
      .setOrigin(0.5, 0)
      .setShadow(1, 1, '#000000', 0);
    this.bar = scene.add.graphics().setPosition(x - REVIVE_BAR_WIDTH / 2, y + DOWN_OFFSET + REVIVE_BAR_BELOW);
    layer.add([this.hull, this.label, this.bar]);
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

  destroy(): void {
    this.hull.destroy();
    this.label.destroy();
    this.bar.destroy();
  }
}
