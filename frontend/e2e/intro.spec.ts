import { test as fresh, type Page } from '@playwright/test';

import { touchButtons } from '../src/sim/touch.ts';
import { expect, registerPlayer, test } from './fixtures.ts';
import { state } from './hunt.ts';

const online = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
};

fresh('a first visit shows the intro after the name screen, and Play closes it for good', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Pick a name').fill('Newcomer');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await online(page);
  const intro = page.locator('#intro-form');
  await expect(intro).toBeVisible();
  await expect(intro).toContainText("The Kla'ed, Nairan and Nautolan fleets hold the sectors around your home planet.");
  await expect(page.locator('#intro-controls')).toContainText('Keyboard');
  expect((await state(page)).introScreen).toBe(true);

  await page.locator('#intro-play').click();
  await expect(intro).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('voidmarch.introSeen'))).toBe('1');

  await page.reload();
  await online(page);
  await page.waitForTimeout(300);
  await expect(intro).toBeHidden();
});

test('on a first visit with a squadron to join, the intro opens over the join screen, which waits behind it', async ({ page, browser, baseURL }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await online(page);
  await expect.poll(async () => (await state(page)).squadron).not.toBe('');
  const squadron = (await state(page)).squadron;

  // A small viewport, since two pages render WebGL in software at once in CI (#22).
  const context = await browser.newContext({ baseURL: baseURL ?? '', viewport: { width: 480, height: 270 } });
  try {
    const token = await registerPlayer(context.request, `Ny${String(Date.now() % 100000)}`);
    await context.addInitScript((t) => {
      localStorage.setItem('voidmarch.token', t);
    }, token);
    const newcomer = await context.newPage();
    await newcomer.goto('/');
    await online(newcomer);
    await expect.poll(async () => (await state(newcomer)).squadronScreen).toBe(true);
    expect((await state(newcomer)).introScreen).toBe(true);

    // Enter plays, and doesn't join the squadron behind the screen.
    await newcomer.keyboard.press('Enter');
    await expect.poll(async () => (await state(newcomer)).introScreen).toBe(false);
    expect((await state(newcomer)).squadron).toBe('');
    // The join screen has the focus back: Enter joins the picked squadron.
    await newcomer.keyboard.press('Enter');
    await expect.poll(async () => (await state(newcomer)).squadron).toBe(squadron);
  } finally {
    // An open page keeps rendering WebGL through later specs (#22).
    await context.close();
  }
});

test('F1 opens and closes the intro, Esc closes it, and the ship holds still under it', async ({ page }) => {
  await page.goto('/');
  await online(page);
  const intro = page.locator('#intro-form');
  await expect(intro, 'signed-in specs have seen it').toBeHidden();

  await page.keyboard.press('F1');
  await expect(intro).toBeVisible();
  const before = (await state(page)).ship;
  await page.keyboard.down('w');
  await page.waitForTimeout(400);
  const held = (await state(page)).ship;
  expect(Math.hypot(held.x - before.x, held.y - before.y), 'the ship holds still under the screen').toBeLessThan(2);

  await page.keyboard.press('F1');
  await expect(intro).toBeHidden();
  await expect.poll(async () => (await state(page)).ship.y, { message: 'W, still held, flies once it closes' }).toBeLessThan(held.y - 10);
  await page.keyboard.up('w');

  await page.keyboard.press('F1');
  await expect(intro).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(intro).toBeHidden();
  expect((await state(page)).settingsScreen, 'Esc only closed it').toBe(false);
});

test('F1 over the settings screen shows the intro in its place', async ({ page }) => {
  await page.goto('/');
  await online(page);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).settingsScreen).toBe(true);
  await page.keyboard.press('F1');
  await expect.poll(async () => (await state(page)).introScreen).toBe(true);
  expect((await state(page)).settingsScreen).toBe(false);
});

test('Copy link copies the address without its query and says Copied', async ({ page }) => {
  // Firefox grants Playwright no clipboard permission, so the clipboard is a stand-in.
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.defineProperty(window, 'copied', { value: copied });
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string): Promise<void> => {
          copied.push(text);

          return Promise.resolve();
        },
      },
    });
  });
  await page.goto('/?wire=json');
  await online(page);
  await page.keyboard.press('F1');
  const copy = page.locator('#intro-copy');
  await expect(copy).toHaveText('Copy link');
  await copy.click();
  await expect(copy).toHaveText('Copied');
  const origin = new URL(page.url()).origin;
  expect(await page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual([`${origin}/`]);
  await expect(page.locator('#intro-link')).toHaveValue(`${origin}/`);
  await expect(copy, 'it goes back after a moment').toHaveText('Copy link', { timeout: 5000 });
});

test.describe('on touch', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  /** Taps the game's canvas at (x, y) in CSS pixels. */
  const tap = async (page: Page, x: number, y: number): Promise<void> => {
    await page.evaluate(
      ([clientX, clientY]) => {
        const canvas = document.querySelector('#game canvas');
        if (canvas === null) {
          throw new Error('no canvas');
        }
        const t = new Touch({ identifier: 1, target: canvas, clientX, clientY });
        for (const kind of ['touchstart', 'touchend'] as const) {
          canvas.dispatchEvent(new TouchEvent(kind, { touches: kind === 'touchend' ? [] : [t], changedTouches: [t], cancelable: true, bubbles: true }));
        }
      },
      [x, y] as const,
    );
  };

  test('the Help button opens the intro with the touch controls, and a tap beside it closes it', async ({ page }) => {
    await page.goto('/?touch=1');
    await online(page);
    await expect.poll(async () => (await state(page)).touchButtons).toContain('help');
    const help = touchButtons({ width: 844, height: 390, dpr: 1, down: false, canRespawn: false, beside: undefined, squadron: true, fullscreen: undefined }).find(
      (b) => b.button === 'help',
    );
    if (help === undefined) {
      throw new Error('no Help button');
    }
    await tap(page, help.x + help.width / 2, help.y + help.height / 2);
    const intro = page.locator('#intro-form');
    await expect(intro).toBeVisible();
    await expect(page.locator('#intro-controls')).toContainText('Thumbs');
    await expect(page.locator('#intro-controls')).not.toContainText('Keyboard');
    expect((await state(page)).touchButtons, 'no buttons over it').toEqual([]);

    // Beside it: the margin below the screen.
    await tap(page, 422, 386);
    await expect(intro).toBeHidden();
  });
});
