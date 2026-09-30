import { ENGINES, SHIELDS, WEAPONS, type Loadout } from './sim/loadout.ts';
import { partLabel, tierCss, type PartId, type Unlocks } from './sim/parts.ts';
import { ASSETS, pickupFile } from './sprites.ts';

/** A slot on the loadout screen, in its column order. */
export type Slot = 'weapon' | 'engine' | 'shield';

export const SLOTS: readonly Slot[] = ['weapon', 'engine', 'shield'];

const SLOT_PARTS: Readonly<Record<Slot, readonly PartId[]>> = { weapon: WEAPONS, engine: ENGINES, shield: SHIELDS };

/** What each part is good at, one line under its name (#72 and the stats). */
export const PART_HINTS: Readonly<Record<PartId, string>> = {
  autoCannon: 'steady and precise',
  rockets: 'seek their target',
  bigSpaceGun: 'bursts into a star',
  zapper: 'pierces',
  base: 'balanced',
  bigPulse: 'fast, drifts',
  burst: 'quick off the mark',
  supercharged: 'fast and quick',
  front: 'strong ahead',
  frontAndSide: 'wider cover',
  round: 'all around, one charge',
  invincibility: 'three charges, slow to recharge',
};

/** A part as the screen lists it. */
export interface LoadoutEntry {
  part: PartId;
  /** Its name with its tier ("Mega Zapper"), or its plain name when locked. */
  label: string;
  /** The tier's color as CSS, white for plain or locked. */
  color: string;
  hint: string;
  locked: boolean;
  fitted: boolean;
  tier: number;
}

/** A slot's parts, as the screen lists them. */
export function loadoutEntries(slot: Slot, unlocks: Unlocks, fitted: Readonly<Loadout>): LoadoutEntry[] {
  return SLOT_PARTS[slot].map((part) => {
    const tier = unlocks.get(part);
    const locked = tier === undefined;

    return {
      part,
      label: partLabel(part, tier ?? 0),
      color: tierCss(tier ?? 0),
      hint: locked ? 'not found yet' : PART_HINTS[part],
      locked,
      fitted: fitted[slot] === part,
      tier: tier ?? 0,
    };
  });
}

/** The loadout with part fitted in its slot, at the tier the player owns it at. */
export function fitPart(loadout: Readonly<Loadout>, slot: Slot, part: PartId, unlocks: Unlocks): Loadout {
  const tier = unlocks.get(part) ?? 0;
  switch (slot) {
    case 'weapon':
      return { ...loadout, weapon: part as Loadout['weapon'], weaponTier: tier };
    case 'engine':
      return { ...loadout, engine: part as Loadout['engine'], engineTier: tier };
    case 'shield':
      return { ...loadout, shield: part as Loadout['shield'], shieldTier: tier };
  }
}

/**
 * The part the arrow keys move to in a slot: the next unlocked one up or
 * down from the fitted one, wrapping around; undefined when there's no other.
 */
export function stepPart(slot: Slot, unlocks: Unlocks, fitted: Readonly<Loadout>, step: 1 | -1): PartId | undefined {
  const parts = SLOT_PARTS[slot];
  const from = parts.indexOf(fitted[slot]);
  for (let i = 1; i < parts.length; i++) {
    const part = parts[(from + step * i + parts.length) % parts.length];
    if (part !== undefined && unlocks.has(part)) {
      return part;
    }
  }

  return undefined;
}

/** What the screen does with the player's choices. */
export interface LoadoutActions {
  fit(loadout: Loadout): void;
  summon(): void;
}

/**
 * The loadout screen at the home planet (#78): three columns of parts, the
 * owned ones fitted by a click, or by 1/2/3 and the arrow keys; the hangar
 * with a Summon button.
 */
export class LoadoutScreen {
  private readonly form: HTMLFormElement | null;
  private readonly slots: HTMLElement | null;
  private readonly hangar: HTMLElement | null;
  private slot: Slot = 'weapon';
  private unlocks: Unlocks = new Map();
  private loadout: Loadout | undefined;
  private actions: LoadoutActions = { fit: () => undefined, summon: () => undefined };

  constructor(doc: Document = document) {
    this.form = doc.querySelector<HTMLFormElement>('#loadout-form');
    this.slots = doc.querySelector<HTMLElement>('#loadout-slots');
    this.hangar = doc.querySelector<HTMLElement>('#loadout-hangar');
    this.form?.addEventListener('submit', (event) => {
      event.preventDefault();
    });
    doc.querySelector<HTMLButtonElement>('#loadout-summon')?.addEventListener('click', () => {
      this.actions.summon();
    });
  }

  get open(): boolean {
    return this.form !== null && !this.form.hidden;
  }

  show(actions: LoadoutActions): void {
    this.actions = actions;
    if (this.form !== null) {
      this.form.hidden = false;
    }
  }

  hide(): void {
    if (this.form !== null) {
      this.form.hidden = true;
    }
  }

  /** Redraws the parts and the hangar line when anything changed. */
  update(unlocks: Unlocks, loadout: Readonly<Loadout>, hangar: string): void {
    this.unlocks = unlocks;
    const changed = this.loadout === undefined || JSON.stringify(this.loadout) !== JSON.stringify(loadout);
    this.loadout = { ...loadout };
    if (this.hangar !== null && this.hangar.textContent !== hangar) {
      this.hangar.textContent = hangar;
    }
    if (changed || this.slots?.childElementCount === 0) {
      this.slots?.replaceChildren(...SLOTS.map((slot) => this.column(slot)));
    }
  }

  /** Handles a key while the screen is open, and reports whether it was the screen's. */
  key(code: string): boolean {
    const slot = { Digit1: 'weapon', Digit2: 'engine', Digit3: 'shield' }[code] as Slot | undefined;
    if (slot !== undefined) {
      this.slot = slot;
      this.redraw();

      return true;
    }
    const step = code === 'ArrowDown' ? 1 : code === 'ArrowUp' ? -1 : 0;
    if (step === 0 || this.loadout === undefined) {
      return false;
    }
    const part = stepPart(this.slot, this.unlocks, this.loadout, step);
    if (part !== undefined) {
      this.actions.fit(fitPart(this.loadout, this.slot, part, this.unlocks));
    }

    return true;
  }

  private redraw(): void {
    this.slots?.replaceChildren(...SLOTS.map((slot) => this.column(slot)));
  }

  private column(slot: Slot): HTMLElement {
    const doc = this.slots?.ownerDocument ?? document;
    const column = doc.createElement('div');
    column.className = slot === this.slot ? 'loadout-slot picked' : 'loadout-slot';
    const title = doc.createElement('h3');
    title.textContent = slot;
    column.append(title);
    const fitted = this.loadout;
    if (fitted === undefined) {
      return column;
    }
    for (const entry of loadoutEntries(slot, this.unlocks, fitted)) {
      column.append(this.row(doc, slot, entry, fitted));
    }

    return column;
  }

  private row(doc: Document, slot: Slot, entry: LoadoutEntry, fitted: Readonly<Loadout>): HTMLElement {
    const row = doc.createElement('button');
    row.type = 'button';
    row.className = `loadout-part${entry.locked ? ' locked' : ''}${entry.fitted ? ' fitted' : ''}`;
    row.disabled = entry.locked;
    row.dataset.part = entry.part;
    const icon = doc.createElement('span');
    icon.className = 'icon';
    icon.style.backgroundImage = `url(${ASSETS}/pickups/${pickupFile(entry.part)}.png)`;
    const name = doc.createElement('span');
    name.className = 'label';
    name.textContent = entry.label;
    name.style.color = entry.locked ? '' : entry.color;
    const hint = doc.createElement('span');
    hint.className = 'hint';
    hint.textContent = entry.fitted ? `fitted · ${entry.hint}` : entry.hint;
    name.append(hint);
    row.append(icon, name);
    row.addEventListener('click', () => {
      this.slot = slot;
      this.actions.fit(fitPart(fitted, slot, entry.part, this.unlocks));
    });

    return row;
  }
}
