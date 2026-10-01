import type { Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';
import { TRIES, aimAt, fitRockets, hunt, state } from './hunt.ts';

/** Flies sideways from home into the sector beside it, east or west, past its edge at 800. */
async function flyInto(page: Page, east: boolean): Promise<void> {
  const side = east ? 1 : -1;
  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      const s = await state(page);
      await aimAt(page, s, s.ship.x + side * 150, s.ship.y);

      return side * s.ship.x;
    })
    .toBeGreaterThan(900);
  await page.keyboard.up('w');
}

// The e2e map gives E4 and C4 a garrison of 2, one sector per browser: a
// cleared sector stays cleared on the shared server.
test('destroying a sector\'s garrison clears it', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const east = testInfo.project.name !== 'firefox';
  const sector = east ? 'E4' : 'C4';
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  expect((await state(page)).sector).toBe('Sector D4 · home');
  await fitRockets(page);
  await flyInto(page, east);
  expect((await state(page)).sector).toBe(`Sector ${sector} · hostile`);

  const cleared = `Sector ${sector} · cleared`;
  for (let tries = 1; (await state(page)).sector !== cleared; tries++) {
    if ((await hunt(page)) === 'down') {
      expect(tries, 'went down five times before clearing the sector').toBeLessThan(TRIES);
      await expect.poll(async () => (await state(page)).canRespawn, { timeout: 10_000 }).toBe(true);
      await page.keyboard.press('h');
      await expect.poll(async () => (await state(page)).downed).toBe(false);
      await flyInto(page, east);
    }
  }
  expect((await state(page)).sector).toBe(cleared);
});
