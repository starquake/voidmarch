import type { Page } from '@playwright/test';

/**
 * Starts recording, every frame, each notice the page shows. A new notice
 * replaces the one showing, and the server's own timers can send one at any
 * moment, such as a derelict coming back to its spot (#314), so a spec checks
 * that its notice was shown rather than that it is the one showing now.
 */
export async function recordNotices(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { noticesShown?: string[] };
    const shown: string[] = [];
    w.noticesShown = shown;
    const look = (): void => {
      // A later recording replaced this one.
      if (w.noticesShown !== shown) {
        return;
      }
      const notice = window.voidmarch?.notice;
      if (notice !== undefined && shown.at(-1) !== notice) {
        shown.push(notice);
      }
      requestAnimationFrame(look);
    };
    look();
  });
}

/** The notices the page showed since recordNotices, in order. */
export const noticesShown = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { noticesShown?: string[] }).noticesShown ?? []);
