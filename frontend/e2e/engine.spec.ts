import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { state } from './hunt.ts';

/** The audio sources that ended, per sound (its buffer, numbered), and the frames drawn meanwhile. */
interface Ended {
  bySound: Record<number, number>;
  frames: number;
}

interface SourceCounts {
  ids: Map<AudioBuffer, number>;
  ended: Record<number, number>;
}

/**
 * Numbers every sound's buffer and counts the sources of each that end. Every
 * rate change restarts a loop's source, which ends the old one (#263); other
 * sounds, such as a raid's warning, have buffers of their own.
 */
const countSources = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const counts: SourceCounts = { ids: new Map(), ended: {} };
    (window as unknown as { sourceCounts: SourceCounts }).sourceCounts = counts;
    const proto = BaseAudioContext.prototype;
    const create = Reflect.get<BaseAudioContext, 'createBufferSource'>(proto, 'createBufferSource');
    proto.createBufferSource = function (this: BaseAudioContext): AudioBufferSourceNode {
      const source = create.call(this);
      source.addEventListener('ended', () => {
        if (source.buffer === null) {
          return;
        }
        const id = counts.ids.get(source.buffer) ?? counts.ids.size;
        counts.ids.set(source.buffer, id);
        counts.ended[id] = (counts.ended[id] ?? 0) + 1;
      });

      return source;
    };
  });

/** The sources that end over ms, per sound. */
const endedOver = (page: Page, ms: number): Promise<Ended> =>
  page.evaluate(async (duration) => {
    const counts = (window as unknown as { sourceCounts: SourceCounts }).sourceCounts;
    const before = { ...counts.ended };
    let frames = 0;
    const end = performance.now() + duration;
    while (performance.now() < end) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      frames++;
    }
    const bySound: Record<number, number> = {};
    for (const [id, n] of Object.entries(counts.ended)) {
      bySound[Number(id)] = n - (before[Number(id)] ?? 0);
    }

    return { bySound, frames };
  }, ms);

test('the engine loop is not restarted every frame (#263)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  // Browsers keep audio locked until the first input.
  const box = await page.locator('#game canvas').boundingBox();
  await page.mouse.click((box?.x ?? 0) + 100, (box?.y ?? 0) + 100);
  await expect.poll(async () => (await state(page)).audio.backend).toBe('webaudio');
  await countSources(page);

  const idle = await endedOver(page, 2000);
  await page.keyboard.down('w');
  const speedingUp = await endedOver(page, 2000);
  const cruising = await endedOver(page, 1000);
  await page.keyboard.up('w');
  // Speeding up, the pitch rises a step at a time, so the engine is the sound whose sources end most.
  const engine = Object.entries(speedingUp.bySound).reduce((best, [id, n]) => (n > best.n ? { id: Number(id), n } : best), { id: -1, n: 0 });
  const perFrame = (e: Ended): string => `${String(e.bySound[engine.id] ?? 0)} / ${String(e.frames)}`;
  console.log(
    `${test.info().project.name} engine sources ended per frame: idle ${perFrame(idle)}, speeding up ${perFrame(speedingUp)}, at top speed ${perFrame(cruising)}`,
  );

  expect(engine.n, 'the engine loop restarts while speeding up').toBeGreaterThan(0);
  expect(idle.frames).toBeGreaterThan(0);
  expect(cruising.frames).toBeGreaterThan(0);
  expect((idle.bySound[engine.id] ?? 0) / idle.frames, 'engine sources ended per frame, idle').toBeLessThan(0.1);
  expect((cruising.bySound[engine.id] ?? 0) / cruising.frames, 'engine sources ended per frame, at top speed').toBeLessThan(0.1);
});
