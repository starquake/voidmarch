import Phaser from 'phaser';

import { fieldDotImage } from '../sim/forcefield.ts';
import { FIELD_DOT_TEXELS } from '../sim/tuning.ts';

const DOT_KEY = 'field-dot';

/**
 * The force field's glow: a pool of tinted, additive images of one dot
 * texture, made once, so the renderer has no circles to tessellate every
 * frame (#262). Each frame starts with begin, adds a dot per sample and ends
 * with end, which hides the dots it didn't use.
 */
export class FieldGlow {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Layer;
  private readonly below: Phaser.GameObjects.GameObject;
  private readonly dots: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private shown = 0;

  /** The dots go into layer, just under below. */
  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, below: Phaser.GameObjects.GameObject) {
    this.scene = scene;
    this.layer = layer;
    this.below = below;
    if (!scene.textures.exists(DOT_KEY)) {
      const { size, data } = fieldDotImage();
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(data), size, size), 0, 0);
      scene.textures.addCanvas(DOT_KEY, canvas)?.setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
  }

  /** Starts a frame's dots. */
  begin(): void {
    this.used = 0;
  }

  /** Adds a dot at (x, y): its glow's radius times scale, in color, each of its two disks at alpha. */
  add(x: number, y: number, scale: number, color: number, alpha: number): void {
    let dot = this.dots[this.used];
    if (dot === undefined) {
      dot = new Phaser.GameObjects.Image(this.scene, 0, 0, DOT_KEY).setBlendMode(Phaser.BlendModes.ADD);
      this.layer.addAt(dot, this.layer.getIndex(this.below));
      this.dots.push(dot);
    }
    dot
      .setPosition(x, y)
      .setScale(scale / FIELD_DOT_TEXELS)
      .setTint(color)
      // The texture draws the glow's disk at half, so the core can be twice as bright.
      .setAlpha(alpha * 2)
      .setVisible(true);
    this.used++;
  }

  /** How many dots the last frame drew. */
  get drawn(): number {
    return this.shown;
  }

  /** Hides the dots this frame didn't use. */
  end(): void {
    for (let i = this.used; i < this.shown; i++) {
      this.dots[i]?.setVisible(false);
    }
    this.shown = this.used;
  }
}
