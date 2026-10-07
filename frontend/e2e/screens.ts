import type { Page } from '@playwright/test';

/**
 * What hides the open screen's buttons, fields and text in this window
 * (#221): the screen should fit in the window, and each of its parts,
 * scrolled into view, should be the topmost thing at the middle of what shows
 * of it. The HUD and the season's float let the pointer through, so they take
 * it while this looks, or they would never be found on top.
 */
export function coveredOnScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const doc = document;
    // Set one by one, since the page's CSP refuses an added style sheet; #hud itself is an empty frame over the whole page.
    const overlays = [...doc.querySelectorAll<HTMLElement>('#hud *, .standings-float')];
    for (const el of overlays) {
      el.style.setProperty('pointer-events', 'auto', 'important');
    }
    const name = (e: Element | null): string => (e === null ? 'nothing' : `${e.tagName.toLowerCase()}${e.id === '' ? '' : `#${e.id}`}.${e.className}`);
    const covered: string[] = [];
    try {
      for (const screen of doc.querySelectorAll<HTMLElement>('.name-screen:not([hidden]):not([inert])')) {
        const box = screen.getBoundingClientRect();
        if (box.top < 0 || box.left < 0 || box.bottom > window.innerHeight || box.right > window.innerWidth) {
          covered.push(`${screen.id} runs off the window`);
        }
        for (const el of screen.querySelectorAll<HTMLElement>(':scope > *, button, input')) {
          el.scrollIntoView({ block: 'nearest' });
          const r = el.getBoundingClientRect();
          const seen = screen.getBoundingClientRect();
          const left = Math.max(r.left, seen.left, 0);
          const right = Math.min(r.right, seen.right, window.innerWidth);
          const top = Math.max(r.top, seen.top, 0);
          const bottom = Math.min(r.bottom, seen.bottom, window.innerHeight);
          if (right - left < 1 || bottom - top < 1) {
            continue;
          }
          const hit = doc.elementFromPoint((left + right) / 2, (top + bottom) / 2);
          if (hit === null || (hit !== el && !el.contains(hit))) {
            covered.push(`${screen.id} ${name(el)} under ${name(hit)}`);
          }
        }
      }
    } finally {
      for (const el of overlays) {
        el.style.removeProperty('pointer-events');
      }
    }

    return covered;
  });
}
