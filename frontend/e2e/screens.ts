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

/** Where something covers the announcement, and the elements it is over, each as its tag and id. */
interface Overlap {
  covered: string[];
  over: string[];
}

/**
 * Where something covers the announcement (#272, decision 3): its middle,
 * and the middle of its overlap with each part of an open screen, the HUD,
 * the season's float and the canvas, should all find the banner topmost. The
 * banner and the see-through overlays take the pointer while this looks, or
 * they would never be found on top. It also returns what the banner is over,
 * so a spec can tell the check reached the screen it meant.
 */
export function announcementCovered(page: Page): Promise<Overlap> {
  return page.evaluate(() => {
    const doc = document;
    const banner = doc.querySelector<HTMLElement>('#announcement');
    if (banner === null || banner.hidden) {
      return { covered: ['no announcement showing'], over: [] };
    }
    const overlays = [banner, ...doc.querySelectorAll<HTMLElement>('#hud *, .standings-float')];
    for (const el of overlays) {
      el.style.setProperty('pointer-events', 'auto', 'important');
    }
    const name = (e: Element | null): string => (e === null ? 'nothing' : `${e.tagName.toLowerCase()}${e.id === '' ? '' : `#${e.id}`}`);
    const covered: string[] = [];
    const over = new Set<string>();
    try {
      const b = banner.getBoundingClientRect();
      const points = [{ what: 'its middle', x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 }];
      const parts = doc.querySelectorAll<HTMLElement>('.name-screen:not([hidden]), .name-screen:not([hidden]) *, #hud *, .standings-float, canvas');
      for (const el of parts) {
        const r = el.getBoundingClientRect();
        const left = Math.max(r.left, b.left, 0);
        const right = Math.min(r.right, b.right, window.innerWidth);
        const top = Math.max(r.top, b.top, 0);
        const bottom = Math.min(r.bottom, b.bottom, window.innerHeight);
        if (right - left < 1 || bottom - top < 1 || getComputedStyle(el).visibility === 'hidden') {
          continue;
        }
        over.add(name(el));
        points.push({ what: name(el), x: (left + right) / 2, y: (top + bottom) / 2 });
      }
      for (const p of points) {
        const hit = doc.elementFromPoint(p.x, p.y);
        if (hit !== banner) {
          covered.push(`the announcement at ${p.what} under ${name(hit)}`);
        }
      }
    } finally {
      for (const el of overlays) {
        el.style.removeProperty('pointer-events');
      }
    }

    return { covered, over: [...over] };
  });
}

/**
 * Clicks through the announcement (#272, decision 3): on a button or field
 * of the open screen under it where there is one, else at its middle. It
 * returns what is under the banner there, found with the banner out of the
 * way, and what the click reached. The click stops at the window, so it
 * changes nothing.
 */
export async function clickThroughAnnouncement(page: Page): Promise<{ under: string; reached: string }> {
  const at = await page.evaluate(() => {
    const doc = document;
    const banner = doc.querySelector<HTMLElement>('#announcement');
    if (banner === null || banner.hidden) {
      throw new Error('no announcement showing');
    }
    const name = (e: EventTarget | null): string => (e instanceof Element ? `${e.tagName.toLowerCase()}${e.id === '' ? '' : `#${e.id}`}` : 'nothing');
    const b = banner.getBoundingClientRect();
    let x = (b.left + b.right) / 2;
    let y = (b.top + b.bottom) / 2;
    for (const el of doc.querySelectorAll<HTMLElement>('.name-screen:not([hidden]):not([inert]) :is(button, input)')) {
      const r = el.getBoundingClientRect();
      const left = Math.max(r.left, b.left);
      const right = Math.min(r.right, b.right);
      const top = Math.max(r.top, b.top);
      const bottom = Math.min(r.bottom, b.bottom);
      if (right - left >= 4 && bottom - top >= 4) {
        x = (left + right) / 2;
        y = (top + bottom) / 2;
        break;
      }
    }
    banner.style.setProperty('visibility', 'hidden');
    const under = doc.elementFromPoint(x, y);
    banner.style.removeProperty('visibility');
    const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    const swallow = (event: Event): void => {
      if (event.type === 'click') {
        doc.documentElement.dataset.reached = name(event.target);
        for (const type of types) {
          window.removeEventListener(type, swallow, { capture: true });
        }
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const type of types) {
      window.addEventListener(type, swallow, { capture: true });
    }

    return { x, y, under: name(under) };
  });
  await page.mouse.click(at.x, at.y);
  const reached = await page.evaluate(() => {
    const what = document.documentElement.dataset.reached ?? 'nothing';
    delete document.documentElement.dataset.reached;

    return what;
  });

  return { under: at.under, reached };
}

/**
 * Shows an announcement in the banner, for a screen that no announcement
 * reaches in a spec (the join screen, the down panel). The scene leaves it
 * up until its own next one; hideAnnouncement takes it down.
 */
export function showAnnouncement(page: Page): Promise<void> {
  return page.evaluate(() => {
    const banner = document.querySelector<HTMLElement>('#announcement');
    if (banner === null) {
      throw new Error('no announcement element');
    }
    banner.textContent = 'Sector E4 is under attack!\nDestroy the Frigate and its fleet before time runs out, or lose the sector.';
    banner.hidden = false;
  });
}

/** Takes down what showAnnouncement put up. */
export function hideAnnouncement(page: Page): Promise<void> {
  return page.evaluate(() => {
    const banner = document.querySelector<HTMLElement>('#announcement');
    if (banner !== null) {
      banner.hidden = true;
    }
  });
}
