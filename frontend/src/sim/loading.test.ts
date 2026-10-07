import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LOAD_CATEGORIES, LoadProgress, fileSizes, loadCategory, loadRank, type LoadView } from './loading.ts';

test('each kind of key has its category', () => {
  const cases: [string, string | undefined][] = [
    ['hull-fullHealth', 'ships'],
    ['engine-burst', 'ships'],
    ['flame-base-idle', 'ships'],
    ['shield-round', 'ships'],
    ['weapon-zapper', 'ships'],
    ['projectile-rockets', 'ships'],
    ['pickup-bigSpaceGun', 'ships'],
    ['klaed-scout-base', 'enemies'],
    ['nairan-frigate-shield', 'enemies'],
    ['nautolan-bomb', 'enemies'],
    ['background-void', 'space'],
    ['planet', 'space'],
    ['asteroid', 'space'],
    ['sfx-auto-cannon-0', 'sounds'],
    ['music-level-1', undefined],
    ['rules', undefined],
    ['planets', undefined],
  ];
  for (const [key, want] of cases) {
    assert.equal(loadCategory(key), want, key);
  }
});

test('keys rank in the strip order, uncategorized last', () => {
  assert.deepEqual(
    ['sfx-charge', 'planet', 'rules', 'klaed-bullet', 'hull-damaged'].sort((a, b) => loadRank(a) - loadRank(b)),
    ['hull-damaged', 'klaed-bullet', 'planet', 'sfx-charge', 'rules'],
  );
});

const states = (view: LoadView): string[] => view.categories.map((c) => `${c.name}:${c.state}`);

const bytes = (entries: Record<string, number>): Map<string, number> => new Map(Object.entries(entries));

/** 1000 bytes in all: the game's code, 600, then its files, 400. */
const progress = (): LoadProgress =>
  new LoadProgress(
    bytes({ '/static/js/main.js': 100, '/static/js/vendor/phaser.js': 500 }),
    bytes({ rules: 100, 'hull-damaged': 50, 'hull-veryDamaged': 50, 'klaed-bullet': 100, planet: 50, 'sfx-charge': 50 }),
  );

test("while the game's code downloads it says Loading game, with every category to come, and counts its bytes", () => {
  const p = progress();
  let view = p.view();
  assert.equal(view.label, 'Loading game');
  assert.equal(view.percent, 0);
  assert.deepEqual(states(view), ['Ships:waiting', 'Enemies:waiting', 'Space:waiting', 'Sounds:waiting']);

  p.advance('/static/js/vendor/phaser.js', 0.5);
  assert.equal(p.view().percent, 25);
  p.finish('/static/js/main.js');
  view = p.view();
  assert.equal(view.label, 'Loading game');
  assert.equal(view.percent, 35);

  // Files that arrive while the code still streams count, but the label waits for the code.
  p.finish('hull-damaged');
  view = p.view();
  assert.equal(view.percent, 40);
  assert.equal(view.label, 'Loading game');
  assert.deepEqual(states(view), ['Ships:waiting', 'Enemies:waiting', 'Space:waiting', 'Sounds:waiting']);
});

test('once the code runs, the strip names the first category still loading, and counts every byte', () => {
  const p = progress();
  p.finish('/static/js/main.js');
  p.advance('/static/js/vendor/phaser.js', 1);
  p.finishCode();
  let view = p.view();
  assert.equal(view.label, 'Loading ships');
  assert.equal(view.percent, 60);
  assert.deepEqual(states(view), ['Ships:loading', 'Enemies:waiting', 'Space:waiting', 'Sounds:waiting']);

  p.finish('hull-damaged');
  p.finish('hull-veryDamaged');
  p.finish('rules');
  p.advance('klaed-bullet', 0.5);
  view = p.view();
  assert.equal(view.label, 'Loading enemies');
  assert.equal(view.percent, 85);
  assert.deepEqual(states(view), ['Ships:done', 'Enemies:loading', 'Space:waiting', 'Sounds:waiting']);

  // A later category can finish first: it's done, and the earlier one still loads.
  p.finish('planet');
  assert.deepEqual(states(p.view()), ['Ships:done', 'Enemies:loading', 'Space:done', 'Sounds:waiting']);
});

test('the code is all counted once it runs, even what failed to stream', () => {
  const p = progress();
  p.advance('/static/js/vendor/phaser.js', 0.2);
  p.finishCode();
  assert.equal(p.view().percent, 60);
});

test('the percentage never goes backwards', () => {
  const p = progress();
  const seen: number[] = [];
  const look = (): void => {
    seen.push(p.view().percent);
  };
  p.advance('/static/js/vendor/phaser.js', 0.6);
  look();
  p.advance('/static/js/vendor/phaser.js', 0.3);
  look();
  p.advance('/static/js/vendor/phaser.js', Number.NaN);
  look();
  p.finish('unknown');
  p.advance('unknown', 1);
  look();
  p.finish('/static/js/vendor/phaser.js');
  look();
  p.advance('/static/js/vendor/phaser.js', 0);
  look();
  assert.deepEqual(seen, [30, 30, 30, 30, 50, 50]);
});

test('a stream counts its bytes against the file it is', () => {
  const p = progress();
  p.receive('/static/js/vendor/phaser.js', 250);
  assert.equal(p.view().percent, 25);
  p.receive('unknown', 1000);
  p.receive('/static/js/vendor/phaser.js', 100);
  assert.equal(p.view().percent, 25);
  p.receive('/static/js/vendor/phaser.js', 5000);
  assert.equal(p.view().percent, 50, 'a stale size counts the file once');
  const empty = new LoadProgress(bytes({ a: 0 }), bytes({}));
  empty.receive('a', 10);
  assert.equal(empty.view().percent, 0);
});

test('a fraction over 1 counts the file once, and leaves it waited for', () => {
  const p = progress();
  p.advance('/static/js/main.js', 7);
  assert.equal(p.view().percent, 10);
  assert.equal(p.complete, false);
});

test('with only uncategorized files left it says Loading, below 100%', () => {
  const p = new LoadProgress(bytes({}), bytes({ 'sfx-charge': 10, 'font-ui': 10 }));
  p.finishCode();
  p.finish('sfx-charge');
  const view = p.view();
  assert.equal(view.label, 'Loading');
  assert.equal(view.percent, 50);
  assert.deepEqual(states(view), ['Ships:done', 'Enemies:done', 'Space:done', 'Sounds:done']);
  assert.equal(p.complete, false);
});

test('100% only once everything is in', () => {
  const keys = Array.from({ length: 1000 }, (_, i) => `sfx-${String(i)}`);
  const p = new LoadProgress(bytes({ '/static/js/main.js': 1 }), new Map(keys.map((key) => [key, 1000])));
  p.finishCode();
  for (const key of keys.slice(1)) {
    p.finish(key);
  }
  p.advance('sfx-0', 0.999);
  assert.equal(p.view().percent, 99);
  p.finish('sfx-0');
  assert.equal(p.complete, true);
  assert.deepEqual(p.view(), {
    label: 'Starting',
    percent: 100,
    categories: LOAD_CATEGORIES.map((category) => ({ category, name: category.charAt(0).toUpperCase() + category.slice(1), state: 'done' })),
  });
});

test('nothing to load is complete', () => {
  const p = new LoadProgress(bytes({}), bytes({}));
  assert.equal(p.complete, true);
  assert.equal(p.view().percent, 100);
});

test('files of no size count as nothing until they are in', () => {
  const p = new LoadProgress(bytes({}), bytes({ 'sfx-charge': 0 }));
  assert.equal(p.view().percent, 0);
  p.finish('sfx-charge');
  assert.equal(p.view().percent, 100);
});

test("a sound weighs its first format the browser plays, as Phaser's loader picks it", () => {
  const files = { planet: 10, 'sfx-charge': { ogg: 30, mp3: 20 } };
  assert.deepEqual(fileSizes(files, () => true), bytes({ planet: 10, 'sfx-charge': 30 }));
  assert.deepEqual(fileSizes(files, (format) => format === 'mp3'), bytes({ planet: 10, 'sfx-charge': 20 }));
  assert.deepEqual(fileSizes(files, () => false), bytes({ planet: 10, 'sfx-charge': 0 }), 'a sound the loader skips');
});
