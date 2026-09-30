import { test } from './fixtures.ts';
import { collectAPart, state } from './hunt.ts';

// The E2E server sets DROP_CHANCE=1, so every kill drops a part (#77).
test('a shot-down enemy drops a part, and flying over it unlocks it', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  const owned = Object.keys((await state(page)).unlocks).length;

  await collectAPart(page, owned);
});
