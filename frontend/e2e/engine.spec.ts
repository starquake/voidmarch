import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { state } from './hunt.ts';

/**
 * Counts the audio sources that end over ms, and the frames drawn meanwhile.
 * Every rate change restarts a loop's source, which ends the old one (#263).
 */
const endedPerFrame = (page: Page, ms: number): Promise<{ ended: number; frames: number }> =>
  page.evaluate(async (duration) => {
    const counts = { ended: 0, frames: 0 };
    const proto = BaseAudioContext.prototype;
    const create = Reflect.get<BaseAudioContext, 'createBufferSource'>(proto, 'createBufferSource');
    proto.createBufferSource = function (this: BaseAudioContext): AudioBufferSourceNode {
      const source = create.call(this);
      source.addEventListener('ended', () => {
        counts.ended++;
      });

      return source;
    };
    const end = performance.now() + duration;
    while (performance.now() < end) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      counts.frames++;
    }
    proto.createBufferSource = create;

    return counts;
  }, ms);

test('the engine loop is not restarted every frame (#263)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  // Browsers keep audio locked until the first input.
  const box = await page.locator('#game canvas').boundingBox();
  await page.mouse.click((box?.x ?? 0) + 100, (box?.y ?? 0) + 100);
  await expect.poll(async () => (await state(page)).audio.backend).toBe('webaudio');

  const idle = await endedPerFrame(page, 2000);
  await page.keyboard.down('w');
  // Speeding up, the pitch rises a step at a time: logged, not asserted.
  const speedingUp = await endedPerFrame(page, 1200);
  const cruising = await endedPerFrame(page, 1000);
  await page.keyboard.up('w');
  const counts = { idle, speedingUp, cruising };
  console.log(`${test.info().project.name} ended per frame: ${JSON.stringify(counts)}`);

  expect(idle.frames).toBeGreaterThan(0);
  expect(cruising.frames).toBeGreaterThan(0);
  expect(idle.ended / idle.frames, 'sources ended per frame, idle').toBeLessThan(0.1);
  expect(cruising.ended / cruising.frames, 'sources ended per frame, at top speed').toBeLessThan(0.1);
});
