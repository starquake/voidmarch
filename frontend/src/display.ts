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
