import { WORLD_EDGE_BAND } from './rules.gen.ts';
import {
  FIELD_COLOR,
  FIELD_CORE_RADIUS,
  FIELD_DOT_TEXELS,
  FIELD_DRAW_RANGE,
  FIELD_FLARE_RANGE,
  FIELD_FLARE_SWELL,
  FIELD_GLOW_RADIUS,
  FIELD_HOT_COLOR,
  FIELD_JITTER,
  FIELD_RIPPLES,
  FIELD_STEP,
  FIELD_VIEW_MARGIN,
  FIELD_ZAP_VOLUME,
} from './tuning.ts';

interface Point {
  x: number;
  y: number;
}

/** A side where an open sector meets a closed one, as `closedEdges` gives it. */
export interface Side {
  a: Point;
  b: Point;
}

/** One sample along a side: where its two strands pass, how much it flares (0 to 1), and its flicker (0.3 to 1). */
export interface FieldSample {
  x: number;
  y: number;
  x2: number;
  y2: number;
  flare: number;
  flicker: number;
}

/** A side's samples in view, the index along the side of the first, and its normal, which the sparks jump along. */
export interface FieldSide {
  samples: FieldSample[];
  first: number;
  nx: number;
  ny: number;
}

/** The part of the world the camera shows. */
export interface View {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The distance from p to the side's nearest point. */
export function distanceToSide(side: Side, p: Point): number {
  const dx = side.b.x - side.a.x;
  const dy = side.b.y - side.a.y;
  const lengthSquared = dx * dx + dy * dy;
  const u = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - side.a.x) * dx + (p.y - side.a.y) * dy) / lengthSquared));

  return Math.hypot(p.x - (side.a.x + dx * u), p.y - (side.a.y + dy * u));
}

/** The distance from p to the nearest side, Infinity with none. */
export function nearestSide(sides: readonly Side[], p: Point): number {
  return sides.reduce((nearest, side) => Math.min(nearest, distanceToSide(side, p)), Number.POSITIVE_INFINITY);
}

/**
 * The sides within FIELD_DRAW_RANGE of the ship, sampled at time t in
 * seconds: only where they pass through the view, grown by FIELD_VIEW_MARGIN.
 */
export function fieldSides(sides: readonly Side[], ship: Point, t: number, view: View): FieldSide[] {
  const grown = {
    left: view.left - FIELD_VIEW_MARGIN,
    top: view.top - FIELD_VIEW_MARGIN,
    right: view.right + FIELD_VIEW_MARGIN,
    bottom: view.bottom + FIELD_VIEW_MARGIN,
  };
  const out: FieldSide[] = [];
  for (const side of sides) {
    const span = distanceToSide(side, ship) <= FIELD_DRAW_RANGE ? clip(side, grown) : undefined;
    if (span !== undefined) {
      out.push(sampleSide(side, ship, t, span));
    }
  }

  return out;
}

/** The part of side inside view, as fractions of the way from a to b (Liang-Barsky); undefined if it misses. */
function clip(side: Side, view: View): [number, number] | undefined {
  const dx = side.b.x - side.a.x;
  const dy = side.b.y - side.a.y;
  let from = 0;
  let to = 1;
  for (const [p, q] of [
    [-dx, side.a.x - view.left],
    [dx, view.right - side.a.x],
    [-dy, side.a.y - view.top],
    [dy, view.bottom - side.a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) {
        return undefined;
      }
      continue;
    }
    const r = q / p;
    if (p < 0) {
      from = Math.max(from, r);
    } else {
      to = Math.min(to, r);
    }
  }

  return from <= to ? [from, to] : undefined;
}

function sampleSide(side: Side, ship: Point, t: number, [from, to]: [number, number]): FieldSide {
  const length = Math.hypot(side.b.x - side.a.x, side.b.y - side.a.y);
  const nx = -(side.b.y - side.a.y) / length;
  const ny = (side.b.x - side.a.x) / length;
  const steps = Math.ceil(length / FIELD_STEP);
  const first = Math.floor(from * steps);
  const [r1, r2, r3, r4] = FIELD_RIPPLES;
  const wave = (r: (typeof FIELD_RIPPLES)[number], s: number): number => r.amplitude * Math.sin(s * r.along + t * r.speed + r.phase);
  const samples: FieldSample[] = [];
  for (let i = first; i <= Math.ceil(to * steps); i++) {
    const s = (i / steps) * length;
    const x = side.a.x + (side.b.x - side.a.x) * (i / steps);
    const y = side.a.y + (side.b.y - side.a.y) * (i / steps);
    const flare = Math.max(0, 1 - Math.hypot(ship.x - x, ship.y - y) / FIELD_FLARE_RANGE) ** 2;
    const swell = 1 + flare * FIELD_FLARE_SWELL;
    const jitter = Math.sin(s * 0.9 + t * 31) * flare * FIELD_JITTER;
    const one = (wave(r1, s) + wave(r2, s)) * swell + jitter;
    const two = (wave(r3, s) + wave(r4, s)) * swell - jitter;
    samples.push({
      x: x + nx * one,
      y: y + ny * one,
      x2: x + nx * two,
      y2: y + ny * two,
      flare,
      flicker: 0.65 + 0.35 * Math.sin(t * 9 + s * 0.021) * Math.sin(t * 13.7 - s * 0.009),
    });
  }

  return { samples, first, nx, ny };
}

/** The field's color at a flare from 0 to 1, from FIELD_COLOR to FIELD_HOT_COLOR. */
export function fieldColor(flare: number): number {
  const channel = (shift: number): number => {
    const from = (FIELD_COLOR >> shift) & 0xff;
    const to = (FIELD_HOT_COLOR >> shift) & 0xff;

    return Math.round(from + (to - from) * flare) << shift;
  };

  return channel(16) | channel(8) | channel(0);
}

/**
 * The glow's dot, white, as straight RGBA: the core's disk inside the glow's,
 * at FIELD_DOT_TEXELS per world px. The core is twice as bright, as the two
 * disks drawn on top of each other were (#262).
 */
export function fieldDotImage(): { size: number; data: Uint8ClampedArray } {
  const radius = FIELD_GLOW_RADIUS * FIELD_DOT_TEXELS;
  const core = FIELD_CORE_RADIUS * FIELD_DOT_TEXELS;
  const size = radius * 2;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - radius, y + 0.5 - radius);
      data[(y * size + x) * 4 + 3] = d <= core ? 255 : d <= radius ? 128 : 0;
    }
  }

  return { size, data };
}

/** Whether sample i throws a spark at time t: a few, changing 20 times a second. */
export function sparks(i: number, t: number): boolean {
  return Math.sin(i * 12.9898 + Math.floor(t * 20) * 78.233) > 0.93;
}

/**
 * A zap's volume for a ship this far from the field: none outside the
 * push-back band, louder the deeper in. A downed ship only drifts there, so
 * it hears none (#189).
 */
export function zapVolume(distance: number, downed: boolean): number {
  if (downed || distance >= WORLD_EDGE_BAND) {
    return 0;
  }

  return FIELD_ZAP_VOLUME * (0.4 + 0.6 * (1 - Math.max(0, distance) / WORLD_EDGE_BAND));
}
