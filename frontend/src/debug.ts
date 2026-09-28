import type { EnemyDebug, NetStatus, RemoteDebug } from './scenes/netplay.ts';
import type { ControlMode } from './sim/input.ts';
import type { DamageState, Loadout } from './sim/loadout.ts';

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
