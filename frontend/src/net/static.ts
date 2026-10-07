/** Where the server serves the client's files when no build is named. */
const UNVERSIONED = '/static/';

/**
 * The prefix the page's files are served under, from the URL of a module in
 * its js/ folder: /static/v/<build>/ when index.html named the build (#238),
 * which the server lets the browser cache for good, or /static/ otherwise.
 */
export function staticBase(moduleUrl: string): string {
  const { pathname } = new URL(moduleUrl);
  const js = pathname.lastIndexOf('/js/');

  return pathname.startsWith(UNVERSIONED) && js >= 0 ? pathname.slice(0, js + 1) : UNVERSIONED;
}

/** The prefix this page's files are served under; /static/ outside a browser, as in the tests. */
export const STATIC = staticBase(import.meta.url);

/** A /static/ URL under base instead, so it shares the page's build; any other URL as it is. */
export function versioned(url: string, base: string = STATIC): string {
  return url.startsWith(UNVERSIONED) ? base + url.slice(UNVERSIONED.length) : url;
}
