import { CONTROL_MODES, type ControlMode } from './sim/input.ts';

const CONTROL_MODE_KEY = 'voidmarch.controlMode';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Returns the storage, or undefined where the browser denies access. */
function browserStorage(): Store | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The saved control mode, or screen-relative when none is saved or storage is unavailable (#104). */
export function loadControlMode(store: Store | undefined = browserStorage()): ControlMode {
  try {
    const saved = store?.getItem(CONTROL_MODE_KEY);

    return CONTROL_MODES.find((mode) => mode === saved) ?? 'screen';
  } catch {
    return 'screen';
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

/** Sound preferences: everything muted, and the music on or off. */
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

const DISPLAY_KEY = 'voidmarch.display';

/** Display preferences (#143): the frame rate capped at 60, and rendering at CSS pixels instead of device pixels. */
export interface DisplaySettings {
  fpsCap: boolean;
  cssPixels: boolean;
}

const DEFAULT_DISPLAY: Readonly<DisplaySettings> = { fpsCap: false, cssPixels: false };

/** The saved display preferences, or the display's own rate at full resolution when none are saved. */
export function loadDisplaySettings(store: Store | undefined = browserStorage()): DisplaySettings {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(DISPLAY_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_DISPLAY };
    }
    const saved = parsed as Partial<Record<keyof DisplaySettings, unknown>>;

    return {
      fpsCap: typeof saved.fpsCap === 'boolean' ? saved.fpsCap : DEFAULT_DISPLAY.fpsCap,
      cssPixels: typeof saved.cssPixels === 'boolean' ? saved.cssPixels : DEFAULT_DISPLAY.cssPixels,
    };
  } catch {
    return { ...DEFAULT_DISPLAY };
  }
}

/** Remembers the display preferences in this browser; a denied write is ignored. */
export function saveDisplaySettings(settings: DisplaySettings, store: Store | undefined = browserStorage()): void {
  try {
    store?.setItem(DISPLAY_KEY, JSON.stringify(settings));
  } catch {
    // Private windows can refuse storage; the settings then last for this visit.
  }
}

const VIEW_KEY = 'voidmarch.view';

/** How the ship turns and whether effects show (#145): remembered like the rest since the settings screen. */
export interface ViewSettings {
  snapRotation: boolean;
  effects: boolean;
}

const DEFAULT_VIEW: Readonly<ViewSettings> = { snapRotation: false, effects: true };

/** The saved view preferences, or free rotation with effects on when none are saved. */
export function loadViewSettings(store: Store | undefined = browserStorage()): ViewSettings {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(VIEW_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_VIEW };
    }
    const saved = parsed as Partial<Record<keyof ViewSettings, unknown>>;

    return {
      snapRotation: typeof saved.snapRotation === 'boolean' ? saved.snapRotation : DEFAULT_VIEW.snapRotation,
      effects: typeof saved.effects === 'boolean' ? saved.effects : DEFAULT_VIEW.effects,
    };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

/** Remembers the view preferences in this browser; a denied write is ignored. */
export function saveViewSettings(settings: ViewSettings, store: Store | undefined = browserStorage()): void {
  try {
    store?.setItem(VIEW_KEY, JSON.stringify(settings));
  } catch {
    // Private windows can refuse storage; the settings then last for this visit.
  }
}

const TOKEN_KEY = 'voidmarch.token';

/** The player's token from registering, or undefined before the first visit. */
export function loadToken(store: Store | undefined = browserStorage()): string | undefined {
  try {
    return store?.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Remembers the player's token in this browser; a denied write is ignored. */
export function saveToken(token: string, store: Store | undefined = browserStorage()): void {
  try {
    store?.setItem(TOKEN_KEY, token);
  } catch {
    // Private windows can refuse storage; the player then registers each visit.
  }
}

/** Forgets the token, after the server said it doesn't know it. */
export function clearToken(store: Pick<Storage, 'removeItem'> | undefined = browserStorage()): void {
  try {
    store?.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to forget where storage is denied.
  }
}

const SQUADRON_KEY = 'voidmarch.squadron';

/** The squadron the player flew in last, to pick it again on the join screen. */
export function loadLastSquadron(store: Store | undefined = browserStorage()): string | undefined {
  try {
    return store?.getItem(SQUADRON_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Remembers the player's squadron in this browser; a denied write is ignored. */
export function saveLastSquadron(name: string, store: Store | undefined = browserStorage()): void {
  try {
    store?.setItem(SQUADRON_KEY, name);
  } catch {
    // Private windows can refuse storage; the join screen then picks the first.
  }
}

const SEEN_SEASON_KEY = 'voidmarch.seasonSeen';

/** The won season whose victory screen this browser showed last (#156), or undefined. */
export function loadSeenSeason(store: Store | undefined = browserStorage()): string | undefined {
  try {
    return store?.getItem(SEEN_SEASON_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Remembers that this browser showed season's victory screen; a denied write is ignored. */
export function saveSeenSeason(season: string, store: Store | undefined = browserStorage()): void {
  try {
    store?.setItem(SEEN_SEASON_KEY, season);
  } catch {
    // Private windows can refuse storage; the screen then shows again next visit.
  }
}

// Numbered: a phone that found the bloom black before the small blend (#180) tries it again.
const BLOOM_BROKEN_KEY = 'voidmarch.bloomBroken.2';

/** Whether this browser found the bloom draws the world black (#180). */
export function loadBloomBroken(store: Store | undefined = browserStorage()): boolean {
  try {
    return store?.getItem(BLOOM_BROKEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remembers that the bloom draws the world black here, so the next start goes without it; a denied write is ignored. */
export function saveBloomBroken(store: Store | undefined = browserStorage()): void {
  try {
    store?.setItem(BLOOM_BROKEN_KEY, '1');
  } catch {
    // Without storage the check runs again next time, after a moment of black.
  }
}
