import type { BossBar } from './net/boss.ts';
import type { DerelictDebug, EnemyDebug, NetStatus, RemoteDebug } from './scenes/netplay.ts';
import type { ControlMode } from './sim/input.ts';
import type { DamageState, Loadout } from './sim/loadout.ts';
import type { MusicPlace } from './sim/music.ts';
import type { RingLayerId } from './sim/tuning.ts';

/** One of the player's companions as drawn: the hub flies it. */
export interface CompanionDebug {
  number: number;
  x: number;
  y: number;
}

/** Read-only state the E2E tests inspect through window.voidmarch. */
export interface DebugState {
  ready: boolean;
  scene: string;
  ship: { x: number; y: number; angle: number; thrusting: boolean };
  loadout: Loadout;
  damage: DamageState;
  /** Shield charges left, fractional while recharging, and whether the shield is drawn. */
  shield: number;
  shieldShown: boolean;
  rotationSnap: number;
  controlMode: ControlMode;
  effects: boolean;
  /** Whether enemy bullets glow (#36); it follows the effects toggle. */
  enemyFireGlow: boolean;
  /** The force field (#127): the ship's distance to the nearest closed side (null with none), and the zaps played. */
  field: { distance: number | null; zaps: number };
  projectiles: number;
  /** This player's own burst shards in flight (#72). */
  ownShards: number;
  /** Camera shakes so far, one per own big space gun burst (#72). */
  shakes: number;
  /** The parts this player owns, at their tiers, and the pickups on the ground (#77). */
  unlocks: Record<string, number>;
  pickups: { id: number; part: string; x: number; y: number }[];
  shotsFired: number;
  zoom: number;
  fps: number;
  /** The average and worst frame time of the last second in ms, and the GPU's time for a recent frame where the browser can time it (#143). */
  frameMs: { average: number; worst: number };
  gpuMs: number | undefined;
  /** Whether the game loop caps the frame rate (V), and whether P picked CSS pixels (#143). */
  fpsCap: boolean;
  cssPixels: boolean;
  weaponFrame: number;
  net: { status: NetStatus; playerId: string | undefined; others: RemoteDebug[] };
  enemies: EnemyDebug[];
  /** Enemies this player shot down, and enemy bullets that hit this ship. */
  enemiesDestroyed: number;
  /** The id of the last enemy this player shot down. */
  lastEnemyDestroyed: number | undefined;
  hitsTaken: number;
  /** Rams the ship made or took. */
  rams: number;
  /** Whether the ship is down, its revive progress, and whether its player may respawn (#47). */
  downed: boolean;
  revive: number;
  canRespawn: boolean;
  /** The DOWN label under the ship and the respawn panel, as shown. */
  downLabel: string | undefined;
  /** The revive bar's fill under the ship while it's shown (#66). */
  reviveBar: number | undefined;
  /** Times a friend revived the ship. */
  revives: number;
  downPanel: string | undefined;
  companions: CompanionDebug[];
  /** Enemies the player's companions shot down. */
  companionKills: number;
  /** The HUD's current notice, if any. */
  notice: string | undefined;
  /** The HUD (#91): the panel's rows as "Label: value", and the toasts showing. */
  hud: { panel: string[]; toasts: string[] };
  /** Whether the Q order ring is showing. */
  orderMenuOpen: boolean;
  /** The player's squadron, "" before choosing, and whether the join screen is up. */
  squadron: string;
  squadronScreen: boolean;
  /** Whether the victory screen is open (#156). */
  victoryScreen: boolean;
  /** Whether the settings screen is open (#145). */
  settingsScreen: boolean;
  /** Whether the intro screen is open (#193). */
  introScreen: boolean;
  /** The rows the season-so-far tables show on the join screen and above the down panel, 0 while hidden (#167). */
  standings: { join: number; down: number };
  /** Whether the touch controls are on, and the touch buttons showing (#180). */
  touch: boolean;
  touchButtons: string[];
  /** The touch sticks held, and whether the aim stick fires. */
  touchSticks: string[];
  touchFiring: boolean;
  /** Whether the full map is open (#100), and where its grid sits in device pixels. */
  mapOpen: boolean;
  mapLayout: { x: number; y: number; scale: number };
  /** How many rings around home are open, as the server says (#123); 0 for all, offline. */
  openRings: number;
  /** The sectors open on their own, like the Dreadnought's (#124). */
  openedSectors: string[];
  /** The derelicts waiting to be rescued, and how many this player rescued (#52). */
  derelicts: DerelictDebug[];
  rescues: number;
  /** Derelicts this client saw start teleporting away, and those still teleporting (#190). */
  teleports: number;
  departing: number;
  /** The last sector cleared and the part it gave this player (#101). */
  lastClear: { sector: string; reward: string | undefined } | undefined;
  /** The cleared sectors, as the server says (#99), sorted; none offline. */
  clearedSectors: string[];
  /** The world event running, as the HUD's line says it (#102). */
  worldEvent: string | undefined;
  /** The player's squadron's mission (#101), and its banner while it shows. */
  mission: string | undefined;
  missionBanner: string | undefined;
  /** The HUD's sector line: "Sector B3 · hostile" (#99). */
  sector: string;
  /** The layers only one ring draws that this GPU loaded, and how far each has faded in (#186). */
  ringLayers: { id: RingLayerId; alpha: number }[];
  /** The boss health bar at the top, while it's shown (#89). */
  boss: BossBar | undefined;
  /** Companion ships waiting in the shared hangar, once the server has listed them. */
  hangar: number | undefined;
  /** The squadron's mode as the ring labels it ("Attack"), once in a squadron. */
  squadronMode: string | undefined;
  audio: {
    muted: boolean;
    music: boolean;
    locked: boolean;
    /** Which Phaser sound backend runs: webaudio, html5, or none. */
    backend: string;
    musicLoaded: boolean;
    /** Where the music thinks the ship is (#187). */
    musicPlace: MusicPlace;
    playingMusic: string | null;
    /** The playing track's volume, rising as it fades in (#187); 0 with none. */
    musicVolume: number;
    /** Tracks still fading out. */
    fadingMusic: number;
  };
}

declare global {
  interface Window {
    voidmarch?: DebugState;
  }
}

/** Publishes state for the E2E tests. */
export function publishDebugState(state: DebugState): void {
  window.voidmarch = state;
}
