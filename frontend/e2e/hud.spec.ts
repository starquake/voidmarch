import { expect, test } from './fixtures.ts';
import { state } from './hunt.ts';

test('the HUD shows the fitted parts, the hull and shield, and a labelled panel (#91)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  await expect(page.locator('#hud-gauge .hud-slot')).toHaveCount(3);
  const s = await state(page);
  const names = await page.locator('#hud-gauge .hud-slot').evaluateAll((els) => els.map((el) => el.getAttribute('title')));
  expect(names).toHaveLength(3);
  expect(names.every((n) => typeof n === 'string' && n.length > 0)).toBe(true);
  // A whole ship: every hull pip lit.
  expect(s.damage).toBe('fullHealth');
  const hullPips = page.locator('#hud-gauge .hud-pips.hull .pip');
  await expect(hullPips).toHaveCount(3);
  await expect(page.locator('#hud-gauge .hud-pips.hull .pip.on')).toHaveCount(3);

  await expect.poll(async () => (await state(page)).hud.panel).toContain("You're in: D4, the home sector");
  await expect.poll(async () => (await state(page)).hud.panel.some((row) => row.startsWith('Squadron: '))).toBe(true);
  await expect.poll(async () => (await state(page)).hud.panel.some((row) => /^Mission: Clear sector [A-G]\d$/.test(row))).toBe(true);
  // Online, nothing about the connection.
  expect((await state(page)).hud.toasts).toEqual([]);

  // The full map hides the HUD under it.
  await page.keyboard.press('m');
  await expect(page.locator('#hud')).toBeHidden();
  await page.keyboard.press('m');
  await expect(page.locator('#hud')).toBeVisible();
});

test('without the server, the connection and a notice show as toasts, and the notice fades (#91)', async ({ page }) => {
  await page.routeWebSocket('**/ws', (ws) => {
    void ws.close();
  });
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  await expect.poll(async () => (await state(page)).hud.toasts.length).toBeGreaterThan(0);

  await page.keyboard.press('g');
  await expect.poll(async () => (await state(page)).hud.toasts).toContain('companions need the server');
  await expect(page.locator('#hud-toasts .hud-toast', { hasText: 'companions need the server' })).toBeVisible();
  await expect.poll(async () => (await state(page)).hud.toasts, { timeout: 15_000 }).not.toContain('companions need the server');
});
