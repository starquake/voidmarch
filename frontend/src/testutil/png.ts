import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

/** An image as 8-bit RGBA, row by row from the top left. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

/** The bytes before a PNG's first chunk, and around each chunk's data: its length and type, then its CRC. */
const SIGNATURE_BYTES = 8;
const CHUNK_HEAD = 8;
const CHUNK_TAIL = 4;

/** IHDR's color types this decoder reads, with their bytes per pixel. */
const CHANNELS: Readonly<Record<number, number>> = { 2: 3, 3: 1, 6: 4 };

/** The byte at i, which the caller knows is there. */
const at = (bytes: Uint8Array, i: number): number => bytes[i] ?? 0;

/** The Paeth predictor of PNG's filter type 4. */
const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);

  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Undoes one scanline's filter in place, given the line above it, already unfiltered. */
const unfilter = (filter: number, line: Uint8Array, above: Uint8Array, bpp: number): void => {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? at(line, i - bpp) : 0;
    const b = at(above, i);
    const c = i >= bpp ? at(above, i - bpp) : 0;
    const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
    if (predicted === undefined) {
      throw new Error(`unknown PNG filter ${String(filter)}`);
    }
    line[i] = (at(line, i) + predicted) & 0xff;
  }
};

/**
 * Decodes a PNG of 8-bit RGB, RGBA or palette pixels, not interlaced: what Go's
 * encoder writes and the Void packs ship. Tests only: it needs Node's zlib.
 */
export function decodePng(file: Uint8Array): Pixels {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let header: Uint8Array | undefined;
  let palette: Uint8Array = new Uint8Array();
  let alphas: Uint8Array = new Uint8Array();
  const data: Uint8Array[] = [];
  for (let i = SIGNATURE_BYTES; i < file.length; ) {
    const length = view.getUint32(i);
    const type = new TextDecoder().decode(file.subarray(i + 4, i + CHUNK_HEAD));
    const body = file.subarray(i + CHUNK_HEAD, i + CHUNK_HEAD + length);
    if (type === 'IHDR') {
      header = body;
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      alphas = body;
    } else if (type === 'IDAT') {
      data.push(body);
    }
    i += CHUNK_HEAD + length + CHUNK_TAIL;
  }
  if (header === undefined) {
    throw new Error('no IHDR chunk');
  }
  const head = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = head.getUint32(0);
  const height = head.getUint32(4);
  const [depth, colorType, , , interlace] = header.subarray(8);
  const bpp = CHANNELS[colorType ?? -1];
  if (depth !== 8 || interlace !== 0 || bpp === undefined) {
    throw new Error(`unsupported PNG: depth ${String(depth)}, color type ${String(colorType)}, interlace ${String(interlace)}`);
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  let above: Uint8Array = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const line = raw.subarray(start + 1, start + 1 + stride);
    unfilter(at(raw, start), line, above, bpp);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (bpp === 1) {
        const p = at(line, x);
        out.set([at(palette, p * 3), at(palette, p * 3 + 1), at(palette, p * 3 + 2), p < alphas.length ? at(alphas, p) : 0xff], o);
      } else {
        out.set([at(line, x * bpp), at(line, x * bpp + 1), at(line, x * bpp + 2), bpp === 4 ? at(line, x * bpp + 3) : 0xff], o);
      }
    }
    above = line;
  }

  return { width, height, data: out };
}

/** The w by h rectangle of img at (x, y), placed at (dx, dy) on a transparent canvas of cw by ch. */
export function copyRect(img: Pixels, x: number, y: number, w: number, h: number, cw = w, ch = h, dx = 0, dy = 0): Pixels {
  const data = new Uint8Array(cw * ch * 4);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * img.width + x) * 4;
    data.set(img.data.subarray(from, from + w * 4), ((dy + row) * cw + dx) * 4);
  }

  return { width: cw, height: ch, data };
}

/** A short fingerprint of an image's pixels, where every fully transparent pixel counts as the same. */
export function fingerprint(img: Pixels): string {
  const data = Uint8Array.from(img.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      data.fill(0, i, i + 4);
    }
  }

  return createHash('sha256').update(`${String(img.width)}x${String(img.height)}`).update(data).digest('hex').slice(0, 16);
}
