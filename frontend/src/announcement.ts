import { MISSION_BANNER_ALPHA, MISSION_BANNER_BORDER_PX, MISSION_BANNER_Y, MISSION_CSS, UI_FONT } from './sim/tuning.ts';

/** The banner's text size and padding at a scale of 1, in CSS pixels: the down panel's. */
export interface BannerSize {
  fontPx: number;
  paddingXPx: number;
  paddingYPx: number;
}

/** The inline style that lays the banner out at a scale, as CSS property values. */
export interface BannerStyle {
  top: string;
  fontFamily: string;
  fontSize: string;
  padding: string;
  borderWidth: string;
  borderColor: string;
  color: string;
  background: string;
}

const px = (n: number): string => `${String(n)}px`;

/**
 * The banner's look (#101, #272): gold text in a black, see-through box with
 * a thin gold border, centered at MISSION_BANNER_Y of the window. The scale
 * is 1 but on a phone, where the drawn UI shrinks with the touch controls
 * (#180). The border sits inside the padding, as the canvas banner drew it.
 */
export function bannerStyle(size: BannerSize, scale: number): BannerStyle {
  const border = MISSION_BANNER_BORDER_PX * scale;

  return {
    top: `${String(MISSION_BANNER_Y * 100)}%`,
    fontFamily: UI_FONT,
    fontSize: px(size.fontPx * scale),
    padding: `${px(size.paddingYPx * scale - border)} ${px(size.paddingXPx * scale - border)}`,
    borderWidth: px(border),
    borderColor: MISSION_CSS,
    color: MISSION_CSS,
    background: `rgb(0 0 0 / ${String(MISSION_BANNER_ALPHA * 100)}%)`,
  };
}

/**
 * The announcement banner (#101): a page element on top of everything, the
 * screens, the HUD and the full map included (#272, decision 3). It takes no
 * pointer or keyboard input, so it never blocks what is under it.
 */
export class AnnouncementView {
  private readonly el: HTMLElement | null;

  constructor(doc: Document = document) {
    this.el = doc.querySelector<HTMLElement>('#announcement');
  }

  /** Shows an announcement, one line per entry. */
  show(lines: readonly string[]): void {
    if (this.el !== null) {
      this.el.textContent = lines.join('\n');
      this.el.hidden = false;
    }
  }

  hide(): void {
    if (this.el !== null) {
      this.el.hidden = true;
    }
  }

  /** Lays the banner out for the window's scale. */
  layout(size: BannerSize, scale: number): void {
    if (this.el !== null) {
      Object.assign(this.el.style, bannerStyle(size, scale));
    }
  }

  /** The announcement showing, its lines joined by newlines, or undefined. */
  get text(): string | undefined {
    return this.el === null || this.el.hidden ? undefined : this.el.textContent;
  }

  /** The font the banner is set in, as the page computes it. */
  get font(): string {
    return this.el === null ? '' : getComputedStyle(this.el).fontFamily;
  }
}
