/** Read-only state the E2E tests inspect through window.voidmarch. */
export interface DebugState {
  ready: boolean;
  scene: string;
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
