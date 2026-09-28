import Phaser from 'phaser';

import { publishDebugState, type DebugState } from '../debug.ts';
import { wireFormatFrom } from '../net/codec.ts';
import { ORDER_ITEMS, applyOrder, describeOrders, itemPosition, pickItem, type OrderItem } from '../ordermenu.ts';
import {
  clearToken,
  loadAudioSettings,
  loadControlMode,
  loadToken,
  saveAudioSettings,
  saveControlMode,
  type AudioSettings,
} from '../settings.ts';
import { keys, weaponTiming } from '../sprites.ts';
import { CONTROL_MODES, type InputSnapshot } from '../sim/input.ts';
import { DAMAGE_STATES, ENGINES, SHIELDS, WEAPONS, nextInCycle, type DamageState } from '../sim/loadout.ts';
import { Sandbox, type FrameEvents } from '../sim/sandbox.ts';
import {
  ENEMY_FIRE_GLOW_COLOUR,
  ENEMY_FIRE_GLOW_DISTANCE,
  ENEMY_FIRE_GLOW_QUALITY,
  ENEMY_FIRE_GLOW_STRENGTH,
  ROTATION_SNAP_STEPS,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  WEAPON_STATS,
} from '../sim/tuning.ts';
import { isWeapon } from '../sim/projectiles.ts';
import { asteroidField } from '../sim/world.ts';
import { integerZoom } from '../sim/zoom.ts';
import { WeaponAnimator } from '../weaponframes.ts';
import { ShipAudio } from './audio.ts';
import { NetPlay, type NetFrame } from './netplay.ts';
import { SPRITE_FACING, ShipView } from './shipview.ts';

/** How far each background layer moves relative to the camera. */
const PARALLAX = [0.05, 0.15, 0.3] as const;
const BACKGROUND_FPS = 6;
const BACKGROUND_FRAMES = 9;
const CAMERA_LERP = 0.15;
/** Bloom's blur reach, in screen pixels at EFFECT_ZOOM. */
const BLOOM_BLUR = 3;
/**
 * Filters work in screen pixels, so their reach is scaled by zoom / EFFECT_ZOOM
 * to look the same on every screen size and display scaling. 2 is the zoom of
 * a 1280x720 window, where the effects were tuned.
 */
const EFFECT_ZOOM = 2;
const HUD_REFRESH_MS = 250;
/** Particles in a hit's spark. */
const HIT_SPARKS = 5;
/** HUD text size and margin in CSS pixels; scaled to device pixels on resize. */
const HUD_FONT_PX = 12;
const HUD_MARGIN_PX = 8;
/** Holding Q this long opens the order ring; a shorter tap repeats the last order. */
const ORDER_HOLD_MS = 200;
/** The order ring's height radius and its dead centre, in CSS pixels. */
const ORDER_RING_PX = 110;
const ORDER_DEAD_ZONE_PX = 24;
/** A companion or enemy this close to the pointer, in art pixels, is the one under it. */
const ORDER_PICK_RADIUS = 30;
const ORDER_TEXT = '#d8f8ff';
const ORDER_PICKED_TEXT = '#ffe08a';

/** Q held down: where the pointer was, and which companion it was on, if any. */
interface OrderPress {
  downAt: number;
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  companion: number | undefined;
  labels: Phaser.GameObjects.Text[] | undefined;
}

/** The item nearest (x, y), if any is within radius. */
function nearestWithin<T extends { x: number; y: number }>(items: readonly T[], x: number, y: number, radius: number): T | undefined {
  let best: T | undefined;
  let bestDistance = radius;
  for (const item of items) {
    const d = Math.hypot(item.x - x, item.y - y);
    if (d <= bestDistance) {
      best = item;
      bestDistance = d;
    }
  }

  return best;
}

interface Background {
  sprite: Phaser.GameObjects.TileSprite;
  factor: number;
}

/** The single-player sandbox: fly, aim and shoot around the home planet. */
export class SandboxScene extends Phaser.Scene {
  private readonly sim = new Sandbox();
  private world!: Phaser.GameObjects.Layer;
  private backgrounds: Background[] = [];
  private backgroundFrame = 0;
  private ships!: Phaser.GameObjects.Container;
  private ship!: ShipView;
  private net: NetPlay | undefined;
  private projectileSprites: Phaser.GameObjects.Sprite[] = [];
  /** Enemy bullets fly on their own layer, which glows as a whole: one filter, not one per bullet. */
  private enemyFire!: Phaser.GameObjects.Layer;
  private enemyFireGlow: Phaser.Filters.Glow | undefined;
  private muzzleFlash!: Phaser.GameObjects.Particles.ParticleEmitter;
  private puff!: Phaser.GameObjects.Particles.ParticleEmitter;
  private bloom: Phaser.Filters.ParallelFilters | undefined;
  private bloomBlur: Phaser.Filters.Blur | undefined;
  private vignette: Phaser.Filters.Vignette | undefined;
  private hudCamera!: Phaser.Cameras.Scene2D.Camera;
  private hud!: Phaser.GameObjects.Text;
  private moveKeys!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private damage: DamageState = 'fullHealth';
  private effects = true;
  private shotsFired = 0;
  private hudUpdatedAt = 0;
  private debug!: DebugState;
  private weaponFrames = new WeaponAnimator(weaponTiming('autoCannon'));
  private audioSettings!: AudioSettings;
  private audio!: ShipAudio;
  private orderPress: OrderPress | undefined;
  private lastOrder: OrderItem | undefined;

  constructor() {
    super('sandbox');
  }

  create(): void {
    this.sim.controlMode = loadControlMode();
    this.audioSettings = loadAudioSettings();
    this.audio = new ShipAudio(this, this.audioSettings);
    this.world = this.add.layer();
    this.createBackgrounds();
    this.createScenery();
    this.ships = this.add.container(0, 0);
    this.world.add(this.ships);
    this.ship = new ShipView(this, this.ships, this.sim.ship.x, this.sim.ship.y);
    this.createProjectiles();
    this.createParticles();
    this.createCameras();
    this.createInput();
    this.applyLoadout();
    this.resize();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      this.resize();
    });
    this.startNetPlay();

    this.debug = {
      ready: true,
      scene: this.scene.key,
      ship: { x: 0, y: 0, angle: 0, thrusting: false },
      loadout: this.sim.ship.loadout,
      damage: this.damage,
      rotationSnap: 0,
      controlMode: this.sim.controlMode,
      effects: this.effects,
      projectiles: 0,
      shotsFired: 0,
      zoom: 1,
      fps: 0,
      weaponFrame: 0,
      audio: { muted: false, music: false, locked: true, backend: 'none', musicLoaded: false, playingMusic: null },
      net: { status: 'offline', playerId: undefined, others: [] },
      enemies: [],
      enemiesDestroyed: 0,
      lastEnemyDestroyed: undefined,
      enemyFireGlow: false,
      hitsTaken: 0,
      companions: [],
      companionKills: 0,
      notice: undefined,
      orderMenuOpen: false,
    };
    this.publish();
  }

  override update(time: number, deltaMs: number): void {
    const events = this.sim.advance(deltaMs / 1000, this.readInput(), this.net?.brainEnemies ?? []);
    const net = this.net?.update(events);
    this.drawShip(events);
    if (net !== undefined) {
      this.showHits(net);
    }
    this.drawProjectiles();
    this.updateOrderMenu(time);
    this.playEffects(events);
    this.audio.update(this.sim.ship, events);
    this.scrollBackgrounds(time);
    if (time - this.hudUpdatedAt > HUD_REFRESH_MS) {
      this.hudUpdatedAt = time;
      this.updateHud();
    }
    this.publish();
  }

  private createBackgrounds(): void {
    this.backgrounds = keys.background.map((key, i) => {
      const sprite = this.add.tileSprite(0, 0, VIEW_WIDTH, VIEW_HEIGHT, key, 0).setScrollFactor(0);
      this.world.add(sprite);

      return { sprite, factor: PARALLAX[i] ?? 0 };
    });
  }

  private createScenery(): void {
    for (const rock of asteroidField()) {
      this.world.add(this.add.image(rock.x, rock.y, keys.asteroid).setRotation(rock.rotation).setFlipX(rock.flip));
    }
    this.world.add(this.add.sprite(0, 0, keys.planet).play(keys.planet));
  }

  /** Plays with others once the player has a name; without one it stays single-player. */
  private startNetPlay(): void {
    const token = (this.registry.get('token') as string | undefined) ?? loadToken();
    if (token === undefined) {
      return;
    }
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.net = new NetPlay({
      scene: this,
      ships: this.ships,
      sim: this.sim,
      audio: this.audio,
      url: `${scheme}://${window.location.host}/ws`,
      token,
      format: wireFormatFrom(window.location.search),
      labelResolution: () => this.cameras.main.zoom,
      onUnknownToken: () => {
        clearToken();
        window.location.reload();
      },
    });
    this.net.start();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.net?.stop());
  }

  private createProjectiles(): void {
    this.projectileSprites = this.sim.projectiles.items.map(() => {
      const sprite = this.add.sprite(0, 0, keys.projectile('autoCannon')).setVisible(false);
      this.world.add(sprite);

      return sprite;
    });
    this.enemyFire = this.add.layer();
    this.world.add(this.enemyFire);
    this.enemyFire.enableFilters();
    this.enemyFireGlow = this.enemyFire.filters?.internal.addGlow(
      ENEMY_FIRE_GLOW_COLOUR,
      ENEMY_FIRE_GLOW_STRENGTH,
      0,
      1,
      false,
      ENEMY_FIRE_GLOW_QUALITY,
      ENEMY_FIRE_GLOW_DISTANCE,
    );
  }

  private createParticles(): void {
    this.muzzleFlash = this.add.particles(0, 0, keys.projectile('bigSpaceGun'), {
      frame: [2, 3, 4],
      lifespan: 120,
      speed: { min: 10, max: 40 },
      scale: { start: 0.35, end: 0 },
      alpha: { start: 0.9, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.puff = this.add.particles(0, 0, keys.projectile('bigSpaceGun'), {
      frame: [6, 7, 8],
      lifespan: 260,
      speed: { min: 15, max: 60 },
      scale: { start: 0.4, end: 0 },
      alpha: { start: 0.8, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.world.add([this.muzzleFlash, this.puff]);
  }

  private createCameras(): void {
    const main = this.cameras.main;
    main.setBackgroundColor('#05030a');
    main.startFollow(this.ship.root, true, CAMERA_LERP, CAMERA_LERP);
    main.setRoundPixels(true);
    const bloom = Phaser.Actions.AddEffectBloom(main, { threshold: 0.55, blurRadius: BLOOM_BLUR, blendAmount: 0.6 })[0];
    this.bloom = bloom?.parallelFilters;
    this.bloomBlur = bloom?.blur;
    this.vignette = main.filters.external.addVignette(0.5, 0.5, 0.9, 0.35);

    this.hud = this.add
      .text(8, 8, '', { fontFamily: 'monospace', fontSize: '12px', color: '#d8f8ff' })
      .setShadow(1, 1, '#000000', 0);
    main.ignore(this.hud);
    this.hudCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.hudCamera.ignore(this.world);
  }

  private createInput(): void {
    const keyboard = this.input.keyboard;
    if (keyboard === null) {
      throw new Error('keyboard input is disabled');
    }
    const codes = Phaser.Input.Keyboard.KeyCodes;
    this.moveKeys = {
      up: keyboard.addKey(codes.W),
      down: keyboard.addKey(codes.S),
      left: keyboard.addKey(codes.A),
      right: keyboard.addKey(codes.D),
    };
    this.input.mouse?.disableContextMenu();

    // Toggles listen to the DOM directly: Phaser's keyboard plugin can replay
    // its queued events more than once per step, cycling a part twice.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return;
      }
      if (event.code === 'KeyQ') {
        this.pressOrders();
      } else {
        this.handleDebugKey(event.code);
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'KeyQ') {
        this.releaseOrders();
      }
    };
    // Letting go of Q in another window never reaches us: close the ring unused.
    const onBlur = (): void => {
      this.closeOrderRing();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });
  }

  private handleDebugKey(code: string): void {
    const ship = this.sim.ship;
    switch (code) {
      case 'Digit1':
        ship.loadout.weapon = nextInCycle(WEAPONS, ship.loadout.weapon);
        ship.cooldown = 0;
        ship.nextMuzzle = 0;
        this.applyLoadout();
        this.audio.partSwitched();
        break;
      case 'Digit2':
        ship.loadout.engine = nextInCycle(ENGINES, ship.loadout.engine);
        this.applyLoadout();
        this.audio.partSwitched();
        break;
      case 'Digit3':
        ship.loadout.shield = nextInCycle(SHIELDS, ship.loadout.shield);
        this.applyLoadout();
        this.audio.shieldSwitched();
        break;
      case 'KeyG':
        this.net?.summon();
        this.updateHud();
        break;
      case 'KeyM':
        this.audio.toggleMute();
        saveAudioSettings(this.audioSettings);
        this.updateHud();
        break;
      case 'KeyN':
        this.audio.toggleMusic();
        saveAudioSettings(this.audioSettings);
        this.updateHud();
        break;
      case 'KeyH':
        this.damage = nextInCycle(DAMAGE_STATES, this.damage);
        ship.damage = DAMAGE_STATES.indexOf(this.damage);
        this.ship.setDamage(ship.damage);
        break;
      case 'KeyC':
        this.sim.controlMode = nextInCycle(CONTROL_MODES, this.sim.controlMode);
        saveControlMode(this.sim.controlMode);
        this.updateHud();
        break;
      case 'KeyR':
        ship.rotationSnap = ship.rotationSnap === 0 ? ROTATION_SNAP_STEPS : 0;
        this.updateHud();
        break;
      case 'KeyF':
        this.effects = !this.effects;
        if (this.bloom !== undefined) {
          this.bloom.active = this.effects;
        }
        if (this.vignette !== undefined) {
          this.vignette.active = this.effects;
        }
        if (this.enemyFireGlow !== undefined) {
          this.enemyFireGlow.active = this.effects;
        }
        this.updateHud();
        break;
      default:
    }
  }

  /** Q down: remember where the pointer is, and the companion under it, if any. */
  private pressOrders(): void {
    this.closeOrderRing();
    const pointer = this.input.activePointer;
    const world = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    // Formation slots sit close together: the nearest one is the one meant.
    const under = nearestWithin(
      this.sim.companions.map((c) => ({ id: c.number, x: c.ship.x, y: c.ship.y })),
      world.x,
      world.y,
      ORDER_PICK_RADIUS,
    );
    this.orderPress = {
      downAt: this.time.now,
      screenX: pointer.x,
      screenY: pointer.y,
      worldX: world.x,
      worldY: world.y,
      companion: under?.id,
      labels: undefined,
    };
  }

  /** While Q is held: open the ring once held long enough, and light the item pointed at. */
  private updateOrderMenu(time: number): void {
    const press = this.orderPress;
    if (press === undefined || time - press.downAt < ORDER_HOLD_MS) {
      return;
    }
    const dpr = this.dpr();
    press.labels ??= ORDER_ITEMS.map((item, i) => {
      const at = itemPosition(i, ORDER_RING_PX * dpr);
      const label = this.add
        .text(press.screenX + at.x, press.screenY + at.y, item.label, {
          fontFamily: 'monospace',
          fontSize: `${String(HUD_FONT_PX * dpr)}px`,
          color: ORDER_TEXT,
        })
        .setOrigin(0.5)
        .setShadow(1, 1, '#000000', 0);
      this.cameras.main.ignore(label);

      return label;
    });
    const picked = this.pickedOrder(press);
    press.labels.forEach((label, i) => label.setColor(i === picked ? ORDER_PICKED_TEXT : ORDER_TEXT));
  }

  private pickedOrder(press: OrderPress): number | undefined {
    const pointer = this.input.activePointer;

    return pickItem(pointer.x - press.screenX, pointer.y - press.screenY, ORDER_DEAD_ZONE_PX * this.dpr());
  }

  /** Drops a Q press and its ring without giving an order. */
  private closeOrderRing(): void {
    for (const label of this.orderPress?.labels ?? []) {
      label.destroy();
    }
    this.orderPress = undefined;
  }

  /** Q up: give the item pointed at, or repeat the last order after a tap. */
  private releaseOrders(): void {
    const press = this.orderPress;
    this.orderPress = undefined;
    if (press === undefined) {
      return;
    }
    if (press.labels === undefined) {
      const world = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      if (this.lastOrder === undefined) {
        this.net?.say('no order to repeat yet: hold Q');
      } else {
        this.giveOrder(this.lastOrder, { ...press, worldX: world.x, worldY: world.y });
      }

      return;
    }
    const picked = this.pickedOrder(press);
    for (const label of press.labels) {
      label.destroy();
    }
    const item = picked === undefined ? undefined : ORDER_ITEMS[picked];
    if (item !== undefined) {
      this.giveOrder(item, press);
    }
  }

  /** Gives an order to the companion the pointer was on, or to all of them. */
  private giveOrder(item: OrderItem, press: Pick<OrderPress, 'worldX' | 'worldY' | 'companion'>): void {
    const targets =
      press.companion === undefined ? this.sim.companions : this.sim.companions.filter((c) => c.number === press.companion);
    if (targets.length === 0) {
      this.net?.say('no companions: press G at the home planet');

      return;
    }
    const focus = nearestWithin(this.net?.brainEnemies ?? [], press.worldX, press.worldY, ORDER_PICK_RADIUS);
    const context = { pointX: press.worldX, pointY: press.worldY, focusEnemyId: focus?.id };
    const next = targets.map((c) => applyOrder(item, c.orders, context));
    if (next.includes(undefined)) {
      this.net?.say('no enemy under the cursor to focus');

      return;
    }
    targets.forEach((c, i) => {
      c.orders = next[i] ?? c.orders;
    });
    this.lastOrder = item;
    this.net?.say(press.companion === undefined ? item.label : `${item.label} (companion ${String(press.companion)})`);
    this.updateHud();
  }

  private dpr(): number {
    return window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  }

  private applyLoadout(): void {
    const { weapon, engine } = this.sim.ship.loadout;
    this.ship.setLoadout(this.sim.ship.loadout);
    this.weaponFrames = new WeaponAnimator(weaponTiming(weapon));
    this.audio.setEngine(engine);
    this.updateHud();
  }

  private resize(): void {
    const { width, height } = this.scale;
    // width and height are device pixels (see display.ts), so the zoom makes
    // every art pixel a whole number of device pixels.
    const zoom = integerZoom(width, height, VIEW_WIDTH, VIEW_HEIGHT);
    this.cameras.main.setZoom(zoom);
    const effectScale = zoom / EFFECT_ZOOM;
    if (this.bloomBlur !== undefined) {
      this.bloomBlur.x = BLOOM_BLUR * effectScale;
      this.bloomBlur.y = BLOOM_BLUR * effectScale;
    }
    if (this.enemyFireGlow !== undefined) {
      this.enemyFireGlow.scale = effectScale;
    }
    this.hudCamera.setSize(width, height);
    const dpr = this.dpr();
    this.hud.setFontSize(HUD_FONT_PX * dpr).setPosition(HUD_MARGIN_PX * dpr, HUD_MARGIN_PX * dpr);
    for (const { sprite } of this.backgrounds) {
      sprite.setPosition(width / 2, height / 2).setSize(Math.ceil(width / zoom), Math.ceil(height / zoom));
    }
  }

  private readInput(): InputSnapshot {
    const pointer = this.input.activePointer;
    const aim = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;

    return {
      up: this.moveKeys.up.isDown,
      down: this.moveKeys.down.isDown,
      left: this.moveKeys.left.isDown,
      right: this.moveKeys.right.isDown,
      pointerX: aim.x,
      pointerY: aim.y,
      fire: pointer.leftButtonDown(),
    };
  }

  private drawShip(events: FrameEvents): void {
    const { ship, previous, alpha } = this.sim;
    this.ship.place(previous.x + (ship.x - previous.x) * alpha, previous.y + (ship.y - previous.y) * alpha, ship.angle);
    this.ship.setThrusting(ship.thrusting);
    this.animateWeapon(events);
  }

  private animateWeapon(events: FrameEvents): void {
    const now = this.time.now / 1000;
    const stats = WEAPON_STATS[this.sim.ship.loadout.weapon];
    const own = events.shots.filter((shot) => shot.companion === 0);
    if (events.charges.length > 0) {
      this.weaponFrames.charge(now, stats.charge);
    }
    if (stats.alternate) {
      for (const shot of own) {
        this.weaponFrames.release(now, shot.muzzle, stats.muzzles.length);
      }
    } else if (own.length > 0) {
      this.weaponFrames.release(now, 0, 1);
    }
    this.ship.weapon.setFrame(this.weaponFrames.frame(now));
  }

  private drawProjectiles(): void {
    this.sim.projectiles.items.forEach((p, i) => {
      const sprite = this.projectileSprites[i];
      if (sprite === undefined) {
        return;
      }
      sprite.setVisible(p.active);
      if (!p.active) {
        return;
      }
      sprite.setPosition(p.x, p.y).setRotation(p.angle + SPRITE_FACING);
      sprite.play(isWeapon(p.kind) ? keys.projectile(p.kind) : keys.enemyBullet(p.kind), true);
      // Pooled sprites carry every faction in turn: move each to its layer.
      const layer = p.faction === 'enemy' ? this.enemyFire : this.world;
      if (sprite.displayList !== layer) {
        sprite.displayList.remove(sprite);
        layer.add(sprite);
      }
    });
  }

  private playEffects(events: FrameEvents): void {
    this.shotsFired += events.shots.filter((shot) => shot.companion === 0).length;
    if (!this.effects) {
      return;
    }
    for (const shot of events.shots) {
      this.muzzleFlash.explode(3, shot.x, shot.y);
      // Only the player's own big gun shakes the camera.
      const shake = shot.companion === 0 ? WEAPON_STATS[shot.weapon].shake : 0;
      if (shake > 0) {
        this.cameras.main.shake(120, shake);
      }
    }
    for (const p of events.expired) {
      this.puff.explode(4, p.x, p.y);
    }
  }

  /** Sparks where shots land; a hull flash when an enemy bullet hits us. */
  private showHits(net: NetFrame): void {
    for (const hit of net.enemyHits) {
      this.puff.explode(HIT_SPARKS, hit.x, hit.y);
    }
    for (const hit of net.hitsOnMe) {
      this.puff.explode(HIT_SPARKS, hit.x, hit.y);
    }
    if (net.hitsOnMe.length > 0) {
      this.ship.flash(this);
    }
  }

  /** Scrolls each layer at its parallax factor; TileSprites cannot play animations, so frames step here. */
  private scrollBackgrounds(time: number): void {
    const camera = this.cameras.main;
    const frame = Math.floor((time / 1000) * BACKGROUND_FPS) % BACKGROUND_FRAMES;
    const frameChanged = frame !== this.backgroundFrame;
    this.backgroundFrame = frame;
    for (const { sprite, factor } of this.backgrounds) {
      sprite.setTilePosition(camera.scrollX * factor, camera.scrollY * factor);
      if (frameChanged) {
        sprite.setFrame(frame);
      }
    }
  }

  private updateHud(): void {
    const { loadout, rotationSnap } = this.sim.ship;
    this.hud.setText([
      `weapon ${loadout.weapon}  engine ${loadout.engine}  shield ${loadout.shield}  hull ${this.damage}`,
      `controls ${this.sim.controlMode === 'ship' ? 'ship-relative' : 'screen-relative'}  rotation ${rotationSnap === 0 ? 'free' : `${rotationSnap} directions`}  effects ${this.effects ? 'on' : 'off'}  sound ${this.audioSettings.muted ? 'off' : 'on'}  music ${this.audioSettings.music ? 'on' : 'off'}  ${Math.round(this.game.loop.actualFps)} fps`,
      'WASD move · mouse aim · hold left button to fire · G companion · hold Q orders, tap to repeat · C controls · M sound · N music · 1/2/3 parts · H hull · R rotation · F effects',
      this.netStatus(),
      this.wingStatus(),
    ]);
  }

  /** The companions out, and the latest notice (a refused summon, a companion sent home). */
  private wingStatus(): string {
    const net = this.net;
    if (net === undefined) {
      return '';
    }
    const { companions } = this.sim;
    const out = companions.length;
    const orders = [...new Set(companions.map((c) => describeOrders(c.orders)))];
    const wing =
      out === 0
        ? 'no companions'
        : `${String(out)} companion${out === 1 ? '' : 's'} · ${orders.length === 1 ? (orders[0] ?? '') : 'mixed orders'}`;
    const notice = net.noticeText;

    return notice === undefined ? wing : `${wing} · ${notice}`;
  }

  private netStatus(): string {
    const net = this.net;
    if (net === undefined) {
      return 'playing alone';
    }
    switch (net.status) {
      case 'online': {
        const count = net.others.filter((o) => o.ownerId === '').length;

        return `online · ${count === 0 ? 'nobody else here yet' : `${count} other${count === 1 ? '' : 's'} here`}`;
      }
      case 'full':
        return 'the frontier is full, try again soon';
      case 'offline':
        return 'offline · reconnecting';
      default:
        return 'connecting';
    }
  }

  private publish(): void {
    const { ship, projectiles } = this.sim;
    this.debug.ship.x = ship.x;
    this.debug.ship.y = ship.y;
    this.debug.ship.angle = ship.angle;
    this.debug.ship.thrusting = ship.thrusting;
    this.debug.damage = this.damage;
    this.debug.rotationSnap = ship.rotationSnap;
    this.debug.controlMode = this.sim.controlMode;
    this.debug.effects = this.effects;
    this.debug.enemyFireGlow = this.enemyFireGlow?.active ?? false;
    this.debug.projectiles = projectiles.activeCount;
    this.debug.shotsFired = this.shotsFired;
    this.debug.zoom = this.cameras.main.zoom;
    this.debug.fps = this.game.loop.actualFps;
    this.debug.weaponFrame = Number(this.ship.weapon.frame.name);
    this.debug.audio.muted = this.audioSettings.muted;
    this.debug.audio.music = this.audioSettings.music;
    this.debug.audio.locked = this.sound.locked;
    this.debug.audio.playingMusic = this.audio.playingMusic;
    this.debug.audio.backend = this.audio.backend;
    this.debug.audio.musicLoaded = this.audio.musicReady;
    this.debug.net.status = this.net?.status ?? 'offline';
    this.debug.net.playerId = this.net?.playerId;
    this.debug.net.others = this.net?.others ?? [];
    this.debug.enemies = this.net?.enemyList ?? [];
    this.debug.enemiesDestroyed = this.net?.enemiesDestroyed ?? 0;
    this.debug.lastEnemyDestroyed = this.net?.lastEnemyDestroyed;
    this.debug.hitsTaken = this.net?.hitsTaken ?? 0;
    this.debug.companions = this.sim.companions.map((c) => ({
      number: c.number,
      x: c.ship.x,
      y: c.ship.y,
      stance: c.orders.stance,
      fire: c.orders.fire,
      resources: c.orders.resources,
      oneShot: c.orders.oneShot?.kind,
    }));
    this.debug.companionKills = this.net?.companionKills ?? 0;
    this.debug.notice = this.net?.noticeText;
    this.debug.orderMenuOpen = this.orderPress?.labels !== undefined;
    publishDebugState(this.debug);
  }
}
