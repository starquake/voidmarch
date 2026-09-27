import Phaser from 'phaser';

import { keys } from '../sprites.ts';
import { DAMAGE_STATES, type Loadout } from '../sim/loadout.ts';

/** Sprites face up; Phaser's rotation 0 faces right. */
export const SPRITE_FACING = Math.PI / 2;

/** What ships and their names are added to. */
export type ShipParent = Phaser.GameObjects.Layer | Phaser.GameObjects.Container;

/** Where a name sits below the ship's centre, in art pixels. */
const LABEL_OFFSET = 26;

/**
 * A Main Ship drawn from its parts, engine to shield, with an optional name
 * underneath. The local ship and every remote one use it.
 */
export class ShipView {
  readonly root: Phaser.GameObjects.Container;
  readonly weapon: Phaser.GameObjects.Sprite;
  private readonly engine: Phaser.GameObjects.Image;
  private readonly flame: Phaser.GameObjects.Sprite;
  private readonly hull: Phaser.GameObjects.Image;
  private readonly shield: Phaser.GameObjects.Sprite;
  private label: Phaser.GameObjects.Text | undefined;
  private loadout: Loadout | undefined;
  private thrusting = false;

  constructor(scene: Phaser.Scene, layer: ShipParent, x: number, y: number) {
    this.engine = scene.add.image(0, 0, keys.engine('base'));
    this.flame = scene.add.sprite(0, 0, keys.flameIdle('base'));
    this.hull = scene.add.image(0, 0, keys.hull('fullHealth'));
    this.weapon = scene.add.sprite(0, 0, keys.weapon('autoCannon'), 0);
    this.shield = scene.add.sprite(0, 0, keys.shield('front'));
    this.root = scene.add.container(x, y, [this.engine, this.flame, this.hull, this.weapon, this.shield]);
    layer.add(this.root);
  }

  /** Shows a name under the ship in the player's colour (0xRRGGBB). */
  setLabel(scene: Phaser.Scene, layer: ShipParent, name: string, colour: number, resolution: number): void {
    this.label?.destroy();
    this.label = scene.add
      .text(this.root.x, this.root.y + LABEL_OFFSET, name, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: `#${colour.toString(16).padStart(6, '0')}`,
        resolution,
      })
      .setOrigin(0.5, 0)
      .setShadow(1, 1, '#000000', 0);
    layer.add(this.label);
  }

  /** Fits the parts; unchanged parts keep their animation running. */
  setLoadout(loadout: Loadout): void {
    const old = this.loadout;
    if (old?.engine !== loadout.engine) {
      this.engine.setTexture(keys.engine(loadout.engine));
      this.flame.play(this.thrusting ? keys.flamePowering(loadout.engine) : keys.flameIdle(loadout.engine));
    }
    if (old?.weapon !== loadout.weapon) {
      this.weapon.setTexture(keys.weapon(loadout.weapon), 0);
    }
    if (old?.shield !== loadout.shield) {
      this.shield.play(keys.shield(loadout.shield));
    }
    this.loadout = { ...loadout };
  }

  setDamage(damage: number): void {
    const state = DAMAGE_STATES[Math.min(Math.max(0, damage), DAMAGE_STATES.length - 1)] ?? 'fullHealth';
    this.hull.setTexture(keys.hull(state));
  }

  setThrusting(thrusting: boolean): void {
    this.thrusting = thrusting;
    const engine = this.loadout?.engine ?? 'base';
    this.flame.play(thrusting ? keys.flamePowering(engine) : keys.flameIdle(engine), true);
  }

  /** Places the ship facing angle (0 is +x). */
  place(x: number, y: number, angle: number): void {
    this.root.setPosition(x, y).setRotation(angle + SPRITE_FACING);
    this.label?.setPosition(x, y + LABEL_OFFSET);
  }

  destroy(): void {
    this.root.destroy();
    this.label?.destroy();
  }
}
