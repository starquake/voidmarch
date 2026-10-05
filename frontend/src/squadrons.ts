import type { SquadronInfo, Squadrons } from './gen/voidmarch/v1/messages_pb.js';
import { fromCompanionMode } from './net/mapping.ts';
import { ORDER_ITEMS } from './ordermenu.ts';

/** The most ships in a squadron, companions included (the server's cap). */
export const SQUADRON_CAP = 4;

/** A squadron the player can join, as the join screen lists it. */
export interface SquadronChoice {
  name: string;
  players: string[];
  companions: number;
  /** One mark per seat: ■ a player, ▣ a companion, □ free. */
  seats: string;
  /** What joining means: a free seat, or taking over a companion. */
  note: string;
  /** The squadron's orders, as the ring names them. */
  mode: string;
}

/** The mode's name as the ring shows it, or Escort for none. */
export function modeName(info: Pick<SquadronInfo, 'mode'>): string {
  const mode = fromCompanionMode(info.mode) ?? 'escort';

  return ORDER_ITEMS.find((i) => i.kind === 'mode' && i.mode === mode)?.label ?? 'Escort';
}

/**
 * The squadrons a joining player can pick, in the server's order (most
 * players first), and the names of those full of players.
 */
export function squadronChoices(list: Pick<Squadrons, 'squadrons'>): { choices: SquadronChoice[]; full: string[] } {
  const choices: SquadronChoice[] = [];
  const full: string[] = [];
  for (const info of list.squadrons) {
    const players = info.members.map((m) => m.name);
    const companions = info.members.reduce((n, m) => n + m.companions, 0);
    if (players.length >= SQUADRON_CAP) {
      full.push(info.name);
      continue;
    }
    const ships = Math.min(SQUADRON_CAP, players.length + companions);
    const shown = ships - players.length;
    const free = SQUADRON_CAP - ships;
    choices.push({
      name: info.name,
      players,
      companions,
      seats: '■'.repeat(players.length) + '▣'.repeat(shown) + '□'.repeat(free),
      note: free === 0 ? 'you take over one of the companions' : `${String(free)} seat${free === 1 ? '' : 's'} free`,
      mode: modeName(info),
    });
  }

  return { choices, full };
}

/** The squadron to pick first: the one the player flew in last, else the fullest. */
export function pickFirst(choices: readonly SquadronChoice[], last: string | undefined): string | undefined {
  return choices.find((c) => c.name === last)?.name ?? choices[0]?.name;
}

/**
 * The join screen: the squadrons with room, a way to start a new one, and
 * why flying together pays. It calls choose with a squadron's name, or ""
 * to start one.
 */
export class SquadronScreen {
  private readonly form: HTMLFormElement | null;
  private readonly list: HTMLElement | null;
  private readonly full: HTMLElement | null;
  private readonly next: HTMLElement | null;
  private readonly error: HTMLElement | null;
  private picked: string | undefined;
  private choose: (name: string) => void = () => undefined;

  constructor(doc: Document = document) {
    this.form = doc.querySelector<HTMLFormElement>('#squadron-form');
    this.list = doc.querySelector<HTMLElement>('#squadron-list');
    this.full = doc.querySelector<HTMLElement>('#squadron-full');
    this.next = doc.querySelector<HTMLElement>('#squadron-next');
    this.error = doc.querySelector<HTMLElement>('#squadron-error');
    this.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.choose(this.picked ?? '');
    });
    doc.querySelector<HTMLButtonElement>('#squadron-start')?.addEventListener('click', () => {
      this.choose('');
    });
  }

  get open(): boolean {
    return this.form !== null && !this.form.hidden;
  }

  show(squadrons: Squadrons, last: string | undefined, choose: (name: string) => void): void {
    this.choose = choose;
    this.picked = pickFirst(squadronChoices(squadrons).choices, last);
    if (this.form !== null) {
      this.form.hidden = false;
    }
    this.update(squadrons);
  }

  /** Redraws the list, keeping the pick while its squadron is still there. */
  update(squadrons: Squadrons): void {
    const { choices, full } = squadronChoices(squadrons);
    if (!choices.some((c) => c.name === this.picked)) {
      this.picked = choices[0]?.name;
    }
    if (this.next !== null) {
      this.next.textContent = squadrons.nextName;
    }
    if (this.full !== null) {
      this.full.textContent = full.length === 0 ? '' : `Full: ${full.join(', ')}.`;
    }
    this.list?.replaceChildren(...choices.map((c) => this.row(c)));
    if (this.open) {
      this.focusPick();
    }
  }

  /** Gives the picked squadron's Join the focus, so Enter joins it. */
  focusPick(): void {
    this.list?.querySelector<HTMLButtonElement>('.picked button')?.focus();
  }

  showError(reason: string): void {
    if (this.error !== null) {
      this.error.textContent = reason;
    }
  }

  hide(): void {
    if (this.form !== null) {
      this.form.hidden = true;
    }
    if (this.error !== null) {
      this.error.textContent = '';
    }
  }

  private row(c: SquadronChoice): HTMLElement {
    const doc = this.list?.ownerDocument ?? document;
    const row = doc.createElement('div');
    row.className = c.name === this.picked ? 'squadron picked' : 'squadron';
    const name = doc.createElement('span');
    name.className = 'name';
    name.textContent = c.name;
    const who = doc.createElement('span');
    who.className = 'who';
    who.textContent = c.players.join(', ');
    if (c.companions > 0) {
      const ai = doc.createElement('span');
      ai.className = 'ai';
      ai.textContent = ` + ${String(c.companions)} companion${c.companions === 1 ? '' : 's'}`;
      who.append(ai);
    }
    const join = doc.createElement('button');
    join.type = 'button';
    join.textContent = 'Join';
    join.addEventListener('click', () => {
      this.choose(c.name);
    });
    const seats = doc.createElement('span');
    seats.className = 'seats-pips';
    seats.textContent = c.seats;
    const note = doc.createElement('span');
    note.className = 'note';
    note.textContent = `${c.note} · orders: ${c.mode}`;
    row.append(name, who, join, seats, note);

    return row;
  }
}
