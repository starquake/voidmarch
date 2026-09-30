import Phaser from 'phaser';

import { keys } from '../sprites.ts';
import { tierColor, tierFromPickup, type PartId, type Unlocks } from '../sim/parts.ts';
import {
  PICKUP_BLINK_AFTER,
  PICKUP_GLOW_DISTANCE,
  PICKUP_GLOW_QUALITY,
  PICKUP_GLOW_STRENGTH,
  PICKUP_USELESS_ALPHA,
} from '../sim/tuning.ts';

/** A part on the ground, as the server dropped it; ticks are the server's. */
export interface Pickup {
  id: number;
  part: PartId;
  x: number;
  y: number;
  tick: number;
  goneTick: number;
}

interface Drawn {
  pickup: Pickup;
  sprite: Phaser.GameObjects.Sprite;
  blinking: boolean;
}

/**
 * The pickups on the ground (#77): the Pickups Pack's icon, glowing in the
 * tier it would give this player, still until it starts to blink, and gone
 * when its time is up.
 */
export class PickupsView {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Layer;
  private readonly drawn = new Map<number, Drawn>();

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    this.scene = scene;
    this.layer = layer;
  }

  /** Puts a pickup down, drawn for this player's unlocks. */
  add(pickup: Pickup, unlocks: Unlocks): void {
    this.remove(pickup.id);
    const sprite = this.scene.add.sprite(pickup.x, pickup.y, keys.pickup(pickup.part), 0);
    this.layer.add(sprite);
    const drawn = { pickup, sprite, blinking: false };
    this.drawn.set(pickup.id, drawn);
    this.grade(drawn, unlocks);
  }

  remove(id: number): void {
    this.drawn.get(id)?.sprite.destroy();
    this.drawn.delete(id);
  }

  clear(): void {
    for (const id of [...this.drawn.keys()]) {
      this.remove(id);
    }
  }

  /** Redraws every pickup's glow, after this player's unlocks changed. */
  regrade(unlocks: Unlocks): void {
    for (const drawn of this.drawn.values()) {
      this.grade(drawn, unlocks);
    }
  }

  /** Blinks the pickups near their end and removes the ones whose time is up, at the server tick. */
  update(tick: number, tickRate: number): void {
    for (const [id, d] of this.drawn) {
      if (tick >= d.pickup.goneTick) {
        this.remove(id);
      } else if (!d.blinking && tick >= d.pickup.tick + PICKUP_BLINK_AFTER * tickRate) {
        d.blinking = true;
        d.sprite.play(keys.pickup(d.pickup.part));
      }
    }
  }

  /** The pickups within reach of (x, y). */
  near(x: number, y: number, reach: number): Pickup[] {
    return [...this.drawn.values()]
      .map((d) => d.pickup)
      .filter((p) => Math.hypot(p.x - x, p.y - y) <= reach);
  }

  /** The pickups on the ground, for the E2E tests. */
  get items(): Pickup[] {
    return [...this.drawn.values()].map((d) => d.pickup);
  }

  private grade(drawn: Drawn, unlocks: Unlocks): void {
    const { sprite } = drawn;
    const tier = tierFromPickup(unlocks, drawn.pickup.part);
    sprite.setAlpha(tier === undefined ? PICKUP_USELESS_ALPHA : 1);
    sprite.filters?.internal.clear();
    const color = tier === undefined ? undefined : tierColor(tier);
    if (color === undefined) {
      return;
    }
    sprite.enableFilters();
    sprite.filters?.internal.addGlow(color, PICKUP_GLOW_STRENGTH, 0, 1, false, PICKUP_GLOW_QUALITY, PICKUP_GLOW_DISTANCE);
  }
}
