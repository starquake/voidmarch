/** A vignette as Phaser's Vignette filter draws it: its center, radius and strength, in screen fractions. */
export interface Vignette {
  x: number;
  y: number;
  radius: number;
  strength: number;
}

/**
 * How much the vignette darkens the point (u, v) of the screen, from 0 to 1:
 * the filter's own formula, mix(color, black, darkness), so an overlay of
 * this much black draws the same (#143).
 */
export function vignetteDarkness(u: number, v: number, vignette: Vignette): number {
  const d = Math.hypot(u - vignette.x, v - vignette.y);
  if (d > vignette.radius) {
    return 1;
  }

  // The shader's 3.14, not Math.PI, so the overlay matches it.
  return Math.sin((d / vignette.radius) * 3.14 * vignette.strength);
}

/** The vignette as a size x size image of black at that darkness, straight RGBA, to stretch over the screen. */
export function vignetteImage(size: number, vignette: Vignette): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      data[(y * size + x) * 4 + 3] = Math.round(vignetteDarkness((x + 0.5) / size, (y + 0.5) / size, vignette) * 255);
    }
  }

  return data;
}
