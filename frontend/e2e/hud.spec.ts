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
  await expect.poll(async () => (await state(page)).hud.panel.some((row) => /^Companions: \d of 3 out$/.test(row))).toBe(true);
  await expect.poll(async () => (await state(page)).hud.panel.some((row) => row.startsWith('Squadron: '))).toBe(true);
  await expect.poll(async () => (await state(page)).hud.panel.some((row) => /^Mission: Clear sector [A-G]\d$/.test(row))).toBe(true);
  // Online, nothing about the connection. Other toasts can come from other specs on the shared server.
  const connection = ['Connecting', 'Offline, reconnecting', 'The frontier is full, try again soon', 'Playing alone'];
  expect((await state(page)).hud.toasts.filter((t) => connection.includes(t))).toEqual([]);

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

test('a click on a slot opens its drop-up, and a click on a part fits it (#191)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const weapon = page.locator('#hud-gauge [data-slot="weapon"]');
  await expect(weapon.locator('.key')).toHaveText('1');

  await weapon.click();
  const drop = page.locator('#hud-gauge .hud-drop');
  await expect(drop).toBeVisible();
  // A development server offers every part, as its 1/2/3 keys cycle every part.
  await expect(drop.locator('[data-part]')).toHaveCount(4);
  await expect(drop.locator('.option.fitted')).toHaveAttribute('data-part', (await state(page)).loadout.weapon);

  await drop.locator('[data-part="rockets"]').click();
  await expect.poll(async () => (await state(page)).loadout.weapon).toBe('rockets');
  await expect(drop).toBeHidden();

  await weapon.click();
  await expect(drop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drop).toBeHidden();
  expect((await state(page)).settingsScreen, 'Esc closed the drop-up, not opened the settings').toBe(false);

  await page.locator('#hud-gauge [data-slot="engine"]').click();
  await expect(drop).toBeVisible();
  // A click on the game, in the middle of the view.
  const view = page.viewportSize() ?? { width: 640, height: 360 };
  await page.mouse.click(view.width / 2, view.height / 3);
  await expect(drop).toBeHidden();
});

test('a newly fitted weapon waits out the swap before it fires (#191)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const view = page.viewportSize() ?? { width: 640, height: 360 };
  await page.mouse.move(view.width / 2 + 100, view.height / 2);
  await page.keyboard.press('1');
  await expect.poll(async () => (await state(page)).loadout.weapon).not.toBe('autoCannon');
  const before = (await state(page)).shotsFired;
  await page.mouse.down();
  await page.waitForTimeout(200);
  expect((await state(page)).shotsFired, 'nothing fires during the half-second swap').toBe(before);
  await expect.poll(async () => (await state(page)).shotsFired, { timeout: 5_000 }).toBeGreaterThan(before);
  await page.mouse.up();
});
