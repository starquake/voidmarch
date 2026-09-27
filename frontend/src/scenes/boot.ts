import Phaser from 'phaser';

import { effectFiles } from '../sounds.ts';
import { sheets } from '../sprites.ts';

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
    this.scene.start('sandbox');
  }
}
