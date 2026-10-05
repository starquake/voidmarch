/** The HUD (#91): the ship's gauge, the panel's rows and the toasts, worked out from the game's state. */
import { MAX_DAMAGE } from './rules.gen.ts';

/** Filled pips out of all of them. */
export interface Pips {
  on: number;
  of: number;
}

/** The hull's pips: one per hit the ship can still take before it goes down. */
export function hullPips(damage: number): Pips {
  return { on: Math.min(MAX_DAMAGE, Math.max(0, MAX_DAMAGE - Math.floor(damage))), of: MAX_DAMAGE };
}

/** The shield's pips: one per whole charge, out of the shield's strength. */
export function shieldPips(shield: number, strength: number): Pips {
  return { on: Math.min(strength, Math.max(0, Math.floor(shield))), of: strength };
}

/** One row of the panel: a label and what it says, and whether it's an alert. */
export interface PanelRow {
  label: string;
  value: string;
  alert: boolean;
}

/** What the panel shows, as the scene knows it; undefined or empty leaves a row out. */
export interface PanelState {
  squadron:
    | {
        name: string;
        /** The other players in it. */
        others: readonly string[];
        companions: number;
        /** The order's name as the ring shows it ("Escort"), and its mode id. */
        order: string;
        mode: string;
      }
    | undefined;
  /** The ships in the hangar, shown at home where G draws one. */
  hangar: number | undefined;
  /** This player's companions out, of the most they may have (#191). */
  companions: { out: number; limit: number } | undefined;
  /** The sector the ship is in, and what it is: "D4", "home". */
  sector: { name: string; state: string } | undefined;
  mission: string | undefined;
  /** A world event's line, "E4 under attack · 6:34", or empty. */
  event: string;
}

/** What each order does, in a few words, for the panel. */
const ORDER_HINTS: Readonly<Record<string, string>> = {
  escort: 'companions fly with you',
  attack: 'companions hunt enemies near you',
  guard: 'companions shield you',
  hold: 'companions hold their spot',
  stealth: 'companions hold fire',
};

/** Names joined as a sentence: "Mira", "Mira and Jo", "Mira, Jo and Sam". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) {
    return names[0] ?? '';
  }

  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/** The panel's rows, each labelled, in the mockup's order. */
export function panelRows(state: PanelState): PanelRow[] {
  const rows: PanelRow[] = [];
  const row = (label: string, value: string, alert = false): void => {
    rows.push({ label, value, alert });
  };
  const { squadron } = state;
  if (squadron !== undefined) {
    const companions = squadron.companions === 0 ? [] : [`${String(squadron.companions)} companion${squadron.companions === 1 ? '' : 's'}`];
    const others = [...squadron.others, ...companions];
    row('Squadron', others.length === 0 ? squadron.name : `${squadron.name}, with ${joinNames(others)}`);
    const hint = ORDER_HINTS[squadron.mode];
    row('Orders', hint === undefined ? squadron.order : `${squadron.order}: ${hint}`);
  }
  if (state.hangar !== undefined) {
    row('Hangar', state.hangar === 0 ? 'empty' : `${String(state.hangar)} ship${state.hangar === 1 ? '' : 's'} to summon`);
  }
  if (state.companions !== undefined && state.companions.limit > 0) {
    row('Companions', `${String(state.companions.out)} of ${String(state.companions.limit)} out`);
  }
  if (state.sector !== undefined) {
    const { name, state: what } = state.sector;
    row("You're in", what === 'home' ? `${name}, the home sector` : what === 'unknown' ? name : `${name}, ${what}`);
  }
  if (state.mission !== undefined && state.mission !== '') {
    row('Mission', `Clear sector ${state.mission}`);
  }
  if (state.event !== '') {
    row('Alert', state.event, true);
  }

  return rows;
}

/** The connection's toast, which stays up while the game isn't online; undefined when it is. */
export function connectionToast(status: string | undefined): string | undefined {
  switch (status) {
    case undefined:
      return 'Playing alone';
    case 'online':
      return undefined;
    case 'full':
      return 'The frontier is full, try again soon';
    case 'offline':
      return 'Offline, reconnecting';
    default:
      return 'Connecting';
  }
}
