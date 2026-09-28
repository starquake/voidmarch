import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';

import type { DebugState } from '../src/debug.ts';

const state = (page: Page): Promise<DebugState> =>
  page.evaluate(() => {
    if (window.voidmarch === undefined) {
      throw new Error('window.voidmarch is not published');
    }

    return structuredClone(window.voidmarch);
  });

/**
 * Emulates switching tabs as a browser does it: the page reports hidden, says
 * so, and gets no animation frames (they wait until it shows again).
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

test('a hidden tab stays in the world, with its squadron and companion', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online' && window.voidmarch.squadron !== '');
  await page.keyboard.press('g');
  await expect.poll(async () => (await state(page)).companions.length).toBe(1);
  const before = await state(page);

  // Longer than the server's 10 s silence limit: without the background tick,
  // the paused game would send nothing and the server would drop the player.
  await setHidden(page, true);
  await page.waitForTimeout(12_000);
  const hidden = await state(page);
  await setHidden(page, false);

  expect(hidden.net.status).toBe('online');
  const after = await state(page);
  expect(after.squadron).toBe(before.squadron);
  // A drop would have sent the companion back to the hangar.
  await expect.poll(async () => (await state(page)).companions.map((c) => c.number)).toEqual([1]);
});
