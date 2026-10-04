import type { Page } from '@playwright/test';

import { expect } from './fixtures.ts';
import { state } from './hunt.ts';

/** Changes one option on the settings screen (#145): Esc opens it, a click on the row changes it, and Esc closes it. */
export async function changeOption(page: Page, label: string): Promise<void> {
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).settingsScreen).toBe(true);
  await page.locator('#settings-rows .settings-row', { hasText: label }).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).settingsScreen).toBe(false);
}
