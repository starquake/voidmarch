import type { Squadrons } from './gen/voidmarch/v1/messages_pb.js';

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
  /** Whether it's the player's own squadron, which they stay in (#45). */
  current: boolean;
}

/**
 * The squadrons a player can pick, in the server's order (most players
 * first), and the names of those full of players. The player's current
 * squadron, when they have one, is always a choice: staying in it (#45).
 */
export function squadronChoices(list: Pick<Squadrons, 'squadrons'>, current = ''): { choices: SquadronChoice[]; full: string[] } {
  const choices: SquadronChoice[] = [];
  const full: string[] = [];
  for (const info of list.squadrons) {
    const players = info.members.map((m) => m.name);
    const companions = info.members.reduce((n, m) => n + m.companions, 0);
    const own = info.name === current;
    if (players.length >= SQUADRON_CAP && !own) {
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
      note: own ? 'your squadron' : free === 0 ? 'you take over one of the companions' : `${String(free)} seat${free === 1 ? '' : 's'} free`,
      current: own,
    });
  }

  return { choices, full };
}

/** What a move to another squadron did, for the HUD notice (#45). */
export interface Move {
  name: string;
  /** Whether the player started it rather than joined it. */
  started: boolean;
  /** Whether the player took over one of its companions' seats. */
  tookOver: boolean;
  /** How many of the player's companions went home for lack of room. */
  sentHome: number;
}

/** The HUD notice for a move to another squadron. */
export function moveNotice(move: Move): string {
  const parts = [move.started ? `Started squadron ${move.name}` : `Moved to ${move.name}`];
  if (move.tookOver) {
    parts.push("in a companion's seat");
  }
  if (move.sentHome > 0) {
    parts.push(`${move.sentHome === 1 ? 'a companion' : `${String(move.sentHome)} companions`} went home, no room`);
  }

  return parts.join(', ');
}

/** The squadron to pick first: the one the player flew in last, else the fullest. */
export function pickFirst(choices: readonly SquadronChoice[], last: string | undefined): string | undefined {
  return choices.find((c) => c.name === last)?.name ?? choices[0]?.name;
}

/**
 * The join screen: the squadrons with room, a way to start a new one, and
 * why flying together pays. It calls choose with a squadron's name, or ""
 * to start one. Reopened in a squadron, it lists that one too, whose Stay
 * closes it (#45).
 */
export class SquadronScreen {
  private readonly form: HTMLFormElement | null;
  private readonly list: HTMLElement | null;
  private readonly full: HTMLElement | null;
  private readonly next: HTMLElement | null;
  private readonly error: HTMLElement | null;
  private picked: string | undefined;
  /** The player's squadron while the screen is reopened in one, else "". */
  private current = '';
  private choose: (name: string) => void = () => undefined;

  constructor(doc: Document = document) {
    this.form = doc.querySelector<HTMLFormElement>('#squadron-form');
    this.list = doc.querySelector<HTMLElement>('#squadron-list');
    this.full = doc.querySelector<HTMLElement>('#squadron-full');
    this.next = doc.querySelector<HTMLElement>('#squadron-next');
    this.error = doc.querySelector<HTMLElement>('#squadron-error');
    this.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.pick(this.picked ?? '');
    });
    doc.querySelector<HTMLButtonElement>('#squadron-start')?.addEventListener('click', () => {
      this.choose('');
    });
  }

  get open(): boolean {
    return this.form !== null && !this.form.hidden;
  }

  /** Whether the screen was reopened in a squadron, so closing it keeps the player there. */
  get reopened(): boolean {
    return this.current !== '';
  }

  /** Opens the screen; current is the player's squadron when they're in one. */
  show(squadrons: Squadrons, last: string | undefined, choose: (name: string) => void, current = ''): void {
    this.choose = choose;
    this.current = current;
    this.picked = pickFirst(squadronChoices(squadrons, current).choices, last);
    if (this.form !== null) {
      this.form.hidden = false;
    }
    this.update(squadrons);
  }

  /** Redraws the list, keeping the pick while its squadron is still there. */
  update(squadrons: Squadrons): void {
    const { choices, full } = squadronChoices(squadrons, this.current);
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

  /** Gives the picked squadron's Join (or Stay) the focus, so Enter picks it. */
  focusPick(): void {
    this.list?.querySelector<HTMLButtonElement>('.picked button')?.focus();
  }

  showError(reason: string): void {
    if (this.error !== null) {
      this.error.textContent = reason;
    }
  }

  hide(): void {
    this.current = '';
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
    row.className = ['squadron', c.name === this.picked ? 'picked' : '', c.current ? 'current' : ''].filter((n) => n !== '').join(' ');
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
    join.textContent = c.current ? 'Stay' : 'Join';
    join.addEventListener('click', () => {
      this.pick(c.name);
    });
    const seats = doc.createElement('span');
    seats.className = 'seats-pips';
    seats.textContent = c.seats;
    const note = doc.createElement('span');
    note.className = 'note';
    note.textContent = c.note;
    row.append(name, who, join, seats, note);

    return row;
  }

  /** Joins the named squadron, or stays: the player's own closes the screen. */
  private pick(name: string): void {
    if (name !== '' && name === this.current) {
      this.hide();
    } else {
      this.choose(name);
    }
  }
}
