import { standingRows, seasonAge, type PlayerStatsRow, type StandingRow } from './sim/standings.ts';

const COLUMNS = ['name', 'kills', 'hitRate', 'killsDeaths'] as const;
const HEADINGS = ['Player', 'Kills', 'Hit rate', 'Kills / deaths'] as const;

/** A "Season so far" table (#167) in a page element: on the join screen, or above the down panel. */
export class StandingsPanel {
  private readonly el: HTMLElement | null;
  private drawn = -1;

  constructor(selector: string, doc: Document = document) {
    this.el = doc.querySelector<HTMLElement>(selector);
  }

  /** How many rows it shows, or 0 while hidden, for the E2E tests. */
  get rows(): number {
    return this.el === null || this.el.hidden ? 0 : this.el.querySelectorAll('tbody tr').length;
  }

  /**
   * Shows the table when show is set and anyone has stats, redrawing it only
   * when version moved; hides it otherwise.
   */
  update(show: boolean, players: readonly PlayerStatsRow[], playerId: string | undefined, started: number, version: number): void {
    if (this.el === null) {
      return;
    }
    const visible = show && players.length > 0;
    this.el.hidden = !visible;
    if (!visible || version === this.drawn) {
      return;
    }
    this.drawn = version;
    const doc = this.el.ownerDocument;
    const title = doc.createElement('h3');
    title.textContent = 'Season so far';
    const age = doc.createElement('span');
    age.textContent = started > 0 ? seasonAge(started, Date.now() / 1000) : '';
    title.append(age);
    const table = doc.createElement('table');
    const head = doc.createElement('tr');
    for (const heading of HEADINGS) {
      const th = doc.createElement('th');
      th.textContent = heading;
      head.append(th);
    }
    const thead = doc.createElement('thead');
    thead.append(head);
    const body = doc.createElement('tbody');
    body.append(...standingRows(players, playerId).map((row) => StandingsPanel.row(doc, row)));
    table.append(thead, body);
    this.el.replaceChildren(title, table);
  }

  private static row(doc: Document, row: StandingRow): HTMLTableRowElement {
    const tr = doc.createElement('tr');
    if (row.you) {
      tr.className = 'you';
    }
    for (const column of COLUMNS) {
      const td = doc.createElement('td');
      td.textContent = row[column];
      tr.append(td);
    }

    return tr;
  }
}
