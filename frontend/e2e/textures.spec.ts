import type Phaser from 'phaser';

import { expect, test } from './fixtures.ts';

/** A page with only the game's Phaser on it, as window.phaser. */
const PHASER_ONLY = `<!doctype html><title>Phaser</title><script type="module">
import Phaser from '/static/js/vendor/phaser.js';
window.phaser = Phaser;
</script>`;

/**
 * Phaser 4.2 makes two WebGL textures per DynamicTexture and keeps one (#260),
 * so the game frees the other. When this fails after a Phaser bump, Phaser
 * stopped making it: drop the workaround in `addDynamicTexture`.
 */
test('Phaser makes a WebGL texture per DynamicTexture it never uses (#260)', async ({ page }) => {
  await page.route('**/phaser-only', (route) => route.fulfill({ contentType: 'text/html', body: PHASER_ONLY }));
  await page.goto('/phaser-only');
  await page.waitForFunction(() => 'phaser' in window);

  const made = await page.evaluate(
    () =>
      new Promise<{ created: number; deleted: number; held: number }>((resolve) => {
        const phaser = (window as unknown as { phaser: typeof Phaser }).phaser;
        const game = new phaser.Game({
          type: phaser.WEBGL,
          width: 64,
          height: 64,
          banner: false,
          scene: {
            create(this: Phaser.Scene) {
              const gl = (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl;
              const count = { created: 0, deleted: 0 };
              const createTexture = gl.createTexture.bind(gl);
              const deleteTexture = gl.deleteTexture.bind(gl);
              gl.createTexture = () => {
                count.created++;
                return createTexture();
              };
              gl.deleteTexture = (texture) => {
                count.deleted++;
                deleteTexture(texture);
              };
              const texture = this.textures.addDynamicTexture('layer', 640, 360);
              const held = new Set([texture?.drawingContext.texture?.webGLTexture, ...(texture?.source ?? []).map((source) => source.glTexture?.webGLTexture)]);
              resolve({ ...count, held: held.size });
              game.destroy(true);
            },
          },
        });
      }),
  );

  expect(made).toEqual({ created: 2, deleted: 0, held: 1 });
});

test('each stars layer holds one WebGL texture (#260)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');

  expect(await page.evaluate(() => window.voidmarch?.layerTextures)).toEqual([1, 1]);
});
