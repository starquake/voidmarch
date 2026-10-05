import { ENEMY_FACTIONS } from './enemies.ts';

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
  /** "Loading enemies", or "Loading" while only uncategorized files are left, or "Starting" once all are in. */
  label: string;
  /** Of everything that loads; 100 only once all of it is in. */
  percent: number;
  categories: readonly { category: LoadCategory; name: string; state: CategoryState }[];
}

/** Counts the files still to come, every one of them, for the loading strip (#227). */
export class LoadProgress {
  private readonly pending: Set<string>;
  private readonly total: number;

  constructor(keys: Iterable<string>) {
    this.pending = new Set(keys);
    this.total = this.pending.size;
  }

  /** A file is in, or failed: either way it's no longer waited for. */
  finish(key: string): void {
    this.pending.delete(key);
  }

  get complete(): boolean {
    return this.pending.size === 0;
  }

  view(): LoadView {
    const left = new Map<LoadCategory, number>();
    for (const key of this.pending) {
      const category = loadCategory(key);
      if (category !== undefined) {
        left.set(category, (left.get(category) ?? 0) + 1);
      }
    }
    const current = LOAD_CATEGORIES.find((c) => left.has(c));
    const categories = LOAD_CATEGORIES.map((category) => ({
      category,
      name: LOAD_CATEGORY_NAMES[category],
      state: stateOf(category, current, left),
    }));
    const done = this.total - this.pending.size;
    const percent = this.complete ? 100 : Math.min(99, Math.floor((done * 100) / this.total));
    let label = 'Loading';
    if (this.complete) {
      label = 'Starting';
    } else if (current !== undefined) {
      label = `Loading ${LOAD_CATEGORY_NAMES[current].toLowerCase()}`;
    }

    return { label, percent, categories };
  }
}

function stateOf(category: LoadCategory, current: LoadCategory | undefined, left: ReadonlyMap<LoadCategory, number>): CategoryState {
  if (!left.has(category)) {
    return 'done';
  }

  return category === current ? 'loading' : 'waiting';
}
