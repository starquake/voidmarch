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
  await expect(drop.locator('.option.highlight'), "the keys' highlight waits for a key").toHaveCount(0);

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

test('a tap of 1 cycles the weapon on release, and a hold opens its drop-up without cycling (#259)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const weapon = page.locator('#hud-gauge [data-slot="weapon"]');
  const drop = page.locator('#hud-gauge .hud-drop');
  const before = await weapon.getAttribute('title');

  // Both events in one evaluate, so no frame passes for a hold; the slot redraws as a part is fitted.
  const titles = await page.evaluate(() => {
    const title = (): string | null => document.querySelector('#hud-gauge [data-slot="weapon"]')?.getAttribute('title') ?? null;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1' }));
    const down = title();
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit1', key: '1' }));

    return { down, up: title() };
  });
  expect(titles.down, 'nothing changes on key-down').toBe(before);
  expect(titles.up, 'the release cycles').not.toBe(before);
  await expect(drop).toHaveCount(0);

  const cycled = (await state(page)).loadout.weapon;
  await page.keyboard.down('1');
  await expect(drop).toBeVisible();
  await expect(drop.locator('.option.fitted')).toHaveAttribute('data-part', cycled);
  await page.keyboard.up('1');
  await expect(drop).toBeVisible();
  expect((await state(page)).loadout.weapon, 'a hold does not cycle').toBe(cycled);
});

test("while a held key's list is open, its taps fit the next part, the arrows and Enter pick, and Esc closes it (#259)", async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const drop = page.locator('#hud-gauge .hud-drop');
  const fitted = drop.locator('.option.fitted');
  const highlight = drop.locator('.option.highlight');

  await page.keyboard.down('1');
  await expect(drop).toBeVisible();
  await page.keyboard.up('1');
  const parts = await drop.locator('[data-part]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.part ?? ''));
  const at = (i: number): string => parts[((i % parts.length) + parts.length) % parts.length] ?? '';
  const first = parts.indexOf((await state(page)).loadout.weapon);
  await expect(highlight, 'the highlight starts on the fitted part').toHaveAttribute('data-part', at(first));

  await page.keyboard.press('1');
  await expect(fitted, 'a tap fits the next part at once').toHaveAttribute('data-part', at(first + 1));
  await expect(highlight, 'and the highlight follows it').toHaveAttribute('data-part', at(first + 1));
  await page.keyboard.press('1');
  await expect(fitted).toHaveAttribute('data-part', at(first + 2));
  await expect(drop, 'the list stays').toBeVisible();

  await page.keyboard.press('ArrowDown');
  await expect(highlight).toHaveAttribute('data-part', at(first + 3));
  await expect(fitted, 'an arrow only moves the highlight').toHaveAttribute('data-part', at(first + 2));
  await page.keyboard.press('Enter');
  await expect(fitted, 'Enter fits the highlighted part').toHaveAttribute('data-part', at(first + 3));
  await expect.poll(async () => (await state(page)).loadout.weapon).toBe(at(first + 3));
  await expect(drop, 'the list stays after Enter').toBeVisible();

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(highlight, 'the highlight wraps round').toHaveAttribute('data-part', at(first + 5));
  await page.keyboard.press('ArrowUp');
  await expect(highlight).toHaveAttribute('data-part', at(first + 4));

  await page.keyboard.press('Escape');
  await expect(drop, 'Esc closes it at once').toHaveCount(0);
  expect((await state(page)).settingsScreen, 'Esc closed the list, not opened the settings').toBe(false);
  expect((await state(page)).loadout.weapon, 'closing fits nothing').toBe(at(first + 3));
});

test("a held key's list closes 2 s after the last key; another slot's tap cycles it and closes the list, and its hold opens its own (#259)", async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const drop = page.locator('#hud-gauge .hud-drop');
  const openSlot = page.locator('#hud-gauge .hud-slot.open');

  await page.keyboard.down('2');
  await expect(openSlot).toHaveAttribute('data-slot', 'engine');
  await page.keyboard.up('2');
  const before = Date.now();
  await page.keyboard.press('ArrowDown');
  await expect(drop).toBeHidden({ timeout: PART_LIST_IDLE_MS + 15_000 });
  expect(Date.now() - before, 'open at least 2 s after the last key').toBeGreaterThanOrEqual(PART_LIST_IDLE_MS);

  await page.keyboard.down('1');
  await expect(openSlot).toHaveAttribute('data-slot', 'weapon');
  await page.keyboard.up('1');
  const engine = (await state(page)).loadout.engine;
  await page.keyboard.press('2');
  await expect(drop, "another slot's tap closes the list").toHaveCount(0);
  await expect.poll(async () => (await state(page)).loadout.engine, 'and cycles that slot').not.toBe(engine);

  await page.keyboard.down('1');
  await expect(openSlot).toHaveAttribute('data-slot', 'weapon');
  await page.keyboard.up('1');
  await page.keyboard.down('3');
  await expect(openSlot, "another slot's hold opens its list").toHaveAttribute('data-slot', 'shield');
  await page.keyboard.up('3');
  await expect(drop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drop).toHaveCount(0);
});

test('a part key let go after the window lost focus, or after a screen opened, fits nothing (#259)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  // Each in one evaluate, so no frame passes for a hold: what fits is the release's doing.
  const titles = await page.evaluate(() => {
    const title = (): string | null => document.querySelector('#hud-gauge [data-slot="weapon"]')?.getAttribute('title') ?? null;
    const key = (type: string, code: string): void => {
      window.dispatchEvent(new KeyboardEvent(type, { code }));
    };
    const before = title();
    key('keydown', 'Digit1');
    window.dispatchEvent(new Event('blur'));
    key('keyup', 'Digit1');
    const afterBlur = title();
    key('keydown', 'Digit1');
    key('keydown', 'F1');
    key('keyup', 'F1');
    key('keyup', 'Digit1');

    return { before, afterBlur, afterScreen: title() };
  });
  expect(titles.afterBlur, 'a lost focus drops the press').toBe(titles.before);
  expect(titles.afterScreen, 'a screen opening drops the press').toBe(titles.before);
  await expect.poll(async () => (await state(page)).introScreen).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).introScreen).toBe(false);
  await expect(page.locator('#hud-gauge .hud-drop')).toHaveCount(0);
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
