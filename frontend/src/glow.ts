/** An image as straight (not premultiplied) RGBA bytes, row by row. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A glow as Phaser's Glow filter draws it: its color, outer strength, and samples per ring and rings. */
export interface GlowSettings {
  color: number;
  strength: number;
  quality: number;
  distance: number;
}

const CHANNELS = 4;
const MAX = 255;

/** src at twice the size, each pixel a 2x2 block, so a glow can step half an art pixel. */
export function double(src: Pixels): Pixels {
  const width = src.width * 2;
  const height = src.height * 2;
  const data = new Uint8ClampedArray(width * height * CHANNELS);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (Math.floor(y / 2) * src.width + Math.floor(x / 2)) * CHANNELS;
      data.set(src.data.subarray(from, from + CHANNELS), (y * width + x) * CHANNELS);
    }
  }

  return { width, height, data };
}

/** The alpha at (x, y), read between pixels like a linear texture lookup; 0 outside the image. */
function alphaAt(src: Pixels, x: number, y: number): number {
  const x0 = Math.floor(x - 0.5);
  const y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0;
  const fy = y - 0.5 - y0;
  const at = (px: number, py: number): number =>
    px < 0 || py < 0 || px >= src.width || py >= src.height ? 0 : (src.data[(py * src.width + px) * CHANNELS + 3] ?? 0) / MAX;

  return (
    at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy
  );
}

/** The shader's pseudo-random turn for a ring, from the pixel's place. */
function jitter(ring: number, u: number, v: number): number {
  const s = Math.sin(ring * 12.9898 + (u + v) * 78.233) * 43758.5453;

  return s - Math.floor(s);
}

/**
 * src with Phaser's Glow filter baked around it, once, as the enemy-fire
 * layer drew it every frame (#143): rings of samples out to the distance
 * add up how much shape is near, and that much glow color goes where the
 * shape isn't. The result is padded by the distance on every side.
 */
export function bakeGlow(src: Pixels, glow: GlowSettings): Pixels {
  const pad = glow.distance;
  const width = src.width + 2 * pad;
  const height = src.height + 2 * pad;
  const data = new Uint8ClampedArray(width * height * CHANNELS);
  const maxAlpha = (glow.distance * (glow.distance + 1) * glow.quality) / 2;
  const red = ((glow.color >> 16) & MAX) / MAX;
  const green = ((glow.color >> 8) & MAX) / MAX;
  const blue = (glow.color & MAX) / MAX;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x - pad + 0.5;
      const sy = y - pad + 0.5;
      let total = 0;
      let angle = 0;
      for (let ring = 0; ring < glow.distance; ring++) {
        angle += jitter(ring, x / width, y / height);
        for (let i = 0; i < glow.quality; i++) {
          angle += (Math.PI * 2) / glow.quality;
          total += (glow.distance - ring) * alphaAt(src, sx + Math.cos(angle) * (ring + 1), sy + Math.sin(angle) * (ring + 1));
        }
      }
      const inside = sx > 0 && sy > 0 && sx < src.width && sy < src.height;
      const from = (Math.floor(sy) * src.width + Math.floor(sx)) * CHANNELS;
      const r = inside ? (src.data[from] ?? 0) / MAX : 0;
      const g = inside ? (src.data[from + 1] ?? 0) / MAX : 0;
      const b = inside ? (src.data[from + 2] ?? 0) / MAX : 0;
      const a = inside ? (src.data[from + 3] ?? 0) / MAX : 0;
      // As the shader does it, premultiplied: the shape, then glow where the shape isn't.
      const outer = Math.min(1 - a, (total / maxAlpha) * glow.strength * (1 - a));
      const alpha = a + outer;
      const to = (y * width + x) * CHANNELS;
      if (alpha > 0) {
        data[to] = Math.round(((r * a + outer * red) / alpha) * MAX);
        data[to + 1] = Math.round(((g * a + outer * green) / alpha) * MAX);
        data[to + 2] = Math.round(((b * a + outer * blue) / alpha) * MAX);
        data[to + 3] = Math.round(alpha * MAX);
      }
    }
  }

  return { width, height, data };
}
