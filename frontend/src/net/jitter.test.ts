import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ServerClock } from './clock.ts';
import { StateBuffer, type Pose } from './interpolation.ts';
import { Timeline } from './timeline.ts';

/*
 * Replays seeded network traces through the client's own timeline and
 * buffer, for a ship flying straight at 200 px/s drawn at 60 fps, and counts
 * what a player would see go wrong (#232): frames where it stands still, and
 * jumps, frames where it overshoots its usual step by more than twice that
 * step (10 px), the measure the audit used.
 */

const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;
const FRAME_MS = 1000 / 60;
const SPEED = 200;
const STEP = (SPEED * FRAME_MS) / 1000;
const MINUTE = 60_000;

/** A deterministic random source, so every run replays the same trace. */
function mulberry32(seed: number): () => number {
  let a = seed;

  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** When each snapshot arrives, one a tick for durationMs, in TCP order: none overtakes another. */
function trace(durationMs: number, latencyMs: (tick: number) => number): number[] {
  const arrivals: number[] = [];
  let last = 0;
  for (let tick = 0; tick * TICK_MS < durationMs; tick++) {
    last = Math.max(last, tick * TICK_MS + latencyMs(tick));
    arrivals.push(last);
  }

  return arrivals;
}

/** A 30 ms base latency plus seeded exponential jitter with the given mean. */
function exponential(meanMs: number, seed = 1): (tick: number) => number {
  const random = mulberry32(seed);

  return () => 30 - meanMs * Math.log(1 - random());
}

/** The client as it draws: a render tick each frame, from the reports so far. */
interface Renderer {
  snapshot(tick: number, nowMs: number): void;
  renderTick(nowMs: number): number | undefined;
}

/** The client before #232: the server clock less a fixed 2 ticks. */
function fixedDelay(): Renderer {
  const clock = new ServerClock(TICK_RATE);

  return {
    snapshot: (tick, nowMs) => {
      clock.observe(tick, nowMs);
    },
    renderTick: (nowMs) => {
      const tick = clock.tickAt(nowMs);

      return tick === undefined ? undefined : tick - 2;
    },
  };
}

/** What a replay showed: frozen frames as a share of all, and jumps a minute. */
interface Seen {
  frozen: number;
  jumpsPerMinute: number;
}

/** Replays arrivals through a renderer and a buffer, counting from settleMs on. */
function replay(renderer: Renderer, arrivals: readonly number[], settleMs = 5000): Seen {
  const buffer = new StateBuffer<Pose>();
  const endMs = (arrivals.at(-1) ?? 0) - 1000;
  let next = 0;
  let last: number | undefined;
  let frames = 0;
  let frozen = 0;
  let jumps = 0;
  for (let nowMs = 0; nowMs < endMs; nowMs += FRAME_MS) {
    for (let at = arrivals[next]; at !== undefined && at <= nowMs; at = arrivals[next]) {
      renderer.snapshot(next, at);
      buffer.push(next, { x: (next * SPEED) / TICK_RATE, y: 0, angle: 0 });
      next++;
    }
    const tick = renderer.renderTick(nowMs);
    const x = tick === undefined ? undefined : buffer.sample(tick)?.x;
    if (x === undefined) {
      continue;
    }
    if (last !== undefined && nowMs >= settleMs) {
      frames++;
      const step = x - last;
      if (step < 1e-6) {
        frozen++;
      } else if (step - STEP > 2 * STEP) {
        jumps++;
      }
    }
    last = x;
  }

  return { frozen: frozen / frames, jumpsPerMinute: jumps / ((frames * FRAME_MS) / MINUTE) };
}

const describe = (seen: Seen): string =>
  `${(seen.frozen * 100).toFixed(2)}% frozen, ${seen.jumpsPerMinute.toFixed(1)} jumps a minute`;

const adaptive = (): Renderer => new Timeline(TICK_RATE);

/** Asserts that seen is at least factor times better than baseline on both counts. */
function better(seen: Seen, baseline: Seen, factor: number): void {
  assert.ok(seen.frozen * factor <= baseline.frozen, `${describe(seen)} against ${describe(baseline)}`);
  assert.ok(seen.jumpsPerMinute * factor <= baseline.jumpsPerMinute, `${describe(seen)} against ${describe(baseline)}`);
}

test('the fixed 2-tick delay reproduces the audit', (t) => {
  const at25 = replay(fixedDelay(), trace(10 * MINUTE, exponential(25)));
  const at50 = replay(fixedDelay(), trace(10 * MINUTE, exponential(50)));
  t.diagnostic(`fixed 2 ticks, 25 ms jitter: ${describe(at25)}`);
  t.diagnostic(`fixed 2 ticks, 50 ms jitter: ${describe(at50)}`);
  // The audit: 2.5% and 20 a minute, 17% and 111 a minute.
  assert.ok(at25.frozen > 0.015 && at25.frozen < 0.035, describe(at25));
  assert.ok(at25.jumpsPerMinute > 12 && at25.jumpsPerMinute < 30, describe(at25));
  assert.ok(at50.frozen > 0.13 && at50.frozen < 0.21, describe(at50));
  assert.ok(at50.jumpsPerMinute > 80 && at50.jumpsPerMinute < 150, describe(at50));
});

test('a constant latency is drawn without a freeze or a jump', (t) => {
  const seen = replay(adaptive(), trace(10 * MINUTE, () => 40));
  t.diagnostic(`adaptive, constant 40 ms: ${describe(seen)}`);
  assert.equal(seen.frozen, 0);
  assert.equal(seen.jumpsPerMinute, 0);
});

test('the adaptive delay beats the fixed one under jitter', (t) => {
  for (const [mean, factor] of [
    [25, 1.5],
    [50, 5],
  ] as const) {
    const arrivals = trace(10 * MINUTE, exponential(mean));
    const seen = replay(adaptive(), arrivals);
    t.diagnostic(`adaptive, ${String(mean)} ms jitter: ${describe(seen)}`);
    better(seen, replay(fixedDelay(), arrivals), factor);
  }
});
