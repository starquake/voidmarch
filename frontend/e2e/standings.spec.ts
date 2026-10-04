import { expect, test } from './fixtures.ts';
import { state } from './hunt.ts';

test('holding Tab shows the season so far, and letting go hides it (#167)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  // A few shots, so this season has stats to show even on a fresh server.
  const view = page.viewportSize() ?? { width: 640, height: 360 };
  await page.mouse.move(view.width / 2 + 100, view.height / 2);
  await page.mouse.down();
  await expect.poll(async () => (await state(page)).shotsFired).toBeGreaterThanOrEqual(3);
  await page.mouse.up();
  expect((await state(page)).standings.down, 'hidden before Tab').toBe(0);

  await page.keyboard.down('Tab');
  await expect
    .poll(async () => (await state(page)).standings.down, { message: 'the season so far while Tab is held', timeout: 30_000 })
    .toBeGreaterThan(0);
  expect((await state(page)).mapOpen, 'Tab no longer opens the map').toBe(false);
  await page.keyboard.up('Tab');
  await expect.poll(async () => (await state(page)).standings.down, { message: 'gone once Tab is let go' }).toBe(0);
});
