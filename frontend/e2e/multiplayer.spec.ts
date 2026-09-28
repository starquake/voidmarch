import type { Browser, Page } from '@playwright/test';

import { expect, registerPlayer, test } from './fixtures.ts';

import type { DebugState } from '../src/debug.ts';

const state = (page: Page): Promise<DebugState> =>
  page.evaluate(() => {
    if (window.voidmarch === undefined) {
      throw new Error('window.voidmarch is not published');
    }

    return structuredClone(window.voidmarch);
  });

/**
 * A registered player in their own browser context, online. Two pages render
 * WebGL in software at once in CI, so each gets a small viewport, a quarter of
 * the pixels. Otherwise a slow runner drops to a few fps, and the sim, which
 * catches up at most a few ticks a frame, runs in slow motion (#22).
 */
async function player(browser: Browser, baseURL: string, name: string, query = ''): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: VIEWPORT });
  const token = await registerPlayer(context.request, name);
  await context.addInitScript((t) => {
    localStorage.setItem('voidmarch.token', t);
  }, token);
  const page = await context.newPage();
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  return page;
}

const VIEWPORT = { width: 480, height: 270 };

test('two players see each other fly and shoot', async ({ browser, baseURL }) => {
  // Two browsers in one test; the default 30 s is tight on a slow runner.
  test.setTimeout(90_000);
  const suffix = String(Date.now() % 100000);
  const sanne = await player(browser, baseURL ?? '', `Sanne${suffix}`, '?wire=json');
  const mo = await player(browser, baseURL ?? '', `Mo${suffix}`);

  // Mo sees Sanne by name, in a colour.
  await expect
    .poll(async () => (await state(mo)).net.others.find((o) => o.name === `Sanne${suffix}`))
    .toMatchObject({ name: `Sanne${suffix}` });
  const before = (await state(mo)).net.others.find((o) => o.name === `Sanne${suffix}`);
  expect(before?.colour).toBeGreaterThan(0);

  // Sanne flies toward the mouse; Mo sees her ship move.
  await sanne.mouse.move(VIEWPORT.width / 2 + 150, VIEWPORT.height / 2);
  await sanne.keyboard.down('w');
  await expect
    .poll(async () => (await state(mo)).net.others.find((o) => o.name === `Sanne${suffix}`)?.x ?? 0)
    .toBeGreaterThan((before?.x ?? 0) + 20);
  await sanne.keyboard.up('w');

  // Sanne fires; her shots reach Mo's world.
  const shotsBefore = (await state(mo)).projectiles;
  await sanne.mouse.down();
  await expect.poll(async () => (await state(mo)).projectiles).toBeGreaterThan(shotsBefore);
  await sanne.mouse.up();

  // And Sanne sees Mo, over JSON.
  await expect
    .poll(async () => (await state(sanne)).net.others.some((o) => o.name === `Mo${suffix}`))
    .toBe(true);
});

test('without the server the game still plays', async ({ page }) => {
  await page.routeWebSocket('**/ws', (ws) => {
    void ws.close();
  });
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');

  const before = await state(page);
  expect(before.net.status).not.toBe('online');
  await page.keyboard.down('d');
  await expect.poll(async () => (await state(page)).ship.x).not.toBe(before.ship.x);
  await page.keyboard.up('d');
  // Enemies come from the server, so offline there are none.
  expect((await state(page)).enemies).toEqual([]);
});
