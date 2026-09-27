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

const AUDIO_KEY = 'voidmarch.audio';

/** Sound preferences: M mutes everything, N switches the music. */
export interface AudioSettings {
  muted: boolean;
  music: boolean;
}

const DEFAULT_AUDIO: Readonly<AudioSettings> = { muted: false, music: true };

/** The saved sound preferences, or sound and music on when none are saved. */
export function loadAudioSettings(store: Store | undefined = browserStorage()): AudioSettings {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(AUDIO_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_AUDIO };
    }
    const saved = parsed as Partial<Record<keyof AudioSettings, unknown>>;

    return {
      muted: typeof saved.muted === 'boolean' ? saved.muted : DEFAULT_AUDIO.muted,
      music: typeof saved.music === 'boolean' ? saved.music : DEFAULT_AUDIO.music,
    };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

/** Remembers the sound preferences in this browser; a denied write is ignored. */
export function saveAudioSettings(settings: AudioSettings, store: Store | undefined = browserStorage()): void {
  try {
    store?.setItem(AUDIO_KEY, JSON.stringify(settings));
  } catch {
    // Private windows can refuse storage; the settings then last for this visit.
  }
}
