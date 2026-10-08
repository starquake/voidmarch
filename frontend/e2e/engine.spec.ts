import type { Page } from '@playwright/test';

import { ENGINE_STATS, TICK_SECONDS } from '../src/sim/rules.gen.ts';

import { expect, test } from './fixtures.ts';
import { state } from './hunt.ts';

/** The audio sources stopped, per sound (its buffer, numbered), and the frames drawn meanwhile. */
interface Stopped {
  bySound: Record<number, number>;
  frames: number;
}

interface SourceCounts {
  ids: Map<AudioBuffer, number>;
  stopped: Record<number, number>;
}

/**
 * Numbers every sound's buffer and counts the sources of each that are
 * stopped. Every rate change restarts a loop: Phaser stops the source it
 * queued for the loop's next pass and queues another (#263). A loop playing
 * on into its next pass isn't counted, since nothing stops its source: at a
 * low frame rate, that alone could look like a restart. Other sounds, such as
 * a raid's warning, have buffers of their own.
 */
const countSources = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const counts: SourceCounts = { ids: new Map(), stopped: {} };
    (window as unknown as { sourceCounts: SourceCounts }).sourceCounts = counts;
    const proto = BaseAudioContext.prototype;
    const create = Reflect.get<BaseAudioContext, 'createBufferSource'>(proto, 'createBufferSource');
    proto.createBufferSource = function (this: BaseAudioContext): AudioBufferSourceNode {
      const source = create.call(this);
      const stop = source.stop.bind(source);
      source.stop = (when?: number): void => {
        if (source.buffer !== null) {
          const id = counts.ids.get(source.buffer) ?? counts.ids.size;
          counts.ids.set(source.buffer, id);
          counts.stopped[id] = (counts.stopped[id] ?? 0) + 1;
        }
        stop(when);
      };

      return source;
    };
  });

/** The sources stopped, per sound, while wait runs; wait gives the frames drawn meanwhile. */
async function stoppedWhile(page: Page, wait: () => Promise<number>): Promise<Stopped> {
  const read = (): Promise<Record<number, number>> =>
    page.evaluate(() => ({ ...(window as unknown as { sourceCounts: SourceCounts }).sourceCounts.stopped }));
  const before = await read();
  const frames = await wait();
  const after = await read();
  const bySound: Record<number, number> = {};
  for (const [id, n] of Object.entries(after)) {
    bySound[Number(id)] = n - (before[Number(id)] ?? 0);
  }

  return { bySound, frames };
}

/** The frames drawn over ms. */
const framesOver = (page: Page, ms: number): Promise<number> =>
  page.evaluate(async (duration) => {
    let frames = 0;
    const end = performance.now() + duration;
    while (performance.now() < end) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      frames++;
    }

    return frames;
  }, ms);

/** The frames in a row that move the ship at top speed before it counts as there. */
const STEADY_FRAMES = 10;
/** How long the ship may take to reach top speed, however slowly the browser draws. */
const TOP_SPEED_TIMEOUT_MS = 20_000;

/**
 * The frames drawn until the ship flies at top speed, measured from its
 * position between frames. The sim moves it a tick at a time, and a frame
 * runs any whole number of ticks, so at top speed every frame moves it a
 * whole number of steps. A fixed wait isn't enough: for 120 frames after the
 * page gains focus, Phaser steps the game 1/60 s a frame, so at CI's 17 fps
 * the game runs at under a third of real time (#293).
 */
const framesToTopSpeed = (page: Page, step: number): Promise<number> =>
  page.evaluate(
    async ({ step, steadyFrames, timeout }) => {
      const position = (): { x: number; y: number } => ({ x: window.voidmarch?.ship.x ?? 0, y: window.voidmarch?.ship.y ?? 0 });
      let last = position();
      let frames = 0;
      let steady = 0;
      const end = performance.now() + timeout;
      while (steady < steadyFrames) {
        if (performance.now() > end) {
          throw new Error(`the ship didn't reach top speed in ${String(timeout)} ms`);
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
        frames++;
        const now = position();
        const steps = Math.hypot(now.x - last.x, now.y - last.y) / step;
        last = now;
        // Above 60 fps, some frames run no tick at all.
        if (steps === 0) {
          continue;
        }
        const ticks = Math.round(steps);
        steady = ticks > 0 && Math.abs(steps - ticks) < 0.005 ? steady + 1 : 0;
      }

      return frames;
    },
    { step, steadyFrames: STEADY_FRAMES, timeout: TOP_SPEED_TIMEOUT_MS },
  );

// Screen-relative W thrusts straight up, wherever the mouse is, so the ship holds its top speed.
test.use({ controls: 'game' });

test('the engine loop is not restarted every frame (#263)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  // Browsers keep audio locked until the first input.
  const box = await page.locator('#game canvas').boundingBox();
  await page.mouse.click((box?.x ?? 0) + 100, (box?.y ?? 0) + 100);
  await expect.poll(async () => (await state(page)).audio.backend).toBe('webaudio');
  await countSources(page);
  const { loadout } = await state(page);
  const step = ENGINE_STATS[loadout.engine].maxSpeed * TICK_SECONDS;

  const idle = await stoppedWhile(page, () => framesOver(page, 2000));
  await page.keyboard.down('w');
  const speedingUp = await stoppedWhile(page, () => framesToTopSpeed(page, step));
  const cruising = await stoppedWhile(page, () => framesOver(page, 1000));
  await page.keyboard.up('w');
  // Speeding up, the pitch rises a step at a time, so the engine is the sound whose sources stop most.
  const engine = Object.entries(speedingUp.bySound).reduce((best, [id, n]) => (n > best.n ? { id: Number(id), n } : best), { id: -1, n: 0 });
  const perFrame = (s: Stopped): string => `${String(s.bySound[engine.id] ?? 0)} / ${String(s.frames)}`;
  console.log(
    `${test.info().project.name} engine sources stopped per frame: idle ${perFrame(idle)}, speeding up ${perFrame(speedingUp)}, at top speed ${perFrame(cruising)}`,
  );

  expect(engine.n, 'the engine loop restarts while speeding up').toBeGreaterThan(0);
  expect(idle.frames).toBeGreaterThan(0);
  expect(cruising.frames).toBeGreaterThan(0);
  expect((idle.bySound[engine.id] ?? 0) / idle.frames, 'engine sources stopped per frame, idle').toBeLessThan(0.1);
  expect((cruising.bySound[engine.id] ?? 0) / cruising.frames, 'engine sources stopped per frame, at top speed').toBeLessThan(0.1);
});
