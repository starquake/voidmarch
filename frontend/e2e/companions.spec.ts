import type { Browser, Page } from '@playwright/test';

import { expect, registerPlayer, signIn, test } from './fixtures.ts';
import { flyOut } from './hunt.ts';

import type { DebugState } from '../src/debug.ts';

const state = (page: Page): Promise<DebugState> =>
  page.evaluate(() => {
    if (window.voidmarch === undefined) {
      throw new Error('window.voidmarch is not published');
    }

    return structuredClone(window.voidmarch);
  });

/** A small viewport, since two pages render WebGL in software at once in CI (#22). */
const VIEWPORT = { width: 480, height: 270 };

/** A second registered player in their own browser context, online. */
async function otherPlayer(browser: Browser, baseURL: string, name: string): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: VIEWPORT });
  const token = await registerPlayer(context.request, name);
  await signIn(context, token);
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  return page;
}

/** Summons count companions; each takes one of the server's 16 seats, so the specs use few. */
async function summon(page: Page, count: number): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('g');
  }
  await expect.poll(async () => (await state(page)).companions.length).toBe(count);
}

test('the server lists the hangar\'s ships to a joining player', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await expect.poll(async () => (await state(page)).hangar).toBeDefined();
  // Earlier specs on this worker's server use the hangar too, so only the range is ours to assert.
  const hangar = (await state(page)).hangar ?? -1;
  expect(hangar).toBeGreaterThanOrEqual(0);
  expect(hangar).toBeLessThanOrEqual(15);
});

test('summoned companions fly with their owner, and others see them as theirs', async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  await summon(page, 3);
  const owner = (await state(page)).net.playerId;
  const mo = await otherPlayer(browser, baseURL ?? '', `Mo${String(Date.now() % 100000)}`);
  try {
    await expect
      .poll(async () => (await state(mo)).net.others.filter((o) => o.ownerId === owner).map((o) => o.id).sort())
      .toEqual([`${owner ?? ''}/1`, `${owner ?? ''}/2`, `${owner ?? ''}/3`]);
  } finally {
    // An open page keeps rendering WebGL through later specs (#22).
    await mo.context().close();
  }
});

test('companions come along into a garrison and shoot down an enemy', async ({ page }) => {
  test.setTimeout(90_000);
  await summon(page, 2);

  // Fly into D5 and its garrison; the companions come along and fight what comes near.
  await flyOut(page);
  await expect
    .poll(async () => (await state(page)).companionKills, { message: 'a companion shot down an enemy', timeout: 45_000 })
    .toBeGreaterThan(0);
});

test('without the server, G summons nothing and says why', async ({ page }) => {
  await page.routeWebSocket('**/ws', (ws) => {
    void ws.close();
  });
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  await page.keyboard.press('g');

  await expect.poll(async () => (await state(page)).notice).toBe('companions need the server');
  expect((await state(page)).companions).toEqual([]);
});

test('a dropped player\'s companion flies on home, then leaves', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const mo = await otherPlayer(browser, baseURL ?? '', `Mo${String(Date.now() % 100000)}`);
  let closed = false;
  try {
    // Mo joins a squadron (on the join screen, if one has room), summons one
    // companion at home and flies out of the safe zone with it.
    await expect
      .poll(async () => {
        const s = await state(mo);
        if (s.squadronScreen) {
          await mo.keyboard.press('Enter');
        }

        return s.squadron;
      })
      .not.toBe('');
    await mo.keyboard.press('g');
    await expect.poll(async () => (await state(mo)).companions.length).toBe(1);
    const moId = (await state(mo)).net.playerId ?? '';
    await mo.mouse.move(VIEWPORT.width / 2, VIEWPORT.height - 5);
    await mo.keyboard.down('w');
    await expect
      .poll(async () => {
        const c = (await state(mo)).companions[0];

        return c === undefined ? 0 : Math.hypot(c.x, c.y);
      }, { message: 'the companion follows Mo out of the safe zone', timeout: 20_000 })
      .toBeGreaterThan(420);
    await mo.keyboard.up('w');

    // Mo drops; his ship leaves at once, his companion flies on, then docks.
    await mo.context().close();
    closed = true;
    const seen = async (): Promise<{ ship: boolean; companion: boolean }> => {
      const others = (await state(page)).net.others;

      return { ship: others.some((o) => o.id === moId), companion: others.some((o) => o.id === `${moId}/1`) };
    };
    await expect.poll(seen, { message: 'Mo\'s ship leaves, his companion stays' }).toEqual({ ship: false, companion: true });
    await expect
      .poll(async () => (await seen()).companion, { message: 'the companion reaches home and leaves', timeout: 60_000 })
      .toBe(false);
  } finally {
    if (!closed) {
      await mo.context().close();
    }
  }
});
