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

/** The client's timeline: a render tick each frame, from the reports so far. */
interface Renderer {
  snapshot(tick: number, nowMs: number): void;
  renderTick(nowMs: number): number | undefined;
}

/** A client: its timeline, and whether it flies ships on past their newest snapshot and blends corrections, or holds them. */
interface Client {
  timeline: Renderer;
  extrapolates: boolean;
}

/** The client before #232: the server clock less a fixed 2 ticks, holding a ship once its snapshots run out. */
function before(): Client {
  const clock = new ServerClock(TICK_RATE);

  return {
    timeline: {
      snapshot: (tick, nowMs) => {
        clock.observe(tick, nowMs);
      },
      renderTick: (nowMs) => {
        const tick = clock.tickAt(nowMs);

        return tick === undefined ? undefined : tick - 2;
      },
    },
    extrapolates: false,
  };
}

/** The adaptive delay alone (#232, task 3). */
const adaptiveDelay = (): Client => ({ timeline: new Timeline(TICK_RATE), extrapolates: false });

/** The client since #232: the adaptive delay, and extrapolation. */
const after = (): Client => ({ timeline: new Timeline(TICK_RATE), extrapolates: true });

/** Where the ship flies: its position and velocity at a (fractional) tick. */
type Path = (tick: number) => Pose;

const straight: Path = (tick) => ({ x: (tick * SPEED) / TICK_RATE, y: 0, vx: SPEED, vy: 0, angle: 0 });

/** What a replay showed: frozen frames as a share of all, jumps a minute, and how far from the true ship it was drawn. */
interface Seen {
  frozen: number;
  frozenFrames: number;
  jumpsPerMinute: number;
  maxErrorPx: number;
}

/**
 * Replays arrivals through a client, counting from settleMs on. onFrame sees
 * each frame's time and how far the ship was drawn from where it truly was.
 */
function replay(
  client: Client,
  arrivals: readonly number[],
  path: Path = straight,
  settleMs = 5000,
  onFrame: (nowMs: number, errorPx: number) => void = () => undefined,
): Seen {
  const buffer = new StateBuffer<Pose>(TICK_RATE);
  const endMs = (arrivals.at(-1) ?? 0) - 1000;
  let next = 0;
  let last: Pose | undefined;
  let frames = 0;
  let frozen = 0;
  let jumps = 0;
  let maxErrorPx = 0;
  for (let nowMs = 0; nowMs < endMs; nowMs += FRAME_MS) {
    for (let at = arrivals[next]; at !== undefined && at <= nowMs; at = arrivals[next]) {
      client.timeline.snapshot(next, at);
      const state = path(next);
      buffer.push(next, client.extrapolates ? state : { ...state, vx: 0, vy: 0 });
      next++;
    }
    const tick = client.timeline.renderTick(nowMs);
    const pose = tick === undefined ? undefined : client.extrapolates ? buffer.draw(tick) : buffer.sample(tick);
    if (tick === undefined || pose === undefined) {
      continue;
    }
    if (last !== undefined && nowMs >= settleMs) {
      frames++;
      const step = Math.hypot(pose.x - last.x, pose.y - last.y);
      if (step < 1e-6) {
        frozen++;
      } else if (step - STEP > 2 * STEP) {
        jumps++;
      }
      const truth = path(tick);
      const errorPx = Math.hypot(pose.x - truth.x, pose.y - truth.y);
      maxErrorPx = Math.max(maxErrorPx, errorPx);
      onFrame(nowMs, errorPx);
    }
    last = pose;
  }

  return { frozen: frozen / frames, frozenFrames: frozen, jumpsPerMinute: jumps / ((frames * FRAME_MS) / MINUTE), maxErrorPx };
}

const describe = (seen: Seen): string =>
  `${(seen.frozen * 100).toFixed(2)}% frozen, ${seen.jumpsPerMinute.toFixed(1)} jumps a minute`;

/** Asserts that seen is at least factor times better than baseline on both counts. */
function better(seen: Seen, baseline: Seen, factor: number): void {
  assert.ok(seen.frozen * factor <= baseline.frozen, `${describe(seen)} against ${describe(baseline)}`);
  assert.ok(seen.jumpsPerMinute * factor <= baseline.jumpsPerMinute, `${describe(seen)} against ${describe(baseline)}`);
}

test('the client before #232 reproduces the audit', (t) => {
  const at25 = replay(before(), trace(10 * MINUTE, exponential(25)));
  const at50 = replay(before(), trace(10 * MINUTE, exponential(50)));
  t.diagnostic(`before, 25 ms jitter: ${describe(at25)}`);
  t.diagnostic(`before, 50 ms jitter: ${describe(at50)}`);
  // The audit: 2.5% and 20 a minute, 17% and 111 a minute.
  assert.ok(at25.frozen > 0.015 && at25.frozen < 0.035, describe(at25));
  assert.ok(at25.jumpsPerMinute > 12 && at25.jumpsPerMinute < 30, describe(at25));
  assert.ok(at50.frozen > 0.13 && at50.frozen < 0.21, describe(at50));
  assert.ok(at50.jumpsPerMinute > 80 && at50.jumpsPerMinute < 150, describe(at50));
});

test('a constant latency is drawn without a freeze or a jump', (t) => {
  const seen = replay(after(), trace(10 * MINUTE, () => 40));
  t.diagnostic(`after, constant 40 ms: ${describe(seen)}`);
  assert.equal(seen.frozen, 0);
  assert.equal(seen.jumpsPerMinute, 0);
});

test('under jitter the client is at least 5 times better than before', (t) => {
  for (const mean of [25, 50]) {
    const arrivals = trace(10 * MINUTE, exponential(mean));
    const baseline = replay(before(), arrivals);
    const delayOnly = replay(adaptiveDelay(), arrivals);
    const seen = replay(after(), arrivals);
    t.diagnostic(`adaptive delay alone, ${String(mean)} ms jitter: ${describe(delayOnly)}`);
    t.diagnostic(`after, ${String(mean)} ms jitter: ${describe(seen)}`);
    better(seen, baseline, 5);
  }
});

/** 40 ms for every snapshot but one, which takes latencyMs and holds up those behind it. */
const stall =
  (tick: number, latencyMs: number) =>
  (t: number): number =>
    t === tick ? latencyMs : 40;

test('a stall within the extrapolation freezes nothing, and a longer one only past it', (t) => {
  // Drawn 2 ticks behind, a snapshot may come 3 ticks (150 ms) more than the 50 ms gap late.
  const within = replay(after(), trace(MINUTE, stall(400, 240)));
  assert.equal(within.frozenFrames, 0);
  assert.equal(within.jumpsPerMinute, 0);

  const long = replay(after(), trace(MINUTE, stall(400, 400)));
  t.diagnostic(`after, a 400 ms stall: ${String(long.frozenFrames)} frames frozen, ${String(long.jumpsPerMinute)} jumps a minute`);
  assert.equal(long.jumpsPerMinute, 0);
  assert.ok(long.frozenFrames <= Math.ceil((400 - 240) / FRAME_MS), `${String(long.frozenFrames)} frames frozen`);
  assert.ok(replay(before(), trace(MINUTE, stall(400, 400))).jumpsPerMinute > 0, 'before, the stall ended in a jump');
});

test('a 90 degree turn during a stall is drawn off by at most the 150 ms flown straight, then corrected', (t) => {
  const turn = 400;
  const path: Path = (tick) =>
    tick <= turn
      ? straight(tick)
      : { x: (turn * SPEED) / TICK_RATE, y: ((tick - turn) * SPEED) / TICK_RATE, vx: 0, vy: SPEED, angle: Math.PI / 2 };
  const arrivals = trace(MINUTE, stall(turn + 1, 240));
  const lateAt = arrivals[turn + 1] ?? 0;
  const seen = replay(after(), arrivals, path, 5000, (nowMs, errorPx) => {
    if (nowMs > lateAt + 100 + FRAME_MS) {
      assert.ok(errorPx < 1e-6, `${errorPx.toFixed(1)} px off at ${nowMs.toFixed(0)} ms`);
    }
  });
  t.diagnostic(`after, a 90 degree turn during a stall: at most ${seen.maxErrorPx.toFixed(1)} px off`);
  // Flown straight instead of turning for up to 150 ms: up to 30 px each way.
  assert.ok(seen.maxErrorPx > 1, 'the turn went unseen for a while');
  assert.ok(seen.maxErrorPx <= SPEED * 0.15 * Math.SQRT2, `${seen.maxErrorPx.toFixed(1)} px off`);
});

/**
 * What the hub holds of another player at each tick: the newest of their
 * uploads in by then, as it was when sent. They send from 60 Hz frames that
 * come up to half a millisecond early or late, either paced at the tick rate
 * or, as before #232, on the first frame 50 ms after the last send; uploads
 * arrive with seeded exponential jitter, in TCP order.
 */
function uploaded(paced: boolean, meanMs: number, durationMs: number): Path {
  const sentAt: number[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (let frame = 0; frame * FRAME_MS < durationMs; frame++) {
    const nowMs = frame * FRAME_MS + (((frame * 7919) % 11) - 5) / 10;
    if (nowMs - last < TICK_MS) {
      continue;
    }
    last = paced && nowMs - (last + TICK_MS) < TICK_MS ? last + TICK_MS : nowMs;
    sentAt.push(nowMs);
  }
  const latency = exponential(meanMs, 2);
  let arrived = 0;
  const arrivals = sentAt.map((sent) => (arrived = Math.max(arrived, sent + latency(0))));
  const held: Pose[] = [];
  let newest = -1;
  for (let tick = 0; tick * TICK_MS < durationMs; tick++) {
    while ((arrivals[newest + 1] ?? Infinity) <= tick * TICK_MS) {
      newest++;
    }
    held.push(straight((sentAt[newest] ?? 0) / TICK_MS));
  }

  return (tick) => held[Math.floor(tick)] ?? straight(tick);
}

test("another player's upload with jitter is drawn without freezing", (t) => {
  const arrivals = trace(10 * MINUTE, () => 40);
  const was = replay(before(), arrivals, uploaded(false, 25, 10 * MINUTE));
  const seen = replay(after(), arrivals, uploaded(true, 25, 10 * MINUTE));
  t.diagnostic(`before, an upload with 25 ms jitter: ${describe(was)}`);
  t.diagnostic(`after, an upload with 25 ms jitter: ${describe(seen)}`);
  assert.ok(was.frozen > 0.05, describe(was));
  better(seen, was, 5);
});
