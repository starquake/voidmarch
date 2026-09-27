import Phaser from 'phaser';

import { BootScene } from './scenes/boot.ts';
import { SandboxScene } from './scenes/sandbox.ts';

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
});
