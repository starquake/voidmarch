import Phaser from 'phaser';

import { deviceSize, renderRatio } from './display.ts';
import { askName } from './name.ts';
import { BootScene } from './scenes/boot.ts';
import { SandboxScene } from './scenes/sandbox.ts';
import { loadDisplaySettings, loadToken, saveToken } from './settings.ts';
import { loadSim } from './simwasm.ts';
import { FONT_NAME, FPS_CAP } from './sim/tuning.ts';

/** Asks for a name on the first visit, then starts the game with the player's token. */
async function start(): Promise<void> {
  let token = loadToken();
  if (token === undefined) {
    token = await askName();
    if (token !== undefined) {
      saveToken(token);
    }
  }

  // The rules run in WebAssembly (internal/sim); the scenes need them from their first frame.
  // Phaser draws a text into its canvas once, so the font has to be loaded before the first one (#170);
  // if it fails, the text falls back to monospace.
  await Promise.all([
    loadSim('/static/wasm/sim.wasm'),
    document.fonts.load(`16px ${FONT_NAME}`).catch(() => []),
  ]);

  const display = loadDisplaySettings();
  const size = deviceSize(window.innerWidth, window.innerHeight, renderRatio(window.devicePixelRatio, display.cssPixels));
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#05030a',
    pixelArt: true,
    roundPixels: true,
    banner: false,
    // Sized in device pixels and shown at CSS size, so pixel art stays even
    // at any display scaling (see display.ts).
    scale: {
      mode: Phaser.Scale.NONE,
      width: size.width,
      height: size.height,
      zoom: size.zoom,
    },
    scene: [BootScene, SandboxScene],
    // V caps it at 60 (#143); 0 follows the display.
    fps: { limit: display.fpsCap ? FPS_CAP : 0 },
    callbacks: {
      // The registry carries the token even where the browser refuses storage.
      preBoot: (game) => {
        game.registry.set('token', token);
      },
    },
  });
  fitToWindow(game);
}

/** Keeps the canvas matched to the window's device pixels, also across screens and when P changes the render resolution. */
function fitToWindow(game: Phaser.Game): void {
  const fit = (): void => {
    const size = deviceSize(window.innerWidth, window.innerHeight, renderRatio(window.devicePixelRatio, loadDisplaySettings().cssPixels));
    game.scale.setZoom(size.zoom);
    game.scale.resize(size.width, size.height);
  };
  window.addEventListener('resize', fit);

  // Moving to a screen with other scaling changes the ratio, not always the size.
  const watchRatio = (): void => {
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        fit();
        watchRatio();
      },
      { once: true },
    );
  };
  watchRatio();
}

void start();
