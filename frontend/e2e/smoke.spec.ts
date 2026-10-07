import { expect, test } from './fixtures.ts';

test('the client boots into the sandbox without errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      problems.push(`console ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) {
      problems.push(`HTTP ${res.status()}: ${res.url()}`);
    }
  });

  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');

  await expect(page.locator('#game canvas')).toBeVisible();
  expect(problems).toEqual([]);

  await page.waitForTimeout(1000);
  const { fps, frameMs, gpuMs } = await page.evaluate(() => ({
    fps: window.voidmarch?.fps ?? 0,
    frameMs: window.voidmarch?.frameMs ?? { average: 0, worst: 0 },
    gpuMs: window.voidmarch?.gpuMs,
  }));
  // The frame times of the last second are published (#143).
  expect(frameMs.worst).toBeGreaterThan(0);
  expect(frameMs.worst).toBeGreaterThanOrEqual(frameMs.average);
  const line = `${fps.toFixed(1)} fps, worst ${frameMs.worst.toFixed(1)} ms${gpuMs === undefined ? '' : `, gpu ${gpuMs.toFixed(1)} ms`}`;
  test.info().annotations.push({ type: 'fps', description: line });
  console.log(`${test.info().project.name}: ${line}`);
});

test('the debug state is built when it is read, not every frame (#264)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  const reader = await page.evaluate(() => typeof Object.getOwnPropertyDescriptor(window, 'voidmarch')?.get);
  expect(reader).toBe('function');
});

test('the game\'s text is in Exo 2, with titles in Orbitron (#170)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.scene === 'sandbox');
  // check() alone also passes for a font the page never declared, so look for the loaded faces themselves.
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')));
  expect(loaded).toEqual(expect.arrayContaining(['Orbitron', 'Exo 2']));
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-form')).toBeVisible();
  const family = async (selector: string): Promise<string> => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);
  expect(await family('#settings-form .settings-row')).toMatch(/^"Exo 2"/);
  expect(await family('#settings-form h2')).toMatch(/^Orbitron/);
});
