import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { state } from './hunt.ts';

/** How long each frame is kept busy, so the game draws well below 60 fps on any machine, as on a slow computer. */
const BUSY_FRAME_MS = 30;
/** How long each measurement runs. */
const MEASURE_MS = 1000;
/** How near real time the game must run: a frame's game time over its real time. */
const MIN_GAME_SPEED = 0.8;

/** A sound source started, and whether the audio was running then. */
interface Started {
  at: number;
  running: boolean;
}

/**
 * Records every sound that starts at once: a loop's next pass, queued ahead,
 * isn't counted. A sound started while the audio is suspended waits, and
 * plays the moment the audio resumes.
 */
const recordStarts = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const started: Started[] = [];
    (window as unknown as { started: Started[] }).started = started;
    const proto = BaseAudioContext.prototype;
    const create = Reflect.get<BaseAudioContext, 'createBufferSource'>(proto, 'createBufferSource');
    proto.createBufferSource = function (this: BaseAudioContext): AudioBufferSourceNode {
      const source = create.call(this);
      const start = source.start.bind(source);
      source.start = (when?: number, offset?: number, duration?: number): void => {
        if ((when ?? 0) <= this.currentTime) {
          started.push({ at: performance.now(), running: this.state === 'running' });
        }
        start(when, offset, duration);
      };

      return source;
    };
  });

/** The sounds started since the page's clock read from ms. */
const startsSince = (page: Page, from: number): Promise<Started[]> =>
  page.evaluate((since) => (window as unknown as { started: Started[] }).started.filter((s) => s.at >= since), from);

/** Keeps every frame busy for ms, as a slow computer would be. */
const slowDown = (page: Page, ms: number): Promise<void> =>
  page.evaluate((busy) => {
    const spin = (): void => {
      const end = performance.now() + busy;
      while (performance.now() < end) {
        // Busy, like a frame that takes long to draw.
      }
      requestAnimationFrame(spin);
    };
    requestAnimationFrame(spin);
  }, ms);

/**
 * How fast the game runs over the next ms, measured from the frames: the
 * game time Phaser gives a frame over the real time between frames. 1 is
 * real time.
 */
const gameSpeed = (page: Page, ms: number): Promise<number> =>
  page.evaluate(async (duration) => {
    const stamps: number[] = [];
    const end = performance.now() + duration;
    while (performance.now() < end) {
      stamps.push(await new Promise<number>((resolve) => requestAnimationFrame(resolve)));
    }
    const first = stamps[0] ?? 0;
    const last = stamps.at(-1) ?? 0;
    const real = (last - first) / Math.max(1, stamps.length - 1);

    return (window.voidmarch?.frameMs.average ?? 0) / real;
  }, ms);

/** The page's clock. */
const now = (page: Page): Promise<number> => page.evaluate(() => performance.now());

/** The window losing or getting back focus, as when the player clicks another window and back. */
const setFocus = (page: Page, focus: boolean): Promise<void> =>
  page.evaluate((f) => {
    window.dispatchEvent(new Event(f ? 'focus' : 'blur'));
  }, focus);

/**
 * Emulates switching tabs as a browser does it: the page reports hidden, says
 * so, and gets no animation frames (they wait until it shows again), as in
 * hidden.spec.ts.
 */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    const w = window as unknown as { realFrame?: typeof requestAnimationFrame; waiting?: FrameRequestCallback[] };
    if (h) {
      w.realFrame = window.requestAnimationFrame.bind(window);
      w.waiting = [];
      window.requestAnimationFrame = (callback) => {
        w.waiting?.push(callback);

        return 0;
      };
    } else if (w.realFrame !== undefined) {
      window.requestAnimationFrame = w.realFrame;
      for (const callback of w.waiting ?? []) {
        w.realFrame(callback);
      }
    }
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** Starts the game with its audio unlocked, and gives the point the mouse clicked. */
async function startGame(page: Page): Promise<{ x: number; y: number }> {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  // Browsers keep audio locked until the first input.
  const box = await page.locator('#game canvas').boundingBox();
  const at = { x: (box?.x ?? 0) + 100, y: (box?.y ?? 0) + 100 };
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await state(page)).audio.backend).toBe('webaudio');
  await expect.poll(async () => (await state(page)).audio.locked).toBe(false);

  return at;
}

// The mouse aims and fires wherever it is.
test.use({ controls: 'game' });

test('a window plays in real time without focus and once it gets focus back (#322)', async ({ page }) => {
  test.fail(true, 'Phaser caps a frame at 1/60 s without focus, and for 120 frames after the game starts or gets focus back (#322)');
  await startGame(page);
  await slowDown(page, BUSY_FRAME_MS);
  const focused = await gameSpeed(page, MEASURE_MS);
  await setFocus(page, false);
  const blurred = await gameSpeed(page, MEASURE_MS);
  await setFocus(page, true);
  const returned = await gameSpeed(page, MEASURE_MS);

  console.log(
    `${test.info().project.name} game speed: focused ${focused.toFixed(2)}, without focus ${blurred.toFixed(2)}, focus back ${returned.toFixed(2)}`,
  );
  expect(focused, 'game speed with focus').toBeGreaterThan(MIN_GAME_SPEED);
  expect(blurred, 'game speed without focus').toBeGreaterThan(MIN_GAME_SPEED);
  expect(returned, 'game speed once focus is back').toBeGreaterThan(MIN_GAME_SPEED);
});

test('a tab shown again plays in real time (#322)', async ({ page }) => {
  test.fail(true, 'Phaser caps a frame at 1/60 s for 120 frames after the tab shows again (#322)');
  await startGame(page);
  await slowDown(page, BUSY_FRAME_MS);
  await setFocus(page, false);
  await setHidden(page, true);
  await page.waitForTimeout(2 * MEASURE_MS);
  await setHidden(page, false);
  await setFocus(page, true);
  const shown = await gameSpeed(page, MEASURE_MS);

  console.log(`${test.info().project.name} game speed once shown: ${shown.toFixed(2)}`);
  expect(shown, 'game speed once the tab shows again').toBeGreaterThan(MIN_GAME_SPEED);
});

test('sounds are dropped while the window has no focus, not played in a burst when it gets focus back (#322)', async ({ page }) => {
  test.fail(true, 'a sound started while the audio is suspended waits, and plays when it resumes (#322)');
  const at = await startGame(page);
  await recordStarts(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(MEASURE_MS);
  const firing = await startsSince(page, 0);
  const shotsBefore = (await state(page)).shotsFired;
  await setFocus(page, false);
  await page.waitForTimeout(MEASURE_MS);
  const shotsPaused = (await state(page)).shotsFired - shotsBefore;
  await setFocus(page, true);
  const back = await now(page);
  await page.waitForTimeout(MEASURE_MS);
  const paused = (await startsSince(page, 0)).filter((s) => s.at < back && !s.running);
  const after = (await startsSince(page, back)).filter((s) => s.at < back + MEASURE_MS);
  await page.mouse.up();

  console.log(
    `${test.info().project.name} sounds started: ${String(firing.length)} in a second of firing, ` +
      `${String(paused.length)} while paused (${String(shotsPaused)} shots), ${String(after.length)} in the second after focus`,
  );
  expect(firing.length, 'holding fire plays shot sounds').toBeGreaterThan(0);
  expect(shotsPaused, 'the ship fires on without focus').toBeGreaterThan(0);
  expect(paused.length, 'sounds started while the audio was paused, which all play when it resumes').toBe(0);
  expect(after.length, 'shot sounds play again once focus is back').toBeGreaterThan(0);
});
