import Phaser from 'phaser';

/** A DynamicTexture, and the WebGL textures it holds: 0 on a canvas. */
export interface Made {
  texture: Phaser.Textures.DynamicTexture;
  glTextures: number;
}

/**
 * Adds a DynamicTexture and frees the full-size placeholder texture Phaser 4.2
 * makes for it: the DynamicTexture draws into its own instead, and never frees
 * the placeholder (#260).
 */
export function addDynamicTexture(textures: Phaser.Textures.TextureManager, key: string, width: number, height: number): Made | null {
  const renderer = textures.game.renderer;
  const before = new Set(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer ? renderer.glTextureWrappers : []);
  const texture = textures.addDynamicTexture(key, width, height);
  if (texture === null) {
    return null;
  }
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) {
    return { texture, glTextures: 0 };
  }
  const used = new Set([texture.drawingContext.texture, ...texture.source.map((source) => source.glTexture)]);
  for (const wrapper of renderer.glTextureWrappers.filter((made) => !before.has(made) && !used.has(made))) {
    renderer.deleteTexture(wrapper);
  }

  return { texture, glTextures: renderer.glTextureWrappers.filter((wrapper) => !before.has(wrapper)).length };
}
