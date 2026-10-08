import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Timeline, delayLine } from './timeline.ts';

const TICK_MS = 50;
const FRAME_MS = 1000 / 60;

/**
 * Plays a timeline: a snapshot every tick, arriving lateMs(tick) after it was
 * sent but never before the one ahead of it (TCP), and a frame every
 * FRAME_MS, until untilMs. Calls frame with each frame's time and render tick.
 */
function play(
  timeline: Timeline,
  untilMs: number,
  lateMs: (tick: number) => number,
  frame: (nowMs: number, renderTick: number) => void = () => undefined,
  fromMs = 0,
): void {
  let tick = Math.ceil(fromMs / TICK_MS);
  let arrived = fromMs;
  for (let nowMs = fromMs; nowMs < untilMs; nowMs += FRAME_MS) {
    for (let at = Math.max(arrived, tick * TICK_MS + lateMs(tick)); at <= nowMs; at = Math.max(arrived, tick * TICK_MS + lateMs(tick))) {
      timeline.snapshot(tick, at);
      arrived = at;
      tick++;
    }
    const renderTick = timeline.renderTick(nowMs);
    if (renderTick !== undefined) {
      frame(nowMs, renderTick);
    }
  }
}

test('the HUD line shows the delay and its target to a tenth of a tick', () => {
  assert.equal(delayLine(2, 3.333), 'delay 2.0 / 3.3 ticks');
});

test('nothing is drawn before the first snapshot', () => {
  const timeline = new Timeline(20);
  assert.equal(timeline.renderTick(0), undefined);
  assert.equal(timeline.serverTick(0), undefined);
});

test('snapshots on time hold the delay at exactly 2 ticks', () => {
  const timeline = new Timeline(20);
  play(timeline, 5000, () => 0, (nowMs, renderTick) => {
    assert.ok(Math.abs(nowMs / TICK_MS - 2 - renderTick) < 1e-9, `render tick ${String(renderTick)} at ${String(nowMs)} ms`);
  });
  assert.ok(Math.abs(timeline.delay - 2) < 1e-9);
  assert.equal(timeline.target, 2);
});

test('a growing delay is reached within 1.5 s, slowing time by at most 10%', () => {
  const timeline = new Timeline(20);
  // 10 s on time, then every fourth snapshot 3 ticks late, holding up the two behind it: the target goes to 4.
  play(timeline, 10_000, () => 0);
  let reachedAt: number | undefined;
  let movedAt: number | undefined;
  let last: { nowMs: number; renderTick: number } | undefined;
  play(
    timeline,
    20_000,
    (tick) => (tick % 4 === 0 ? 3 * TICK_MS : 0),
    (nowMs, renderTick) => {
      if (last !== undefined) {
        const step = (renderTick - last.renderTick) / ((nowMs - last.nowMs) / TICK_MS);
        assert.ok(step >= 0.9 - 1e-9 && step <= 1.05 + 1e-9, `step ${String(step)} of real time at ${String(nowMs)} ms`);
      }
      last = { nowMs, renderTick };
      if (movedAt === undefined && timeline.target >= 4 - 1e-6) {
        movedAt = nowMs;
      }
      if (reachedAt === undefined && timeline.delay >= 4 - 1e-6) {
        reachedAt = nowMs;
      }
    },
    10_000,
  );
  assert.ok(movedAt !== undefined && reachedAt !== undefined, 'the delay reached 4 ticks');
  assert.ok(reachedAt - movedAt <= 1500, `reached ${String(reachedAt - movedAt)} ms after the target moved`);
});

test('a shrinking delay speeds time up by at most 5%', () => {
  const timeline = new Timeline(20);
  play(timeline, 10_000, (tick) => (tick % 4 === 0 ? 3 * TICK_MS : 0));
  assert.ok(Math.abs(timeline.target - 4) < 1e-6, `target ${String(timeline.target)}`);
  let last: { nowMs: number; renderTick: number } | undefined;
  play(
    timeline,
    25_000,
    () => 0,
    (nowMs, renderTick) => {
      if (last !== undefined) {
        const step = (renderTick - last.renderTick) / ((nowMs - last.nowMs) / TICK_MS);
        assert.ok(step >= 1 - 1e-9 && step <= 1.05 + 1e-9, `step ${String(step)} of real time`);
      }
      last = { nowMs, renderTick };
    },
    10_000,
  );
  assert.ok(Math.abs(timeline.delay - 2) < 1e-9, `delay ${String(timeline.delay)}`);
});

test('a packet faster than all before moves the render tick by no more than 5% of a frame', () => {
  const timeline = new Timeline(20);
  // Every snapshot 1 tick slow, until tick 100 comes on time.
  const steps: number[] = [];
  let last: number | undefined;
  play(
    timeline,
    10_000,
    (tick) => (tick < 100 ? TICK_MS : 0),
    (_nowMs, renderTick) => {
      if (last !== undefined) {
        steps.push((renderTick - last) / (FRAME_MS / TICK_MS));
      }
      last = renderTick;
    },
  );
  const biggest = Math.max(...steps);
  assert.ok(biggest <= 1.05 + 1e-9, `a frame stepped ${String(biggest)} frames`);
  assert.ok(Math.abs(timeline.delay - 2) < 1e-9, 'it catches up with the clock');
});

test('a clock 3 s ahead snaps the render tick', () => {
  const timeline = new Timeline(20);
  // The first snapshots come in 3 s late; the ones queued behind them show the clock was 60 ticks behind.
  play(timeline, 5000, (tick) => (tick < 5 ? 3000 : 0));
  assert.ok(Math.abs(timeline.delay - 2) < 1e-9, `delay ${String(timeline.delay)}`);
});

test('the render tick never steps back', () => {
  const timeline = new Timeline(20);
  let last = Number.NEGATIVE_INFINITY;
  play(
    timeline,
    20_000,
    (tick) => ((tick * 7919) % 13) * 10,
    (_nowMs, renderTick) => {
      assert.ok(renderTick >= last);
      last = renderTick;
    },
  );
  assert.ok((timeline.renderTick(10_000) ?? Number.NEGATIVE_INFINITY) >= last, 'a frame from the past holds');
});
