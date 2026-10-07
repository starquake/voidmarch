import { moveSelection, type OptionRow } from './sim/options.ts';

/**
 * The settings screen (#145): Esc opens it over the running game, and each
 * row changes an option, by a click or by the arrow keys and Enter.
 */
export class SettingsScreen {
  private readonly form: HTMLFormElement | null;
  private readonly list: HTMLElement | null;
  private readonly change: (row: OptionRow) => void;
  private rows: readonly OptionRow[] = [];
  private selected = 0;

  constructor(change: (row: OptionRow) => void, doc: Document = document) {
    this.change = change;
    this.form = doc.querySelector<HTMLFormElement>('#settings-form');
    this.list = doc.querySelector<HTMLElement>('#settings-rows');
    this.form?.addEventListener('submit', (event) => {
      event.preventDefault();
    });
    // Keeps focus off the rows, so Enter and Space reach key() alone instead of clicking the focused row too.
    this.list?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
    });
    this.list?.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-row]') : null;
      const index = Number(button?.dataset.row);
      const row = this.rows[index];
      if (row !== undefined) {
        this.selected = index;
        this.change(row);
      }
    });
  }

  get open(): boolean {
    return this.form !== null && !this.form.hidden;
  }

  /** Opens the screen on its first row. */
  show(rows: readonly OptionRow[]): void {
    this.selected = 0;
    this.update(rows);
    if (this.form !== null) {
      this.form.hidden = false;
    }
  }

  /** Shows the rows' current values. */
  update(rows: readonly OptionRow[]): void {
    this.rows = rows;
    const doc = this.list?.ownerDocument;
    if (doc === undefined) {
      return;
    }
    this.list?.replaceChildren(
      ...rows.map((row, i) => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = i === this.selected ? 'settings-row selected' : 'settings-row';
        button.dataset.row = String(i);
        const label = doc.createElement('span');
        label.textContent = row.label;
        const value = doc.createElement('span');
        value.className = 'value';
        value.textContent = row.value;
        button.append(label, value);

        return button;
      }),
    );
    // In a short window the screen scrolls (#221): the arrows bring the picked row into view.
    this.list?.children[this.selected]?.scrollIntoView({ block: 'nearest' });
  }

  hide(): void {
    if (this.form !== null) {
      this.form.hidden = true;
    }
  }

  /** Handles a key while open: the arrows pick a row, and Enter, Space, left and right change it. Returns whether the key was the screen's. */
  key(event: KeyboardEvent): boolean {
    switch (event.code) {
      case 'ArrowUp':
      case 'ArrowDown':
        event.preventDefault();
        this.selected = moveSelection(this.selected, event.code === 'ArrowUp' ? -1 : 1, this.rows.length);
        this.update(this.rows);

        return true;
      case 'Enter':
      case 'Space':
      case 'ArrowLeft':
      case 'ArrowRight': {
        event.preventDefault();
        const row = this.rows[this.selected];
        if (row !== undefined) {
          this.change(row);
        }

        return true;
      }
      default:
        return false;
    }
  }
}
