/** A player's season stats, as the server sends them (#154). */
export interface PlayerResult {
  playerId: string;
  name: string;
  kills: number;
  companionKills: number;
  shots: number;
  hits: number;
  deaths: number;
  rescues: number;
  sectors: number;
}

/** The season's result (#156): which season, how long it took, everyone's stats, and the sectors cleared. */
export interface SeasonResult {
  season: string;
  seconds: number;
  players: readonly PlayerResult[];
  sectors: number;
}

/** One row of the victory screen's table, as text. */
export interface VictoryRow {
  name: string;
  kills: string;
  companionKills: string;
  hitRate: string;
  killsDeaths: string;
  rescues: string;
  sectors: string;
  you: boolean;
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const PERCENT = 100;

/** How long the season took: "41 h 12 min", or "12 min" under an hour. */
export function formatTook(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / SECONDS_PER_MINUTE);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;

  return hours === 0 ? `${String(rest)} min` : `${String(hours)} h ${String(rest)} min`;
}

/** Hits over shots fired, as a whole percentage, or a dash with no shots. */
function hitRate(hits: number, shots: number): string {
  return shots === 0 ? '–' : `${String(Math.round((PERCENT * hits) / shots))}%`;
}

/** The table's rows, in the server's order, the player's own marked, then everyone's totals. */
export function victoryRows(result: SeasonResult, playerId: string | undefined): VictoryRow[] {
  const sum = (pick: (p: PlayerResult) => number): number => result.players.reduce((total, p) => total + pick(p), 0);
  const rows = result.players.map((p) => ({
    name: p.name,
    kills: String(p.kills),
    companionKills: String(p.companionKills),
    hitRate: hitRate(p.hits, p.shots),
    killsDeaths: `${String(p.kills)} / ${String(p.deaths)}`,
    rescues: String(p.rescues),
    sectors: String(p.sectors),
    you: p.playerId === playerId,
  }));
  const kills = sum((p) => p.kills);
  rows.push({
    name: 'Everyone',
    kills: String(kills),
    companionKills: String(sum((p) => p.companionKills)),
    hitRate: hitRate(
      sum((p) => p.hits),
      sum((p) => p.shots),
    ),
    killsDeaths: `${String(kills)} / ${String(sum((p) => p.deaths))}`,
    rescues: String(sum((p) => p.rescues)),
    sectors: String(result.sectors),
    you: false,
  });

  return rows;
}

const COLUMNS = ['name', 'kills', 'companionKills', 'hitRate', 'killsDeaths', 'rescues', 'sectors'] as const;

/** The victory screen (#156): shown over the running game when the season is won, and reopened with O. */
export class VictoryScreen {
  private readonly form: HTMLFormElement | null;
  private readonly took: HTMLElement | null;
  private readonly body: HTMLElement | null;
  private readonly totals: HTMLElement | null;

  constructor(doc: Document = document) {
    this.form = doc.querySelector<HTMLFormElement>('#victory-form');
    this.took = doc.querySelector<HTMLElement>('#victory-took');
    this.body = doc.querySelector<HTMLElement>('#victory-players');
    this.totals = doc.querySelector<HTMLElement>('#victory-totals');
    this.form?.addEventListener('submit', (event) => {
      event.preventDefault();
    });
  }

  get open(): boolean {
    return this.form !== null && !this.form.hidden;
  }

  show(result: SeasonResult, playerId: string | undefined): void {
    if (this.form === null) {
      return;
    }
    const doc = this.form.ownerDocument;
    if (this.took !== null) {
      this.took.textContent = `in ${formatTook(result.seconds)}`;
    }
    const rows = victoryRows(result, playerId);
    const everyone = rows.pop();
    this.body?.replaceChildren(...rows.map((row) => VictoryScreen.row(doc, row)));
    this.totals?.replaceChildren(...(everyone === undefined ? [] : [VictoryScreen.row(doc, everyone)]));
    this.form.hidden = false;
  }

  hide(): void {
    if (this.form !== null) {
      this.form.hidden = true;
    }
  }

  private static row(doc: Document, row: VictoryRow): HTMLTableRowElement {
    const tr = doc.createElement('tr');
    if (row.you) {
      tr.className = 'you';
    }
    for (const column of COLUMNS) {
      const td = doc.createElement('td');
      td.textContent = row[column];
      if (column === 'companionKills') {
        td.className = 'dim';
      }
      tr.append(td);
    }

    return tr;
  }
}
