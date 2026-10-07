import { ENEMY_FACTIONS } from './enemies.ts';

/** The rules (internal/sim as WebAssembly): the entry module starts them, the game runs them. */
export const RULES = { key: 'rules', url: '/static/wasm/sim.wasm' } as const;

/** What the loading strip names (#227, decision 6): kinds of things, never a file's or an enemy's name. */
export const LOAD_CATEGORIES = ['ships', 'enemies', 'space', 'sounds'] as const;

export type LoadCategory = (typeof LOAD_CATEGORIES)[number];

/** How the strip writes each category. */
export const LOAD_CATEGORY_NAMES: Readonly<Record<LoadCategory, string>> = {
  ships: 'Ships',
  enemies: 'Enemies',
  space: 'Space',
  sounds: 'Sounds',
};

const SHIP_PREFIXES = ['hull-', 'engine-', 'flame-', 'shield-', 'weapon-', 'projectile-', 'pickup-'];
const SPACE_KEYS = ['planet', 'asteroid'];

/** The category of a loader key, or undefined for one the strip doesn't know. */
export function loadCategory(key: string): LoadCategory | undefined {
  // Before the ship prefixes: an enemy's shield is `<faction>-<kind>-shield`.
  if (ENEMY_FACTIONS.some((faction) => key.startsWith(`${faction}-`))) {
    return 'enemies';
  }
  if (SHIP_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return 'ships';
  }
  if (key.startsWith('background-') || SPACE_KEYS.includes(key)) {
    return 'space';
  }
  if (key.startsWith('sfx-')) {
    return 'sounds';
  }

  return undefined;
}

/** Where a key loads in the strip's order; one without a category goes last. */
export function loadRank(key: string): number {
  const category = loadCategory(key);

  return category === undefined ? LOAD_CATEGORIES.length : LOAD_CATEGORIES.indexOf(category);
}

/** A category on the strip: all in, the one loading now, or still to come. */
export type CategoryState = 'done' | 'loading' | 'waiting';

/** What the strip shows. */
export interface LoadView {
  /** "Loading game" for the game's code, "Loading enemies", "Loading" while only uncategorized files are left, or "Starting" once all are in. */
  label: string;
  /** Of every byte loaded before play; 100 only once all of it is in. */
  percent: number;
  categories: readonly { category: LoadCategory; name: string; state: CategoryState }[];
}

/** A file's size in bytes, or a sound's per format (its URL's extension), best first. */
export type FileBytes = number | Readonly<Record<string, number>>;

/** The type the browser is asked about for each sound format, as Phaser's loader asks it (Device.Audio). */
export const SOUND_TYPES: Readonly<Record<string, string>> = {
  ogg: 'audio/ogg; codecs="vorbis"',
  mp3: 'audio/mpeg',
};

/**
 * Each file's size, a sound's in the first format the browser can play: the
 * one Phaser's loader picks from the same list. A sound with none playable
 * weighs nothing, as the loader skips it.
 */
export function fileSizes(files: Readonly<Record<string, FileBytes>>, canPlay: (format: string) => boolean): Map<string, number> {
  return new Map(
    Object.entries(files).map(([key, bytes]) => {
      if (typeof bytes === 'number') {
        return [key, bytes];
      }
      const format = Object.keys(bytes).find(canPlay);

      return [key, format === undefined ? 0 : (bytes[format] ?? 0)];
    }),
  );
}

/**
 * One loading bar by bytes (#227, decision 9): the game's code as it
 * streams, then every file loaded before play. Every size is known from the
 * start, so the total never changes and the bar never goes backwards.
 */
export class LoadProgress {
  private readonly code: readonly string[];
  private readonly sizes: ReadonlyMap<string, number>;
  /** Each file still to come, with the fraction of it already in. */
  private readonly pending: Map<string, number>;
  private readonly total: number;
  private codeIn = false;

  /** code: the game's modules by URL; files: everything loaded once they run, by key; both in bytes. */
  constructor(code: ReadonlyMap<string, number>, files: ReadonlyMap<string, number>) {
    this.code = [...code.keys()];
    this.sizes = new Map([...code, ...files]);
    this.pending = new Map([...this.sizes.keys()].map((key) => [key, 0]));
    this.total = [...this.sizes.values()].reduce((sum, bytes) => sum + bytes, 0);
  }

  /** Part of a file is in: a fraction of it, which only ever grows. */
  advance(key: string, fraction: number): void {
    const was = this.pending.get(key);
    if (was !== undefined && Number.isFinite(fraction)) {
      this.pending.set(key, Math.min(1, Math.max(was, fraction)));
    }
  }

  /** Part of a file is in, counted in bytes as a stream delivers them. */
  receive(key: string, bytes: number): void {
    const size = this.sizes.get(key);
    if (size !== undefined && size > 0) {
      this.advance(key, bytes / size);
    }
  }

  /** A file is in, or failed: either way it's no longer waited for. */
  finish(key: string): void {
    this.pending.delete(key);
  }

  /** The game's code runs: any of it not counted yet is done, and the categories take over from "Loading game". */
  finishCode(): void {
    for (const key of this.code) {
      this.finish(key);
    }
    this.codeIn = true;
  }

  get complete(): boolean {
    return this.pending.size === 0;
  }

  view(): LoadView {
    const left = new Map<LoadCategory, number>();
    for (const key of this.pending.keys()) {
      const category = loadCategory(key);
      if (category !== undefined) {
        left.set(category, (left.get(category) ?? 0) + 1);
      }
    }
    const current = this.codeIn ? LOAD_CATEGORIES.find((c) => left.has(c)) : undefined;
    const categories = LOAD_CATEGORIES.map((category) => ({
      category,
      name: LOAD_CATEGORY_NAMES[category],
      state: this.codeIn ? stateOf(category, current, left) : 'waiting',
    }));
    let label = 'Loading';
    if (!this.codeIn) {
      label = 'Loading game';
    } else if (this.complete) {
      label = 'Starting';
    } else if (current !== undefined) {
      label = `Loading ${LOAD_CATEGORY_NAMES[current].toLowerCase()}`;
    }

    return { label, percent: this.percent(), categories };
  }

  private percent(): number {
    if (this.complete) {
      return 100;
    }
    let missing = 0;
    for (const [key, fraction] of this.pending) {
      missing += (this.sizes.get(key) ?? 0) * (1 - fraction);
    }

    return this.total === 0 ? 0 : Math.min(99, Math.floor(((this.total - missing) * 100) / this.total));
  }
}

function stateOf(category: LoadCategory, current: LoadCategory | undefined, left: ReadonlyMap<LoadCategory, number>): CategoryState {
  if (!left.has(category)) {
    return 'done';
  }

  return category === current ? 'loading' : 'waiting';
}
