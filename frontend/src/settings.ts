import { CONTROL_MODES, type ControlMode } from './sim/input.ts';

const CONTROL_MODE_KEY = 'voidmarch.controlMode';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** Returns the storage, or undefined where the browser denies access. */
function browserStorage(): Store | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The saved control mode, or ship-relative when none is saved or storage is unavailable. */
export function loadControlMode(store: Store | undefined = browserStorage()): ControlMode {
  try {
    const saved = store?.getItem(CONTROL_MODE_KEY);

    return CONTROL_MODES.find((mode) => mode === saved) ?? 'ship';
  } catch {
    return 'ship';
  }
}

/** Remembers the control mode in this browser; a denied write is ignored. */
export function saveControlMode(mode: ControlMode, store: Store | undefined = browserStorage()): void {
  try {
    store?.setItem(CONTROL_MODE_KEY, mode);
  } catch {
    // Private windows can refuse storage; the mode then lasts for this visit.
  }
}
