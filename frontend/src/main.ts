import Phaser from 'phaser';

import { publishDebugState } from './debug.ts';
import { integerZoom } from './sim/zoom.ts';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 360;

class TitleScene extends Phaser.Scene {
  constructor() {
    super('title');
  }

  create(): void {
    const zoom = integerZoom(this.scale.width, this.scale.height, VIEW_WIDTH, VIEW_HEIGHT);
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'VOIDMARCH', {
        fontFamily: 'monospace',
        fontSize: `${8 * zoom}px`,
        color: '#d8f8ff',
      })
      .setOrigin(0.5);

    publishDebugState({ ready: true, scene: this.scene.key });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#05030a',
  pixelArt: true,
  banner: false,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  scene: [TitleScene],
});
