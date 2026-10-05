import type { Browser, Page } from '@playwright/test';

import { expect, registerPlayer, signIn, test } from './fixtures.ts';
import { aimAt } from './hunt.ts';

import type { DebugState } from '../src/debug.ts';

const state = (page: Page): Promise<DebugState> =>
  page.evaluate(() => {
    if (window.voidmarch === undefined) {
      throw new Error('window.voidmarch is not published');
    }

    return structuredClone(window.voidmarch);
  });

/** Inside D5, south of home, where the e2e map keeps a garrison (#99). */
const IN_D5 = 950;

/** How close a reviving ship keeps, center to center: well inside the revive radius of 100. */
const BESIDE = 40;

/** A second registered player in their own small browser context, online. */
async function otherPlayer(browser: Browser, baseURL: string, name: string): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: { width: 480, height: 270 } });
  const token = await registerPlayer(context.request, name);
  await signIn(context, token);
  const other = await context.newPage();
  await other.goto('/');
  await other.waitForFunction(() => window.voidmarch?.net.status === 'online');

  return other;
}

/** One step of flying toward (x, y): thrust while farther than BESIDE, coast once there. */
async function steerTo(page: Page, s: DebugState, x: number, y: number): Promise<void> {
  if (Math.hypot(x - s.ship.x, y - s.ship.y) > BESIDE) {
    await aimAt(page, s, x, y);
    await page.keyboard.down('w');
  } else {
    await page.keyboard.up('w');
  }
}

/**
 * Takes the round shield, one charge all around, flies into D5 and parks
 * until enemy fire takes the ship down.
 */
async function goDown(page: Page): Promise<void> {
  await page.keyboard.press('3');
  await page.keyboard.press('3');
  await expect.poll(async () => (await state(page)).loadout.shield).toBe('round');
  const view = page.viewportSize() ?? { width: 640, height: 360 };
  await page.mouse.move(view.width / 2, view.height - 10);
  await page.keyboard.down('w');
  await expect
    .poll(async () => {
      const s = await state(page);

      return s.ship.y;
    })
    .toBeGreaterThan(IN_D5);
  await page.keyboard.up('w');
  await expect
    .poll(async () => (await state(page)).downed, { message: 'enemy fire takes the ship down', timeout: 150_000 })
    .toBe(true);
}

test('a downed player respawns at home, whole', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await goDown(page);

  const down = await state(page);
  // Alone out there, nobody revives: DOWN, and no bar yet.
  expect([down.downLabel, down.reviveBar]).toEqual(['DOWN', undefined]);
  expect(down.downPanel).toContain("You're down");
  // The season so far shows above the panel; going down counted in it (#167).
  await expect.poll(async () => (await state(page)).standings.down, { message: 'the season so far while down' }).toBeGreaterThan(0);
  await expect
    .poll(async () => (await state(page)).downPanel ?? '', { timeout: 10_000 })
    .toContain('[H] respawn at home');

  await page.keyboard.press('h');
  await expect
    .poll(async () => {
      const s = await state(page);

      return [s.downed, s.damage, s.shield, Math.round(s.ship.x), s.downPanel];
    })
    .toEqual([false, 'fullHealth', 1, 0, undefined]);
  expect((await state(page)).revives).toBe(0);
  expect((await state(page)).standings.down, 'gone once up again').toBe(0);
});

test('a downed player switches squadron with C and stays down, the panel still theirs (#45)', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online' && window.voidmarch.squadron !== '');
  const first = (await state(page)).squadron;
  await goDown(page);
  expect((await state(page)).downPanel).toContain('[C] switch squadron');
  await expect
    .poll(async () => (await state(page)).downPanel ?? '', { timeout: 10_000 })
    .toContain('[H] respawn at home');

  await page.keyboard.press('c');
  await expect.poll(async () => (await state(page)).squadronScreen).toBe(true);
  await expect(page.locator('#squadron-list .squadron.current button')).toHaveText('Stay');
  await expect
    .poll(async () => {
      const { join, down } = (await state(page)).standings;

      return [join > 0, down];
    }, { message: 'one copy of the season so far, on the screen' })
    .toEqual([true, 0]);
  await page.keyboard.press('h');
  expect((await state(page)).downed, 'H waits under the screen').toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).squadronScreen).toBe(false);
  expect((await state(page)).squadron, 'Esc closes it without moving').toBe(first);

  await page.keyboard.press('c');
  await expect.poll(async () => (await state(page)).squadronScreen).toBe(true);
  await page.locator('#squadron-start').click();
  await expect.poll(async () => (await state(page)).squadron).not.toBe(first);
  const moved = await state(page);
  expect([moved.squadronScreen, moved.downed], 'the screen closes, and the ship stays down').toEqual([false, true]);
  expect(moved.notice).toBe(`Started squadron ${moved.squadron}`);
  expect(moved.downPanel).toContain('[H] respawn at home');
  expect(moved.downPanel).toContain('[C] switch squadron');

  await page.keyboard.press('h');
  await expect.poll(async () => (await state(page)).downed).toBe(false);
  expect((await state(page)).squadron, 'respawned in the new squadron').toBe(moved.squadron);
});

test('a downed player joins a friend\'s squadron, and a revive closes the screen (#45)', async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online' && window.voidmarch.squadron !== '');
  await goDown(page);

  // Mo starts a squadron of their own, and the downed player moves into it.
  const mo = await otherPlayer(browser, baseURL ?? '', `Mo${String(Date.now() % 100000)}`);
  try {
    await expect.poll(async () => (await state(mo)).squadronScreen).toBe(true);
    await mo.locator('#squadron-start').click();
    await expect.poll(async () => (await state(mo)).squadron).not.toBe('');
    const theirs = (await state(mo)).squadron;

    await page.keyboard.press('c');
    await expect.poll(async () => (await state(page)).squadronScreen).toBe(true);
    await page.locator('#squadron-list .squadron', { hasText: theirs }).getByRole('button', { name: 'Join' }).click();
    await expect.poll(async () => (await state(page)).squadron).toBe(theirs);
    const moved = await state(page);
    expect([moved.squadronScreen, moved.downed, moved.notice]).toEqual([false, true, `Moved to ${theirs}`]);

    // Mo flies over and revives them under the reopened screen, which closes: moving is for the downed.
    // The burst engine stops within a few pixels, so Mo stays beside on a slow runner, and the round shield holds out.
    await mo.keyboard.press('2');
    await mo.keyboard.press('2');
    await mo.keyboard.press('3');
    await mo.keyboard.press('3');
    await expect.poll(async () => (await state(mo)).loadout).toMatchObject({ engine: 'burst', shield: 'round' });
    await page.keyboard.press('c');
    await expect.poll(async () => (await state(page)).squadronScreen).toBe(true);
    await expect
      .poll(
        async () => {
          const [mine, theirShip] = await Promise.all([state(page), state(mo)]);
          await steerTo(mo, theirShip, mine.ship.x, mine.ship.y);

          // Mo's side too, so a failure says whether Mo went down or never got there.
          return {
            downed: mine.downed,
            revive: mine.revive,
            moDowned: theirShip.downed,
            apart: Math.round(Math.hypot(mine.ship.x - theirShip.ship.x, mine.ship.y - theirShip.ship.y)),
          };
        },
        { message: 'Mo revives the downed player', timeout: 90_000, intervals: [100] },
      )
      .toMatchObject({ downed: false });
    await mo.keyboard.up('w');
    const up = await state(page);
    expect([up.squadronScreen, up.squadron]).toEqual([false, theirs]);
  } finally {
    // An open page keeps rendering WebGL through later specs (#22).
    await mo.context().close();
  }
});
