import type { IntroScreen } from './introscreen.ts';
import { LoadProgress, codeView, type LoadView } from './sim/loading.ts';

/** The loading strip (#227): what is loading and how far it got, docked at the bottom of the screen. */
class LoadingStrip {
  private readonly doc: Document;
  private readonly strip: HTMLElement | null;
  private readonly what: HTMLElement | null;
  private readonly amount: HTMLElement | null;
  private readonly percent: HTMLElement | null;
  private readonly bar: HTMLElement | null;
  private readonly fill: HTMLElement | null;
  private readonly categories: HTMLElement | null;

  constructor(doc: Document) {
    this.doc = doc;
    this.strip = doc.querySelector('#loading-strip');
    this.what = doc.querySelector('#loading-what');
    this.amount = doc.querySelector('#loading-amount');
    this.percent = doc.querySelector('#loading-percent');
    this.bar = doc.querySelector('#loading-bar');
    this.fill = doc.querySelector('#loading-fill');
    this.categories = doc.querySelector('#loading-categories');
  }

  show(view: LoadView): void {
    if (this.strip === null) {
      return;
    }
    const percent = `${String(view.percent ?? 0)}%`;
    if (this.what !== null) {
      this.what.textContent = view.label;
    }
    if (this.amount !== null) {
      this.amount.hidden = view.percent === undefined;
    }
    if (this.percent !== null) {
      this.percent.textContent = percent;
    }
    // Without a value, the bar is an indeterminate progressbar.
    if (view.percent === undefined) {
      this.bar?.removeAttribute('aria-valuenow');
    } else {
      this.bar?.setAttribute('aria-valuenow', String(view.percent));
    }
    if (this.fill !== null) {
      this.fill.style.width = percent;
    }
    this.categories?.replaceChildren(
      ...view.categories.map((c) => {
        const li = this.doc.createElement('li');
        li.className = c.state;
        li.textContent = c.name;

        return li;
      }),
    );
    this.strip.hidden = false;
    // The intro makes room for it.
    this.doc.documentElement.classList.add('loading');
  }

  hide(): void {
    if (this.strip !== null) {
      this.strip.hidden = true;
    }
    this.doc.documentElement.classList.remove('loading');
  }
}

/**
 * The screens before the game, one at a time (#227): the name screen while
 * everything loads behind it, then the intro on a first visit with the
 * loading strip under it, or the strip alone, until the game is up. It
 * starts in the entry module, before the game's code is in (decision 8).
 */
export class FrontDoor {
  private readonly doc: Document;
  /** Undefined until the game's code is in and says what it loads. */
  private progress: LoadProgress | undefined;
  private readonly strip: LoadingStrip;
  private readonly intro: IntroScreen;
  private entered = false;
  private started = false;

  /** Until the game is up, F1 has nothing to toggle, and some browsers would open their own help. */
  private readonly keepHelpClosed = (event: KeyboardEvent): void => {
    if (event.code === 'F1') {
      event.preventDefault();
    }
  };

  constructor(intro: IntroScreen, doc: Document = document) {
    this.doc = doc;
    this.strip = new LoadingStrip(doc);
    this.intro = intro;
    doc.addEventListener('keydown', this.keepHelpClosed);
  }

  /** The game's code is in: from now on the strip counts keys, everything still to load. */
  count(keys: Iterable<string>): void {
    this.progress = new LoadProgress(keys);
    this.draw();
  }

  /** A file is in, or failed. */
  loaded(key: string): void {
    this.progress?.finish(key);
    this.draw();
  }

  /** Past the name screen: the intro on a first visit, and the strip until the game is up. */
  enter(showIntro: boolean, touch: boolean): void {
    this.entered = true;
    if (showIntro) {
      this.intro.show(touch, !this.started);
    }
    this.draw();
  }

  /** The game is up: the strip goes, and the intro can be closed. */
  start(): void {
    this.started = true;
    this.doc.removeEventListener('keydown', this.keepHelpClosed);
    this.strip.hide();
    this.intro.ready();
  }

  private draw(): void {
    if (this.entered && !this.started) {
      this.strip.show(this.progress?.view() ?? codeView());
    }
  }
}
