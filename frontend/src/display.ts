/** A canvas sized in device pixels and shown at CSS size. */
export interface DeviceSize {
  /** The canvas backing store, in device pixels. */
  width: number;
  height: number;
  /** The scale manager's zoom that shows it at CSS size: 1 / dpr. */
  zoom: number;
  dpr: number;
}

/**
 * Sizes the canvas to the device pixels a CSS-sized window covers, so every
 * canvas pixel is one device pixel. At fractional scaling (150%) a CSS-sized
 * canvas would be stretched unevenly, giving art pixels of mixed sizes.
 */
export function deviceSize(cssWidth: number, cssHeight: number, devicePixelRatio: number): DeviceSize {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;

  return {
    width: Math.max(1, Math.floor(cssWidth * dpr)),
    height: Math.max(1, Math.floor(cssHeight * dpr)),
    zoom: 1 / dpr,
    dpr,
  };
}

/**
 * The device pixels per CSS pixel the canvas renders at: the display's
 * ratio, or 1 when the player picked CSS pixels (P, #143), which the
 * browser then scales up: a quarter of the pixels on a 2x screen, with
 * softer text.
 */
export function renderRatio(devicePixelRatio: number, cssPixels: boolean): number {
  return cssPixels ? 1 : devicePixelRatio;
}

/** Where to sample a canvas width by height to tell a black world: a 3x3 grid across its middle, clear of the HUD's corners. */
export function blankSamples(width: number, height: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const fx of [0.3, 0.5, 0.7]) {
    for (const fy of [0.3, 0.5, 0.7]) {
      out.push({ x: Math.floor(width * fx), y: Math.floor(height * fy) });
    }
  }

  return out;
}

/** Whether every sampled RGBA pixel is pure black: nothing drew there. */
export function allBlack(samples: readonly Uint8Array[]): boolean {
  return samples.length > 0 && samples.every((p) => p[0] === 0 && p[1] === 0 && p[2] === 0);
}

/**
 * The whole-number enlargement of small that covers output, per side: the
 * size the bloom doubled its half-size glow to before #234, which can be a
 * pixel larger than the screen on an odd side.
 */
export function enlargedSize(small: { width: number; height: number }, output: { width: number; height: number }): { width: number; height: number } {
  return {
    width: small.width * Math.max(1, Math.round(output.width / small.width)),
    height: small.height * Math.max(1, Math.round(output.height / small.height)),
  };
}
