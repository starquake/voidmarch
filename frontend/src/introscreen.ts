import { introContent, shareLink, type ControlColumn, type Line } from './sim/intro.ts';

/** How long Copy link says "Copied". */
const COPIED_MS = 2000;

/**
 * The intro screen (#193): the premise, the controls of the device, the
 * sectors and what else is good to know, and the game's link to share. It
 * shows on the first visit, while the game loads (#227), and again from F1 or
 * the Help button, over the running game. The screens behind it hide until it
 * closes.
 */
export class IntroScreen {
  private readonly doc: Document;
  private readonly form: HTMLFormElement | null;
  private readonly link: HTMLInputElement | null;
  private readonly copy: HTMLButtonElement | null;
  private readonly share: HTMLButtonElement | null;
  private readonly play: HTMLButtonElement | null;
  private readonly closed: (() => void)[] = [];
  private copiedTimer: number | undefined;
  private touch = false;
  /** While the game loads behind it, Play waits and the screen stays (#227, decision 5). */
  private loading = false;

  constructor(doc: Document = document) {
    this.doc = doc;
    this.form = doc.querySelector<HTMLFormElement>('#intro-form');
    this.link = doc.querySelector<HTMLInputElement>('#intro-link');
    this.copy = doc.querySelector<HTMLButtonElement>('#intro-copy');
    this.share = doc.querySelector<HTMLButtonElement>('#intro-share');
    this.play = doc.querySelector<HTMLButtonElement>('#intro-play');
    // Play is the form's submit button, so Enter plays too.
    this.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.hide();
    });
    this.copy?.addEventListener('click', () => {
      this.copyLink();
    });
    this.share?.addEventListener('click', () => {
      this.shareLink();
    });
  }

  get open(): boolean {
    return this.form !== null && !this.form.hidden;
  }

  /** listener runs each time the screen closes. */
  onClose(listener: () => void): void {
    this.closed.push(listener);
  }

  /**
   * Opens the screen with the controls of the device, keeping the screens
   * behind it hidden and from taking focus or clicks. While loading, Play
   * waits until ready.
   */
  show(touch: boolean, loading = false): void {
    if (this.form === null) {
      return;
    }
    this.touch = touch;
    this.loading = loading;
    this.fill();
    for (const other of this.doc.querySelectorAll<HTMLElement>('.name-screen')) {
      other.inert = other !== this.form;
    }
    this.form.hidden = false;
    this.form.scrollTop = 0;
    this.focusPlay();
  }

  /** The game is up behind the screen: Play plays, and the screen closes. */
  ready(): void {
    if (!this.loading) {
      return;
    }
    this.loading = false;
    this.fillLoading();
    if (this.open) {
      this.focusPlay();
    }
  }

  hide(): void {
    if (!this.open || this.loading || this.form === null) {
      return;
    }
    this.form.hidden = true;
    for (const other of this.doc.querySelectorAll<HTMLElement>('.name-screen')) {
      other.inert = false;
    }
    for (const listener of this.closed) {
      listener();
    }
  }

  /** Enter plays, once it can; on touch there's no keyboard to press it. */
  private focusPlay(): void {
    if (!this.touch && !this.loading) {
      this.play?.focus({ preventScroll: true });
    }
  }

  private fill(): void {
    const touch = this.touch;
    const content = introContent(touch, this.loading);
    const location = this.doc.defaultView?.location;
    this.fillLoading();
    this.text('#intro-premise', content.premise);
    this.doc.querySelector('#intro-friends')?.replaceChildren(content.friends);
    if (this.link !== null && location !== undefined) {
      this.link.value = shareLink(location);
    }
    this.resetCopy();
    if (this.share !== null) {
      // The share sheet is for phones and tablets, where the browser has one (decision 4).
      this.share.hidden = !touch || typeof this.doc.defaultView?.navigator.share !== 'function';
    }
    this.doc.querySelector('#intro-controls')?.replaceChildren(...content.controls.map((column) => this.column(column)));
    this.list('#intro-sectors', content.sectors);
    this.list('#intro-extras', content.extras);
  }

  /** What changes once the game is up: the hint, and Play. */
  private fillLoading(): void {
    this.text('#intro-hint', introContent(this.touch, this.loading).hint);
    if (this.play !== null) {
      this.play.disabled = this.loading;
    }
  }

  /** Copies the link and says so for a moment; where the clipboard is out of reach, selects it to copy by hand. */
  private copyLink(): void {
    const link = this.link?.value ?? '';
    const clipboard = this.doc.defaultView?.navigator.clipboard;
    const fallback = (): void => {
      this.link?.focus();
      this.link?.select();
    };
    if (clipboard === undefined) {
      fallback();

      return;
    }
    clipboard.writeText(link).then(() => {
      this.copied();
    }, fallback);
  }

  private copied(): void {
    const view = this.doc.defaultView;
    if (this.copy === null || view === null) {
      return;
    }
    this.copy.textContent = 'Copied';
    this.copy.classList.add('copied');
    view.clearTimeout(this.copiedTimer);
    this.copiedTimer = view.setTimeout(() => {
      this.resetCopy();
    }, COPIED_MS);
  }

  private resetCopy(): void {
    this.doc.defaultView?.clearTimeout(this.copiedTimer);
    this.copiedTimer = undefined;
    if (this.copy !== null) {
      this.copy.textContent = 'Copy link';
      this.copy.classList.remove('copied');
    }
  }

  /** Opens the device's share sheet with the link; closing it unshared is fine. */
  private shareLink(): void {
    const nav = this.doc.defaultView?.navigator;
    nav?.share({ title: 'Voidmarch', url: this.link?.value ?? '' }).catch(() => undefined);
  }

  private text(selector: string, line: Line): void {
    this.doc.querySelector(selector)?.replaceChildren(...this.spans(line));
  }

  private list(selector: string, lines: readonly Line[]): void {
    this.doc.querySelector(selector)?.replaceChildren(
      ...lines.map((line) => {
        const li = this.doc.createElement('li');
        li.append(...this.spans(line));

        return li;
      }),
    );
  }

  private spans(line: Line): (Node | string)[] {
    return line.map(({ text, mark }) => {
      if (mark === undefined) {
        return text;
      }
      const el = this.doc.createElement(mark === 'key' ? 'b' : 'span');
      if (mark !== 'key') {
        el.className = `mark-${mark}`;
      }
      el.textContent = text;

      return el;
    });
  }

  private column(column: ControlColumn): HTMLElement {
    const el = this.doc.createElement('div');
    const title = this.doc.createElement('h3');
    title.textContent = column.title;
    const rows = this.doc.createElement('div');
    rows.className = 'intro-rows';
    for (const row of column.rows) {
      const keys = this.doc.createElement('span');
      keys.className = column.style === 'buttons' ? 'intro-keys buttons' : 'intro-keys';
      keys.append(
        ...row.keys.map((k) => {
          if (column.style !== 'keys') {
            return k;
          }
          const cap = this.doc.createElement('kbd');
          cap.textContent = k;

          return cap;
        }),
      );
      const text = this.doc.createElement('span');
      text.textContent = row.text;
      rows.append(keys, text);
    }
    el.append(title, rows);
    if (column.note !== undefined) {
      const note = this.doc.createElement('p');
      note.className = 'intro-note';
      note.textContent = column.note;
      el.append(note);
    }

    return el;
  }
}
