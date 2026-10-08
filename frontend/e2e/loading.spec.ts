import type { Page } from '@playwright/test';

import { expect, fresh, test } from './fixtures.ts';

/** A file's URL pattern under the page's build, /static/v/<build>/ (#238). */
const STATIC = String.raw`\/static\/v\/[0-9a-f]+\/`;

/** The enemies' sheets, held back so the strip stays up mid-load. */
const ENEMY_SHEETS = new RegExp(String.raw`${STATIC}assets\/(klaed|nairan|nautolan)\/`);

/** Phaser, the largest part of the game's code, held back to keep the entry module's screens up (#227, decision 8). */
const PHASER = new RegExp(String.raw`${STATIC}js\/vendor\/phaser\.js$`);

/** The rules. */
const RULES = new RegExp(String.raw`${STATIC}wasm\/sim\.wasm$`);

/** Files the bar counts that the server gzips (#230): the game's code, the rules, and a layout Phaser's loader fetches. */
const GZIPPED = [PHASER, RULES, new RegExp(String.raw`${STATIC}assets\/environment\/background-stars\.json$`)];

/** Holds the requests matching url until the returned function lets them through. */
async function hold(page: Page, url: RegExp): Promise<() => void> {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(url, async (route) => {
    await gate;
    await route.continue();
  });

  return release;
}

/** Whether phaser.js has finished downloading. */
const phaserLoaded = (page: Page): Promise<boolean> =>
  page.evaluate(() => performance.getEntriesByType('resource').some((entry) => entry.name.endsWith('/js/vendor/phaser.js')));

/** Each category on the strip, with its state. */
const categories = (page: Page): Promise<string[]> =>
  page.locator('#loading-categories li').evaluateAll((items) => items.map((li) => `${li.textContent}:${li.getAttribute('class') ?? ''}`));

/** The bar's value, as a screen reader reads it. */
const barValue = async (page: Page): Promise<number> => Number(await page.locator('#loading-bar').getAttribute('aria-valuenow'));

/** A value the bar took, with the strip's label at the time. */
interface BarStep {
  label: string;
  value: number;
}

/** Records every value the bar takes once the strip first shows, on window.barSteps. */
async function recordBar(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const steps: BarStep[] = [];
    (window as unknown as { barSteps: BarStep[] }).barSteps = steps;
    new MutationObserver(() => {
      const bar = document.querySelector('#loading-bar');
      if (bar === null || (steps.length === 0 && document.querySelector<HTMLElement>('#loading-strip')?.hidden !== false)) {
        return;
      }
      const step = { label: document.querySelector('#loading-what')?.textContent ?? '', value: Number(bar.getAttribute('aria-valuenow')) };
      const last = steps.at(-1);
      if (last?.label !== step.label || last.value !== step.value) {
        steps.push(step);
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
}

const online = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
};

fresh("the name screen shows before the game's code is in, and the strip reads Loading game until it is", async ({ page }) => {
  const release = await hold(page, PHASER);
  const phaser = page.waitForRequest(PHASER);
  await page.goto('/', { waitUntil: 'commit' });
  await phaser;
  const name = page.locator('#name-form');
  await expect(name).toBeVisible();
  expect(await phaserLoaded(page), 'phaser.js is still downloading').toBe(false);

  // Typing a name overlaps the download.
  await page.getByLabel('Pick a name').fill('Early');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(name).toBeHidden();

  const strip = page.locator('#loading-strip');
  const play = page.locator('#intro-play');
  await expect(strip).toBeVisible();
  await expect(page.locator('#intro-form')).toBeVisible();
  await expect(page.locator('#loading-what')).toHaveText('Loading game');
  await expect.poll(() => barValue(page), "the code's download counts what is in").toBeGreaterThan(0);
  await expect.poll(() => categories(page)).toEqual(['Ships:waiting', 'Enemies:waiting', 'Space:waiting', 'Sounds:waiting']);
  await expect(play).toBeDisabled();
  expect(await phaserLoaded(page), 'phaser.js is still downloading').toBe(false);

  release();
  await expect(strip).toBeHidden();
  await expect(play).toBeEnabled();
  await online(page);
});

fresh('a first visit loads behind the name screen, then shows the intro with the strip until the game is up', async ({ page }) => {
  const release = await hold(page, ENEMY_SHEETS);
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  const registered: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/players')) {
      registered.push(request.url());
    }
  });

  const shipSheet = page.waitForRequest(new RegExp(String.raw`${STATIC}assets\/mainship\/`));
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

test("a returning player sees the strip alone, reading Loading game until the game's code is in, then the game", async ({ page }) => {
  const releaseCode = await hold(page, PHASER);
  const release = await hold(page, ENEMY_SHEETS);
  const phaser = page.waitForRequest(PHASER);
  await page.goto('/', { waitUntil: 'commit' });
  await phaser;
  const strip = page.locator('#loading-strip');
  await expect(strip).toBeVisible();
  await expect(page.locator('#loading-what')).toHaveText('Loading game');
  expect(await phaserLoaded(page), 'phaser.js is still downloading').toBe(false);
  await expect(page.locator('#name-form')).toBeHidden();
  await expect(page.locator('#intro-form')).toBeHidden();

  releaseCode();
  await expect(page.locator('#loading-what')).toHaveText('Loading enemies');
  expect(await page.evaluate(() => window.voidmarch?.ready ?? false), 'the game waits for its files').toBe(false);

  release();
  await expect(strip).toBeHidden();
  await online(page);
});

test("one bar by bytes: it counts the game's gzipped code as it streams, never goes back, and reaches 100 once", async ({ page }) => {
  await recordBar(page);
  const gzipped = Promise.all(GZIPPED.map((url) => page.waitForResponse(url)));
  const release = await hold(page, PHASER);
  const phaser = page.waitForRequest(PHASER);
  await page.goto('/', { waitUntil: 'commit' });
  await phaser;
  await expect(page.locator('#loading-what')).toHaveText('Loading game');
  // main.js and the protobuf modules stream in while Phaser is held.
  await expect.poll(() => barValue(page)).toBeGreaterThan(0);
  const held = await barValue(page);
  expect(held, 'Phaser is most of what is left').toBeLessThan(50);
  await expect(page.locator('#loading-percent')).toHaveText(`${String(held)}%`);
  await expect(page.locator('#loading-what')).toHaveText('Loading game');
  expect(await phaserLoaded(page), 'phaser.js is still downloading').toBe(false);

  release();
  await expect(page.locator('#loading-strip')).toBeHidden();
  await online(page);
  const steps = await page.evaluate(() => (window as unknown as { barSteps: BarStep[] }).barSteps);
  const values = steps.map((s) => s.value);
  expect(values, 'the bar never goes back').toEqual(values.toSorted((a, b) => a - b));
  expect(values.at(-1), 'it ends at 100').toBe(100);
  expect(values.filter((v) => v === 100).length, 'and gets there once').toBe(1);
  expect(steps.some((s) => s.label === 'Loading game' && s.value > 0), 'the code counts before it runs').toBe(true);
  expect(steps.some((s) => s.label !== 'Loading game' && s.value < 100), 'then the files count').toBe(true);
  for (const response of await gzipped) {
    const headers = await response.allHeaders();
    expect(headers['content-encoding'], `${response.url()} arrives gzipped`).toBe('gzip');
    expect(Number(headers['content-length']), `${response.url()} gives its length, for the loader's progress`).toBeGreaterThan(0);
  }
});

test('the rules download once, starting when the code is in (decision 10)', async ({ page }) => {
  const rules: string[] = [];
  page.on('request', (request) => {
    if (RULES.test(request.url())) {
      rules.push(request.url());
    }
  });
  // The second request for main.js is import()'s, after the entry module's download: holding it keeps the game's code from running.
  let mainRequests = 0;
  let releaseImport = (): void => undefined;
  const imported = new Promise<void>((resolve) => {
    releaseImport = resolve;
  });
  await page.route(new RegExp(String.raw`${STATIC}js\/main\.js$`), async (route) => {
    mainRequests += 1;
    if (mainRequests > 1) {
      await imported;
    }
    await route.continue();
  });
  const rulesRequested = page.waitForRequest(RULES);
  await page.goto('/', { waitUntil: 'commit' });
  await rulesRequested;
  await expect.poll(() => mainRequests, 'and the game code is held').toBe(2);

  releaseImport();
  await expect(page.locator('#loading-strip')).toBeHidden();
  await online(page);
  expect(rules, 'the game runs the bytes the entry module downloaded').toHaveLength(1);
});

/** What a page fetched under the static paths: each URL, and the bytes that crossed the network for it (0 from the cache). */
const staticFetches = (page: Page): Promise<{ url: string; transferSize: number }[]> =>
  page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((entry) => new URL(entry.name).pathname.startsWith('/static/'))
      .map((entry) => ({ url: entry.name, transferSize: (entry as PerformanceResourceTiming).transferSize })),
  );

test('a return visit takes every file the first one loaded from the cache, asking the server about none, and the bar still fills once (#238)', async ({
  page,
}) => {
  await page.goto('/');
  await online(page);
  const first = await staticFetches(page);
  expect(first.length, 'the first visit loads the game').toBeGreaterThan(100);
  expect(
    first.filter(({ url }) => !new RegExp(STATIC).test(url)),
    "every file is under the page's build",
  ).toEqual([]);
  expect(first.some(({ url }) => url.endsWith('/fonts/exo2.woff2')), "style.css's fonts too").toBe(true);

  await recordBar(page);
  await page.goto('about:blank');
  await page.goto('/');
  await online(page);
  const loaded = new Set(first.map(({ url }) => url));
  const again = (await staticFetches(page)).filter(({ url }) => loaded.has(url));
  const urls = again.map(({ url }) => url);
  // A font may not show at all: Firefox keeps the fonts it has, and asks no cache for them.
  for (const file of [PHASER, RULES, /\/js\/main\.js$/, /\/assets\/mainship\//]) {
    expect(urls.some((url) => file.test(url)), `the return visit loads ${file.source}`).toBe(true);
  }
  expect(
    again.filter(({ transferSize }) => transferSize > 0).map(({ url }) => url),
    'none asks the server again',
  ).toEqual([]);

  const values = (await page.evaluate(() => (window as unknown as { barSteps: BarStep[] }).barSteps)).map((s) => s.value);
  expect(values, 'the bar never goes back').toEqual(values.toSorted((a, b) => a - b));
  expect(values.at(-1), 'it ends at 100').toBe(100);
  expect(values.filter((v) => v === 100).length, 'and gets there once').toBe(1);
});
