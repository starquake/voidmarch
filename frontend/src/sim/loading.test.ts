import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LOAD_CATEGORIES, LoadProgress, codeView, loadCategory, loadRank, type LoadView } from './loading.ts';

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

test('the strip names the first category still loading, and counts every file', () => {
  const progress = new LoadProgress(['hull-damaged', 'hull-veryDamaged', 'klaed-bullet', 'planet', 'sfx-charge', 'rules', 'font-ui', 'font-heading']);
  let view = progress.view();
  assert.equal(view.label, 'Loading ships');
  assert.equal(view.percent, 0);
  assert.deepEqual(states(view), ['Ships:loading', 'Enemies:waiting', 'Space:waiting', 'Sounds:waiting']);

  progress.finish('hull-damaged');
  progress.finish('hull-veryDamaged');
  progress.finish('rules');
  view = progress.view();
  assert.equal(view.label, 'Loading enemies');
  assert.equal(view.percent, 37);
  assert.deepEqual(states(view), ['Ships:done', 'Enemies:loading', 'Space:waiting', 'Sounds:waiting']);

  // A later category can finish first: it's done, and the earlier one still loads.
  progress.finish('planet');
  assert.deepEqual(states(progress.view()), ['Ships:done', 'Enemies:loading', 'Space:done', 'Sounds:waiting']);
});

test('with only uncategorized files left it says Loading, below 100%', () => {
  const progress = new LoadProgress(['sfx-charge', 'font-ui']);
  progress.finish('sfx-charge');
  progress.finish('unknown');
  const view = progress.view();
  assert.equal(view.label, 'Loading');
  assert.equal(view.percent, 50);
  assert.deepEqual(states(view), ['Ships:done', 'Enemies:done', 'Space:done', 'Sounds:done']);
  assert.equal(progress.complete, false);
});

test('100% only once everything is in', () => {
  const keys = Array.from({ length: 1000 }, (_, i) => `sfx-${String(i)}`);
  const progress = new LoadProgress(keys);
  for (const key of keys.slice(1)) {
    progress.finish(key);
  }
  assert.equal(progress.view().percent, 99);
  progress.finish('sfx-0');
  assert.equal(progress.complete, true);
  assert.deepEqual(progress.view(), {
    label: 'Starting',
    percent: 100,
    categories: LOAD_CATEGORIES.map((category) => ({ category, name: category.charAt(0).toUpperCase() + category.slice(1), state: 'done' })),
  });
});

test('nothing to load is complete', () => {
  const progress = new LoadProgress([]);
  assert.equal(progress.complete, true);
  assert.equal(progress.view().percent, 100);
});

test("while the game's code downloads it says Loading game, with no percentage and every category to come", () => {
  const view = codeView();
  assert.equal(view.label, 'Loading game');
  assert.equal(view.percent, undefined);
  assert.deepEqual(states(view), ['Ships:waiting', 'Enemies:waiting', 'Space:waiting', 'Sounds:waiting']);
});
