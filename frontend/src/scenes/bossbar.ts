import Phaser from 'phaser';

import type { BossBar } from '../net/boss.ts';

/** The bar's look from the mockup (#89): enemy coral, the shield in blue under it. */
const NAME_COLOR = '#ff9a8a';
const TEXT_COLOR = '#d8f8ff';
const HEALTH_FILL = 0xff5a4a;
const SHIELD_FILL = 0x8fd8ff;
const TRACK = 0x05030a;
const TRACK_ALPHA = 0.8;
/** Its width as a share of the screen, and its sizes in CSS pixels. */
const WIDTH_SHARE = 0.3;
const TOP_PX = 8;
const FONT_PX = 12;
const HEALTH_PX = 10;
const SHIELD_PX = 3;
const GAP_PX = 2;

/** The health bar at the top center while a boss is near (#89), on the HUD camera. */
export class BossBarView {
  private readonly name: Phaser.GameObjects.Text;
  private readonly text: Phaser.GameObjects.Text;
  private readonly bars: Phaser.GameObjects.Graphics;
  private shown: BossBar | undefined;
  private width = 0;
  private scale = 1;

  constructor(scene: Phaser.Scene, hide: (object: Phaser.GameObjects.GameObject) => void) {
    const style = { fontFamily: 'monospace', fontSize: `${String(FONT_PX)}px` };
    this.name = scene.add.text(0, 0, '', { ...style, color: NAME_COLOR }).setOrigin(0.5, 0).setShadow(1, 1, '#000000', 0);
    this.text = scene.add.text(0, 0, '', { ...style, color: TEXT_COLOR }).setOrigin(0.5, 0).setShadow(1, 1, '#000000', 0);
    this.bars = scene.add.graphics();
    for (const object of [this.name, this.text, this.bars]) {
      hide(object);
    }
    this.show(undefined);
  }

  /** The bar as shown, for the E2E tests. */
  get current(): BossBar | undefined {
    return this.shown;
  }

  /** Lays the bar out for a screen width in device pixels at dpr. */
  resize(width: number, dpr: number): void {
    this.width = Math.round(width * WIDTH_SHARE);
    this.scale = dpr;
    const x = width / 2;
    this.name.setFontSize(FONT_PX * dpr).setPosition(x, TOP_PX * dpr);
    this.bars.setPosition(Math.round(x - this.width / 2), this.name.y + this.name.height + GAP_PX * dpr);
    this.text.setFontSize(FONT_PX * dpr).setPosition(x, this.bars.y + (HEALTH_PX + SHIELD_PX + 2 * GAP_PX) * dpr);
    this.draw();
  }

  /** Shows bar, or hides it when undefined. */
  show(bar: BossBar | undefined): void {
    const same =
      bar?.name === this.shown?.name && bar?.health === this.shown?.health && bar?.shield === this.shown?.shield && bar?.text === this.shown?.text;
    this.shown = bar;
    for (const object of [this.name, this.text, this.bars]) {
      object.setVisible(bar !== undefined);
    }
    if (bar === undefined || same) {
      return;
    }
    this.name.setText(bar.name);
    this.text.setText(bar.text);
    this.draw();
  }

  private draw(): void {
    const bar = this.shown;
    this.bars.clear();
    if (bar === undefined) {
      return;
    }
    const s = this.scale;
    const health = HEALTH_PX * s;
    const shieldY = health + GAP_PX * s;
    const shield = SHIELD_PX * s;
    this.bars
      .fillStyle(TRACK, TRACK_ALPHA)
      .fillRect(0, 0, this.width, health)
      .fillRect(0, shieldY, this.width, shield)
      .fillStyle(HEALTH_FILL, 1)
      .fillRect(0, 0, Math.round(this.width * bar.health), health)
      .fillStyle(SHIELD_FILL, 1)
      .fillRect(0, shieldY, Math.round(this.width * bar.shield), shield);
  }
}
