import Phaser from 'phaser';

import { publishDebugState, type DebugState } from '../debug.ts';
import { loadAudioSettings, loadControlMode, saveAudioSettings, saveControlMode, type AudioSettings } from '../settings.ts';
import { keys, weaponTiming } from '../sprites.ts';
import { CONTROL_MODES, type InputSnapshot } from '../sim/input.ts';
import { DAMAGE_STATES, ENGINES, SHIELDS, WEAPONS, nextInCycle, type DamageState } from '../sim/loadout.ts';
import { Sandbox, type FrameEvents } from '../sim/sandbox.ts';
import { ROTATION_SNAP_STEPS, VIEW_HEIGHT, VIEW_WIDTH, WEAPON_STATS } from '../sim/tuning.ts';
import { asteroidField } from '../sim/world.ts';
import { integerZoom } from '../sim/zoom.ts';
import { WeaponAnimator } from '../weaponframes.ts';
import { ShipAudio } from './audio.ts';

/** How far each background layer moves relative to the camera. */
const PARALLAX = [0.05, 0.15, 0.3] as const;
const BACKGROUND_FPS = 6;
const BACKGROUND_FRAMES = 9;
const CAMERA_LERP = 0.15;
const HUD_REFRESH_MS = 250;
/** Sprites face up; Phaser's rotation 0 faces right. */
const SPRITE_FACING = Math.PI / 2;

interface Background {
  sprite: Phaser.GameObjects.TileSprite;
  factor: number;
}

interface ShipView {
  root: Phaser.GameObjects.Container;
  engine: Phaser.GameObjects.Image;
  flame: Phaser.GameObjects.Sprite;
  hull: Phaser.GameObjects.Image;
  weapon: Phaser.GameObjects.Sprite;
  shield: Phaser.GameObjects.Sprite;
}

/** The single-player sandbox: fly, aim and shoot around the home planet. */
export class SandboxScene extends Phaser.Scene {
  private readonly sim = new Sandbox();
  private world!: Phaser.GameObjects.Layer;
  private backgrounds: Background[] = [];
  private backgroundFrame = 0;
  private ship!: ShipView;
  private projectileSprites: Phaser.GameObjects.Sprite[] = [];
  private muzzleFlash!: Phaser.GameObjects.Particles.ParticleEmitter;
  private puff!: Phaser.GameObjects.Particles.ParticleEmitter;
  private bloom: Phaser.Filters.ParallelFilters | undefined;
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
    this.ship = this.createShip();
    this.createProjectiles();
    this.createParticles();
    this.createCameras();
    this.createInput();
    this.applyLoadout();
    this.resize();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      this.resize();
    });

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
    };
    this.publish();
  }

  override update(time: number, deltaMs: number): void {
    const events = this.sim.advance(deltaMs / 1000, this.readInput());
    this.drawShip(events);
    this.drawProjectiles();
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

  private createShip(): ShipView {
    const engine = this.add.image(0, 0, keys.engine('base'));
    const flame = this.add.sprite(0, 0, keys.flameIdle('base'));
    const hull = this.add.image(0, 0, keys.hull('fullHealth'));
    const weapon = this.add.sprite(0, 0, keys.weapon('autoCannon'), 0);
    const shield = this.add.sprite(0, 0, keys.shield('front'));
    const root = this.add.container(this.sim.ship.x, this.sim.ship.y, [engine, flame, hull, weapon, shield]);
    this.world.add(root);

    return { root, engine, flame, hull, weapon, shield };
  }

  private createProjectiles(): void {
    this.projectileSprites = this.sim.projectiles.items.map(() => {
      const sprite = this.add.sprite(0, 0, keys.projectile('autoCannon')).setVisible(false);
      this.world.add(sprite);

      return sprite;
    });
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
    this.bloom = Phaser.Actions.AddEffectBloom(main, { threshold: 0.55, blurRadius: 3, blendAmount: 0.6 })[0]
      ?.parallelFilters;
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
      if (!event.repeat) {
        this.handleDebugKey(event.code);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', onKeyDown);
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
        this.ship.hull.setTexture(keys.hull(this.damage));
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
        this.updateHud();
        break;
      default:
    }
  }

  private applyLoadout(): void {
    const { weapon, engine, shield } = this.sim.ship.loadout;
    this.ship.engine.setTexture(keys.engine(engine));
    this.ship.flame.play(keys.flameIdle(engine));
    this.ship.weapon.setTexture(keys.weapon(weapon), 0);
    this.weaponFrames = new WeaponAnimator(weaponTiming(weapon));
    this.ship.shield.play(keys.shield(shield));
    this.audio.setEngine(engine);
    this.updateHud();
  }

  private resize(): void {
    const { width, height } = this.scale;
    const zoom = integerZoom(width, height, VIEW_WIDTH, VIEW_HEIGHT);
    this.cameras.main.setZoom(zoom);
    this.hudCamera.setSize(width, height);
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
    this.ship.root
      .setPosition(previous.x + (ship.x - previous.x) * alpha, previous.y + (ship.y - previous.y) * alpha)
      .setRotation(ship.angle + SPRITE_FACING);

    const engine = ship.loadout.engine;
    this.ship.flame.play(ship.thrusting ? keys.flamePowering(engine) : keys.flameIdle(engine), true);
    this.animateWeapon(events);
  }

  private animateWeapon(events: FrameEvents): void {
    const now = this.time.now / 1000;
    const stats = WEAPON_STATS[this.sim.ship.loadout.weapon];
    if (events.charges.length > 0) {
      this.weaponFrames.charge(now, stats.charge);
    }
    if (stats.alternate) {
      for (const shot of events.shots) {
        this.weaponFrames.release(now, shot.muzzle, stats.muzzles.length);
      }
    } else if (events.shots.length > 0) {
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
      sprite.play(keys.projectile(p.weapon), true);
    });
  }

  private playEffects(events: FrameEvents): void {
    this.shotsFired += events.shots.length;
    if (!this.effects) {
      return;
    }
    for (const shot of events.shots) {
      this.muzzleFlash.explode(3, shot.x, shot.y);
      const shake = WEAPON_STATS[shot.weapon].shake;
      if (shake > 0) {
        this.cameras.main.shake(120, shake);
      }
    }
    for (const p of events.expired) {
      this.puff.explode(4, p.x, p.y);
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
      'WASD move · mouse aim · hold left button to fire · C controls · M sound · N music · 1/2/3 parts · H hull · R rotation · F effects',
    ]);
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
    publishDebugState(this.debug);
  }
}
