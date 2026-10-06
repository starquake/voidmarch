import type Phaser from 'phaser';

import { stamps, type LayerLayout } from '../layers.ts';

/** Draws a stars layer's animation frame from its pieces (#222) into the texture its TileSprite tiles. */
export function drawLayer(texture: Phaser.Textures.DynamicTexture, sheet: string, layout: LayerLayout, frame: number): void {
  texture.clear();
  for (const stamp of stamps(layout, frame)) {
    texture.stamp(sheet, stamp.name, stamp.x, stamp.y, { originX: 0, originY: 0 });
  }
  texture.render();
}
