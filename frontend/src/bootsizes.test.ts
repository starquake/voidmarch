import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CODE_BYTES, FILE_BYTES } from './bootsizes.gen.ts';
import { FONTS, bootUrls } from './preload.ts';
import { SOUND_TYPES } from './sim/loading.ts';

const STATIC = new URL('../../internal/web/static/', import.meta.url);

/** What a committed module imports before it runs, as /static/js/ URLs. */
function staticImports(url: string): string[] {
  const source = readFileSync(new URL(url.replace(/^\/static\//, ''), STATIC), 'utf8');
  const dir = url.slice(0, url.lastIndexOf('/') + 1);

  return [...source.matchAll(/(?:^|[;\n}])\s*(?:import|export)\s*(?:[\w$*{}\s,]*?\s*from\s*)?"(\.\/[^"]+)"/g)].map(
    ([, path]) => dir + (path ?? '').slice(2),
  );
}

test("the generated sizes cover the game's code: main.js and every module it imports, and not the entry", () => {
  const want = new Set<string>();
  const visit = (url: string): void => {
    if (!want.has(url)) {
      want.add(url);
      staticImports(url).forEach(visit);
    }
  };
  visit('/static/js/main.js');
  assert.ok(want.has('/static/js/vendor/phaser.js'), 'the walk finds Phaser');
  assert.deepEqual(new Set(Object.keys(CODE_BYTES)), want);
  assert.equal(CODE_BYTES['/static/js/entry.js'], undefined);
});

test('every key loaded before play has a size, a sound one per format, and nothing else has', () => {
  const urls = bootUrls();
  assert.deepEqual(Object.keys(FILE_BYTES), urls.map((file) => file.key));
  for (const { key, urls: list } of urls) {
    const bytes = FILE_BYTES[key];
    if (list.length === 1) {
      assert.equal(typeof bytes, 'number', key);
    } else {
      const formats = list.map((url) => url.slice(url.lastIndexOf('.') + 1));
      assert.deepEqual(typeof bytes === 'object' ? Object.keys(bytes) : bytes, formats, key);
      for (const format of formats) {
        assert.ok(format in SOUND_TYPES, `${key}: the entry can't ask the browser about ${format}`);
      }
    }
  }
});

test("every size is the committed file's", () => {
  const sizeOf = (url: string): number => readFileSync(new URL(url.replace(/^\/static\//, ''), STATIC)).byteLength;
  for (const [url, bytes] of Object.entries(CODE_BYTES)) {
    assert.equal(bytes, sizeOf(url), url);
  }
  for (const { key, urls } of bootUrls()) {
    const bytes = FILE_BYTES[key];
    const got = typeof bytes === 'object' ? Object.values(bytes) : [bytes];
    assert.deepEqual(got, urls.map(sizeOf), key);
  }
});

test("the fonts' URLs are the ones style.css loads", () => {
  const css = readFileSync(new URL('css/style.css', STATIC), 'utf8');
  for (const { name, url } of FONTS) {
    assert.ok(css.includes(`url("..${url.replace(/^\/static/, '')}")`), `${name}: ${url} is not in style.css`);
  }
});
