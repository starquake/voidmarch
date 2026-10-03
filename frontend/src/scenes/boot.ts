import Phaser from 'phaser';

import { bakeGlow, double, type Pixels } from '../glow.ts';
import { effectFiles } from '../sounds.ts';
import { glowSheets, sheets, type GlowSheet } from '../sprites.ts';
import {
  ENEMY_FIRE_GLOW_COLOR,
  ENEMY_FIRE_GLOW_DISTANCE,
  ENEMY_FIRE_GLOW_QUALITY,
  ENEMY_FIRE_GLOW_STRENGTH,
} from '../sim/tuning.ts';

/** The glow enemy fire wears (#36), baked at twice the art's size so it steps half an art pixel (#143). */
const ENEMY_FIRE_GLOW = {
  color: ENEMY_FIRE_GLOW_COLOR,
  strength: ENEMY_FIRE_GLOW_STRENGTH,
  quality: ENEMY_FIRE_GLOW_QUALITY,
  distance: ENEMY_FIRE_GLOW_DISTANCE,
};

/** The frames of an enemy bullet sheet with its glow baked in, side by side on a canvas. */
function bakeSheet(source: CanvasImageSource, sheet: GlowSheet): { canvas: HTMLCanvasElement; frameWidth: number; frameHeight: number } {
  const read = document.createElement('canvas');
  read.width = sheet.frameWidth * sheet.frames;
  read.height = sheet.frameHeight;
  const reader = read.getContext('2d', { willReadFrequently: true });
  reader?.drawImage(source, 0, 0);
  const frames: Pixels[] = [];
  for (let i = 0; i < sheet.frames; i++) {
    const frame = reader?.getImageData(i * sheet.frameWidth, 0, sheet.frameWidth, sheet.frameHeight);
    if (frame !== undefined) {
      frames.push(bakeGlow(double({ width: frame.width, height: frame.height, data: frame.data }), ENEMY_FIRE_GLOW));
    }
  }
  const frameWidth = frames[0]?.width ?? 1;
  const frameHeight = frames[0]?.height ?? 1;
  const canvas = document.createElement('canvas');
  canvas.width = frameWidth * frames.length;
  canvas.height = frameHeight;
  const writer = canvas.getContext('2d');
  frames.forEach((f, i) => {
    writer?.putImageData(new ImageData(new Uint8ClampedArray(f.data), f.width, f.height), i * frameWidth, 0);
  });

  return { canvas, frameWidth, frameHeight };
}

/** Loads every sprite sheet and creates its animation, then starts the sandbox. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    for (const sheet of sheets()) {
      this.load.spritesheet(sheet.key, sheet.url, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      });
    }
    for (const sound of effectFiles()) {
      this.load.audio(sound.key, sound.urls);
    }
  }

  /** Bakes a glowing copy of every enemy bullet sheet, once, in place of a glow filter every frame (#143). */
  private bakeEnemyFireGlow(): void {
    for (const sheet of glowSheets()) {
      const { canvas, frameWidth, frameHeight } = bakeSheet(this.textures.get(sheet.key).getSourceImage() as CanvasImageSource, sheet);
      const texture = this.textures.addCanvas(sheet.glowKey, canvas);
      if (texture === null) {
        continue;
      }
      for (let i = 0; i < sheet.frames; i++) {
        texture.add(i, 0, i * frameWidth, 0, frameWidth, frameHeight);
      }
      this.anims.create({
        key: sheet.glowKey,
        frames: this.anims.generateFrameNumbers(sheet.glowKey, { start: 0, end: sheet.frames - 1 }),
        frameRate: sheet.fps,
        repeat: -1,
      });
    }
  }

  create(): void {
    for (const sheet of sheets()) {
      if (sheet.fps > 0) {
        this.anims.create({
          key: sheet.key,
          frames: this.anims.generateFrameNumbers(sheet.key, { start: 0, end: sheet.frames - 1 }),
          frameRate: sheet.fps,
          repeat: sheet.loop ? -1 : 0,
        });
      }
    }
    this.bakeEnemyFireGlow();
    this.scene.start('sandbox');
  }
}
