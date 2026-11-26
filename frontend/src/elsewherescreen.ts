/**
 * The screen a tab shows once the same player opened the game in another tab
 * (#353): the server keeps one connection per player, so this tab waits
 * until Play here takes the game back from the other.
 */
export class ElsewhereScreen {
  private readonly form: HTMLFormElement | null;
  private readonly play: HTMLButtonElement | null;
  private playHere: () => void = () => undefined;

  constructor(doc: Document = document) {
    this.form = doc.querySelector<HTMLFormElement>('#elsewhere-form');
    this.play = doc.querySelector<HTMLButtonElement>('#elsewhere-play');
    // Play here is the form's submit button, so Enter and a tap both reach it.
    this.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.choose();
    });
  }

  get open(): boolean {
    return this.form !== null && !this.form.hidden;
  }

  /** Opens the screen; playHere runs once, when the player takes the game back. */
  show(touch: boolean, playHere: () => void): void {
    if (this.form === null) {
      return;
    }
    this.playHere = playHere;
    this.form.hidden = false;
    if (!touch) {
      this.play?.focus({ preventScroll: true });
    }
  }

  /** Takes the game back to this tab, once per showing. */
  choose(): void {
    if (!this.open || this.form === null) {
      return;
    }
    this.form.hidden = true;
    this.playHere();
  }
}
