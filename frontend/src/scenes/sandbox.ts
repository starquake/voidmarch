import Phaser from 'phaser';

import { BackgroundTicker, workerTimer } from '../background.ts';
import { publishDebugState, type DebugState } from '../debug.ts';
import { FrameTimes, GpuTimer } from '../frametimes.ts';
import { wireFormatFrom } from '../net/codec.ts';
import { fromCompanionMode } from '../net/mapping.ts';
import {
  ORDER_ITEMS,
  RING_ASPECT,
  chooseFocus,
  itemPosition,
  pickItem,
  type OrderItem,
} from '../ordermenu.ts';
import { renderRatio } from '../display.ts';
import {
  clearToken,
  loadAudioSettings,
  loadControlMode,
  loadDisplaySettings,
  loadToken,
  loadViewSettings,
  saveAudioSettings,
  saveControlMode,
  saveDisplaySettings,
  saveViewSettings,
  type AudioSettings,
  type DisplaySettings,
} from '../settings.ts';
import { keys, weaponTiming } from '../sprites.ts';
import { type InputSnapshot } from '../sim/input.ts';
import { changeOption, optionRows, type OptionId, type Options } from '../sim/options.ts';
import { SettingsScreen } from '../settingsscreen.ts';
import { ENGINES, SHIELD_STATS, SHIELDS, WEAPONS, damageState, nextInCycle, type Loadout, type WeaponId } from '../sim/loadout.ts';
import { defaultUnlocks, partLabel, tierCss, withTiers } from '../sim/parts.ts';
import { LoadoutScreen } from '../loadout.ts';
import { VictoryScreen } from '../victory.ts';
import { MapView } from './mapview.ts';
import { isWeapon, sandbox, type FrameEvents } from '../simwasm.ts';
import {
  BRAIN_SPACING,
  HOME_SPAWN_Y,
  RESPAWN_DELAY,
  ROTATION_SNAP_STEPS,
  SAFE_ZONE_RADIUS,
  EVENT_COLOR,
  EVENT_CSS,
  MISSION_ARROW_MARGIN_PX,
  MISSION_ARROW_SIZE_PX,
  MISSION_LABEL_OFFSET,
  MISSION_BANNER_ALPHA,
  MISSION_BANNER_BORDER_PX,
  MISSION_BANNER_MS,
  MISSION_BANNER_Y,
  MISSION_COLOR,
  MISSION_CSS,
  SECTOR_LINE_ALPHA,
  SECTOR_LINE_COLOR,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  WEAPON_STATS,
  CLOSED_SHADE_ALPHA,
  FIELD_CORE_RADIUS,
  FIELD_GLOW_ALPHA,
  FIELD_GLOW_RADIUS,
  FIELD_SPARK_COLOR,
  FIELD_SPARK_JUMP,
  FIELD_STRAND_ALPHA,
  FIELD_ZAP_EVERY_MS,
  RING_TINT_FADE_MS,
  MINIMAP_REDRAW_MS,
  FPS_CAP,
  TOUCH_AIM_REACH,
} from '../sim/tuning.ts';
import { fieldColor, fieldSides, nearestSide, sparks, zapVolume, type Side } from '../sim/forcefield.ts';
import { TouchControls, touchButtons, touchMode, touchUnit, type ButtonRect, type Point } from '../sim/touch.ts';
import {
  ALL_OPEN,
  fadeColor,
  closedEdges,
  missionArrow,
  missionBanner,
  ringTint,
  SECTOR_NAMES,
  sectorCorners,
  sectorLine,
  sectorOpen,
} from '../sim/sectors.ts';
import { asteroidField } from '../sim/world.ts';
import { integerZoom } from '../sim/zoom.ts';
import { SquadronScreen, hangarLine, modeName } from '../squadrons.ts';
import { WeaponAnimator } from '../weaponframes.ts';
import { bossBar } from '../net/boss.ts';
import { ShipAudio } from './audio.ts';
import { BossBarView } from './bossbar.ts';
import { NetPlay, type NetFrame } from './netplay.ts';
import { PickupsView } from './pickups.ts';
import { Resample, registerResample } from './resample.ts';
import { vignetteImage } from '../vignette.ts';
import { SPRITE_FACING, ShipView } from './shipview.ts';
import { TouchView } from './touchview.ts';
import { registerSmallBlend } from './blend.ts';
import { allBlack, blankSamples } from '../display.ts';
import { loadBloomBroken, saveBloomBroken } from '../settings.ts';
import { Diagnostics } from '../diag.ts';

/** How far each background layer moves relative to the camera. */
const PARALLAX = [0.05, 0.15, 0.3] as const;
const BACKGROUND_FPS = 6;
const BACKGROUND_FRAMES = 9;
const CAMERA_LERP = 0.15;
/** Bloom's blur reach, in screen pixels at EFFECT_ZOOM. */
const BLOOM_BLUR = 3;
/** What counts as bright enough to bloom, how many blur rounds, and how much of the bloom adds to the scene. */
const BLOOM_THRESHOLD = 0.55;
const BLOOM_BLUR_STEPS = 4;
const BLOOM_AMOUNT = 0.6;
/** The vignette: centered, reaching 0.9 of the screen, at strength 0.35, as the filter it replaces (#143). */
const VIGNETTE = { x: 0.5, y: 0.5, radius: 0.9, strength: 0.35 };
const VIGNETTE_KEY = 'vignette';
/** The vignette image's size; stretched with smoothing, its gradient needs no more. */
const VIGNETTE_SIZE = 256;
/**
 * Filters work in screen pixels, so their reach is scaled by zoom / EFFECT_ZOOM
 * to look the same on every screen size and display scaling. 2 is the zoom of
 * a 1280x720 window, where the effects were tuned.
 */
const EFFECT_ZOOM = 2;
/** The scale the baked glowing enemy bullets are drawn at, having been baked at twice the art's size. */
const BAKED_GLOW_SCALE = 0.5;
/** Bloom's threshold and blur run at this share of the screen's size, then scale back up (#143). */
const BLOOM_SCALE = 0.5;
const HUD_REFRESH_MS = 250;
/** Particles in a hit's spark. */
const HIT_SPARKS = 5;
/** HUD text size and margin in CSS pixels; scaled to device pixels on resize. */
/** A burst's shards are the auto cannon's shot in this gold (#72). */
const SHARD_TINT = 0xffd27a;
const HUD_FONT_PX = 12;
const HUD_MARGIN_PX = 8;
/** The "You're down" panel (#47): its text size, padding and height on screen, in CSS pixels and a fraction of the height. */
const DOWN_PANEL_FONT_PX = 14;
const DOWN_PANEL_PADDING_X = 12;
const DOWN_PANEL_PADDING_Y = 8;
const DOWN_PANEL_Y = 0.8;
/** How many frames in the bloom is checked for drawing the world black, once things have settled (#180). */
const BLOOM_CHECK_FRAME = 30;
/** The HUD's two lines of keys. */
const KEY_HELP_MOVE = 'WASD move · mouse aim · hold left button to fire · H/J respawn when down · G companion · L loadout at home';
const KEY_HELP_MORE = 'hold Q orders, tap to repeat · 1/2/3 parts · Esc settings';
/** Holding Q this long opens the order ring; a shorter tap repeats the last order. */
const ORDER_HOLD_MS = 200;
/** The order ring's height radius and its dead center, in CSS pixels. */
const ORDER_RING_PX = 88;
const ORDER_DEAD_ZONE_PX = 24;
/** The ring's colors: modes and one-shots apart, the picked item white. */
const ORDER_COLORS: Readonly<Record<OrderItem['kind'], number>> = { mode: 0x8fd8ff, oneShot: 0xffe08a };
const ORDER_PICKED_TEXT = '#ffffff';
const ORDER_BACKDROP = 0x05030a;
const ORDER_BACKDROP_ALPHA = 0.72;
/** How far past the items' circle the backdrop reaches, in CSS pixels. */
const ORDER_BACKDROP_PAD = 40;
/** Each item is its icon with the label under it: offsets from the item's point, in CSS pixels. */
const ORDER_ICON_RISE = 10;
const ORDER_LABEL_DROP = 12;

/**
 * A Void-pack sprite beside each order (#35), scaled per sprite: the ship
 * parts sit small in mostly empty 48 and 64 px frames.
 */
const ORDER_ICONS: Readonly<Record<string, { key: string; frame?: number; dim?: boolean; scale: number }>> = {
  Escort: { key: keys.hull('fullHealth'), scale: 1 },
  Attack: { key: keys.weapon('rockets'), scale: 1.1 },
  Guard: { key: keys.shield('front'), scale: 0.9 },
  'Hold here': { key: keys.engine('base'), scale: 1.2 },
  Stealth: { key: keys.weapon('autoCannon'), dim: true, scale: 1.1 },
  Focus: { key: keys.projectile('bigSpaceGun'), frame: 3, scale: 1.3 },
  Regroup: { key: keys.flamePowering('base'), frame: 2, scale: 1.4 },
  'Go home': { key: keys.planet, scale: 0.35 },
};

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** Q held down: where the pointer was. */
interface OrderPress {
  downAt: number;
  /** Set when the Orders touch button opened it (#180): the ring follows that touch, not the mouse. */
  touch: boolean;
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  /** The ring, once open: its labels, and its backdrop, icons and center. */
  labels: Phaser.GameObjects.Text[] | undefined;
  backdrop: Phaser.GameObjects.Graphics | undefined;
  extras: Phaser.GameObjects.GameObject[];
}

/** Removes everything the ring drew. */
function destroyRing(press: OrderPress): void {
  for (const object of [...(press.labels ?? []), ...press.extras]) {
    object.destroy();
  }
  press.backdrop?.destroy();
}

interface Background {
  sprite: Phaser.GameObjects.TileSprite;
  factor: number;
}

/** The single-player sandbox: fly, aim and shoot around the home planet. */
export class SandboxScene extends Phaser.Scene {
  private readonly sim = sandbox();
  private world!: Phaser.GameObjects.Layer;
  private backgrounds: Background[] = [];
  private backgroundFrame = 0;
  /** The background's tint now, fading toward the ring the ship is in (#136). */
  private backgroundTint = 0xffffff;
  private ships!: Phaser.GameObjects.Container;
  private pickups!: PickupsView;
  private partsLine: Phaser.GameObjects.Text[] = [];
  /** The own ship's loadout as last drawn, so any change redraws it. */
  private shownLoadout = '';
  private ship!: ShipView;
  private net: NetPlay | undefined;
  /** The loadout screen at the home planet (#78). */
  private readonly loadoutScreen = new LoadoutScreen();
  private readonly victoryScreen = new VictoryScreen();
  private readonly settingsScreen = new SettingsScreen((row) => {
    this.setOption(row.id);
  });
  /** Twin-stick touch controls on a tablet (#180). */
  private readonly touchOn = touchMode((query) => window.matchMedia(query).matches, window.location.search);
  private readonly touch = new TouchControls();
  private touchView: TouchView | undefined;
  private touchButtonRects: ButtonRect[] = [];
  private askedFullscreen = false;
  /** The notch's safe area, read on resize (#180). */
  private insets = { insetLeft: 0, insetRight: 0 };
  private maps!: MapView;
  /** The closed sectors' shade (#123), and the frontier it was drawn for. */
  private closedLayer!: Phaser.GameObjects.Graphics;
  private closedDrawn = -1;
  /** The force field on the closed sectors' edge (#127): its sides, its layer, drawn every frame, and its zaps. */
  private closedSides: Side[] = [];
  private fieldLayer!: Phaser.GameObjects.Graphics;
  private lastZap = Number.NEGATIVE_INFINITY;
  private fieldZaps = 0;
  private projectileSprites: Phaser.GameObjects.Sprite[] = [];
  /** Enemy bullets fly on their own layer, above the players' shots, so enemy fire stands out (#36). */
  private enemyFire!: Phaser.GameObjects.Layer;
  private muzzleFlash!: Phaser.GameObjects.Particles.ParticleEmitter;
  private puff!: Phaser.GameObjects.Particles.ParticleEmitter;
  private bloom: Phaser.Filters.ParallelFilters | undefined;
  private bloomBlur: Phaser.Filters.Blur | undefined;
  /** Set where the bloom draws the world black, so it stays off (#180). */
  private bloomBroken = false;
  /** The vignette as an overlay on the HUD camera, over the bloomed world (#143). */
  private vignette!: Phaser.GameObjects.Image;
  private hudCamera!: Phaser.Cameras.Scene2D.Camera;
  private hud!: Phaser.GameObjects.Text;
  private bossBar!: BossBarView;
  private missionArrow!: Phaser.GameObjects.Graphics;
  private missionLabel!: Phaser.GameObjects.Text;
  private eventLabel!: Phaser.GameObjects.Text;
  private missionBanner!: Phaser.GameObjects.Text;
  private missionFrame!: Phaser.GameObjects.Graphics;
  private announcedMission: string | undefined;
  private missionBannerUntil = 0;
  private downPanel!: Phaser.GameObjects.Text;
  /** Whether the ship was down last frame and was respawned since, to count revives. */
  private wasDown = false;
  private respawned = false;
  private revives = 0;
  private moveKeys!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private effects = true;
  /** WebGL's limits and the page's errors in the HUD, with `?diag=1` (#180). */
  private diagnostics: Diagnostics | undefined;
  private shotsFired = 0;
  private hudUpdatedAt = 0;
  private debug!: DebugState;
  private readonly frameTimes = new FrameTimes();
  private mapsDrawnAt = -Infinity;
  private displaySettings!: DisplaySettings;
  private gpuTimer: GpuTimer | undefined;
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
    this.displaySettings = loadDisplaySettings();
    this.audio = new ShipAudio(this, this.audioSettings);
    this.world = this.add.layer();
    this.createBackgrounds();
    this.createScenery();
    const pickupLayer = this.add.layer();
    this.world.add(pickupLayer);
    this.pickups = new PickupsView(this, pickupLayer);
    this.ships = this.add.container(0, 0);
    this.world.add(this.ships);
    this.ship = new ShipView(this, this.ships, this.sim.ship.x, this.sim.ship.y);
    this.createProjectiles();
    this.createParticles();
    this.createCameras();
    this.timeGpu();
    this.checkBloom();
    this.createInput();
    if (this.touchOn) {
      this.createTouch();
    }
    const asked = new URLSearchParams(window.location.search);
    const view = loadViewSettings();
    if (view.snapRotation) {
      this.sim.setRotationSnap(ROTATION_SNAP_STEPS);
    }
    // ?effects=0 is for this visit only, so it isn't saved.
    if (!view.effects || asked.get('effects') === '0') {
      this.setEffects(false);
    }
    if (asked.get('diag') === '1') {
      const renderer = this.renderer;
      this.diagnostics = new Diagnostics(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer ? renderer.gl : undefined, this.game.canvas);
    }
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
      damage: 'fullHealth',
      shield: 0,
      shieldShown: false,
      rotationSnap: 0,
      controlMode: this.sim.controlMode,
      effects: this.effects,
      projectiles: 0,
      ownShards: 0,
      shakes: 0,
      unlocks: {},
      pickups: [],
      shotsFired: 0,
      zoom: 1,
      fps: 0,
      frameMs: { average: 0, worst: 0 },
      fpsCap: false,
      cssPixels: false,
      gpuMs: undefined,
      weaponFrame: 0,
      audio: { muted: false, music: false, locked: true, backend: 'none', musicLoaded: false, playingMusic: null },
      net: { status: 'offline', playerId: undefined, others: [] },
      enemies: [],
      enemiesDestroyed: 0,
      lastEnemyDestroyed: undefined,
      enemyFireGlow: false,
      field: { distance: null, zaps: 0 },
      hitsTaken: 0,
      rams: 0,
      downed: false,
      revive: 0,
      canRespawn: false,
      downLabel: undefined,
      reviveBar: undefined,
      revives: 0,
      downPanel: undefined,
      companions: [],
      companionKills: 0,
      notice: undefined,
      orderMenuOpen: false,
      squadron: '',
      squadronScreen: false,
      loadoutScreen: false,
      victoryScreen: false,
      settingsScreen: false,
      touch: this.touchOn,
      touchButtons: [],
      touchSticks: [],
      touchFiring: false,
      mapOpen: false,
      openRings: 0,
      openedSectors: [],
      mapLayout: { x: 0, y: 0, scale: 0 },
      boss: undefined,
      sector: '',
      mission: undefined,
      worldEvent: undefined,
      lastClear: undefined,
      missionBanner: undefined,
      derelicts: [],
      rescues: 0,
      hangar: undefined,
      squadronMode: undefined,
    };
    this.publish();
  }

  override update(time: number, deltaMs: number): void {
    this.frameTimes.add(deltaMs, time);
    const events = this.sim.advance(deltaMs / 1000, this.readInput(), this.net?.squadmateDistance, this.net?.friendDistance);
    this.burstExpired(events);
    const net = this.net?.update(events);
    if (loadoutKey(this.sim.ship.loadout) !== this.shownLoadout) {
      this.applyLoadout();
    }
    this.updateLoadoutScreen();
    this.openVictoryIfDue();
    this.drawTouch();
    this.diagnostics?.check();
    this.drawShip(events);
    this.countRevive();
    this.updateDownPanel();
    if (net !== undefined) {
      this.showHits(net);
    }
    this.drawProjectiles();
    this.updateOrderMenu(time);
    this.playEffects(events);
    this.audio.update(this.sim.ship, events);
    this.scrollBackgrounds(time, deltaMs);
    this.bossBar.show(bossBar(this.net?.bosses ?? [], this.sim.ship.x, this.sim.ship.y));
    this.drawMissionArrow();
    this.drawMaps();
    this.drawClosed();
    this.drawField(time);
    this.announceMission(time);
    if (time - this.hudUpdatedAt > HUD_REFRESH_MS) {
      this.hudUpdatedAt = time;
      this.updateHud();
    }
    this.publish();
  }

  /**
   * Announces in the middle of the screen, one after another: a finished
   * mission, then the squadron's new one whenever it starts or changes (#101).
   */
  private announceMission(time: number): void {
    const net = this.net;
    if (net === undefined) {
      return;
    }
    const mission = net.mission;
    if (mission !== undefined && mission !== this.announcedMission) {
      net.banners.push(missionBanner(mission));
    }
    this.announcedMission = mission;
    if (this.missionBanner.visible && time <= this.missionBannerUntil) {
      return;
    }
    const next = net.banners.shift();
    this.missionBanner.setVisible(next !== undefined);
    this.missionFrame.setVisible(next !== undefined);
    if (next !== undefined) {
      this.missionBanner.setText(next);
      this.drawMissionFrame();
      this.missionBannerUntil = time + MISSION_BANNER_MS;
    }
  }

  /** The banner's black, see-through box with a thin gold border, fitted around its text. */
  private drawMissionFrame(): void {
    const b = this.missionBanner.getBounds();
    const line = MISSION_BANNER_BORDER_PX * this.dpr();
    this.missionFrame
      .clear()
      .fillStyle(0x000000, MISSION_BANNER_ALPHA)
      .fillRect(b.x, b.y, b.width, b.height)
      .lineStyle(line, MISSION_COLOR, 1)
      .strokeRect(b.x + line / 2, b.y + line / 2, b.width - line, b.height - line);
  }

  /**
   * The arrows at the screen's edge: gold toward the squadron's mission (#101),
   * red toward a world event (#102), each while the ship is elsewhere.
   */
  private drawMissionArrow(): void {
    const g = this.missionArrow.clear();
    this.drawArrow(g, this.missionLabel, this.net?.mission, MISSION_COLOR);
    this.drawArrow(g, this.eventLabel, this.net?.worldEvent?.sector, EVENT_COLOR);
  }

  private drawArrow(g: Phaser.GameObjects.Graphics, label: Phaser.GameObjects.Text, sector: string | undefined, color: number): void {
    const mission = sector;
    const { width, height } = this.scale;
    const dpr = this.dpr();
    const at = mission === undefined ? undefined : missionArrow(this.sim.ship, mission, width, height, MISSION_ARROW_MARGIN_PX * dpr);
    label.setVisible(at !== undefined);
    if (at === undefined || mission === undefined) {
      return;
    }
    const size = MISSION_ARROW_SIZE_PX * dpr;
    const tip = { x: at.x + Math.cos(at.angle) * size, y: at.y + Math.sin(at.angle) * size };
    const side = (turn: number) => ({ x: at.x + Math.cos(at.angle + turn) * size * 0.7, y: at.y + Math.sin(at.angle + turn) * size * 0.7 });
    const left = side(Math.PI / 2);
    const right = side(-Math.PI / 2);
    g.fillStyle(color, 1).fillTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
    label
      .setText(mission)
      .setFontSize(HUD_FONT_PX * dpr)
      .setPosition(at.x - Math.cos(at.angle) * size * MISSION_LABEL_OFFSET, at.y - Math.sin(at.angle) * size * MISSION_LABEL_OFFSET);
  }

  private createBackgrounds(): void {
    this.backgrounds = keys.background.map((key, i) => {
      const sprite = this.add.tileSprite(0, 0, VIEW_WIDTH, VIEW_HEIGHT, key, 0).setScrollFactor(0);
      this.world.add(sprite);

      return { sprite, factor: PARALLAX[i] ?? 0 };
    });
  }

  private createScenery(): void {
    const lines = this.add.graphics().lineStyle(1, SECTOR_LINE_COLOR, SECTOR_LINE_ALPHA);
    for (const name of SECTOR_NAMES) {
      const [first, ...rest] = sectorCorners(name);
      if (first !== undefined) {
        lines.beginPath().moveTo(first.x, first.y);
        for (const corner of rest) {
          lines.lineTo(corner.x, corner.y);
        }
        lines.closePath().strokePath();
      }
    }
    this.world.add(lines);
    this.closedLayer = this.add.graphics();
    this.world.add(this.closedLayer);
    this.fieldLayer = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.world.add(this.fieldLayer);
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
      squadronScreen: new SquadronScreen(),
      pickups: this.pickups,
    });
    this.net.start();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.net?.stop());

    // While the tab is hidden, a worker steps the game so the server keeps us (#57).
    const background = new BackgroundTicker(
      (deltaMs) => {
        this.stepHidden(deltaMs);
      },
      document,
      workerTimer(),
      () => performance.now(),
    );
    background.start();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      background.stop();
    });
  }

  /**
   * One step while the tab is hidden: the ship coasts with nothing held, its
   * state goes to the server, and nothing is drawn. The ship stays in the
   * world, exposed (#57).
   */
  private stepHidden(deltaMs: number): void {
    const { pointerX, pointerY } = this.readInput();
    const idle = { up: false, down: false, left: false, right: false, pointerX, pointerY, fire: false };
    const events = this.sim.advance(deltaMs / 1000, idle, this.net?.squadmateDistance, this.net?.friendDistance);
    this.burstExpired(events);
    this.net?.update(events);
    this.publish();
  }

  private createProjectiles(): void {
    this.projectileSprites = this.sim.projectiles.items.map(() => {
      const sprite = this.add.sprite(0, 0, keys.projectile('autoCannon')).setVisible(false);
      this.world.add(sprite);

      return sprite;
    });
    this.enemyFire = this.add.layer();
    this.world.add(this.enemyFire);
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

  /**
   * Bloom as Phaser's AddEffectBloom draws it, but with its threshold and
   * blur at half the screen's size between two smooth resamples (#143).
   */
  private createBloom(main: Phaser.Cameras.Scene2D.Camera): void {
    if (!(this.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) {
      return;
    }
    registerResample(this.renderer);
    registerSmallBlend(this.renderer);
    const bloom = main.filters.external.addParallelFilters();
    bloom.top.add(new Resample(main, BLOOM_SCALE));
    bloom.top.addThreshold(BLOOM_THRESHOLD, 1);
    this.bloomBlur = bloom.top.addBlur(0, BLOOM_BLUR * BLOOM_SCALE, BLOOM_BLUR * BLOOM_SCALE, 1, 0xffffff, BLOOM_BLUR_STEPS);
    bloom.top.add(new Resample(main, 1 / BLOOM_SCALE));
    bloom.blend.blendMode = Phaser.BlendModes.ADD;
    bloom.blend.amount = BLOOM_AMOUNT;
    this.bloom = bloom;
  }

  /**
   * The vignette the camera's filter used to draw, as one stretched image of
   * black at its darkness: the same look without a pass over every pixel.
   */
  private createVignette(): Phaser.GameObjects.Image {
    if (!this.textures.exists(VIGNETTE_KEY)) {
      const canvas = document.createElement('canvas');
      canvas.width = VIGNETTE_SIZE;
      canvas.height = VIGNETTE_SIZE;
      canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(vignetteImage(VIGNETTE_SIZE, VIGNETTE)), VIGNETTE_SIZE, VIGNETTE_SIZE), 0, 0);
      this.textures.addCanvas(VIGNETTE_KEY, canvas)?.setFilter(Phaser.Textures.FilterMode.LINEAR);
    }

    return this.add.image(0, 0, VIGNETTE_KEY).setOrigin(0, 0);
  }

  private createCameras(): void {
    const main = this.cameras.main;
    main.setBackgroundColor('#05030a');
    main.startFollow(this.ship.root, true, CAMERA_LERP, CAMERA_LERP);
    main.setRoundPixels(true);
    this.createBloom(main);
    this.vignette = this.createVignette();
    main.ignore(this.vignette);

    this.hud = this.add
      .text(8, 8, '', { fontFamily: 'monospace', fontSize: '12px', color: '#d8f8ff' })
      .setOrigin(0, 1)
      .setShadow(1, 1, '#000000', 0);
    main.ignore(this.hud);
    // The parts line (#77): "parts", then each fitted part in its tier's color.
    this.partsLine = Array.from({ length: 4 }, () => {
      const text = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#d8f8ff' }).setShadow(1, 1, '#000000', 0);
      main.ignore(text);

      return text;
    });
    this.downPanel = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: `${String(DOWN_PANEL_FONT_PX)}px`,
        color: '#d8f8ff',
        align: 'center',
        backgroundColor: '#05030acc',
      })
      .setOrigin(0.5, 0)
      .setShadow(1, 1, '#000000', 0)
      .setVisible(false);
    main.ignore(this.downPanel);
    this.missionFrame = this.add.graphics().setVisible(false);
    this.missionBanner = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: `${String(DOWN_PANEL_FONT_PX)}px`,
        color: MISSION_CSS,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setShadow(1, 1, '#000000', 0)
      .setVisible(false);
    main.ignore([this.missionFrame, this.missionBanner]);
    this.bossBar = new BossBarView(this, (object) => main.ignore(object));
    this.missionArrow = this.add.graphics();
    this.missionLabel = this.add
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: MISSION_CSS })
      .setOrigin(0.5)
      .setShadow(1, 1, '#000000', 0);
    this.eventLabel = this.add
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: EVENT_CSS })
      .setOrigin(0.5)
      .setShadow(1, 1, '#000000', 0);
    main.ignore([this.missionArrow, this.missionLabel, this.eventLabel]);
    this.maps = new MapView(this, (objects) => main.ignore(objects));
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
      if (this.settingsScreen.open) {
        this.settingsKey(event);
      } else if (this.victoryScreen.open) {
        this.victoryKey(event);
      } else if (this.maps.open) {
        this.mapKey(event);
      } else if (this.loadoutScreen.open) {
        this.loadoutKey(event);
      } else if (event.code === 'Tab' && this.canOpenMap()) {
        event.preventDefault();
        this.maps.toggle();
      } else if (event.code === 'KeyL') {
        this.openLoadout();
      } else if (event.code === 'KeyO') {
        this.openVictory();
      } else if (event.code === 'KeyQ') {
        this.pressOrders();
      } else if (event.code === 'Escape') {
        this.openSettings();
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
    // A click on the open full map sends the squadron there (#100, decision 10).
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (this.touchOn) {
        // Touches are the touch controls' own (#180).
        return;
      }
      const sector = this.maps.pick(pointer.x, pointer.y, this.net?.clearedSectors ?? new Set(), this.net?.frontier ?? ALL_OPEN);
      if (sector !== undefined) {
        this.net?.pickMission(sector);
      }
    });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });
  }

  /** The full map opens online, and not over the join screen or the order ring, where Tab and the mouse are theirs. */
  private canOpenMap(): boolean {
    const squadronScreen = document.querySelector<HTMLFormElement>('#squadron-form');

    return this.net?.status === 'online' && this.orderPress === undefined && squadronScreen?.hidden !== false;
  }

  /** A key while the full map is open: Tab and Esc close it, and the rest wait. */
  private mapKey(event: KeyboardEvent): void {
    if (event.code === 'Tab' || event.code === 'Escape') {
      event.preventDefault();
      this.maps.close();
    }
  }

  /** Shades the closed sectors and finds their sides with the open ones, whenever the frontier changes (#123). */
  private drawClosed(): void {
    const version = this.net?.frontierVersion ?? 0;
    if (version === this.closedDrawn) {
      return;
    }
    this.closedDrawn = version;
    const frontier = this.net?.frontier ?? ALL_OPEN;
    const g = this.closedLayer.clear();
    for (const name of SECTOR_NAMES) {
      if (sectorOpen(name, frontier)) {
        continue;
      }
      const [first, ...rest] = sectorCorners(name);
      if (first !== undefined) {
        g.fillStyle(0x000000, CLOSED_SHADE_ALPHA).beginPath().moveTo(first.x, first.y);
        for (const corner of rest) {
          g.lineTo(corner.x, corner.y);
        }
        g.closePath().fillPath();
      }
    }
    this.closedSides = closedEdges(frontier);
  }

  /** Draws the force field along the closed sides near the ship, and zaps while the ship is in its push-back band (#127). */
  private drawField(time: number): void {
    const g = this.fieldLayer.clear();
    const ship = this.sim.ship;
    for (const { samples, nx, ny } of fieldSides(this.closedSides, ship, time / 1000)) {
      if (this.effects) {
        for (const s of samples) {
          g.fillStyle(fieldColor(s.flare), FIELD_GLOW_ALPHA * s.flicker * (1 + s.flare * 3));
          g.fillCircle(s.x, s.y, FIELD_GLOW_RADIUS * (1 + s.flare));
          g.fillCircle(s.x, s.y, FIELD_CORE_RADIUS * (1 + s.flare));
        }
      }
      samples.forEach((s, i) => {
        const prev = samples[i - 1];
        if (prev === undefined) {
          return;
        }
        g.lineStyle(1, fieldColor(s.flare), Math.min(1, FIELD_STRAND_ALPHA * s.flicker * (1 + s.flare * 1.2)));
        g.lineBetween(prev.x, prev.y, s.x, s.y);
        if (!this.effects) {
          return;
        }
        g.lineStyle(1, fieldColor(s.flare / 2), Math.min(1, FIELD_STRAND_ALPHA * 0.6 * s.flicker * (1 + s.flare * 1.5)));
        g.lineBetween(prev.x2, prev.y2, s.x2, s.y2);
        if (s.flare > 0.3 && sparks(i, time / 1000)) {
          const jump = Math.sin(i + time / 25) * FIELD_SPARK_JUMP;
          g.fillStyle(FIELD_SPARK_COLOR, s.flare).fillRect(s.x + nx * jump, s.y + ny * jump, 1, 1);
        }
      });
    }
    const volume = zapVolume(nearestSide(this.closedSides, ship));
    if (volume > 0 && time - this.lastZap >= FIELD_ZAP_EVERY_MS) {
      this.lastZap = time;
      this.fieldZaps++;
      this.audio.fieldZap(volume);
    }
  }

  /** Draws the maps, and hides the HUD's lines under the open full map (#100, decision 9). */
  private drawMaps(): void {
    const now = performance.now();
    // The full map answers the mouse, so it draws every frame; the minimap alone needs far less.
    if (this.maps.open || now - this.mapsDrawnAt >= MINIMAP_REDRAW_MS) {
      this.mapsDrawnAt = now;
      const net = this.net;
      const state = net?.status === 'online' ? net.mapState(this.sim.ship) : undefined;
      this.maps.draw(state, net?.mapName ?? '', now);
    }
    const alpha = this.maps.open ? 0 : 1;
    for (const o of [this.hud, ...this.partsLine, this.missionBanner, this.missionFrame, this.missionArrow, this.missionLabel, this.eventLabel]) {
      o.setAlpha(alpha);
    }
  }

  /** Opens the victory screen once the season is won (#156), over the map or the loadout screen. */
  private openVictory(): void {
    const result = this.net?.seasonResult;
    if (result === undefined) {
      return;
    }
    this.maps.close();
    this.loadoutScreen.hide();
    this.victoryScreen.show(result, this.net?.playerId);
  }

  /** Opens the victory screen when the season is won, or for a joiner seeing a won season the first time (#156). */
  private openVictoryIfDue(): void {
    if (this.net?.takeVictory() === true) {
      this.openVictory();
    }
  }

  /** A key while the victory screen is open: O and Esc close it, and the rest wait. */
  private victoryKey(event: KeyboardEvent): void {
    if (event.code === 'KeyO' || event.code === 'Escape') {
      this.victoryScreen.hide();
    }
  }

  /** Whether a screen or the full map covers the game, so the ship holds still and the touch controls hide. */
  private get screenOpen(): boolean {
    return this.loadoutScreen.open || this.maps.open || this.victoryScreen.open || this.settingsScreen.open;
  }

  /** Opens the settings screen (#145), unless the join screen or the order ring is up. */
  private openSettings(): void {
    const squadronScreen = document.querySelector<HTMLFormElement>('#squadron-form');
    if (this.orderPress !== undefined || squadronScreen?.hidden === false) {
      return;
    }
    this.settingsScreen.show(optionRows(this.options()));
  }

  /** A key while the settings screen is open: Esc closes it, the arrows and Enter are its own, and the rest wait. */
  private settingsKey(event: KeyboardEvent): void {
    if (event.code === 'Escape') {
      this.settingsScreen.hide();
    } else {
      this.settingsScreen.key(event);
    }
  }

  /** The settings screen's options, as they are now. */
  private options(): Options {
    return {
      sound: !this.audioSettings.muted,
      music: this.audioSettings.music,
      controls: this.sim.controlMode,
      snapRotation: this.sim.ship.rotationSnap !== 0,
      effects: this.effects,
      fpsCap: this.displaySettings.fpsCap,
      lowResolution: this.displaySettings.cssPixels,
    };
  }

  /** Changes one option to its next value, applies it at once and remembers it (#145). */
  private setOption(id: OptionId): void {
    const next = changeOption(this.options(), id);
    switch (id) {
      case 'sound':
        this.audio.toggleMute();
        saveAudioSettings(this.audioSettings);
        break;
      case 'music':
        this.audio.toggleMusic();
        saveAudioSettings(this.audioSettings);
        break;
      case 'controls':
        this.sim.controlMode = next.controls;
        saveControlMode(next.controls);
        break;
      case 'snapRotation':
        this.sim.setRotationSnap(next.snapRotation ? ROTATION_SNAP_STEPS : 0);
        break;
      case 'effects':
        this.setEffects(next.effects);
        break;
      case 'fpsCap':
        this.displaySettings = { ...this.displaySettings, fpsCap: next.fpsCap };
        saveDisplaySettings(this.displaySettings);
        this.game.loop.setFPSLimit(next.fpsCap ? FPS_CAP : 0);
        break;
      case 'lowResolution':
        this.displaySettings = { ...this.displaySettings, cssPixels: next.lowResolution };
        saveDisplaySettings(this.displaySettings);
        // The window fit in main.ts reads the setting and resizes the canvas.
        window.dispatchEvent(new Event('resize'));
        break;
    }
    if (id === 'snapRotation' || id === 'effects') {
      saveViewSettings({ snapRotation: next.snapRotation, effects: next.effects });
    }
    this.settingsScreen.update(optionRows(this.options()));
    this.updateHud();
  }

  /** Opens the loadout screen, only at the home planet and with the ship up (#78, decisions 2 and 4). */
  private openLoadout(): void {
    const ship = this.sim.ship;
    const squadronScreen = document.querySelector<HTMLFormElement>('#squadron-form');
    const busy = this.orderPress !== undefined || squadronScreen?.hidden === false;
    if (busy || this.sim.downed || Math.hypot(ship.x, ship.y) > SAFE_ZONE_RADIUS) {
      return;
    }
    this.loadoutScreen.show({
      fit: (loadout) => {
        this.fit(loadout);
        this.applyLoadout();
        this.audio.partSwitched();
      },
      summon: () => this.net?.summon(),
    });
    this.updateLoadoutScreen();
  }

  /** A key while the loadout screen is open: L and Esc close it, and the rest are its own. */
  private loadoutKey(event: KeyboardEvent): void {
    if (event.code === 'KeyL' || event.code === 'Escape') {
      this.loadoutScreen.hide();
    } else if (event.code === 'KeyG') {
      this.net?.summon();
    } else if (this.loadoutScreen.key(event.code)) {
      event.preventDefault();
    }
  }

  /** Keeps the open screen current, and closes it once the ship is away from home or down. */
  private updateLoadoutScreen(): void {
    if (!this.loadoutScreen.open) {
      return;
    }
    const ship = this.sim.ship;
    if (this.sim.downed || Math.hypot(ship.x, ship.y) > SAFE_ZONE_RADIUS) {
      this.loadoutScreen.hide();

      return;
    }
    const net = this.net;
    const hangar = net === undefined ? 'Hangar: offline' : (hangarLine(net.hangar, true) ?? 'Hangar: …');
    const out =
      net === undefined ? '' : ` · ${String(net.companionCount)} of ${String(net.companionLimit)} companions out`;
    this.loadoutScreen.update(
      this.net?.unlocks ?? defaultUnlocks(),
      ship.loadout,
      `${hangar}${out} · they pick from your parts, spread across the squadron`,
    );
  }

  /** The 1/2/3 keys fit any part in development and offline; elsewhere the loadout screen does (#78). */
  private get partKeys(): boolean {
    return this.net?.status !== 'online' || this.net.development;
  }

  private handleDebugKey(code: string): void {
    const ship = this.sim.ship;
    if (!this.partKeys && (code === 'Digit1' || code === 'Digit2' || code === 'Digit3')) {
      return;
    }
    switch (code) {
      case 'KeyK':
        this.net?.devStartAttack();
        break;
      case 'KeyY':
        this.net?.devSeasonWon();
        break;
      case 'Digit1':
        this.fit({ ...ship.loadout, weapon: nextInCycle(WEAPONS, ship.loadout.weapon) });
        this.applyLoadout();
        this.audio.partSwitched();
        break;
      case 'Digit2':
        this.fit({ ...ship.loadout, engine: nextInCycle(ENGINES, ship.loadout.engine) });
        this.applyLoadout();
        this.audio.partSwitched();
        break;
      case 'Digit3':
        this.fit({ ...ship.loadout, shield: nextInCycle(SHIELDS, ship.loadout.shield) });
        this.applyLoadout();
        this.audio.shieldSwitched();
        break;
      case 'KeyH':
        this.respawn(false);
        break;
      case 'KeyJ':
        this.respawn(true);
        break;
      case 'KeyG':
        this.net?.summon();
        this.updateHud();
        break;
      default:
    }
  }

  /** Q down: remember where the pointer is. */
  private pressOrders(at?: Point): void {
    this.closeOrderRing();
    const pointer = this.input.activePointer;
    const screen = at ?? { x: pointer.x, y: pointer.y };
    const world = this.cameras.main.getWorldPoint(screen.x, screen.y);
    this.orderPress = {
      downAt: this.time.now,
      touch: at !== undefined,
      screenX: screen.x,
      screenY: screen.y,
      worldX: world.x,
      worldY: world.y,
      labels: undefined,
      backdrop: undefined,
      extras: [],
    };
  }

  /** While Q is held: open the ring once held long enough, and light the item pointed at. */
  private updateOrderMenu(time: number): void {
    const press = this.orderPress;
    if (press === undefined || time - press.downAt < ORDER_HOLD_MS) {
      return;
    }
    press.labels ??= this.openOrderRing(press);
    const picked = this.pickedOrder(press);
    this.drawRingBackdrop(press, picked);
    press.labels.forEach((label, i) => {
      const item = ORDER_ITEMS[i];
      label.setColor(i === picked || item === undefined ? ORDER_PICKED_TEXT : hex(ORDER_COLORS[item.kind]));
      label.setScale(i === picked ? 1.15 : 1);
    });
  }

  /** Lays out the ring: a label and its pack icon per order, and the wing's mode in the center. */
  private openOrderRing(press: OrderPress): Phaser.GameObjects.Text[] {
    const dpr = this.dpr();
    const style = { fontFamily: 'monospace', fontSize: `${String(HUD_FONT_PX * dpr)}px` };
    const info = this.net?.squadronInfo;
    const mode = info === undefined ? undefined : fromCompanionMode(info.mode) ?? 'escort';
    press.backdrop = this.add.graphics();
    this.cameras.main.ignore(press.backdrop);
    const labels = ORDER_ITEMS.map((item, i) => {
      const at = itemPosition(i, ORDER_RING_PX * dpr);
      const x = press.screenX + at.x;
      const y = press.screenY + at.y + ORDER_LABEL_DROP * dpr;
      // A dot marks the mode the wing is in.
      const inForce = item.kind === 'mode' && item.mode === mode;
      const label = this.add
        .text(x, y, `${inForce ? '• ' : ''}${item.label}`, { ...style, color: hex(ORDER_COLORS[item.kind]) })
        .setOrigin(0.5)
        .setShadow(1, 1, '#000000', 0);
      this.cameras.main.ignore(label);
      const icon = ORDER_ICONS[item.label];
      if (icon !== undefined) {
        const image = this.add
          .image(x, press.screenY + at.y - ORDER_ICON_RISE * dpr, icon.key, icon.frame ?? 0)
          .setScale(icon.scale * dpr);
        if (icon.dim === true) {
          image.setTint(0x9a9a9a);
        }
        this.cameras.main.ignore(image);
        press.extras.push(image);
      }

      return label;
    });
    const count = this.net?.companionCount ?? 0;
    const center = this.add
      .text(
        press.screenX,
        press.screenY,
        count === 0 || info === undefined ? 'no companions' : `wing (${String(count)})\n${modeName(info)}`,
        { ...style, color: '#ffffff', align: 'center' },
      )
      .setOrigin(0.5)
      .setShadow(1, 1, '#000000', 0);
    this.cameras.main.ignore(center);
    press.extras.push(center);

    return labels;
  }

  /** The ring's backdrop, with the wedge of the item pointed at lit in its color. */
  private drawRingBackdrop(press: OrderPress, picked: number | undefined): void {
    const g = press.backdrop;
    if (g === undefined) {
      return;
    }
    const dpr = this.dpr();
    const rx = (ORDER_RING_PX * RING_ASPECT + ORDER_BACKDROP_PAD) * dpr;
    const ry = (ORDER_RING_PX + ORDER_BACKDROP_PAD) * dpr;
    const { screenX: cx, screenY: cy } = press;
    g.clear();
    g.fillStyle(ORDER_BACKDROP, ORDER_BACKDROP_ALPHA).fillEllipse(cx, cy, rx * 2, ry * 2);
    g.lineStyle(dpr, ORDER_COLORS.mode, 0.35).strokeEllipse(cx, cy, rx * 2, ry * 2);
    const item = picked === undefined ? undefined : ORDER_ITEMS[picked];
    if (picked === undefined || item === undefined) {
      return;
    }
    const n = ORDER_ITEMS.length;
    const mid = -Math.PI / 2 + (picked * Math.PI * 2) / n;
    const points = [new Phaser.Math.Vector2(cx, cy)];
    const steps = 8;
    for (let k = 0; k <= steps; k++) {
      const a = mid - Math.PI / n + (k * 2 * Math.PI) / n / steps;
      points.push(new Phaser.Math.Vector2(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
    }
    g.fillStyle(ORDER_COLORS[item.kind], 0.22).fillPoints(points, true);
  }

  private pickedOrder(press: OrderPress): number | undefined {
    const pointer = press.touch ? (this.touch.position('orders') ?? { x: press.screenX, y: press.screenY }) : this.input.activePointer;

    return pickItem(pointer.x - press.screenX, pointer.y - press.screenY, ORDER_DEAD_ZONE_PX * this.dpr());
  }

  /** Drops a Q press and its ring without giving an order. */
  private closeOrderRing(): void {
    if (this.orderPress !== undefined) {
      destroyRing(this.orderPress);
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
      const world = press.touch ? { x: press.worldX, y: press.worldY } : (this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2);
      if (this.lastOrder === undefined) {
        this.net?.say('no order to repeat yet: hold Q');
      } else {
        this.giveOrder(this.lastOrder, { ...press, worldX: world.x, worldY: world.y });
      }

      return;
    }
    const picked = this.pickedOrder(press);
    destroyRing(press);
    const item = picked === undefined ? undefined : ORDER_ITEMS[picked];
    if (item !== undefined) {
      this.giveOrder(item, press);
    }
  }

  /**
   * Gives an order to the squadron: the hub gives it to every companion in
   * it, and squadmates see it as a callout.
   */
  private giveOrder(item: OrderItem, press: Pick<OrderPress, 'worldX' | 'worldY'>): void {
    const net = this.net;
    if (net === undefined) {
      return;
    }
    // Squadmates hear the order even when nobody has companions yet; alone, it needs some.
    const squadmates = (net.squadronInfo?.members.length ?? 1) - 1;
    if (net.companionCount === 0 && squadmates === 0) {
      net.say('no companions: press G at the home planet');

      return;
    }
    const focusEnemyId = chooseFocus(net.enemyList, press.worldX, press.worldY, net.lastHit, performance.now());
    if (item.kind === 'oneShot' && item.oneShot === 'focus' && focusEnemyId === undefined) {
      net.say('no enemy to focus: hit one, or point at it');

      return;
    }
    this.lastOrder = item;
    net.orderSquadron(item, { pointX: press.worldX, pointY: press.worldY, focusEnemyId });
    net.say(item.label);
    this.updateHud();
  }

  /** Device pixels per CSS pixel the canvas renders at, for sizing the HUD: 1 when P picked CSS pixels (#143). */
  private dpr(): number {
    const ratio = renderRatio(window.devicePixelRatio > 0 ? window.devicePixelRatio : 1, this.displaySettings.cssPixels);

    // On a phone the drawn UI shrinks with the touch controls, to leave room to play (#180, decision 7).
    return this.touchOn ? touchUnit(this.scale.height, ratio) : ratio;
  }

  /** Fits a loadout, each part at the tier this player owns it at. */
  private fit(loadout: Loadout): void {
    this.sim.setLoadout(withTiers(loadout, this.net?.unlocks ?? new Map()));
    this.net?.sendStateNow();
  }

  private applyLoadout(): void {
    const { weapon, engine } = this.sim.ship.loadout;
    this.shownLoadout = loadoutKey(this.sim.ship.loadout);
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
    if (this.touchOn) {
      this.insets = this.safeInsets();
    }
    const effectScale = zoom / EFFECT_ZOOM;
    if (this.bloomBlur !== undefined) {
      this.bloomBlur.x = BLOOM_BLUR * effectScale * BLOOM_SCALE;
      this.bloomBlur.y = BLOOM_BLUR * effectScale * BLOOM_SCALE;
    }
    this.hudCamera.setSize(width, height);
    this.vignette.setDisplaySize(width, height);
    const dpr = this.dpr();
    this.hud.setFontSize(HUD_FONT_PX * dpr);
    this.layoutHud();
    this.maps.resize(width, height, dpr);
    this.bossBar.resize(width, dpr);
    this.downPanel
      .setFontSize(DOWN_PANEL_FONT_PX * dpr)
      .setPadding(DOWN_PANEL_PADDING_X * dpr, DOWN_PANEL_PADDING_Y * dpr)
      .setPosition(width / 2, height * DOWN_PANEL_Y);
    this.missionBanner
      .setFontSize(DOWN_PANEL_FONT_PX * dpr)
      .setPadding(DOWN_PANEL_PADDING_X * dpr, DOWN_PANEL_PADDING_Y * dpr)
      .setPosition(width / 2, height * MISSION_BANNER_Y);
    this.drawMissionFrame();
    for (const { sprite } of this.backgrounds) {
      sprite.setPosition(width / 2, height / 2).setSize(Math.ceil(width / zoom), Math.ceil(height / zoom));
    }
  }

  /** Turns the touch controls on (#180): screen-relative sticks, their view, and the canvas's touches. */
  private createTouch(): void {
    this.sim.controlMode = 'screen';
    document.body.classList.add('touch');
    this.touchView = new TouchView(this, (object) => {
      this.cameras.main.ignore(object);
    });
    const canvas = this.game.canvas;
    const at = (t: Touch): Point => {
      const r = canvas.getBoundingClientRect();

      return { x: ((t.clientX - r.left) * canvas.width) / r.width, y: ((t.clientY - r.top) * canvas.height) / r.height };
    };
    const onStart = (event: TouchEvent): void => {
      event.preventDefault();
      for (const t of event.changedTouches) {
        this.touchStart(t.identifier, at(t));
      }
    };
    const onMove = (event: TouchEvent): void => {
      event.preventDefault();
      for (const t of event.changedTouches) {
        const p = at(t);
        this.touch.moveTo(t.identifier, p.x, p.y);
      }
    };
    const onEnd = (event: TouchEvent): void => {
      event.preventDefault();
      // On a lift, not a landing: browsers only allow fullscreen from a completed tap.
      this.askFullscreen();
      for (const t of event.changedTouches) {
        this.touchEnd(t.identifier);
      }
    };
    const onBlur = (): void => {
      this.touch.clear();
    };
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd, { passive: false });
    canvas.addEventListener('touchcancel', onEnd, { passive: false });
    window.addEventListener('blur', onBlur);
    // A tap on the victory screen closes it; it has nothing else to tap.
    const victory = document.querySelector('#victory-form');
    const closeVictory = (): void => {
      this.victoryScreen.hide();
    };
    victory?.addEventListener('click', closeVictory);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      canvas.removeEventListener('touchstart', onStart);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onEnd);
      canvas.removeEventListener('touchcancel', onEnd);
      window.removeEventListener('blur', onBlur);
      victory?.removeEventListener('click', closeVictory);
    });
  }

  /** Asks for fullscreen once, on the first touch, where the browser has it. */
  private askFullscreen(): void {
    if (this.askedFullscreen) {
      return;
    }
    this.askedFullscreen = true;
    this.switchFullscreen(true);
  }

  /** Switches the page to fullscreen or back, where the browser can: iPadOS Safari only by its webkit names, an iPhone's not at all. */
  private switchFullscreen(on: boolean): void {
    const page: { requestFullscreen?: () => Promise<void>; webkitRequestFullscreen?: () => void } = document.documentElement;
    const doc: { exitFullscreen?: () => Promise<void>; webkitExitFullscreen?: () => void } = document;
    if (on) {
      if (page.requestFullscreen !== undefined) {
        page.requestFullscreen().catch(() => undefined);
      } else {
        page.webkitRequestFullscreen?.();
      }
    } else if (this.fullscreenState() === true) {
      if (doc.exitFullscreen !== undefined) {
        doc.exitFullscreen().catch(() => undefined);
      } else {
        doc.webkitExitFullscreen?.();
      }
    }
  }

  /** Whether the page is fullscreen, or undefined where the browser can't switch. */
  private fullscreenState(): boolean | undefined {
    const doc: { fullscreenEnabled?: boolean; webkitFullscreenEnabled?: boolean; fullscreenElement?: Element | null; webkitFullscreenElement?: Element | null } =
      document;
    if (doc.fullscreenEnabled !== true && doc.webkitFullscreenEnabled !== true) {
      return undefined;
    }

    return (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) !== null;
  }

  /** The notch's safe area on the left and right, in canvas pixels, from the page's safe-area probe. */
  private safeInsets(): { insetLeft: number; insetRight: number } {
    const probe = document.querySelector('#safe-area');
    if (probe === null) {
      return { insetLeft: 0, insetRight: 0 };
    }
    const style = getComputedStyle(probe);
    const toCanvas = this.scale.width / Math.max(1, window.innerWidth);

    return { insetLeft: parseFloat(style.paddingLeft) * toCanvas || 0, insetRight: parseFloat(style.paddingRight) * toCanvas || 0 };
  }

  /** A touch lands: it closes an open screen or map, picks a sector, or starts a stick, a button or the map. */
  private touchStart(id: number, p: Point): void {
    if (this.settingsScreen.open) {
      this.settingsScreen.hide();

      return;
    }
    if (this.victoryScreen.open) {
      this.victoryScreen.hide();

      return;
    }
    if (this.loadoutScreen.open) {
      this.loadoutScreen.hide();

      return;
    }
    if (this.maps.open) {
      const sector = this.maps.pick(p.x, p.y, this.net?.clearedSectors ?? new Set(), this.net?.frontier ?? ALL_OPEN);
      if (sector !== undefined) {
        this.net?.pickMission(sector);
      } else if (!this.maps.onFull(p.x, p.y)) {
        this.maps.close();
      }

      return;
    }
    const role = this.touch.start(id, p.x, p.y, this.scale.width, this.touchButtonRects, this.maps.onMinimap(p.x, p.y), this.dpr());
    if (role === 'orders') {
      this.pressOrders(p);
    }
  }

  /** A touch lifts: a button does its job on release, like its key. */
  private touchEnd(id: number): void {
    switch (this.touch.end(id)) {
      case 'orders':
        this.releaseOrders();
        break;
      case 'summon':
        this.net?.summon();
        break;
      case 'loadout':
        this.openLoadout();
        break;
      case 'settings':
        this.openSettings();
        break;
      case 'respawnHome':
        this.respawn(false);
        break;
      case 'respawnBeside':
        this.respawn(true);
        break;
      case 'fullscreen':
        this.switchFullscreen(this.fullscreenState() !== true);
        break;
      case 'map':
        if (this.canOpenMap()) {
          this.maps.toggle();
        }
        break;
      case 'move':
      case 'aim':
      case undefined:
        break;
    }
  }

  /** The touch sticks as input (#180): the left one moves, and the right one aims and fires while pushed. */
  private readTouch(): InputSnapshot {
    const { x, y, angle } = this.sim.ship;
    const move = this.touch.stick('move');
    const aim = this.touch.aim() ?? { x: Math.cos(angle), y: Math.sin(angle) };

    return {
      up: false,
      down: false,
      left: false,
      right: false,
      moveX: move.x,
      moveY: move.y,
      pointerX: x + aim.x * TOUCH_AIM_REACH,
      pointerY: y + aim.y * TOUCH_AIM_REACH,
      fire: this.touch.firing,
    };
  }

  /** Lays out and draws the touch buttons and sticks; none over a screen or the full map. */
  private drawTouch(): void {
    if (this.touchView === undefined) {
      return;
    }
    const ship = this.sim.ship;
    this.touchButtonRects = this.screenOpen
      ? []
      : touchButtons({
          width: this.scale.width,
          height: this.scale.height,
          dpr: renderRatio(window.devicePixelRatio > 0 ? window.devicePixelRatio : 1, this.displaySettings.cssPixels),
          atHome: Math.hypot(ship.x, ship.y) <= SAFE_ZONE_RADIUS,
          down: this.sim.downed,
          canRespawn: this.sim.canRespawn,
          beside: this.net?.nearestSquadmate()?.name,
          fullscreen: this.fullscreenState(),
          ...this.insets,
        });
    this.touchView.draw(this.touch, this.touchButtonRects, this.dpr());
  }

  private readInput(): InputSnapshot {
    const pointer = this.input.activePointer;
    const aim = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    if (this.touchOn && !this.screenOpen) {
      return this.readTouch();
    }
    if (this.screenOpen) {
      // The ship holds still under the screen or the map, still facing where it was (#78 and #100).
      const { x, y, angle } = this.sim.ship;

      return {
        up: false,
        down: false,
        left: false,
        right: false,
        pointerX: x + Math.cos(angle),
        pointerY: y + Math.sin(angle),
        fire: false,
      };
    }

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
    this.ship.setDamage(ship.damage);
    this.ship.setShield(ship.shield);
    this.ship.setDown(this.sim.downed, ship.revive, this.cameras.main.zoom);
    this.animateWeapon(events);
  }

  /** While the ship is down: how to get back, respawning once it may (#47). */
  private updateDownPanel(): void {
    if (!this.sim.downed) {
      this.downPanel.setVisible(false);

      return;
    }
    const beside = this.net?.nearestSquadmate();
    const keys = `[H] respawn at home${beside === undefined ? '' : `      [J] respawn beside ${beside.name}`}`;
    const choices = this.sim.canRespawn
      ? this.touchOn
        ? 'respawn with a button above'
        : keys
      : `respawn in ${String(Math.ceil(RESPAWN_DELAY - this.sim.ship.downFor))} s`;
    const text = ["You're down", '', choices, 'or stay: a friend close by revives you'].join('\n');
    if (this.downPanel.text !== text) {
      this.downPanel.setText(text);
    }
    this.downPanel.setVisible(true);
  }

  /** Respawns at home, or beside the nearest squadmate that is up, once the ship may. */
  private respawn(beside: boolean): void {
    if (!beside) {
      this.respawned = this.sim.respawn(0, HOME_SPAWN_Y) || this.respawned;

      return;
    }
    const mate = this.net?.nearestSquadmate();
    if (mate !== undefined) {
      this.respawned = this.sim.respawn(mate.x + BRAIN_SPACING, mate.y) || this.respawned;
    }
  }

  /** Counts the ship coming back up without a respawn: a friend revived it. */
  private countRevive(): void {
    const down = this.sim.downed;
    if (this.wasDown && !down && !this.respawned) {
      this.revives++;
    }
    this.wasDown = down;
    this.respawned = false;
  }

  private animateWeapon(events: FrameEvents): void {
    const now = this.time.now / 1000;
    const stats = WEAPON_STATS[this.sim.ship.loadout.weapon];
    const own = events.shots;
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

  /** Our own big space gun balls that ran out burst into their star, as on every screen (#72). */
  private burstExpired(events: FrameEvents): void {
    for (const e of events.expired) {
      if (e.faction === 'own' && e.kind === 'bigSpaceGun') {
        this.sim.burst(e.kind, 'own', e.x, e.y, e.shotId, this.net?.playerId ?? '');
      }
    }
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
      if (p.kind === 'shard') {
        // A burst's shard: the auto cannon's shot, recolored gold (#72).
        sprite.play(keys.projectile('autoCannon'), true).setTint(SHARD_TINT).setScale(1);
      } else if (isWeapon(p.kind)) {
        sprite.play(keys.projectile(p.kind), true).clearTint().setScale(1);
      } else if (this.effects) {
        // Its glow baked in at twice the art's size (#143).
        sprite.play(keys.enemyBulletGlow(p.kind), true).clearTint().setScale(BAKED_GLOW_SCALE);
      } else {
        sprite.play(keys.enemyBullet(p.kind), true).clearTint().setScale(1);
      }
      // Pooled sprites carry every faction in turn: move each to its layer.
      const layer = p.faction === 'enemy' ? this.enemyFire : this.world;
      if (sprite.displayList !== layer) {
        sprite.displayList.remove(sprite);
        layer.add(sprite);
      }
    });
  }

  private playEffects(events: FrameEvents): void {
    this.shotsFired += events.shots.length;
    if (!this.effects) {
      return;
    }
    for (const shot of events.shots) {
      this.muzzleFlash.explode(3, shot.x, shot.y);
    }
    for (const p of events.expired) {
      this.puff.explode(4, p.x, p.y);
      if (p.faction === 'own' && isWeapon(p.kind)) {
        this.shakeFor(p.kind);
      }
    }
  }

  /** Our own shot bursting shakes the camera, if its weapon does. */
  private shakeFor(weapon: WeaponId): void {
    const shake = WEAPON_STATS[weapon].shake;
    if (this.effects && shake > 0) {
      this.cameras.main.shake(120, shake);
      this.debug.shakes++;
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
    for (const weapon of net.ownBursts) {
      this.shakeFor(weapon);
    }
  }

  /** Scrolls each layer at its parallax factor and tints it for the ship's ring; TileSprites cannot play animations, so frames step here. */
  private scrollBackgrounds(time: number, deltaMs: number): void {
    const camera = this.cameras.main;
    const frame = Math.floor((time / 1000) * BACKGROUND_FPS) % BACKGROUND_FRAMES;
    const frameChanged = frame !== this.backgroundFrame;
    this.backgroundFrame = frame;
    const tint = fadeColor(this.backgroundTint, ringTint(this.sim.ship.x, this.sim.ship.y), deltaMs / RING_TINT_FADE_MS);
    const tintChanged = tint !== this.backgroundTint;
    this.backgroundTint = tint;
    for (const { sprite, factor } of this.backgrounds) {
      sprite.setTilePosition(camera.scrollX * factor, camera.scrollY * factor);
      if (frameChanged) {
        sprite.setFrame(frame);
      }
      if (tintChanged) {
        sprite.setTint(tint);
      }
    }
  }

  /** Times the GPU's work for each frame, where the browser can (#143). */
  private timeGpu(): void {
    const renderer = this.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) {
      return;
    }
    const timer = new GpuTimer(renderer.gl);
    if (!timer.available) {
      return;
    }
    this.gpuTimer = timer;
    renderer.on(Phaser.Renderer.Events.PRE_RENDER, () => {
      timer.begin();
    });
    renderer.on(Phaser.Renderer.Events.POST_RENDER, () => {
      timer.end();
    });
  }

  /** Turns the bloom and the vignette on or off: F, or `?effects=0` for a device without a keyboard. The bloom stays off where it draws the world black. */
  private setEffects(on: boolean): void {
    this.effects = on;
    if (this.bloom !== undefined) {
      this.bloom.active = on && !this.bloomBroken;
    }
    this.vignette.setVisible(on);
    this.updateHud();
  }

  /**
   * Turns the bloom off for good in this browser if it draws the world black,
   * as Phaser's parallel filters do on some phones' GPUs (a PowerVR D-Series,
   * #180): a moment after the start, if every sample across the middle of the
   * screen is pure black, which the world's background never is.
   */
  private checkBloom(): void {
    const renderer = this.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) || this.bloom === undefined) {
      return;
    }
    if (loadBloomBroken()) {
      this.bloomBroken = true;
      this.bloom.active = false;

      return;
    }
    let frames = 0;
    const check = (): void => {
      frames++;
      if (frames < BLOOM_CHECK_FRAME || this.bloom?.active !== true) {
        return;
      }
      renderer.off(Phaser.Renderer.Events.POST_RENDER, check);
      const gl = renderer.gl;
      // The screen's own buffer, whatever Phaser has bound, put back after.
      const bound = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const samples = blankSamples(gl.drawingBufferWidth, gl.drawingBufferHeight).map(({ x, y }) => {
        const pixel = new Uint8Array(4);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

        return pixel;
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, bound);
      if (allBlack(samples)) {
        this.bloomBroken = true;
        this.bloom.active = false;
        saveBloomBroken();
      }
    };
    renderer.on(Phaser.Renderer.Events.POST_RENDER, check);
  }

  /** The HUD's frame rate: frames a second, the worst frame of the last second, and the GPU's time where known. */
  private fpsLine(): string {
    const gpu = this.gpuTimer?.last;

    return `${String(Math.round(this.game.loop.actualFps))} fps (worst ${this.frameTimes.worst.toFixed(1)} ms${gpu === undefined ? '' : `, gpu ${gpu.toFixed(1)} ms`})`;
  }

  private updateHud(): void {
    const { loadout, rotationSnap, damage, shield } = this.sim.ship;
    this.hud.setText([
      `weapon ${loadout.weapon}  engine ${loadout.engine}  shield ${loadout.shield} ${Math.floor(shield)}/${SHIELD_STATS[loadout.shield].strength}  hull ${damageState(damage)}`,
      `controls ${this.sim.controlMode === 'ship' ? 'ship-relative' : 'screen-relative'}  rotation ${rotationSnap === 0 ? 'free' : `${rotationSnap} directions`}  effects ${this.effects ? (this.bloomBroken ? 'on, no bloom' : 'on') : 'off'}  sound ${this.audioSettings.muted ? 'off' : 'on'}  music ${this.audioSettings.music ? 'on' : 'off'}  cap ${this.displaySettings.fpsCap ? String(FPS_CAP) : 'off'}  resolution ${this.displaySettings.cssPixels ? 'low' : 'full'}  ${this.fpsLine()}`,
      // The key lines are about keys, so a tablet goes without them (#180, decision 6).
      ...(this.touchOn ? [] : [KEY_HELP_MOVE, KEY_HELP_MORE]),
      sectorLine(this.sim.ship.x, this.sim.ship.y, this.net?.status === 'online' ? this.net.clearedSectors : undefined, this.net?.frontier),
      this.net?.mission === undefined ? '' : `Mission: ${this.net.mission}`,
      this.net?.eventLine(performance.now()) ?? '',
      this.netStatus(),
      this.squadronStatus(),
      ...(this.diagnostics?.lines() ?? []),
    ]);
    this.layoutHud();
  }

  /**
   * The HUD at the bottom left (#89): its lines, then the fitted parts under
   * them, each named in its tier's color (#77, decision 12).
   */
  private layoutHud(): void {
    const dpr = this.dpr();
    const lineHeight = this.hud.height / Math.max(1, this.hud.text.split('\n').length);
    const y = this.scale.height - HUD_MARGIN_PX * dpr - lineHeight;
    this.hud.setPosition(HUD_MARGIN_PX * dpr, y);
    const l = this.sim.ship.loadout;
    const words: [string, string][] = [
      ['parts', tierCss(0)],
      [partLabel(l.weapon, l.weaponTier), tierCss(l.weaponTier)],
      [partLabel(l.engine, l.engineTier), tierCss(l.engineTier)],
      [partLabel(l.shield, l.shieldTier), tierCss(l.shieldTier)],
    ];
    let x = this.hud.x;
    const gap = Number.parseFloat(String(this.hud.style.fontSize));
    this.partsLine.forEach((text, i) => {
      const [word, color] = words[i] ?? ['', tierCss(0)];
      text.setFontSize(this.hud.style.fontSize).setColor(color).setText(word).setPosition(x, y);
      x += text.width + gap;
    });
  }

  /** The squadron, its players and companions and orders, then the latest notice on its own line. */
  private squadronStatus(): string {
    const net = this.net;
    if (net === undefined) {
      return '';
    }
    const info = net.squadronInfo;
    const lines: string[] = [];
    if (info === undefined) {
      lines.push(net.squadron === '' ? 'no squadron yet' : net.squadron);
    } else {
      const companions = info.members.reduce((n, m) => n + m.companions, 0);
      const ai = companions === 0 ? '' : ` · ${String(companions)} companion${companions === 1 ? '' : 's'}`;
      lines.push(`${info.name}: ${info.members.map((m) => m.name).join(', ')}${ai} · ${modeName(info)}`);
    }
    const { ship } = this.sim;
    const hangar = hangarLine(net.hangar, Math.hypot(ship.x, ship.y) <= SAFE_ZONE_RADIUS);
    if (hangar !== undefined) {
      lines.push(hangar);
    }
    const notice = net.noticeText;
    if (notice !== undefined) {
      lines.push(`→ ${notice}`);
    }

    return lines.join('\n');
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
    this.debug.damage = damageState(ship.damage);
    this.debug.shield = ship.shield;
    this.debug.shieldShown = this.ship.shieldShown;
    this.debug.rotationSnap = ship.rotationSnap;
    this.debug.controlMode = this.sim.controlMode;
    this.debug.effects = this.effects;
    this.debug.fpsCap = this.game.loop.hasFpsLimit;
    this.debug.cssPixels = this.displaySettings.cssPixels;
    this.debug.enemyFireGlow = this.effects;
    const distance = nearestSide(this.closedSides, this.sim.ship);
    this.debug.field = { distance: Number.isFinite(distance) ? distance : null, zaps: this.fieldZaps };
    this.debug.projectiles = projectiles.activeCount;
    this.debug.unlocks = Object.fromEntries(this.net?.unlocks ?? []);
    this.debug.pickups = this.pickups.items.map(({ id, part, x, y }) => ({ id, part, x, y }));
    this.debug.ownShards = projectiles.items.filter((p) => p.active && p.faction === 'own' && p.kind === 'shard').length;
    this.debug.shotsFired = this.shotsFired;
    this.debug.zoom = this.cameras.main.zoom;
    this.debug.fps = this.game.loop.actualFps;
    this.debug.frameMs = { average: this.frameTimes.average, worst: this.frameTimes.worst };
    this.debug.gpuMs = this.gpuTimer?.last;
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
    this.debug.rams = this.net?.rams ?? 0;
    this.debug.downed = this.sim.downed;
    this.debug.revive = ship.revive;
    this.debug.canRespawn = this.sim.canRespawn;
    this.debug.downLabel = this.ship.downText;
    this.debug.reviveBar = this.ship.reviveShown;
    this.debug.revives = this.revives;
    this.debug.downPanel = this.downPanel.visible ? this.downPanel.text : undefined;
    this.debug.companions = (this.net?.others ?? [])
      .filter((o) => o.ownerId !== '' && o.ownerId === this.net?.playerId)
      .map((o) => ({ number: Number(o.id.slice(o.ownerId.length + 1)), x: o.x, y: o.y }));
    this.debug.squadronMode = this.net?.squadronInfo === undefined ? undefined : modeName(this.net.squadronInfo);
    this.debug.companionKills = this.net?.companionKills ?? 0;
    this.debug.notice = this.net?.noticeText;
    this.debug.orderMenuOpen = this.orderPress?.labels !== undefined;
    this.debug.squadron = this.net?.squadron ?? '';
    this.debug.hangar = this.net?.hangar;
    this.debug.squadronScreen = !(document.querySelector<HTMLFormElement>('#squadron-form')?.hidden ?? true);
    this.debug.loadoutScreen = this.loadoutScreen.open;
    this.debug.victoryScreen = this.victoryScreen.open;
    this.debug.settingsScreen = this.settingsScreen.open;
    this.debug.touchButtons = this.touchButtonRects.map((b) => b.button);
    this.debug.touchSticks = this.touch.sticks().map((s) => s.role);
    this.debug.touchFiring = this.touch.firing;
    this.debug.mapOpen = this.maps.open;
    this.debug.openRings = this.net?.frontier.openRings ?? 0;
    this.debug.openedSectors = [...(this.net?.frontier.opened ?? [])];
    this.debug.mapLayout = { ...this.maps.layout };
    this.debug.boss = this.bossBar.current;
    this.debug.mission = this.net?.mission;
    this.debug.lastClear = this.net?.lastClear;
    this.debug.worldEvent = this.net?.worldEvent === undefined ? undefined : this.net.eventLine(performance.now());
    this.debug.missionBanner = this.missionBanner.visible ? this.missionBanner.text : undefined;
    this.debug.sector = sectorLine(this.sim.ship.x, this.sim.ship.y, this.net?.status === 'online' ? this.net.clearedSectors : undefined, this.net?.frontier);
    this.debug.derelicts = this.net?.derelictList ?? [];
    this.debug.rescues = this.net?.rescues ?? 0;
    publishDebugState(this.debug);
  }
}

/** A loadout as one string, to see when it changed. */
const loadoutKey = (l: Loadout): string =>
  `${l.weapon}:${l.engine}:${l.shield}:${String(l.weaponTier)}${String(l.engineTier)}${String(l.shieldTier)}`;
