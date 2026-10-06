import Phaser from 'phaser';

import { deviceSize, renderRatio } from './display.ts';
import type { FrontDoor } from './frontdoor.ts';
import type { IntroScreen } from './introscreen.ts';
import { bootKeys } from './preload.ts';
import { BootScene } from './scenes/boot.ts';
import { SandboxScene } from './scenes/sandbox.ts';
import { loadDisplaySettings } from './settings.ts';
import { loadSim } from './simwasm.ts';
import { FPS_CAP, HEADING_FONT_NAME, UI_FONT_NAME } from './sim/tuning.ts';

/** The rules' and the fonts' keys on the loading strip, beside the boot scene's files. */
const RULES_KEY = 'rules';
const FONTS = [UI_FONT_NAME, HEADING_FONT_NAME];
const fontKey = (name: string): string => `font-${name}`;

/** What the entry module (entry.ts) hands over once the game's code is in. */
export interface Handover {
  /** The screens before the game, already showing. */
  door: FrontDoor;
  intro: IntroScreen;
  /** Resolves with the player's token, or undefined to play alone, once past the name screen. */
  token: Promise<string | undefined>;
}

/**
 * Starts loading behind the screens the entry module shows (#227): the rules,
 * the fonts and the boot scene's files download while the player types a
 * name, and the game starts once all of them and the name are in.
 */
export function start({ door, intro, token }: Handover): void {
  door.count([RULES_KEY, ...FONTS.map(fontKey), ...bootKeys()]);

  // The rules run in WebAssembly (internal/sim); the game scene needs them from its construction.
  // Phaser draws a text into its canvas once, so the fonts have to be loaded before the first one (#170);
  // if one fails, its text falls back to sans-serif.
  const assets = Promise.all([
    loadSim('/static/wasm/sim.wasm').then(() => {
      door.loaded(RULES_KEY);
    }),
    ...FONTS.map(async (name) => {
      await document.fonts.load(`16px '${name}'`).catch(() => []);
      door.loaded(fontKey(name));
    }),
  ]);
  const display = loadDisplaySettings();
  const size = deviceSize(window.innerWidth, window.innerHeight, renderRatio(window.devicePixelRatio, display.cssPixels));
  const boot = new BootScene({
    loaded: (key) => {
      door.loaded(key);
    },
    go: Promise.all([assets, token]).then(([, t]) => t),
    game: () =>
      new SandboxScene({
        intro,
        ready: () => {
          door.start();
        },
      }),
  });
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
    scene: [boot],
    // V caps it at 60 (#143); 0 follows the display.
    fps: { limit: display.fpsCap ? FPS_CAP : 0 },
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
