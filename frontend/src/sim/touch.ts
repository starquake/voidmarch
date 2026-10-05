import {
  TOUCH_BUTTON_GAP_PX,
  TOUCH_BUTTON_PX,
  TOUCH_BUTTON_WIDTH_PX,
  TOUCH_BUTTONS_Y,
  TOUCH_DEAD_ZONE,
  TOUCH_EDGE_PX,
  TOUCH_FULL_HEIGHT_PX,
  TOUCH_MIN_SCALE,
  TOUCH_RESPAWN_Y,
  TOUCH_SMALL_SHARE,
  TOUCH_STICK_RADIUS_PX,
  TOUCH_WIDE_BUTTON_PX,
} from './tuning.ts';

/** The touch buttons (#180): what the keyboard's G, Q, H, J and Esc do, and switching to fullscreen and back. */
export type TouchButton = 'summon' | 'orders' | 'respawnHome' | 'respawnBeside' | 'settings' | 'fullscreen';

/** A touch button's place on the canvas, in device pixels, and its label. */
export interface ButtonRect {
  button: TouchButton;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  gold: boolean;
}

/**
 * Device pixels per CSS pixel of touch UI on a canvas height device pixels
 * tall: the display's ratio, shrunk on a short screen such as a phone's, so
 * the sticks and buttons leave room to play (#180).
 */
export function touchUnit(height: number, dpr: number): number {
  const scale = Math.min(1, Math.max(TOUCH_MIN_SCALE, height / dpr / TOUCH_FULL_HEIGHT_PX));

  return dpr * scale;
}

/** What decides which buttons show: the canvas in device pixels and the ship's situation. */
export interface TouchScreen {
  width: number;
  height: number;
  dpr: number;
  down: boolean;
  canRespawn: boolean;
  /** The squadmate to respawn beside, if one is up. */
  beside: string | undefined;
  /** Whether the page is in fullscreen, or undefined where the browser can't switch (an iPhone's Safari). */
  fullscreen: boolean | undefined;
  /** The notch's safe area on the left and right, in device pixels, which the buttons keep clear of. */
  insetLeft?: number;
  insetRight?: number;
}

/**
 * The buttons for screen, as mocked (#180): Summon and Orders on the right
 * edge; while down, only the respawns.
 */
export function touchButtons(screen: TouchScreen): ButtonRect[] {
  const dpr = touchUnit(screen.height, screen.dpr);
  const small = { y: TOUCH_EDGE_PX * dpr, height: TOUCH_BUTTON_PX * dpr * TOUCH_SMALL_SHARE, gold: false };
  const settings: ButtonRect = {
    ...small,
    button: 'settings',
    label: 'Settings',
    x: TOUCH_EDGE_PX * dpr + (screen.insetLeft ?? 0),
    width: TOUCH_BUTTON_WIDTH_PX * dpr * TOUCH_SMALL_SHARE,
  };
  const switcher: ButtonRect[] =
    screen.fullscreen === undefined
      ? []
      : [
          {
            ...small,
            button: 'fullscreen',
            label: screen.fullscreen ? 'Windowed' : 'Full screen',
            x: settings.x + settings.width + TOUCH_BUTTON_GAP_PX * dpr,
            width: TOUCH_WIDE_BUTTON_PX * dpr * TOUCH_SMALL_SHARE,
          },
        ];

  return [...playButtons(screen, dpr), settings, ...switcher];
}

/** The buttons for playing: Summon and Orders, or while down the respawns. */
function playButtons(screen: TouchScreen, dpr: number): ButtonRect[] {
  const { width, height } = screen;
  const h = TOUCH_BUTTON_PX * dpr;
  const gap = TOUCH_BUTTON_GAP_PX * dpr;
  if (screen.down) {
    if (!screen.canRespawn) {
      return [];
    }
    const wide = TOUCH_WIDE_BUTTON_PX * dpr;
    const respawns: { button: TouchButton; label: string; gold: boolean }[] = [{ button: 'respawnHome', label: 'Respawn at home', gold: true }];
    if (screen.beside !== undefined) {
      respawns.push({ button: 'respawnBeside', label: `Respawn beside ${screen.beside}`, gold: false });
    }
    const total = respawns.length * wide + (respawns.length - 1) * gap;
    const left = (width - total) / 2;

    return respawns.map((r, i) => ({ ...r, x: left + i * (wide + gap), y: height * TOUCH_RESPAWN_Y, width: wide, height: h }));
  }
  const w = TOUCH_BUTTON_WIDTH_PX * dpr;
  const right = width - TOUCH_EDGE_PX * dpr - w - (screen.insetRight ?? 0);
  const top = height * TOUCH_BUTTONS_Y;
  const buttons: ButtonRect[] = [
    { button: 'summon', label: 'Summon', x: right, y: top, width: w, height: h, gold: false },
    { button: 'orders', label: 'Orders', x: right, y: top + h + gap, width: w, height: h, gold: false },
  ];

  return buttons;
}

/** The button at (x, y), if any. */
export function buttonAt(buttons: readonly ButtonRect[], x: number, y: number): ButtonRect | undefined {
  return buttons.find((b) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height);
}

/** What a touch is doing: the move or aim stick, a button, or opening the map from the minimap. */
export type TouchRole = 'move' | 'aim' | 'map' | TouchButton;

interface Track {
  role: TouchRole;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

/** A point on the canvas, or a stick's deflection. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Twin-stick touch controls (#180), in canvas device pixels. A touch on a
 * button or the minimap is that; otherwise one on the left half starts the
 * move stick where it lands, and one on the right half the aim stick, which
 * fires while it's pushed past the dead zone (decisions 1 and 2).
 */
export class TouchControls {
  private readonly tracks = new Map<number, Track>();
  private dpr = 1;

  /**
   * Starts touch id at (x, y) and returns what it does; undefined when that
   * stick is taken already. unit is touchUnit's: device pixels per CSS pixel
   * of touch UI.
   */
  start(id: number, x: number, y: number, width: number, buttons: readonly ButtonRect[], onMinimap: boolean, unit: number): TouchRole | undefined {
    this.dpr = unit;
    let role: TouchRole | undefined = buttonAt(buttons, x, y)?.button ?? (onMinimap ? 'map' : undefined);
    if (role === undefined) {
      const stick = x < width / 2 ? 'move' : 'aim';
      role = this.held(stick) ? undefined : stick;
    }
    if (role !== undefined) {
      this.tracks.set(id, { role, originX: x, originY: y, x, y });
    }

    return role;
  }

  /**
   * Moves touch id to (x, y). A touch that started on the minimap and moves
   * becomes the aim stick, if that's free: only a tap opens the map, since on
   * a phone the minimap covers much of where the aiming thumb lands.
   */
  moveTo(id: number, x: number, y: number): void {
    const t = this.tracks.get(id);
    if (t === undefined) {
      return;
    }
    t.x = x;
    t.y = y;
    const moved = Math.hypot(x - t.originX, y - t.originY) > TOUCH_STICK_RADIUS_PX * this.dpr * TOUCH_DEAD_ZONE;
    if (t.role === 'map' && moved && !this.held('aim')) {
      t.role = 'aim';
    }
  }

  /** Ends touch id and returns what it was doing. */
  end(id: number): TouchRole | undefined {
    const t = this.tracks.get(id);
    this.tracks.delete(id);

    return t?.role;
  }

  /** Lets go of every touch, as when the window loses focus. */
  clear(): void {
    this.tracks.clear();
  }

  /** Whether a touch is doing role. */
  held(role: TouchRole): boolean {
    return [...this.tracks.values()].some((t) => t.role === role);
  }

  /** Where the touch doing role is now, if any. */
  position(role: TouchRole): Point | undefined {
    const t = this.track(role);

    return t === undefined ? undefined : { x: t.x, y: t.y };
  }

  /** A stick's deflection: its offset over its reach, at most length 1, zero inside the dead zone. */
  stick(role: 'move' | 'aim'): Point {
    const t = this.track(role);
    if (t === undefined) {
      return { x: 0, y: 0 };
    }
    const radius = TOUCH_STICK_RADIUS_PX * this.dpr;
    const x = (t.x - t.originX) / radius;
    const y = (t.y - t.originY) / radius;
    const length = Math.hypot(x, y);
    if (length < TOUCH_DEAD_ZONE) {
      return { x: 0, y: 0 };
    }

    return length > 1 ? { x: x / length, y: y / length } : { x, y };
  }

  /** The aim stick's direction while it's pushed past the dead zone, as a unit vector. */
  aim(): Point | undefined {
    const { x, y } = this.stick('aim');
    const length = Math.hypot(x, y);

    return length === 0 ? undefined : { x: x / length, y: y / length };
  }

  /** Whether the aim stick fires: pushed past the dead zone. */
  get firing(): boolean {
    return this.aim() !== undefined;
  }

  /** The sticks being held, for drawing: where each started, and its knob, kept within reach. */
  sticks(): { role: 'move' | 'aim'; origin: Point; knob: Point; firing: boolean }[] {
    const radius = TOUCH_STICK_RADIUS_PX * this.dpr;
    const out: { role: 'move' | 'aim'; origin: Point; knob: Point; firing: boolean }[] = [];
    for (const t of this.tracks.values()) {
      if (t.role !== 'move' && t.role !== 'aim') {
        continue;
      }
      const dx = t.x - t.originX;
      const dy = t.y - t.originY;
      const scale = Math.min(1, radius / Math.max(Math.hypot(dx, dy), Number.EPSILON));
      out.push({
        role: t.role,
        origin: { x: t.originX, y: t.originY },
        knob: { x: t.originX + dx * scale, y: t.originY + dy * scale },
        firing: t.role === 'aim' && this.firing,
      });
    }

    return out;
  }

  private track(role: TouchRole): Track | undefined {
    return [...this.tracks.values()].find((t) => t.role === role);
  }
}

/**
 * Whether to show the touch controls (decision 3): on a touch screen with no
 * mouse, or as the page's `?touch=1` asks (`?touch=0` turns them off), for
 * trying them on a desktop and for E2E.
 */
export function touchMode(matches: (query: string) => boolean, search: string): boolean {
  const asked = new URLSearchParams(search).get('touch');
  if (asked !== null) {
    return asked === '1';
  }

  return matches('(pointer: coarse)') && !matches('(any-pointer: fine)');
}
