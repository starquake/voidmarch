import { test as fresh, type Page } from '@playwright/test';

import { expect, test } from './fixtures.ts';

/** The enemies' sheets, held back so the strip stays up mid-load. */
const ENEMY_SHEETS = /\/static\/assets\/(klaed|nairan|nautolan)\//;

/** Holds the enemies' sheets until the returned function lets them through. */
async function holdEnemies(page: Page): Promise<() => void> {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(ENEMY_SHEETS, async (route) => {
    await gate;
    await route.continue();
  });

  return release;
}

/** Each category on the strip, with its state. */
const categories = (page: Page): Promise<string[]> =>
  page.locator('#loading-categories li').evaluateAll((items) => items.map((li) => `${li.textContent}:${li.getAttribute('class') ?? ''}`));

const online = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
};

fresh('a first visit loads behind the name screen, then shows the intro with the strip until the game is up', async ({ page }) => {
  const release = await holdEnemies(page);
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  const registered: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/players')) {
      registered.push(request.url());
    }
  });

  const shipSheet = page.waitForRequest(/\/static\/assets\/mainship\//);
  await page.goto('/');
  const name = page.locator('#name-form');
  await expect(name).toBeVisible();
  await shipSheet;
  await expect(page.locator('#loading-strip'), 'the name screen shows no progress').toBeHidden();
  expect(sockets, 'nothing connects before the name').toEqual([]);
  expect(registered, 'nothing registers before the name').toEqual([]);

  await page.getByLabel('Pick a name').fill('Loader');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(name).toBeHidden();

  const strip = page.locator('#loading-strip');
  const intro = page.locator('#intro-form');
  const play = page.locator('#intro-play');
  await expect(strip).toBeVisible();
  await expect(intro).toBeVisible();
  await expect(page.locator('#loading-what')).toHaveText('Loading enemies');
  await expect.poll(() => categories(page)).toEqual(['Ships:done', 'Enemies:loading', 'Space:waiting', 'Sounds:waiting']);
  const percent = Number((await page.locator('#loading-percent').textContent())?.replace('%', ''));
  expect(percent).toBeGreaterThan(0);
  expect(percent).toBeLessThan(100);
  await expect(play, 'Play waits for the game').toBeDisabled();
  await expect(page.locator('#intro-hint')).toHaveText('F1 opens and closes this');
  const introBox = await intro.boundingBox();
  const stripBox = await strip.boundingBox();
  expect((introBox?.y ?? 0) + (introBox?.height ?? 0), 'the intro sits above the strip').toBeLessThanOrEqual(stripBox?.y ?? 0);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(intro, 'neither Esc nor Enter closes it while loading').toBeVisible();

  await page.evaluate(() => {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'F1') {
        document.body.dataset.f1Prevented = String(event.defaultPrevented);
      }
    });
  });
  await page.keyboard.press('F1');
  await expect(page.locator('body'), "F1 keeps the browser's own help closed").toHaveAttribute('data-f1-prevented', 'true');
  await expect(intro, 'F1 leaves it open while loading').toBeVisible();

  release();
  await expect(strip).toBeHidden();
  await expect(play).toBeEnabled();
  await expect(page.locator('#intro-hint')).toContainText('Esc closes');
  await online(page);
  await expect(intro, 'the intro stays until Play').toBeVisible();

  await play.click();
  await expect(intro).toBeHidden();
});

test('a returning player sees the strip alone, then the game', async ({ page }) => {
  const release = await holdEnemies(page);
  await page.goto('/');
  const strip = page.locator('#loading-strip');
  await expect(strip).toBeVisible();
  await expect(page.locator('#loading-what')).toHaveText('Loading enemies');
  await expect(page.locator('#name-form')).toBeHidden();
  await expect(page.locator('#intro-form')).toBeHidden();
  expect(await page.evaluate(() => window.voidmarch?.ready ?? false), 'the game waits for its files').toBe(false);

  release();
  await expect(strip).toBeHidden();
  await online(page);
});
