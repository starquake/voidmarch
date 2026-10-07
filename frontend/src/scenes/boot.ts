import Phaser from 'phaser';

import { bakeGlow, double, type Pixels } from '../glow.ts';
import { pieceFrames, type LayerLayout } from '../layers.ts';
import { bootFiles, bootKeys } from '../preload.ts';
import { glowSheets, keys, layerSheets, sheets, type GlowSheet } from '../sprites.ts';
import { drawLayer } from './starlayer.ts';
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

/** What the boot scene needs from the page (#227). */
export interface BootOptions {
  /** A file's key and the fraction of it in so far, while it downloads. */
  loading: (key: string, fraction: number) => void;
  /** Each file's key once it has arrived, or failed. */
  loaded: (key: string) => void;
  /** Resolves with the player's token, or undefined to play alone, once the rules, the fonts and the name are in. */
  go: Promise<string | undefined>;
  /** The game scene, made once go resolves, since it needs the rules from its construction. */
  game: () => Phaser.Scene;
}

/** Loads every sprite sheet and creates its animation, then starts the game scene. */
export class BootScene extends Phaser.Scene {
  private readonly options: BootOptions;

  constructor(options: BootOptions) {
    super('boot');
    this.options = options;
  }

  preload(): void {
    const loaded = (file: Phaser.Loader.File): void => {
      this.options.loaded(file.key);
    };
    // Only where the response gives its length; a compressed one counts its transferred bytes against it.
    this.load.on(Phaser.Loader.Events.FILE_PROGRESS, (file: Phaser.Loader.File, fraction: number) => {
      this.options.loading(file.key, fraction);
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD, loaded);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, loaded);
    // The loader skips a file it can't use, such as a sound where the browser has no audio.
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      for (const key of bootKeys()) {
        this.options.loaded(key);
      }
    });
    const files = bootFiles();
    for (const sheet of files.sheets) {
      this.load.spritesheet(sheet.key, sheet.url, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
        // A grid's last row can have empty cells.
        endFrame: sheet.frames - 1,
      });
    }
    for (const layer of layerSheets()) {
      this.load.image(layer.key, layer.url);
      this.load.json(keys.layerLayout(layer.key), layer.layoutUrl);
    }
    for (const sound of files.sounds) {
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

  /** Names each stars layer's pieces in its sheet, and makes the texture its frames are drawn into (#222). */
  private cutLayers(): void {
    for (const layer of layerSheets()) {
      const layout = this.cache.json.get(keys.layerLayout(layer.key)) as LayerLayout;
      const sheet = this.textures.get(layer.key);
      for (const frame of pieceFrames(layout)) {
        sheet.add(frame.name, 0, frame.x, frame.y, frame.width, frame.height);
      }
      const texture = this.textures.addDynamicTexture(keys.layerFrame(layer.key), layout.width, layout.height);
      if (texture !== null) {
        drawLayer(texture, layer.key, layout, 0);
      }
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
    this.cutLayers();
    void this.options.go.then((token) => {
      // The registry carries the token even where the browser refuses storage.
      this.registry.set('token', token);
      this.scene.add('sandbox', this.options.game(), true);
      this.scene.stop();
    });
  }
}
