import { STATIC } from './net/static.ts';
import type { PanelRow, Pips } from './sim/hud.ts';

const ASSETS = `${STATIC}assets`;
/** How long a toast takes to fade out, matching the CSS transition. */
const TOAST_FADE_MS = 600;

/** A slot of the gauge, and the key that cycles it (#191). */
export type SlotKind = 'weapon' | 'engine' | 'shield';

/** A part as the gauge and its drop-up show it: icon file, name, tier color and what it does. */
export interface PartView {
  part: string;
  file: string;
  name: string;
  color: string;
  hint: string;
}

/** One of the gauge's part slots: the fitted part, its key, and the parts its drop-up offers. */
export interface GaugeSlot extends PartView {
  kind: SlotKind;
  key: string;
  options: readonly PartView[];
}

/** Everything the HUD shows in one frame. */
export interface HudFrame {
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
  private readonly fit: (kind: SlotKind, part: string) => void;
  /** The slot whose drop-up is open (#191). */
  private open: SlotKind | undefined;

  constructor(fit: (kind: SlotKind, part: string) => void, doc: Document = document) {
    this.fit = fit;
    this.root = doc.querySelector<HTMLElement>('#hud');
    this.gauge = doc.querySelector<HTMLElement>('#hud-gauge');
    this.panel = doc.querySelector<HTMLElement>('#hud-panel');
    this.toastBox = doc.querySelector<HTMLElement>('#hud-toasts');
    // A tap or click on a slot opens its drop-up, and one on a part fits it.
    this.gauge?.addEventListener('pointerdown', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const option = target?.closest<HTMLElement>('[data-part]');
      const slot = target?.closest<HTMLElement>('[data-slot]');
      event.preventDefault();
      event.stopPropagation();
      if (option !== null && option !== undefined && this.open !== undefined) {
        this.fit(this.open, option.dataset.part ?? '');
        this.close();
      } else if (slot !== null && slot !== undefined) {
        const kind = slot.dataset.slot as SlotKind;
        this.setOpen(this.open === kind ? undefined : kind);
      }
    });
    // Anywhere else closes it.
    doc.addEventListener('pointerdown', () => {
      this.close();
    });
  }

  /** Whether a slot's drop-up is open, so the scene's Esc closes it first. */
  get dropOpen(): SlotKind | undefined {
    return this.open;
  }

  /** Closes the drop-up, if it's open. */
  close(): void {
    this.setOpen(undefined);
  }

  private setOpen(kind: SlotKind | undefined): void {
    if (kind === this.open) {
      return;
    }
    this.open = kind;
    this.gaugeKey = '';
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

  /**
   * What covers the HUD this frame: the full map hides all of it, and a
   * screen or the down panel all but the toasts (#221). A drop-up out of
   * sight closes, or it would take the Esc meant for the screen.
   */
  cover(map: boolean, screen: boolean): void {
    if (this.root === null) {
      return;
    }
    if (this.root.hidden !== map) {
      this.root.hidden = map;
    }
    if (this.root.classList.contains('toasts-only') !== screen) {
      this.root.classList.toggle('toasts-only', screen);
    }
    if (map || screen) {
      this.close();
    }
  }

  update(frame: HudFrame): void {
    if (this.root === null) {
      return;
    }
    this.drawGauge(frame);
    this.drawPanel(frame.rows);
    this.drawToasts(frame.toasts);
  }

  private drawGauge(frame: HudFrame): void {
    const key = JSON.stringify([frame.slots, frame.hull, frame.shield, this.open]);
    if (this.gauge === null || key === this.gaugeKey) {
      return;
    }
    this.gaugeKey = key;
    const doc = this.gauge.ownerDocument;
    const slots = doc.createElement('div');
    slots.className = 'hud-slots';
    for (const slot of frame.slots) {
      const box = doc.createElement('div');
      box.className = slot.kind === this.open ? 'hud-slot open' : 'hud-slot';
      box.title = `${slot.name} (${slot.key})`;
      box.dataset.slot = slot.kind;
      box.style.borderColor = slot.kind === this.open ? '' : slot.color;
      const keyLabel = doc.createElement('span');
      keyLabel.className = 'key';
      keyLabel.textContent = slot.key;
      box.append(HudView.icon(doc, slot.file), keyLabel);
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
    const open = frame.slots.find((s) => s.kind === this.open);
    if (open !== undefined) {
      this.drawDrop(doc, open, slots);
    }
  }

  /** The open slot's drop-up, above it, its icons in one column with the slot's (#191). */
  private drawDrop(doc: Document, slot: GaugeSlot, slots: HTMLElement): void {
    const drop = doc.createElement('div');
    drop.className = 'hud-drop';
    const title = doc.createElement('div');
    title.className = 'title';
    title.textContent = `${slot.kind.toUpperCase()} · ${slot.key} cycles`;
    drop.append(title);
    for (const option of slot.options) {
      const row = doc.createElement('div');
      row.className = option.part === slot.part ? 'option fitted' : 'option';
      row.dataset.part = option.part;
      const text = doc.createElement('span');
      const name = doc.createElement('span');
      name.className = 'name';
      name.textContent = option.name;
      name.style.color = option.color;
      const hint = doc.createElement('span');
      hint.className = 'hint';
      hint.textContent = option.hint;
      text.append(name, hint);
      row.append(HudView.icon(doc, option.file), text);
      drop.append(row);
    }
    this.gauge?.append(drop);
    const slotIcon = slots.querySelector(`[data-slot="${slot.kind}"] i`)?.getBoundingClientRect();
    const listIcon = drop.querySelector('.option i')?.getBoundingClientRect();
    if (slotIcon !== undefined && listIcon !== undefined) {
      drop.style.left = `${String(drop.offsetLeft + slotIcon.left - listIcon.left)}px`;
    }
  }

  /** The texts of the open drop-up's parts, for the E2E tests. */
  get dropParts(): string[] {
    return [...(this.gauge?.querySelectorAll<HTMLElement>('.hud-drop [data-part]') ?? [])].map((el) => el.dataset.part ?? '');
  }

  private static icon(doc: Document, file: string): HTMLElement {
    const icon = doc.createElement('i');
    icon.style.backgroundImage = `url(${ASSETS}/pickups/${file}.png)`;

    return icon;
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
