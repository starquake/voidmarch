import type { Browser, Page } from '@playwright/test';

import { expect, registerPlayer, signIn, test } from './fixtures.ts';

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
  await signIn(context, token);
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
  // Close both when done: an open page keeps rendering WebGL through later specs (#22).
  try {
    // Mo sees Sanne by name, in a color.
    await expect
      .poll(async () => (await state(mo)).net.others.find((o) => o.name === `Sanne${suffix}`))
      .toMatchObject({ name: `Sanne${suffix}` });
    const before = (await state(mo)).net.others.find((o) => o.name === `Sanne${suffix}`);
    expect(before?.color).toBeGreaterThan(0);

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
  } finally {
    await sanne.context().close();
    await mo.context().close();
  }
});

test('two ships flown into each other bump apart', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const suffix = String(Date.now() % 100000);
  const sanne = await player(browser, baseURL ?? '', `Sanne${suffix}`);
  const mo = await player(browser, baseURL ?? '', `Mo${suffix}`);
  const apart = async (): Promise<{ dx: number; distance: number; rams: number }> => {
    const [a, b] = await Promise.all([state(sanne), state(mo)]);

    return { dx: b.ship.x - a.ship.x, distance: Math.hypot(b.ship.x - a.ship.x, b.ship.y - a.ship.y), rams: b.rams };
  };
  const SHIPS_TOUCH = 24;
  try {
    // Both start below the home planet on the same point, and part sideways.
    await expect
      .poll(async () => (await apart()).distance, { message: 'the two new ships part' })
      .toBeGreaterThanOrEqual(SHIPS_TOUCH - 1);

    // They part along x, so with screen-relative controls Mo backs away
    // along that line and then flies straight into her, whatever his aim.
    await mo.keyboard.press('c');
    await expect.poll(async () => (await state(mo)).controlMode).toBe('screen');
    const [away, toward] = (await apart()).dx > 0 ? ['d', 'a'] : ['a', 'd'];
    await mo.keyboard.down(away);
    await expect.poll(async () => (await apart()).distance).toBeGreaterThan(80);
    await mo.keyboard.up(away);
    await mo.keyboard.down(toward);
    // He never flies through her: the ships stay out of each other while he pushes.
    let closest = Infinity;
    const track = async (): Promise<{ distance: number; rams: number }> => {
      const now = await apart();
      closest = Math.min(closest, now.distance);

      return now;
    };
    await expect
      .poll(
        async () => {
          const now = await track();

          return now.rams > 0 && now.distance >= SHIPS_TOUCH - 1;
        },
        { message: 'Mo rams Sanne and stays out of her ship', intervals: [50] },
      )
      .toBe(true);
    for (let i = 0; i < 10; i++) {
      await track();
      await mo.waitForTimeout(50);
    }
    await mo.keyboard.up(toward);
    expect(closest, 'the closest the ships came, center to center').toBeGreaterThan(SHIPS_TOUCH / 2);
    // Rams hurt both: Sanne's own client counts his ram on her too.
    await expect.poll(async () => (await state(sanne)).rams, { message: 'Sanne counts the ram' }).toBeGreaterThan(0);
  } finally {
    await sanne.context().close();
    await mo.context().close();
  }
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
