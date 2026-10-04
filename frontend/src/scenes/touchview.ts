import type Phaser from 'phaser';

import type { ButtonRect, TouchControls } from '../sim/touch.ts';
import { TOUCH_STICK_RADIUS_PX, UI_FONT } from '../sim/tuning.ts';

const UI = 0x8fd8ff;
const GOLD = 0xfff08a;
const PANEL = 0x05030a;
const KNOB_RADIUS = 32;
const LINE_PX = 2;
const BUTTON_ALPHA = 0.7;
const RING_ALPHA = 0.45;
const KNOB_ALPHA = 0.35;
const FONT_PX = 13;

/** Draws the touch sticks and buttons (#180) on the HUD camera, in device pixels. */
export class TouchView {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private readonly scene: Phaser.Scene;
  private readonly hide: (o: Phaser.GameObjects.GameObject) => void;

  constructor(scene: Phaser.Scene, hideFromWorld: (o: Phaser.GameObjects.GameObject) => void) {
    this.scene = scene;
    this.hide = hideFromWorld;
    this.g = scene.add.graphics().setDepth(1000);
    hideFromWorld(this.g);
  }

  /** Draws the sticks being held and the buttons, unit device pixels to a CSS pixel of touch UI (touchUnit). */
  draw(controls: TouchControls, buttons: readonly ButtonRect[], unit: number): void {
    const g = this.g.clear();
    for (const s of controls.sticks()) {
      const color = s.firing ? GOLD : UI;
      g.fillStyle(PANEL, RING_ALPHA).fillCircle(s.origin.x, s.origin.y, TOUCH_STICK_RADIUS_PX * unit);
      g.lineStyle(LINE_PX * unit, color, RING_ALPHA).strokeCircle(s.origin.x, s.origin.y, TOUCH_STICK_RADIUS_PX * unit);
      g.fillStyle(color, KNOB_ALPHA).fillCircle(s.knob.x, s.knob.y, KNOB_RADIUS * unit);
      g.lineStyle(LINE_PX * unit, color, 1).strokeCircle(s.knob.x, s.knob.y, KNOB_RADIUS * unit);
    }
    while (this.labels.length < buttons.length) {
      const label = this.scene.add.text(0, 0, '', { fontFamily: UI_FONT }).setOrigin(0.5).setDepth(1001);
      this.hide(label);
      this.labels.push(label);
    }
    this.labels.forEach((label, i) => {
      const b = buttons[i];
      label.setVisible(b !== undefined);
      if (b === undefined) {
        return;
      }
      const color = b.gold ? GOLD : UI;
      const radius = b.height / 2;
      g.fillStyle(PANEL, BUTTON_ALPHA).fillRoundedRect(b.x, b.y, b.width, b.height, radius);
      g.lineStyle(LINE_PX * unit, color, BUTTON_ALPHA).strokeRoundedRect(b.x, b.y, b.width, b.height, radius);
      label
        .setText(b.label)
        .setFontSize(FONT_PX * unit)
        .setColor(b.gold ? '#fff08a' : '#d8f8ff')
        .setPosition(b.x + b.width / 2, b.y + b.height / 2);
    });
  }
}
