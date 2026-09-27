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
  projectiles: number;
  shotsFired: number;
  zoom: number;
  fps: number;
  weaponFrame: number;
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
