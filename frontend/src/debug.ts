import type { DamageState, Loadout } from './sim/loadout.ts';

/** Read-only state the E2E tests inspect through window.voidmarch. */
export interface DebugState {
  ready: boolean;
  scene: string;
  ship: { x: number; y: number; angle: number; thrusting: boolean };
  loadout: Loadout;
  damage: DamageState;
  rotationSnap: number;
  effects: boolean;
  projectiles: number;
  shotsFired: number;
  zoom: number;
  fps: number;
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
