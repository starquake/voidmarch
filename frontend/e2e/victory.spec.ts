import { expect, test } from './fixtures.ts';
import { state } from './hunt.ts';

// The development key Y asks for the season's result as if it were won now
// (#156), sent to this page alone and winning nothing.
test('the victory screen shows the season result, and O and Esc close and reopen it', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const screen = page.locator('#victory-form');
  await expect(screen).toBeHidden();

  // O does nothing before the season is won.
  await page.keyboard.press('o');
  await expect.poll(async () => (await state(page)).victoryScreen).toBe(false);

  await page.keyboard.press('y');
  await expect.poll(async () => (await state(page)).victoryScreen, { message: 'the screen opens' }).toBe(true);
  await expect(screen.locator('h2')).toContainText('SEASON WON');
  await expect(page.locator('#victory-took')).toHaveText(/^in (\d+ h )?\d+ min$/);
  await expect(page.locator('#victory-totals td').first()).toHaveText('Everyone');
  await expect.poll(async () => (await state(page)).audio.musicPlace, { message: 'Ending plays (#187)' }).toBe('ending');

  await page.keyboard.press('o');
  await expect.poll(async () => (await state(page)).victoryScreen).toBe(false);
  await page.keyboard.press('o');
  await expect.poll(async () => (await state(page)).victoryScreen, { message: 'O reopens it' }).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).victoryScreen).toBe(false);
  await expect.poll(async () => (await state(page)).audio.musicPlace, { message: 'the home track comes back' }).toBe('home');
});
