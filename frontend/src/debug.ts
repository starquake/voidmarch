import type { EnemyDebug, NetStatus, RemoteDebug } from './scenes/netplay.ts';
import type { FireOrder, OneShot, ResourceOrder, Stance } from './sim/brain.ts';
import type { ControlMode } from './sim/input.ts';
import type { DamageState, Loadout } from './sim/loadout.ts';

/** One of the player's companions, as the E2E tests see it. */
export interface CompanionDebug {
  number: number;
  x: number;
  y: number;
  stance: Stance;
  fire: FireOrder;
  resources: ResourceOrder;
  oneShot: OneShot['kind'] | undefined;
}

/** Read-only state the E2E tests inspect through window.voidmarch. */
export interface DebugState {
  ready: boolean;
  scene: string;
  ship: { x: number; y: number; angle: number; thrusting: boolean };
  loadout: Loadout;
  damage: DamageState;
  rotationSnap: number;
  controlMode: ControlMode;
  effects: boolean;
  /** Whether enemy bullets glow (#36); it follows the effects toggle. */
  enemyFireGlow: boolean;
  projectiles: number;
  shotsFired: number;
  zoom: number;
  fps: number;
  weaponFrame: number;
  net: { status: NetStatus; playerId: string | undefined; others: RemoteDebug[] };
  enemies: EnemyDebug[];
  /** Enemies this player shot down, and enemy bullets that hit this ship. */
  enemiesDestroyed: number;
  /** The id of the last enemy this player shot down. */
  lastEnemyDestroyed: number | undefined;
  hitsTaken: number;
  companions: CompanionDebug[];
  /** Enemies the player's companions shot down. */
  companionKills: number;
  /** The HUD's current notice, if any. */
  notice: string | undefined;
  /** Whether the Q order ring is showing. */
  orderMenuOpen: boolean;
  /** The player's squadron, "" before choosing, and whether the join screen is up. */
  squadron: string;
  squadronScreen: boolean;
  /** Companion ships waiting in the shared hangar, once the server has listed them. */
  hangar: number | undefined;
  audio: {
    muted: boolean;
    music: boolean;
    locked: boolean;
    /** Which Phaser sound backend runs: webaudio, html5, or none. */
    backend: string;
    musicLoaded: boolean;
    playingMusic: string | null;
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
