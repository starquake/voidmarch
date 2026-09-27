import Phaser from 'phaser';

import { askName } from './name.ts';
import { BootScene } from './scenes/boot.ts';
import { SandboxScene } from './scenes/sandbox.ts';
import { loadToken, saveToken } from './settings.ts';

/** Asks for a name on the first visit, then starts the game with the player's token. */
async function start(): Promise<void> {
  let token = loadToken();
  if (token === undefined) {
    token = await askName();
    if (token !== undefined) {
      saveToken(token);
    }
  }

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#05030a',
    pixelArt: true,
    roundPixels: true,
    banner: false,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    scene: [BootScene, SandboxScene],
    callbacks: {
      // The registry carries the token even where the browser refuses storage.
      preBoot: (game) => {
        game.registry.set('token', token);
      },
    },
  });
}

void start();
