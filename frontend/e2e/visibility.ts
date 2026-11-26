import type { Page } from '@playwright/test';

/**
 * Emulates switching tabs as a browser does it: the page reports hidden, says
 * so, and gets no animation frames (they wait until it shows again).
 */
export async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    const w = window as unknown as { realFrame?: typeof requestAnimationFrame; waiting?: FrameRequestCallback[] };
    if (h) {
      w.realFrame = window.requestAnimationFrame.bind(window);
      w.waiting = [];
      window.requestAnimationFrame = (callback) => {
        w.waiting?.push(callback);

        return 0;
      };
    } else if (w.realFrame !== undefined) {
      window.requestAnimationFrame = w.realFrame;
      for (const callback of w.waiting ?? []) {
        w.realFrame(callback);
      }
    }
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}
