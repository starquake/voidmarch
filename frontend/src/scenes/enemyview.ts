import Phaser from 'phaser';

import { keys } from '../sprites.ts';
import type { EnemyKind } from '../sim/enemies.ts';
import { SPRITE_FACING, type ShipParent } from './shipview.ts';

/** How long a hit flashes an enemy white. */
const FLASH_MS = 70;

/** A Kla'ed enemy drawn from its pack parts: engine, base, weapon; then its destruction. */
export class EnemyView {
  readonly kind: EnemyKind;
  private readonly root: Phaser.GameObjects.Container;
  private readonly base: Phaser.GameObjects.Image;
  private readonly weapon: Phaser.GameObjects.Sprite;
  /** The shield bubble, for the kinds that have one (#89). */
  private readonly shield: Phaser.GameObjects.Sprite | undefined;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, parent: ShipParent, kind: EnemyKind) {
    this.scene = scene;
    this.kind = kind;
    const engine = scene.add.sprite(0, 0, keys.enemyEngine(kind)).play(keys.enemyEngine(kind));
    this.base = scene.add.image(0, 0, keys.enemyBase(kind));
    this.weapon = scene.add.sprite(0, 0, keys.enemyWeapons(kind), 0);
    this.weapon.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.weapon.setFrame(0);
    });
    const parts: Phaser.GameObjects.GameObject[] = [engine, this.base, this.weapon];
    if (scene.textures.exists(keys.enemyShield(kind))) {
      this.shield = scene.add.sprite(0, 0, keys.enemyShield(kind)).play(keys.enemyShield(kind)).setVisible(false);
      parts.push(this.shield);
    }
    this.root = scene.add.container(0, 0, parts);
    parent.add(this.root);
  }

  get x(): number {
    return this.root.x;
  }

  get y(): number {
    return this.root.y;
  }

  place(x: number, y: number, angle: number): void {
    this.root.setPosition(x, y).setRotation(angle + SPRITE_FACING);
  }

  /** Shows the shield bubble while the shield holds a charge. */
  setShield(up: boolean): void {
    this.shield?.setVisible(up);
  }

  /** Whether the shield bubble shows, for the E2E tests. */
  get shieldShown(): boolean {
    return this.shield?.visible ?? false;
  }

  /** Plays the weapon animation: the telegraph before a volley leaves. */
  warn(): void {
    this.weapon.play(keys.enemyWeapons(this.kind));
  }

  /** A short white flash where a shot landed. */
  flash(): void {
    this.base.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(FLASH_MS, () => {
      this.base.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    });
  }

  /** Plays the pack's destruction animation in place of the ship, then goes. */
  destroy(explode: boolean): void {
    if (!explode) {
      this.root.destroy();

      return;
    }
    const boom = this.scene.add
      .sprite(this.root.x, this.root.y, keys.enemyDestruction(this.kind))
      .setRotation(this.root.rotation);
    this.root.parentContainer.add(boom);
    this.root.destroy();
    boom.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      boom.destroy();
    });
    boom.play(keys.enemyDestruction(this.kind));
  }
}
