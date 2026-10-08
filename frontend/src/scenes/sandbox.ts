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
import { LAYER_FPS, LAYER_FRAMES, keys, pickupFile, weaponTiming } from '../sprites.ts';
import type { LayerLayout } from '../layers.ts';
import { drawLayer } from './starlayer.ts';
import { type InputSnapshot } from '../sim/input.ts';
import { changeOption, optionRows, type OptionId, type Options } from '../sim/options.ts';
import { SettingsScreen } from '../settingsscreen.ts';
import type { IntroScreen } from '../introscreen.ts';
import { HudView, type GaugeSlot, type PartView, type SlotKind } from '../hud.ts';
import { AnnouncementView } from '../announcement.ts';
import { connectionToast, downPanelText, hullPips, panelRows, shieldPips } from '../sim/hud.ts';
import { ENGINES, SHIELD_STATS, SHIELDS, WEAPONS, damageState, type Loadout, type WeaponId } from '../sim/loadout.ts';
import { PART_HINTS, defaultUnlocks, nextPart, ownedParts, partLabel, tierCss, withTiers, type PartId } from '../sim/parts.ts';
import { PartListTimer } from '../sim/partkeys.ts';
import { VictoryScreen } from '../victory.ts';
import { StandingsPanel } from '../standings.ts';
import { MapView, polygon } from './mapview.ts';
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
  MISSION_BANNER_MS,
  MISSION_COLOR,
  MISSION_CSS,
  SECTOR_LINE_ALPHA,
  SECTOR_LINE_COLOR,
  SECTOR_VIEW_MARGIN,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  WEAPON_STATS,
  CLOSED_SHADE_ALPHA,
  FIELD_GLOW_ALPHA,
  FIELD_SPARK_COLOR,
  FIELD_SPARK_JUMP,
  FIELD_STRAND_ALPHA,
  FIELD_ZAP_EVERY_MS,
  RING_TINT_FADE_MS,
  MINIMAP_REDRAW_MS,
  FPS_CAP,
  TOUCH_AIM_REACH,
  UI_FONT,
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
  sectorCorners,
  sectorLine,
  sectorName,
  sectorState,
  sectorOpen,
  sectorsInView,
} from '../sim/sectors.ts';
import { musicPlace } from '../sim/music.ts';
import { asteroidField } from '../sim/world.ts';
import { integerZoom } from '../sim/zoom.ts';
import { SquadronScreen, modeName } from '../squadrons.ts';
import { WeaponAnimator } from '../weaponframes.ts';
import { bossBar } from '../net/boss.ts';
import { ShipAudio } from './audio.ts';
import { BossBarView } from './bossbar.ts';
import { FieldGlow } from './fieldglow.ts';
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
import { isSoftwareRenderer, rendererName } from '../renderer.ts';

/** How far each background layer moves relative to the camera. */
const PARALLAX = [0.05, 0.15, 0.3] as const;
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
/** Bloom's threshold and blur run at this share of the screen's size (#143). */
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
/** Bottom right: the keys to the intro screen, which lists the rest (#193), and the settings. */
const KEY_HINT = 'F1 help · Esc settings';
/** Holding Q this long opens the order ring; a shorter tap repeats the last order. */
const ORDER_HOLD_MS = 200;
/** The gauge slot each part key switches, and whose list it shows (#191, #259). */
const PART_KEY_SLOTS: ReadonlyMap<string, SlotKind> = new Map([
  ['Digit1', 'weapon'],
  ['Digit2', 'engine'],
  ['Digit3', 'shield'],
]);
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
  /** A stars layer's pieces (#222), drawn into the texture the sprite tiles; without, the sprite steps its sheet's frames. */
  pieces: { sheet: string; layout: LayerLayout; texture: Phaser.Textures.DynamicTexture } | undefined;
}

/** What the game scene shares with the front door (#227). */
export interface SandboxOptions {
  /** The intro screen, which the front door opens on a first visit. */
  intro: IntroScreen;
  /** Runs once the scene is up. */
  ready: () => void;
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
  /** The HUD's page elements (#91): the gauge, the panel and the toasts. */
  private readonly hudView = new HudView((kind, part) => {
    this.fitPart(kind, part);
  });
  /** Whether the text HUD shows frames per second: F3 on a development server (#91, decision 2). */
  private showFps = false;
  /** The own ship's loadout as last drawn, so any change redraws it. */
  private shownLoadout = '';
  private ship!: ShipView;
  private net: NetPlay | undefined;
  private readonly victoryScreen = new VictoryScreen();
  private readonly settingsScreen = new SettingsScreen((row) => {
    this.setOption(row.id);
  });
  private readonly squadronScreen = new SquadronScreen();
  /** The intro screen (#193), from the first visit's front door (#227) and from F1. */
  private readonly introScreen: IntroScreen;
  /** Tells the front door the game is up. */
  private readonly ready: () => void;
  /** The season so far on the join screen, and above the down panel while down or while Tab is held (#167). */
  private readonly standingsJoin = new StandingsPanel('#standings-join');
  private readonly standingsDown = new StandingsPanel('#standings-down');
  private standingsHeld = false;
  /** Twin-stick touch controls on a tablet (#180). */
  private readonly touchOn = touchMode((query) => window.matchMedia(query).matches, window.location.search);
  private readonly touch = new TouchControls();
  private touchView: TouchView | undefined;
  private touchButtonRects: ButtonRect[] = [];
  private askedFullscreen = false;
  /** The notch's safe area, read on resize (#180). */
  private insets = { insetLeft: 0, insetRight: 0 };
  private maps!: MapView;
  /** The sector edges near the view (#99) and the closed ones' shade (#123), with the frontier and the sectors they were drawn for (#265). */
  private sectorLines!: Phaser.GameObjects.Graphics;
  private closedLayer!: Phaser.GameObjects.Graphics;
  private closedDrawn = -1;
  private sectorsDrawn = '';
  /** The force field on the closed sectors' edge (#127): its sides, its layer, drawn every frame, and its zaps. */
  private closedSides: Side[] = [];
  private fieldLayer!: Phaser.GameObjects.Graphics;
  private fieldGlow!: FieldGlow;
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
  /** The announcement banner, a page element over everything (#272, decision 3). */
  private readonly announcement = new AnnouncementView();
  private announcedMission: string | undefined;
  /** When the announcement showing ends, or undefined while none shows. */
  private announcementUntil: number | undefined;
  private downPanel!: Phaser.GameObjects.Text;
  /** Whether the ship was down last frame and was respawned since, to count revives. */
  private wasDown = false;
  private respawned = false;
  private revives = 0;
  private moveKeys!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private effects = true;
  /** The effects the player picked in the settings, or undefined to leave them to the renderer (#234). */
  private effectsPicked: boolean | undefined;
  /** Whether WebGL draws in software, where effects start off (#234). */
  private softwareRenderer = false;
  /** WebGL's limits and the page's errors in the HUD, with `?diag=1` (#180). */
  private diagnostics: Diagnostics | undefined;
  private shotsFired = 0;
  private hudUpdatedAt = 0;
  private debug!: DebugState;
  /** Brings window.voidmarch up to date at the end of a frame, once something has read it (#264). */
  private refreshDebug!: () => void;
  private readonly frameTimes = new FrameTimes();
  private mapsDrawnAt = -Infinity;
  private displaySettings!: DisplaySettings;
  private gpuTimer: GpuTimer | undefined;
  private weaponFrames = new WeaponAnimator(weaponTiming('autoCannon'));
  private audioSettings!: AudioSettings;
  private audio!: ShipAudio;
  private orderPress: OrderPress | undefined;
  private lastOrder: OrderItem | undefined;
  /** Closes the drop-up a tap of 1, 2 or 3 showed (#259). */
  private readonly partList = new PartListTimer<SlotKind>();

  constructor(options: SandboxOptions) {
    super('sandbox');
    this.introScreen = options.intro;
    this.ready = options.ready;
    this.introScreen.onClose(() => {
      // On a first visit the join screen waited behind it; Enter joins again.
      if (this.squadronScreen.open) {
        this.squadronScreen.focusPick();
      }
    });
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
    const renderer = this.renderer;
    this.softwareRenderer = renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer && isSoftwareRenderer(rendererName(renderer.gl));
    this.effectsPicked = view.effects;
    // ?effects=0 is for this visit only, so it isn't saved.
    if (!(view.effects ?? !this.softwareRenderer) || asked.get('effects') === '0') {
      this.setEffects(false);
    }
    if (asked.get('diag') === '1') {
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
      softwareRenderer: this.softwareRenderer,
      projectiles: 0,
      ownShards: 0,
      shakes: 0,
      unlocks: {},
      pickups: [],
      shotsFired: 0,
      zoom: 1,
      fps: 0,
      layerTextures: (this.registry.get('layerTextures') as number[] | undefined) ?? [],
      frameMs: { average: 0, worst: 0 },
      fpsCap: false,
      cssPixels: false,
      gpuMs: undefined,
      weaponFrame: 0,
      audio: {
        muted: false,
        music: false,
        locked: true,
        backend: 'none',
        musicLoaded: false,
        musicPlace: 'home',
        playingMusic: null,
        musicVolume: 0,
        fadingMusic: 0,
      },
      net: { status: 'offline', playerId: undefined, others: [] },
      enemies: [],
      enemiesGone: [],
      enemiesDestroyed: 0,
      lastEnemyDestroyed: undefined,
      enemyFireGlow: false,
      field: { distance: null, zaps: 0, dots: 0 },
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
      hud: { panel: [], toasts: [] },
      orderMenuOpen: false,
      squadron: '',
      squadronScreen: false,
      victoryScreen: false,
      settingsScreen: false,
      introScreen: false,
      standings: { join: 0, down: 0 },
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
      clearedSectors: [],
      missionBanner: undefined,
      missionBannerFont: '',
      derelicts: [],
      rescues: 0,
      teleports: 0,
      departing: 0,
      hangar: undefined,
      squadronMode: undefined,
    };
    this.refreshDebug = publishDebugState(() => this.debugState());
    this.ready();
  }

  override update(time: number, deltaMs: number): void {
    this.frameTimes.add(deltaMs, time);
    const events = this.sim.advance(deltaMs / 1000, this.readInput(), this.net?.squadmateDistance, this.net?.friendDistance);
    this.burstExpired(events);
    const net = this.net?.update(events);
    if (loadoutKey(this.sim.ship.loadout) !== this.shownLoadout) {
      this.applyLoadout();
    }
    this.openVictoryIfDue();
    this.updateStandings();
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
    this.updatePartList();
    this.playEffects(events);
    this.audio.update(this.sim.ship, events);
    this.scrollBackgrounds(time, deltaMs);
    this.bossBar.show(bossBar(this.net?.bosses ?? [], this.sim.ship.x, this.sim.ship.y));
    this.audio.setMusicPlace(musicPlace(sectorName(this.sim.ship.x, this.sim.ship.y), this.victoryScreen.open));
    this.drawMissionArrow();
    this.drawMaps();
    this.drawSectors();
    this.drawField(time);
    this.announceMission(time);
    // Every frame, so a screen opening never has the HUD over it.
    this.hudView.cover(this.maps.open, this.screenOpen || this.squadronScreen.open || this.sim.downed);
    if (time - this.hudUpdatedAt > HUD_REFRESH_MS) {
      this.hudUpdatedAt = time;
      this.updateHud();
    }
    this.refreshDebug();
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
    if (this.announcementUntil !== undefined && time <= this.announcementUntil) {
      return;
    }
    const next = net.banners.shift();
    if (next !== undefined) {
      this.announcement.show(next);
      this.announcementUntil = time + MISSION_BANNER_MS;
    } else if (this.announcementUntil !== undefined) {
      this.announcement.hide();
      this.announcementUntil = undefined;
    }
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
      const layout = this.cache.json.get(keys.layerLayout(key)) as LayerLayout | undefined;
      const texture = layout === undefined ? undefined : this.textures.get(keys.layerFrame(key));
      const pieces = layout !== undefined && texture instanceof Phaser.Textures.DynamicTexture ? { sheet: key, layout, texture } : undefined;
      const sprite = (
        pieces === undefined
          ? this.add.tileSprite(0, 0, VIEW_WIDTH, VIEW_HEIGHT, key, 0)
          : this.add.tileSprite(0, 0, VIEW_WIDTH, VIEW_HEIGHT, pieces.texture)
      ).setScrollFactor(0);
      this.world.add(sprite);

      return { sprite, factor: PARALLAX[i] ?? 0, pieces };
    });
  }

  private createScenery(): void {
    this.sectorLines = this.add.graphics();
    this.world.add(this.sectorLines);
    this.closedLayer = this.add.graphics();
    this.world.add(this.closedLayer);
    this.fieldLayer = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.world.add(this.fieldLayer);
    this.fieldGlow = new FieldGlow(this, this.world, this.fieldLayer);
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
      squadronScreen: this.squadronScreen,
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
    this.refreshDebug();
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
   * blur at half the screen's size (#143): the threshold in the halving
   * resample, and the blur added back by the blend, smoothly, with no
   * full-size pass between (#234).
   */
  private createBloom(main: Phaser.Cameras.Scene2D.Camera): void {
    if (!(this.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) {
      return;
    }
    registerResample(this.renderer);
    registerSmallBlend(this.renderer);
    const bloom = main.filters.external.addParallelFilters();
    bloom.top.add(new Resample(main, BLOOM_SCALE, BLOOM_THRESHOLD));
    this.bloomBlur = bloom.top.addBlur(0, BLOOM_BLUR * BLOOM_SCALE, BLOOM_BLUR * BLOOM_SCALE, 1, 0xffffff, BLOOM_BLUR_STEPS);
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

    // What's left of the text HUD (#91): the F1 and Esc hint (#193), frames per second, and ?diag=1.
    this.hud = this.add
      .text(8, 8, '', { fontFamily: UI_FONT, fontSize: '12px', color: '#d8f8ff', align: 'right' })
      .setOrigin(1, 1)
      .setShadow(1, 1, '#000000', 0);
    main.ignore(this.hud);
    this.downPanel = this.add
      .text(0, 0, '', {
        fontFamily: UI_FONT,
        fontSize: `${String(DOWN_PANEL_FONT_PX)}px`,
        color: '#d8f8ff',
        align: 'center',
        backgroundColor: '#05030acc',
      })
      .setOrigin(0.5, 0)
      .setShadow(1, 1, '#000000', 0)
      .setVisible(false);
    main.ignore(this.downPanel);
    this.bossBar = new BossBarView(this, (object) => main.ignore(object));
    this.missionArrow = this.add.graphics();
    this.missionLabel = this.add
      .text(0, 0, '', { fontFamily: UI_FONT, fontSize: '12px', color: MISSION_CSS })
      .setOrigin(0.5)
      .setShadow(1, 1, '#000000', 0);
    this.eventLabel = this.add
      .text(0, 0, '', { fontFamily: UI_FONT, fontSize: '12px', color: EVENT_CSS })
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
        // A held Tab repeats; left alone, each repeat would move the page's focus.
        if (event.code === 'Tab' && this.standingsHeld) {
          event.preventDefault();
        }

        return;
      }
      const partSlot = PART_KEY_SLOTS.get(event.code);
      if (event.code === 'F1') {
        // Some browsers open their own help on F1.
        event.preventDefault();
        this.toggleIntro();
      } else if (this.introScreen.open) {
        this.introKey(event);
      } else if (this.hudView.dropOpen !== undefined && event.code === 'Escape') {
        this.hudView.close();
      } else if (this.settingsScreen.open) {
        this.settingsKey(event);
      } else if (this.victoryScreen.open) {
        this.victoryKey(event);
      } else if (this.squadronScreen.reopened) {
        this.squadronKey(event);
      } else if (this.maps.open) {
        this.mapKey(event);
      } else if (event.code === 'KeyM' && this.canOpenMap()) {
        this.maps.toggle();
      } else if (event.code === 'Tab' && !this.squadronScreen.open) {
        event.preventDefault();
        this.standingsHeld = true;
      } else if (event.code === 'KeyO') {
        this.openVictory();
      } else if (event.code === 'KeyQ') {
        this.pressOrders();
      } else if (event.code === 'KeyC') {
        this.openSquadrons();
      } else if (event.code === 'Escape') {
        this.openSettings();
      } else if (partSlot !== undefined) {
        this.tapPartKey(partSlot);
      } else {
        this.handleDebugKey(event.code);
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'KeyQ') {
        this.releaseOrders();
      } else if (event.code === 'Tab') {
        this.standingsHeld = false;
      }
    };
    // Letting go of Q in another window never reaches us: close the ring unused.
    const onBlur = (): void => {
      this.closeOrderRing();
      this.standingsHeld = false;
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

  /** The full map opens online, and not over the join screen or the order ring, where the keys and the mouse are theirs. */
  private canOpenMap(): boolean {
    return this.net?.status === 'online' && this.orderPress === undefined && !this.squadronScreen.open;
  }

  /** Reopens the join screen to move to another squadron, only while down (#45, decision 3), and not over the order ring or another screen. */
  private openSquadrons(): void {
    if (!this.sim.downed || this.orderPress !== undefined || this.screenOpen) {
      return;
    }
    if (this.net?.openSquadrons() === true) {
      this.hudView.close();
    }
  }

  /** A key while the join screen is reopened: C and Esc close it without moving, the form has Tab and Enter, and the rest wait. */
  private squadronKey(event: KeyboardEvent): void {
    if (event.code === 'KeyC' || event.code === 'Escape') {
      this.squadronScreen.hide();
    }
  }

  /** A key while the full map is open: M and Esc close it, and the rest wait. */
  private mapKey(event: KeyboardEvent): void {
    if (event.code === 'KeyM' || event.code === 'Escape') {
      event.preventDefault();
      this.maps.close();
    }
  }

  /**
   * Draws the edges of the sectors near the view and shades the closed ones
   * (#123), only when those sectors or the frontier change: Phaser redraws a
   * Graphics' every shape every frame (#265).
   */
  private drawSectors(): void {
    const version = this.net?.frontierVersion ?? 0;
    const frontier = this.net?.frontier ?? ALL_OPEN;
    if (version !== this.closedDrawn) {
      this.closedDrawn = version;
      this.closedSides = closedEdges(frontier);
    }
    const { worldView } = this.cameras.main;
    const names = sectorsInView({
      left: worldView.x - SECTOR_VIEW_MARGIN,
      top: worldView.y - SECTOR_VIEW_MARGIN,
      right: worldView.right + SECTOR_VIEW_MARGIN,
      bottom: worldView.bottom + SECTOR_VIEW_MARGIN,
    });
    const key = `${String(version)} ${names.join(',')}`;
    if (key === this.sectorsDrawn) {
      return;
    }
    this.sectorsDrawn = key;
    const lines = this.sectorLines.clear().lineStyle(1, SECTOR_LINE_COLOR, SECTOR_LINE_ALPHA);
    const shade = this.closedLayer.clear();
    for (const name of names) {
      const corners = sectorCorners(name);
      polygon(lines, corners).strokePath();
      if (!sectorOpen(name, frontier)) {
        polygon(shade.fillStyle(0x000000, CLOSED_SHADE_ALPHA), corners).fillPath();
      }
    }
  }

  /** Draws the force field along the closed sides near the ship, and zaps while the ship is in its push-back band (#127). */
  private drawField(time: number): void {
    const g = this.fieldLayer.clear();
    const ship = this.sim.ship;
    const { worldView } = this.cameras.main;
    const view = { left: worldView.x, top: worldView.y, right: worldView.right, bottom: worldView.bottom };
    this.fieldGlow.begin();
    for (const { samples, first, nx, ny } of fieldSides(this.closedSides, ship, time / 1000, view)) {
      if (this.effects) {
        for (const s of samples) {
          this.fieldGlow.add(s.x, s.y, 1 + s.flare, fieldColor(s.flare), FIELD_GLOW_ALPHA * s.flicker * (1 + s.flare * 3));
        }
      }
      samples.forEach((s, at) => {
        const i = first + at;
        const prev = samples[at - 1];
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
    this.fieldGlow.end();
    const volume = zapVolume(nearestSide(this.closedSides, ship), this.sim.downed);
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
    for (const o of [this.hud, this.missionArrow, this.missionLabel, this.eventLabel]) {
      o.setAlpha(alpha);
    }
  }

  /** Opens the victory screen once the season is won (#156), over the map. */
  private openVictory(): void {
    const result = this.net?.seasonResult;
    if (result === undefined) {
      return;
    }
    this.maps.close();
    this.victoryScreen.show(result, this.net?.playerId);
  }

  /** Opens the victory screen when the season is won, or for a joiner seeing a won season the first time (#156). */
  private openVictoryIfDue(): void {
    if (this.net?.takeVictory() === true) {
      this.openVictory();
    }
  }

  /** Shows the season so far on the join screen while it's up, and above the down panel while down (#167). */
  private updateStandings(): void {
    const net = this.net;
    const players = net?.standings ?? [];
    for (const [panel, show] of [
      [this.standingsJoin, this.squadronScreen.open],
      // Holding Tab shows it too, in the same place (#167, decision 6).
      // Under the reopened join screen, its own copy shows instead.
      [this.standingsDown, (this.sim.downed || this.standingsHeld) && !this.squadronScreen.open],
    ] as const) {
      panel.update(show, players, net?.playerId, net?.seasonStarted ?? 0, net?.standingsVersion ?? 0);
    }
  }

  /** A key while the victory screen is open: O and Esc close it, and the rest wait. */
  private victoryKey(event: KeyboardEvent): void {
    if (event.code === 'KeyO' || event.code === 'Escape') {
      this.victoryScreen.hide();
    }
  }

  /**
   * Whether a screen or the full map covers the game, so the ship holds still
   * and the touch controls hide. The join screen counts only when reopened:
   * a joining ship flies while its player picks.
   */
  private get screenOpen(): boolean {
    return this.maps.open || this.victoryScreen.open || this.settingsScreen.open || this.introScreen.open || this.squadronScreen.reopened;
  }

  /** Opens the intro screen in place of any other screen, map or list, or closes it; not while the order ring is up. */
  private toggleIntro(): void {
    if (this.introScreen.open) {
      this.introScreen.hide();

      return;
    }
    if (this.orderPress !== undefined) {
      return;
    }
    this.settingsScreen.hide();
    this.victoryScreen.hide();
    this.maps.close();
    this.hudView.close();
    this.standingsHeld = false;
    this.introScreen.show(this.touchOn);
  }

  /** A key while the intro screen is open: Esc closes it, and the rest wait. */
  private introKey(event: KeyboardEvent): void {
    if (event.code === 'Escape') {
      this.introScreen.hide();
    }
  }

  /** Opens the settings screen (#145), unless the join screen or the order ring is up. */
  private openSettings(): void {
    if (this.orderPress !== undefined || this.squadronScreen.open) {
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
        this.effectsPicked = next.effects;
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
      saveViewSettings({ snapRotation: next.snapRotation, effects: this.effectsPicked });
    }
    this.settingsScreen.update(optionRows(this.options()));
    this.updateHud();
  }

  /** The parts 1/2/3 and the drop-ups choose from (#191): the player's own, or undefined for every part where anything goes. */
  private get ownedUnlocks(): ReadonlyMap<PartId, number> | undefined {
    return this.partKeys ? undefined : (this.net?.unlocks ?? defaultUnlocks());
  }

  /** Fits a part picked from a slot's drop-up (#191). */
  private fitPart(kind: SlotKind, part: string): void {
    const { loadout } = this.sim.ship;
    if (loadout[kind] === part || this.sim.downed) {
      return;
    }
    this.fit({ ...loadout, [kind]: part });
    this.applyLoadout();
    if (kind === 'shield') {
      this.audio.shieldSwitched();
    } else {
      this.audio.partSwitched();
    }
  }

  /** Anything goes in development and offline: 1/2/3 cycle every part, and F3 shows frames per second (#91, #191). */
  private get partKeys(): boolean {
    return this.net?.status !== 'online' || this.net.development;
  }

  /** A tap of 1, 2 or 3 (#259): fit that slot's next part, and show its list for a while. */
  private tapPartKey(kind: SlotKind): void {
    this.hudView.show(kind);
    this.partList.tapped(kind, performance.now());
    this.cyclePart(kind);
  }

  /** Every frame: the list a tap showed closes once the taps stop. */
  private updatePartList(): void {
    if (this.partList.due(performance.now(), this.hudView.dropOpen)) {
      this.hudView.close();
      this.updateHud();
    }
  }

  /** Fits a slot's next part (#191), and redraws the HUD. */
  private cyclePart(kind: SlotKind): void {
    const { loadout } = this.sim.ship;
    const owned = this.ownedUnlocks;
    switch (kind) {
      case 'weapon':
        this.fit({ ...loadout, weapon: nextPart(WEAPONS, loadout.weapon, owned) });
        break;
      case 'engine':
        this.fit({ ...loadout, engine: nextPart(ENGINES, loadout.engine, owned) });
        break;
      case 'shield':
        this.fit({ ...loadout, shield: nextPart(SHIELDS, loadout.shield, owned) });
        break;
    }
    this.applyLoadout();
    if (kind === 'shield') {
      this.audio.shieldSwitched();
    } else {
      this.audio.partSwitched();
    }
  }

  private handleDebugKey(code: string): void {
    if (!this.partKeys && code === 'F3') {
      return;
    }
    switch (code) {
      case 'KeyK':
        this.net?.devStartAttack();
        break;
      case 'KeyY':
        this.net?.devSeasonWon();
        break;
      case 'KeyU':
        this.net?.devStartRaid();
        break;
      case 'F3':
        this.showFps = !this.showFps;
        this.updateHud();
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
    const style = { fontFamily: UI_FONT, fontSize: `${String(HUD_FONT_PX * dpr)}px` };
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
    const ratio = this.cssRatio();

    // On a phone the drawn UI shrinks with the touch controls, to leave room to play (#180, decision 7).
    return this.touchOn ? touchUnit(this.scale.height, ratio) : ratio;
  }

  /** The canvas pixels per CSS pixel. */
  private cssRatio(): number {
    return renderRatio(window.devicePixelRatio > 0 ? window.devicePixelRatio : 1, this.displaySettings.cssPixels);
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
    this.announcement.layout(
      { fontPx: DOWN_PANEL_FONT_PX, paddingXPx: DOWN_PANEL_PADDING_X, paddingYPx: DOWN_PANEL_PADDING_Y },
      dpr / this.cssRatio(),
    );
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

  /** A touch lands: it closes an open screen (the join screen only when reopened) or map, picks a sector, or starts a stick, a button or the map. */
  private touchStart(id: number, p: Point): void {
    if (this.introScreen.open) {
      this.introScreen.hide();

      return;
    }
    if (this.settingsScreen.open) {
      this.settingsScreen.hide();

      return;
    }
    if (this.victoryScreen.open) {
      this.victoryScreen.hide();

      return;
    }
    if (this.squadronScreen.reopened) {
      this.squadronScreen.hide();

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
      case 'settings':
        this.openSettings();
        break;
      case 'help':
        this.toggleIntro();
        break;
      case 'respawnHome':
        this.respawn(false);
        break;
      case 'respawnBeside':
        this.respawn(true);
        break;
      case 'squadron':
        this.openSquadrons();
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
    this.touchButtonRects = this.screenOpen
      ? []
      : touchButtons({
          width: this.scale.width,
          height: this.scale.height,
          dpr: renderRatio(window.devicePixelRatio > 0 ? window.devicePixelRatio : 1, this.displaySettings.cssPixels),
          down: this.sim.downed,
          canRespawn: this.sim.canRespawn,
          beside: this.net?.nearestSquadmate()?.name,
          squadron: this.net?.canSwitchSquadron === true,
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
      // Revived under the reopened join screen: moving is for the downed only.
      if (this.squadronScreen.reopened) {
        this.squadronScreen.hide();
      }

      return;
    }
    const text = downPanelText({
      canRespawn: this.sim.canRespawn,
      wait: RESPAWN_DELAY - this.sim.ship.downFor,
      beside: this.net?.nearestSquadmate()?.name,
      touch: this.touchOn,
      squadron: this.net?.canSwitchSquadron === true,
    });
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
    const frame = Math.floor((time / 1000) * LAYER_FPS) % LAYER_FRAMES;
    const frameChanged = frame !== this.backgroundFrame;
    this.backgroundFrame = frame;
    const tint = fadeColor(this.backgroundTint, ringTint(this.sim.ship.x, this.sim.ship.y), deltaMs / RING_TINT_FADE_MS);
    const tintChanged = tint !== this.backgroundTint;
    this.backgroundTint = tint;
    for (const { sprite, factor, pieces } of this.backgrounds) {
      sprite.setTilePosition(camera.scrollX * factor, camera.scrollY * factor);
      if (frameChanged && pieces !== undefined) {
        drawLayer(pieces.texture, pieces.sheet, pieces.layout, frame);
      } else if (frameChanged) {
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
    this.hud.setText([
      // The hint is about keys, so a tablet goes without it (#180, decision 6).
      ...(this.touchOn ? [] : [KEY_HINT]),
      ...(this.showFps ? [this.fpsLine()] : []),
      ...(this.diagnostics?.lines() ?? []),
    ]);
    this.layoutHud();
    this.updateHudView();
  }

  private layoutHud(): void {
    const dpr = this.dpr();
    this.hud.setPosition(this.scale.width - HUD_MARGIN_PX * dpr, this.scale.height - HUD_MARGIN_PX * dpr);
  }

  /** Draws the gauge, the panel and the toasts (#91). */
  private updateHudView(): void {
    const { ship } = this.sim;
    const { loadout } = ship;
    const net = this.net;
    const online = net?.status === 'online';
    const owned = this.ownedUnlocks;
    const unlocks = this.net?.unlocks ?? defaultUnlocks();
    const view = (part: PartId, tier: number): PartView => ({ part, file: pickupFile(part), name: partLabel(part, tier), color: tierCss(tier), hint: PART_HINTS[part] });
    const slot = (kind: SlotKind, key: string, parts: readonly PartId[], part: PartId, tier: number): GaugeSlot => ({
      ...view(part, tier),
      kind,
      key,
      options: ownedParts(parts, owned).map((p) => view(p, unlocks.get(p) ?? 0)),
    });
    const info = net?.squadronInfo;
    const here = sectorName(ship.x, ship.y);
    const toasts = [connectionToast(net?.status), net?.noticeText].filter((t): t is string => t !== undefined);
    this.hudView.update({
      slots: [
        slot('weapon', '1', WEAPONS, loadout.weapon, loadout.weaponTier),
        slot('engine', '2', ENGINES, loadout.engine, loadout.engineTier),
        slot('shield', '3', SHIELDS, loadout.shield, loadout.shieldTier),
      ],
      hull: hullPips(ship.damage),
      shield: shieldPips(ship.shield, SHIELD_STATS[loadout.shield].strength),
      rows: panelRows({
        squadron:
          info === undefined
            ? undefined
            : {
                name: info.name,
                others: info.members.filter((m) => m.playerId !== net?.playerId).map((m) => m.name),
                companions: info.members.reduce((n, m) => n + m.companions, 0),
                order: modeName(info),
                mode: fromCompanionMode(info.mode) ?? 'escort',
              },
        hangar: Math.hypot(ship.x, ship.y) <= SAFE_ZONE_RADIUS ? net?.hangar : undefined,
        // How many of your companions are out, which the loadout screen showed until #191.
        companions: online ? { out: net.companionCount, limit: net.companionLimit } : undefined,
        sector: here === undefined ? undefined : { name: here, state: sectorState(here, online ? net.clearedSectors : undefined, net?.frontier) },
        mission: net?.mission,
        event: net?.eventLine(performance.now()) ?? '',
      }),
      toasts,
    });
  }

  /** The state window.voidmarch shows, brought up to date. */
  private debugState(): DebugState {
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
    this.debug.hud = { panel: this.hudView.rowTexts, toasts: this.hudView.toastTexts };
    const distance = nearestSide(this.closedSides, this.sim.ship);
    this.debug.field = { distance: Number.isFinite(distance) ? distance : null, zaps: this.fieldZaps, dots: this.fieldGlow.drawn };
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
    this.debug.audio.musicPlace = this.audio.musicPlace;
    this.debug.audio.playingMusic = this.audio.playingMusic;
    this.debug.audio.musicVolume = this.audio.musicVolume;
    this.debug.audio.fadingMusic = this.audio.fadingMusic;
    this.debug.audio.backend = this.audio.backend;
    this.debug.audio.musicLoaded = this.audio.musicReady;
    this.debug.net.status = this.net?.status ?? 'offline';
    this.debug.net.playerId = this.net?.playerId;
    this.debug.net.others = this.net?.others ?? [];
    this.debug.enemies = this.net?.enemyList ?? [];
    this.debug.enemiesGone = this.net?.enemiesGone ?? [];
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
    this.debug.squadronScreen = this.squadronScreen.open;
    this.debug.victoryScreen = this.victoryScreen.open;
    this.debug.settingsScreen = this.settingsScreen.open;
    this.debug.introScreen = this.introScreen.open;
    this.debug.standings = { join: this.standingsJoin.rows, down: this.standingsDown.rows };
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
    this.debug.clearedSectors = this.net?.status === 'online' ? [...this.net.clearedSectors].sort() : [];
    this.debug.worldEvent = this.net?.worldEvent === undefined ? undefined : this.net.eventLine(performance.now());
    this.debug.missionBanner = this.announcement.text;
    this.debug.missionBannerFont = this.announcement.font;
    this.debug.sector = sectorLine(this.sim.ship.x, this.sim.ship.y, this.net?.status === 'online' ? this.net.clearedSectors : undefined, this.net?.frontier);
    this.debug.derelicts = this.net?.derelictList ?? [];
    this.debug.rescues = this.net?.rescues ?? 0;
    this.debug.teleports = this.net?.teleports ?? 0;
    this.debug.departing = this.net?.departingCount ?? 0;

    return this.debug;
  }
}

/** A loadout as one string, to see when it changed. */
const loadoutKey = (l: Loadout): string =>
  `${l.weapon}:${l.engine}:${l.shield}:${String(l.weaponTier)}${String(l.engineTier)}${String(l.shieldTier)}`;
