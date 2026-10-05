import Phaser from 'phaser';

import { keys } from '../sprites.ts';
import type { EnemyFaction, EnemyKind } from '../sim/enemies.ts';
import { BOMBER_WARN_TINT } from '../sim/tuning.ts';
import { SPRITE_FACING, type ShipParent } from './shipview.ts';

/** How long a hit flashes an enemy white. */
const FLASH_MS = 70;

/** An enemy drawn from its faction's pack parts: engine, base, weapon; then its destruction. */
export class EnemyView {
  readonly kind: EnemyKind;
  readonly faction: EnemyFaction;
  private readonly root: Phaser.GameObjects.Container;
  private readonly base: Phaser.GameObjects.Image;
  /** The weapons, for the kinds whose pack draws them; a Bomber has none (#137), nor a Support Ship (#184). */
  private readonly weapon: Phaser.GameObjects.Sprite | undefined;
  /** The shield bubble, for the kinds whose pack draws one: a boss's (#89), a small ship's for its repairs (#188). */
  private readonly shield: Phaser.GameObjects.Sprite | undefined;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, parent: ShipParent, kind: EnemyKind, faction: EnemyFaction) {
    this.scene = scene;
    this.kind = kind;
    this.faction = faction;
    const engine = scene.add.sprite(0, 0, keys.enemyEngine(faction, kind)).play(keys.enemyEngine(faction, kind));
    this.base = scene.add.image(0, 0, keys.enemyBase(faction, kind));
    const parts: Phaser.GameObjects.GameObject[] = [engine, this.base];
    if (scene.textures.exists(keys.enemyWeapons(faction, kind))) {
      const weapon = scene.add.sprite(0, 0, keys.enemyWeapons(faction, kind), 0);
      weapon.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        weapon.setFrame(0);
      });
      this.weapon = weapon;
      parts.push(weapon);
    }
    if (scene.textures.exists(keys.enemyShield(faction, kind))) {
      this.shield = scene.add.sprite(0, 0, keys.enemyShield(faction, kind)).play(keys.enemyShield(faction, kind)).setVisible(false);
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

  /** Shows or hides the shield bubble: a boss's while it holds a charge, a small ship's while it's repaired. */
  setShield(up: boolean): void {
    this.shield?.setVisible(up);
  }

  /** Whether the shield bubble shows, for the E2E tests. */
  get shieldShown(): boolean {
    return this.shield?.visible ?? false;
  }

  /** The telegraph before a volley leaves in ms: the weapon animation, or without weapons a blue glow for that long. */
  warn(ms: number): void {
    if (this.weapon !== undefined) {
      this.weapon.play(keys.enemyWeapons(this.faction, this.kind));

      return;
    }
    this.base.setTint(BOMBER_WARN_TINT).setTintMode(Phaser.TintModes.ADD);
    this.scene.time.delayedCall(ms, () => {
      this.base.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    });
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
      .sprite(this.root.x, this.root.y, keys.enemyDestruction(this.faction, this.kind))
      .setRotation(this.root.rotation);
    this.root.parentContainer.add(boom);
    this.root.destroy();
    boom.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      boom.destroy();
    });
    boom.play(keys.enemyDestruction(this.faction, this.kind));
  }
}
