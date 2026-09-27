import { expect, test } from '@playwright/test';

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
  const fps = await page.evaluate(() => window.voidmarch?.fps ?? 0);
  test.info().annotations.push({ type: 'fps', description: fps.toFixed(1) });
  console.log(`${test.info().project.name}: ${fps.toFixed(1)} fps`);
});
