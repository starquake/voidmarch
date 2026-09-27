// src/main.ts
import Phaser from "./vendor/phaser.js";

// src/debug.ts
function publishDebugState(state) {
  window.voidmarch = state;
}

// src/sim/zoom.ts
var MIN_ZOOM = 2;
function integerZoom(viewportWidth, viewportHeight, targetWidth, targetHeight) {
  const fit = Math.floor(Math.min(viewportWidth / targetWidth, viewportHeight / targetHeight));
  return Math.max(MIN_ZOOM, fit);
}

// src/main.ts
var VIEW_WIDTH = 640;
var VIEW_HEIGHT = 360;
var TitleScene = class extends Phaser.Scene {
  constructor() {
    super("title");
  }
  create() {
    const zoom = integerZoom(this.scale.width, this.scale.height, VIEW_WIDTH, VIEW_HEIGHT);
    this.add.text(this.scale.width / 2, this.scale.height / 2, "VOIDMARCH", {
      fontFamily: "monospace",
      fontSize: `${8 * zoom}px`,
      color: "#d8f8ff"
    }).setOrigin(0.5);
    publishDebugState({ ready: true, scene: this.scene.key });
  }
};
new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#05030a",
  pixelArt: true,
  banner: false,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: "100%",
    height: "100%"
  },
  scene: [TitleScene]
});
