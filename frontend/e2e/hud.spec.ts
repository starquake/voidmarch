import { expect, registerPlayer, signIn, test } from './fixtures.ts';
import { state } from './hunt.ts';
import { coveredOnScreen } from './screens.ts';
import { PART_LIST_IDLE_MS } from '../src/sim/tuning.ts';

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
  // Online, nothing about the connection. The server's own notices can show, such as a derelict coming back (#210).
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

test('a tap of 1 fits the next weapon on key-down and shows the weapon list; a held key does nothing more (#259)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const drop = page.locator('#hud-gauge .hud-drop');
  const before = (await state(page)).loadout.weapon;

  // The key-down alone, with no frame after it: what shows is the key-down's doing.
  const down = await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1' }));
    const open = document.querySelector<HTMLElement>('#hud-gauge .hud-slot.open');
    const fitted = document.querySelector<HTMLElement>('#hud-gauge .hud-drop .option.fitted');

    return { open: open?.dataset.slot, fitted: fitted?.dataset.part };
  });
  expect(down.open, 'the key-down shows the weapon list').toBe('weapon');
  expect(down.fitted, 'with the next weapon fitted').not.toBe(before);
  await expect.poll(async () => (await state(page)).loadout.weapon).toBe(down.fitted);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit1', key: '1' })));

  // Playwright sends a key that is already down as a repeat.
  await page.keyboard.down('1');
  const held = (await state(page)).loadout.weapon;
  await page.keyboard.down('1');
  await page.keyboard.down('1');
  await page.keyboard.up('1');
  await expect(drop).toBeVisible();
  expect((await state(page)).loadout.weapon, 'repeats and the release fit nothing').toBe(held);
});

test('each tap fits the next part, and the list stays open and follows it (#259)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const drop = page.locator('#hud-gauge .hud-drop');
  const fitted = drop.locator('.option.fitted');

  await page.keyboard.press('3');
  await expect(drop).toBeVisible();
  const parts = await drop.locator('[data-part]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.part ?? ''));
  const at = (i: number): string => parts[i % parts.length] ?? '';
  const first = parts.indexOf((await state(page)).loadout.shield);
  await expect(fitted).toHaveAttribute('data-part', at(first));

  for (let i = 1; i <= parts.length; i++) {
    await page.keyboard.press('3');
    await expect(fitted).toHaveAttribute('data-part', at(first + i));
    await expect.poll(async () => (await state(page)).loadout.shield).toBe(at(first + i));
    await expect(page.locator('#hud-gauge .hud-slot.open'), 'the list stays').toHaveAttribute('data-slot', 'shield');
  }
});

test('the list closes 2 s after the last tap, and Esc closes it at once (#259)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const drop = page.locator('#hud-gauge .hud-drop');

  await page.keyboard.press('2');
  await expect(drop).toBeVisible();
  await page.waitForTimeout(PART_LIST_IDLE_MS * 0.75);
  const lastTap = Date.now();
  await page.keyboard.press('2');
  await expect(drop).toBeHidden({ timeout: PART_LIST_IDLE_MS + 15_000 });
  expect(Date.now() - lastTap, 'open 2 s from the last tap, not the first').toBeGreaterThanOrEqual(PART_LIST_IDLE_MS);

  const weapon = (await state(page)).loadout.weapon;
  await page.keyboard.press('1');
  await expect(drop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drop, 'Esc closes it at once').toHaveCount(0);
  const after = await state(page);
  expect(after.settingsScreen, 'Esc closed the list, not opened the settings').toBe(false);
  expect(after.loadout.weapon, 'the tap fitted a part, and Esc kept it').not.toBe(weapon);
});

test("another slot's key switches that slot and shows its list instead (#259)", async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const openSlot = page.locator('#hud-gauge .hud-slot.open');

  await page.keyboard.press('1');
  await expect(openSlot).toHaveAttribute('data-slot', 'weapon');
  const { weapon, engine } = (await state(page)).loadout;
  await page.keyboard.press('2');
  await expect(openSlot).toHaveAttribute('data-slot', 'engine');
  await expect(page.locator('#hud-gauge .hud-drop')).toHaveCount(1);
  await expect.poll(async () => (await state(page)).loadout.engine).not.toBe(engine);
  expect((await state(page)).loadout.weapon, 'the weapon stays').toBe(weapon);
});

test('a tap on a list the mouse opened switches the part, and the list then closes 2 s after it (#259)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const drop = page.locator('#hud-gauge .hud-drop');

  await page.locator('#hud-gauge [data-slot="engine"]').click();
  await expect(drop).toBeVisible();
  await page.waitForTimeout(PART_LIST_IDLE_MS + 500);
  await expect(drop, 'a list the mouse opened stays').toBeVisible();

  const engine = (await state(page)).loadout.engine;
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).loadout.engine).not.toBe(engine);
  await expect(drop).toBeHidden({ timeout: PART_LIST_IDLE_MS + 15_000 });
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

test('in a small window the HUD keeps off every screen, and a screen closes an open drop-up (#221)', async ({ page, browser, baseURL }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const panel = page.locator('#hud-panel');
  const gauge = page.locator('#hud-gauge');
  const drop = page.locator('#hud-gauge .hud-drop');
  await expect(panel).toBeVisible();

  // The development key Y opens the victory screen (#156), here over an open drop-up.
  await page.locator('#hud-gauge [data-slot="weapon"]').click();
  await expect(drop).toBeVisible();
  await page.keyboard.press('y');
  await expect.poll(async () => (await state(page)).victoryScreen).toBe(true);
  await expect(gauge).toBeHidden();
  await expect(panel).toBeHidden();
  expect(await coveredOnScreen(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).victoryScreen, { message: 'one Esc closes the screen, not the drop-up under it' }).toBe(false);
  await expect(gauge).toBeVisible();
  await expect(drop, 'the drop-up closed as the screen opened').toHaveCount(0);

  for (const [key, open] of [
    ['Escape', 'settingsScreen'],
    ['F1', 'introScreen'],
  ] as const) {
    await page.keyboard.press(key);
    await expect.poll(async () => (await state(page))[open]).toBe(true);
    await expect(gauge).toBeHidden();
    expect(await coveredOnScreen(page), open).toEqual([]);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await state(page))[open]).toBe(false);
    await expect(gauge).toBeVisible();
    await expect(panel).toBeVisible();
  }

  // A second player in a window as small meets the join screen: the first page's squadron has room.
  const context = await browser.newContext({ baseURL: baseURL ?? '', viewport: page.viewportSize() ?? { width: 640, height: 360 } });
  await signIn(context, await registerPlayer(context.request, 'Joiner'));
  const joiner = await context.newPage();
  await joiner.goto('/');
  await joiner.waitForFunction(() => window.voidmarch?.squadronScreen === true);
  await expect(joiner.locator('#squadron-list .squadron').first()).toBeVisible();
  await expect(joiner.locator('#hud-gauge')).toBeHidden();
  expect(await coveredOnScreen(joiner)).toEqual([]);
  await context.close();
});
