import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { setHidden } from './visibility.ts';

import type { DebugState } from '../src/debug.ts';

const state = (page: Page): Promise<DebugState> =>
  page.evaluate(() => {
    if (window.voidmarch === undefined) {
      throw new Error('window.voidmarch is not published');
    }

    return structuredClone(window.voidmarch);
  });

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
