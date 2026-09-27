import { expect, test } from '@playwright/test';

test('the client boots without errors', async ({ page }) => {
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
  await page.waitForFunction(() => window.voidmarch?.ready === true);

  await expect(page.locator('#game canvas')).toBeVisible();
  expect(problems).toEqual([]);
});
