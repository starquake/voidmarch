import { WORLD_EDGE_BAND } from './rules.gen.ts';
import {
  FIELD_COLOR,
  FIELD_DRAW_RANGE,
  FIELD_FLARE_RANGE,
  FIELD_FLARE_SWELL,
  FIELD_HOT_COLOR,
  FIELD_JITTER,
  FIELD_RIPPLES,
  FIELD_STEP,
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

/** A side's samples, and its normal, which the sparks jump along. */
export interface FieldSide {
  samples: FieldSample[];
  nx: number;
  ny: number;
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

/** The sides within FIELD_DRAW_RANGE of the ship, sampled at time t in seconds. */
export function fieldSides(sides: readonly Side[], ship: Point, t: number): FieldSide[] {
  return sides.filter((side) => distanceToSide(side, ship) <= FIELD_DRAW_RANGE).map((side) => sampleSide(side, ship, t));
}

function sampleSide(side: Side, ship: Point, t: number): FieldSide {
  const length = Math.hypot(side.b.x - side.a.x, side.b.y - side.a.y);
  const nx = -(side.b.y - side.a.y) / length;
  const ny = (side.b.x - side.a.x) / length;
  const steps = Math.ceil(length / FIELD_STEP);
  const [r1, r2, r3, r4] = FIELD_RIPPLES;
  const wave = (r: (typeof FIELD_RIPPLES)[number], s: number): number => r.amplitude * Math.sin(s * r.along + t * r.speed + r.phase);
  const samples: FieldSample[] = [];
  for (let i = 0; i <= steps; i++) {
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

  return { samples, nx, ny };
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

/** Whether sample i throws a spark at time t: a few, changing 20 times a second. */
export function sparks(i: number, t: number): boolean {
  return Math.sin(i * 12.9898 + Math.floor(t * 20) * 78.233) > 0.93;
}

/** A zap's volume for a ship this far from the field: none outside the push-back band, louder the deeper in. */
export function zapVolume(distance: number): number {
  if (distance >= WORLD_EDGE_BAND) {
    return 0;
  }

  return FIELD_ZAP_VOLUME * (0.4 + 0.6 * (1 - Math.max(0, distance) / WORLD_EDGE_BAND));
}
