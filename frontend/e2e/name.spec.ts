import { expect, test } from '@playwright/test';

test('the first visit asks for a name, then plays online', async ({ page }) => {
  await page.goto('/');
  const form = page.locator('#name-form');
  await expect(form).toBeVisible();

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Pick a name first.');

  await page.getByLabel('Pick a name').fill('Mo!');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('letters, digits');

  await page.getByLabel('Pick a name').fill('Joost');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(form).toBeHidden();
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');

  // The token is kept: a reload goes straight into the game.
  await page.reload();
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  await expect(form).toBeHidden();
});

test('typing a name does not steer the game', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Pick a name').pressSequentially('Wasd Mcnfr');
  await expect(page.getByLabel('Pick a name')).toHaveValue('Wasd Mcnfr');
});

test('a token the server forgot asks for a name again', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded') === null) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('voidmarch.token', 'forgotten');
    }
  });
  await page.goto('/');
  await expect(page.locator('#name-form')).toBeVisible();
});
