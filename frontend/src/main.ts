import Phaser from 'phaser';

import { deviceSize } from './display.ts';
import { askName } from './name.ts';
import { BootScene } from './scenes/boot.ts';
import { SandboxScene } from './scenes/sandbox.ts';
import { loadToken, saveToken } from './settings.ts';
import { loadSim } from './simwasm.ts';

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
  await loadSim('/static/wasm/sim.wasm');

  const size = deviceSize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
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
    callbacks: {
      // The registry carries the token even where the browser refuses storage.
      preBoot: (game) => {
        game.registry.set('token', token);
      },
    },
  });
  fitToWindow(game);
}

/** Keeps the canvas matched to the window's device pixels, also across screens. */
function fitToWindow(game: Phaser.Game): void {
  const fit = (): void => {
    const size = deviceSize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
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
