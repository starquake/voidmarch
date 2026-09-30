import { expect, test } from './fixtures.ts';
import { collectAPart, flyHome, flyOut, state } from './hunt.ts';

test('the loadout screen fits a collected part at home, and it is still fitted after a reload', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const before = await state(page);
  await collectAPart(page, Object.keys(before.unlocks).length);
  const part = Object.keys((await state(page)).unlocks).find((p) => !(p in before.unlocks));
  if (part === undefined) {
    throw new Error('no new part collected');
  }

  await flyHome(page);
  await page.keyboard.press('l');
  await expect.poll(async () => (await state(page)).loadoutScreen).toBe(true);
  // The hunt fitted rockets with the development key 1, and only a loadout of
  // owned parts is saved: fit the auto cannon back, then the new part.
  await page.locator('#loadout-slots [data-part="autoCannon"]').click();
  await page.locator(`#loadout-slots [data-part="${part}"]`).click();
  const fitted = (s: Awaited<ReturnType<typeof state>>): boolean => Object.values(s.loadout).includes(part);
  await expect.poll(async () => fitted(await state(page)), { message: `${part} is fitted` }).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).loadoutScreen).toBe(false);

  // The server saved it: a reload fits it again.
  await page.reload();
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await expect.poll(async () => fitted(await state(page)), { message: `${part} is fitted after a reload` }).toBe(true);
});

test('the loadout screen opens only at home', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await flyOut(page);
  await page.keyboard.press('l');
  // A frame for the key to land, then it must still be shut.
  await page.waitForTimeout(200);
  expect((await state(page)).loadoutScreen).toBe(false);
});
