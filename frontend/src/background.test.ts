import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BACKGROUND_INTERVAL_MS, BackgroundTicker, type Page, type Timer } from './background.ts';

/** A page whose visibility the test sets, and a timer it fires by hand. */
function setup(): {
  page: Page & { show(state: DocumentVisibilityState): void };
  fire: () => void;
  timer: Timer & { interval: number | undefined };
  clock: { ms: number };
  deltas: number[];
  ticker: BackgroundTicker;
} {
  const listeners = new Set<() => void>();
  let state: DocumentVisibilityState = 'visible';
  const page = {
    get visibilityState() {
      return state;
    },
    addEventListener: (_: 'visibilitychange', l: () => void) => listeners.add(l),
    removeEventListener: (_: 'visibilitychange', l: () => void) => listeners.delete(l),
    show(next: DocumentVisibilityState) {
      state = next;
      for (const l of listeners) {
        l();
      }
    },
  };
  let tick: (() => void) | undefined;
  const timer = {
    interval: undefined as number | undefined,
    start(intervalMs: number, t: () => void) {
      this.interval = intervalMs;
      tick = t;
    },
    stop() {
      this.interval = undefined;
      tick = undefined;
    },
  };
  const clock = { ms: 1000 };
  const deltas: number[] = [];
  const ticker = new BackgroundTicker((d) => deltas.push(d), page, timer, () => clock.ms);

  return { page, fire: () => tick?.(), timer, clock, deltas, ticker };
}

test('a visible page gets no background ticks', () => {
  const { ticker, timer } = setup();
  ticker.start();
  assert.equal(ticker.ticking, false);
  assert.equal(timer.interval, undefined);
});

test('a hidden page ticks at the server rate, with the time since the last tick', () => {
  const { ticker, page, timer, fire, clock, deltas } = setup();
  ticker.start();
  page.show('hidden');
  assert.equal(ticker.ticking, true);
  assert.equal(timer.interval, BACKGROUND_INTERVAL_MS);
  clock.ms += 50;
  fire();
  clock.ms += 1000; // a throttled tick comes late; the game catches up as far as it can
  fire();
  assert.deepEqual(deltas, [50, 1000]);
});

test('showing the page again stops the ticks, and hiding it again restarts them', () => {
  const { ticker, page, timer } = setup();
  ticker.start();
  page.show('hidden');
  page.show('hidden');
  page.show('visible');
  assert.equal(ticker.ticking, false);
  assert.equal(timer.interval, undefined);
  page.show('hidden');
  assert.equal(ticker.ticking, true);
});

test('a page already hidden when the ticker starts ticks at once, and stop ends it all', () => {
  const { ticker, page, timer } = setup();
  page.show('hidden');
  ticker.start();
  assert.equal(ticker.ticking, true);
  ticker.stop();
  assert.equal(timer.interval, undefined);
  page.show('visible');
  page.show('hidden');
  assert.equal(ticker.ticking, false, 'no longer watching');
});
