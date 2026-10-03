import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FrameTimes, GpuTimer, type TimerGl } from './frametimes.ts';

test('frame times keep the last second: its average and its worst frame', () => {
  const frames = new FrameTimes();
  assert.deepEqual([frames.average, frames.worst], [0, 0]);
  frames.add(8, 0);
  frames.add(30, 500);
  frames.add(10, 900);
  assert.equal(frames.worst, 30);
  assert.equal(frames.average, 16);
  frames.add(12, 1600);
  assert.equal(frames.worst, 12, 'the 30 ms frame is more than a second old');
  assert.equal(frames.average, 11);
});

test('equal frames average to no more than the worst of them', () => {
  const frames = new FrameTimes();
  // CI's steady headless frames: 30 of them sum to a hair more than 30 times one.
  const frame = 16.666666666666664;
  for (let i = 0; i < 30; i++) {
    frames.add(frame, i * frame);
  }
  assert.ok(frames.average <= frames.worst, `average ${String(frames.average)} above worst ${String(frames.worst)}`);
});

/** A fake GL whose timer query results arrive when told. */
function fakeGl(offered: boolean): { gl: TimerGl; finish: (ns: number) => void; disjoint: (on: boolean) => void } {
  const ready = new Map<object, number>();
  let isDisjoint = false;
  let last: object | undefined;
  const ext = {
    TIME_ELAPSED_EXT: 1,
    GPU_DISJOINT_EXT: 2,
    QUERY_RESULT_EXT: 3,
    QUERY_RESULT_AVAILABLE_EXT: 4,
    createQueryEXT: () => ({}),
    deleteQueryEXT: () => undefined,
    beginQueryEXT: (_: number, query: object) => {
      last = query;
    },
    endQueryEXT: () => undefined,
    getQueryObjectEXT: (query: object, pname: number) => (pname === 4 ? ready.has(query) : (ready.get(query) ?? 0)),
  };
  const gl: TimerGl = {
    getExtension: (name) => (offered && name === 'EXT_disjoint_timer_query' ? ext : null),
    getParameter: (pname) => pname === 2 && isDisjoint,
  };

  return {
    gl,
    finish: (ns) => {
      if (last !== undefined) {
        ready.set(last, ns);
      }
    },
    disjoint: (on) => {
      isDisjoint = on;
    },
  };
}

test('the GPU timer reads each frame once its result is in, and skips disjoint ones', () => {
  const { gl, finish, disjoint } = fakeGl(true);
  const timer = new GpuTimer(gl);
  assert.equal(timer.available, true);
  timer.begin();
  timer.end();
  assert.equal(timer.last, undefined, 'no result yet');
  finish(4_500_000);
  timer.begin();
  timer.end();
  assert.equal(timer.last, 4.5);
  finish(9_000_000);
  disjoint(true);
  timer.begin();
  timer.end();
  assert.equal(timer.last, 4.5, 'a disjoint frame is dropped');
});

test('without the extension the GPU timer measures nothing', () => {
  const timer = new GpuTimer(fakeGl(false).gl);
  assert.equal(timer.available, false);
  timer.begin();
  timer.end();
  assert.equal(timer.last, undefined);
});
