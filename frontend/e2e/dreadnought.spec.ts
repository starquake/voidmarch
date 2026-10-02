import type { Page } from '@playwright/test';

import type { DebugState } from '../src/debug.ts';
import { expect, test } from './fixtures.ts';

const state = (page: Page): Promise<DebugState> =>
  page.evaluate(() => {
    if (window.voidmarch === undefined) {
      throw new Error('window.voidmarch is not published');
    }

    return structuredClone(window.voidmarch);
  });

// The e2e map wakes the Dreadnought at once (#124), in a ring-2 sector that opens for it.
test('the Dreadnought is awake in a ring-2 sector, open on its own', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await expect
    .poll(async () => (await state(page)).enemies.some((e) => e.kind === 'dreadnought'), { message: 'the Dreadnought is in the world' })
    .toBe(true);
  const s = await state(page);
  expect(s.openRings).toBe(1);
  expect(s.openedSectors).toHaveLength(1);
});
