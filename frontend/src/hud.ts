import type { PanelRow, Pips } from './sim/hud.ts';

const ASSETS = '/static/assets';
/** How long a toast takes to fade out, matching the CSS transition. */
const TOAST_FADE_MS = 600;

/** One of the gauge's part slots: its pickup icon file, name and tier color. */
export interface GaugeSlot {
  file: string;
  name: string;
  color: string;
}

/** Everything the HUD shows in one frame. */
export interface HudFrame {
  shown: boolean;
  slots: readonly GaugeSlot[];
  hull: Pips;
  shield: Pips;
  rows: readonly PanelRow[];
  toasts: readonly string[];
}

/**
 * The HUD's page elements (#91): the gauge bottom left, the panel top left
 * and the toasts at the top. Each part redraws only when what it shows
 * changes.
 */
export class HudView {
  private readonly root: HTMLElement | null;
  private readonly gauge: HTMLElement | null;
  private readonly panel: HTMLElement | null;
  private readonly toastBox: HTMLElement | null;
  private gaugeKey = '';
  private panelKey = '';
  private readonly toasts = new Map<string, HTMLElement>();

  constructor(doc: Document = document) {
    this.root = doc.querySelector<HTMLElement>('#hud');
    this.gauge = doc.querySelector<HTMLElement>('#hud-gauge');
    this.panel = doc.querySelector<HTMLElement>('#hud-panel');
    this.toastBox = doc.querySelector<HTMLElement>('#hud-toasts');
  }

  /** The panel's rows as "Label: value", for the E2E tests. */
  get rowTexts(): string[] {
    const cells = [...(this.panel?.children ?? [])].map((el) => el.textContent);
    const rows: string[] = [];
    for (let i = 0; i + 1 < cells.length; i += 2) {
      rows.push(`${cells[i] ?? ''}: ${cells[i + 1] ?? ''}`);
    }

    return rows;
  }

  /** The texts of the toasts on screen, fading ones excluded, for the E2E tests. */
  get toastTexts(): string[] {
    return [...this.toasts.entries()].filter(([, el]) => !el.classList.contains('gone')).map(([text]) => text);
  }

  update(frame: HudFrame): void {
    if (this.root === null) {
      return;
    }
    this.root.hidden = !frame.shown;
    this.drawGauge(frame);
    this.drawPanel(frame.rows);
    this.drawToasts(frame.toasts);
  }

  private drawGauge(frame: HudFrame): void {
    const key = JSON.stringify([frame.slots, frame.hull, frame.shield]);
    if (this.gauge === null || key === this.gaugeKey) {
      return;
    }
    this.gaugeKey = key;
    const doc = this.gauge.ownerDocument;
    const slots = doc.createElement('div');
    slots.className = 'hud-slots';
    for (const slot of frame.slots) {
      const box = doc.createElement('div');
      box.className = 'hud-slot';
      box.title = slot.name;
      box.style.borderColor = slot.color;
      const icon = doc.createElement('i');
      icon.style.backgroundImage = `url(${ASSETS}/pickups/${slot.file}.png)`;
      box.append(icon);
      slots.append(box);
    }
    const bars = doc.createElement('div');
    bars.className = 'hud-bars';
    for (const [label, pips, kind] of [
      ['HULL', frame.hull, 'hull'],
      ['SHIELD', frame.shield, 'shield'],
    ] as const) {
      const name = doc.createElement('span');
      name.textContent = label;
      const row = doc.createElement('span');
      row.className = `hud-pips ${kind}`;
      for (let i = 0; i < pips.of; i++) {
        const pip = doc.createElement('span');
        pip.className = i < pips.on ? 'pip on' : 'pip';
        row.append(pip);
      }
      bars.append(name, row);
    }
    this.gauge.replaceChildren(slots, bars);
  }

  private drawPanel(rows: readonly PanelRow[]): void {
    const key = JSON.stringify(rows);
    if (this.panel === null || key === this.panelKey) {
      return;
    }
    this.panelKey = key;
    const doc = this.panel.ownerDocument;
    this.panel.hidden = rows.length === 0;
    this.panel.replaceChildren(
      ...rows.flatMap((row) => {
        const label = doc.createElement('span');
        label.className = 'k';
        label.textContent = row.label;
        const value = doc.createElement('span');
        value.textContent = row.value;
        if (row.alert) {
          value.className = 'alert';
        }

        return [label, value];
      }),
    );
  }

  private drawToasts(texts: readonly string[]): void {
    if (this.toastBox === null) {
      return;
    }
    const doc = this.toastBox.ownerDocument;
    for (const [text, el] of this.toasts) {
      if (!texts.includes(text) && !el.classList.contains('gone')) {
        el.classList.add('gone');
        setTimeout(() => {
          el.remove();
          if (this.toasts.get(text) === el) {
            this.toasts.delete(text);
          }
        }, TOAST_FADE_MS);
      }
    }
    for (const text of texts) {
      const shown = this.toasts.get(text);
      if (shown !== undefined && !shown.classList.contains('gone')) {
        continue;
      }
      shown?.remove();
      const el = doc.createElement('div');
      el.className = 'hud-toast';
      el.textContent = text;
      this.toastBox.append(el);
      this.toasts.set(text, el);
    }
  }
}
