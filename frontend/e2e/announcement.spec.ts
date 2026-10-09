import type { Page } from '@playwright/test';

import { expect, registerPlayer, signIn, test } from './fixtures.ts';
import { state } from './hunt.ts';
import { announcementCovered, clickThroughAnnouncement, showAnnouncement } from './screens.ts';

import type { DebugState } from '../src/debug.ts';

/** The new squadron's mission is announced as the page comes online (#101). */
const MISSION = /^New mission: sector /;

/** What the banner showed, and the scene's banner, in the same frame. */
interface Shown {
  text: string;
  scene: string | undefined;
}

/**
 * Waits for an announcement and checks, in the frame it shows, that the
 * banner sits where the canvas one did, at the same size whatever the pixel
 * ratio. One shows for a few seconds, and on a busy runner a few round trips
 * to the page can outlast it.
 */
async function expectPlaced(page: Page): Promise<Shown> {
  const found = await page.waitForFunction(() => {
    const el = document.querySelector<HTMLElement>('#announcement');
    if (el === null || el.hidden) {
      return false;
    }
    const r = el.getBoundingClientRect();

    return {
      top: r.top,
      middle: (r.left + r.right) / 2,
      font: getComputedStyle(el).fontSize,
      width: window.innerWidth,
      height: window.innerHeight,
      text: el.textContent,
      scene: window.voidmarch?.missionBanner,
    };
  });
  const box = (await found.jsonValue()) as { top: number; middle: number; font: string; width: number; height: number } & Shown;
  expect(box.top).toBeCloseTo(box.height * 0.22, 0);
  expect(box.middle).toBeCloseTo(box.width / 2, 0);
  expect(box.font).toBe('14px');

  return { text: box.text, scene: box.scene };
}

/** The screens a key opens, and the window width at which one of their buttons lies under the banner. */
const SCREENS: readonly { name: string; key: string; open: keyof DebugState; over: string; buttonAt?: number }[] = [
  { name: 'the settings', key: 'Escape', open: 'settingsScreen', over: 'form#settings-form', buttonAt: 640 },
  { name: 'the intro', key: 'F1', open: 'introScreen', over: 'form#intro-form' },
  { name: 'the full map', key: 'm', open: 'mapOpen', over: 'canvas' },
];

for (const viewport of [
  { width: 640, height: 360 },
  { width: 1280, height: 720 },
]) {
  test.describe(`at ${String(viewport.width)}x${String(viewport.height)}`, () => {
    test.use({ viewport });

    test('an announcement shows over the HUD, in the page (#272)', async ({ page }) => {
      await page.goto('/');
      await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
      const shown = await expectPlaced(page);
      expect(shown.text).toMatch(MISSION);
      expect(shown.text, "the scene's banner, in the page").toBe(shown.scene);
      const { covered, over } = await announcementCovered(page);
      expect(covered).toEqual([]);
      expect(over).toContain('canvas');
      await expect.poll(async () => (await state(page)).missionBanner, { timeout: 15_000 }).toBeUndefined();
      await expect(page.locator('#announcement')).toBeHidden();
    });

    for (const screen of SCREENS) {
      test(`an announcement shows over ${screen.name}, and a click goes through it (#272)`, async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
        await page.keyboard.press(screen.key);
        await expect.poll(async () => (await state(page))[screen.open]).toBe(true);
        const { covered, over, text } = await announcementCovered(page);
        expect(text).toMatch(MISSION);
        expect(covered).toEqual([]);
        expect(over).toContain(screen.over);
        const { under, reached } = await clickThroughAnnouncement(page);
        expect(under).not.toBe('div#announcement');
        if (screen.buttonAt === viewport.width) {
          expect(under).toMatch(/^button/);
        }
        expect(reached).toBe(under);
      });
    }

    test('an announcement shows over the join screen, and a click goes through it (#272)', async ({ page, browser, baseURL }) => {
      // Two pages in one test, each as large as the viewport; the default 30 s is tight on a slow runner (#22).
      test.setTimeout(60_000);
      await page.goto('/');
      await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
      // A second player meets the join screen, the first page's squadron having room; no announcement reaches it there.
      const context = await browser.newContext({ baseURL: baseURL ?? '', viewport });
      await signIn(context, await registerPlayer(context.request, 'Joiner'));
      const joiner = await context.newPage();
      await joiner.goto('/');
      await joiner.waitForFunction(() => window.voidmarch?.squadronScreen === true);
      await expect(joiner.locator('#squadron-list .squadron').first()).toBeVisible();
      await showAnnouncement(joiner);
      await expectPlaced(joiner);
      const { covered, over } = await announcementCovered(joiner);
      expect(covered).toEqual([]);
      expect(over).toContain('form#squadron-form');
      const { under, reached } = await clickThroughAnnouncement(joiner);
      expect(under).not.toBe('div#announcement');
      expect(reached).toBe(under);
      await context.close();
    });
  });
}

test.describe('at twice the pixels', () => {
  test.use({ deviceScaleFactor: 2 });

  test('an announcement keeps its size and place (#272)', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
    expect((await expectPlaced(page)).text).toMatch(MISSION);
  });
});

test('the tablet\'s turn-sideways message stays on top of an announcement', async ({ page }) => {
  // A tablet held upright shows the message over the whole game; nothing can be played under it.
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('/?touch=1');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await expect(page.locator('#rotate-notice')).toBeVisible();
  await showAnnouncement(page);
  const topmost = await page.evaluate(() => {
    const banner = document.querySelector<HTMLElement>('#announcement');
    if (banner === null) {
      throw new Error('no announcement element');
    }
    // The banner lets the pointer through, so elementFromPoint would skip it; let it take the pointer while looking.
    banner.style.pointerEvents = 'auto';
    const r = banner.getBoundingClientRect();
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    banner.style.pointerEvents = '';

    return hit?.closest('#rotate-notice, #announcement')?.id ?? hit?.tagName ?? '';
  });
  expect(topmost).toBe('rotate-notice');
});
