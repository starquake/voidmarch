import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bootKeys } from './preload.ts';
import { LOAD_CATEGORIES, loadCategory } from './sim/loading.ts';
import { effectFiles } from './sounds.ts';
import { keys as spriteKeys, layerSheets, sheets } from './sprites.ts';

test('every key the boot scene loads has a category, so a new sheet or sound needs one', () => {
  for (const key of bootKeys()) {
    assert.notEqual(loadCategory(key), undefined, `${key} has no loading category`);
  }
});

test('the boot scene loads every sheet, pieced layer and sound effect, once', () => {
  const keys = bootKeys();
  const layers = layerSheets().flatMap((layer) => [layer.key, spriteKeys.layerLayout(layer.key)]);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(new Set(keys), new Set([...[...sheets(), ...effectFiles()].map((f) => f.key), ...layers]));
});

test('the boot scene loads the categories in the strip order', () => {
  const order = bootKeys().map((key) => LOAD_CATEGORIES.indexOf(loadCategory(key) ?? 'sounds'));
  assert.deepEqual(order, order.toSorted((a, b) => a - b));
  assert.deepEqual([...new Set(order)], [0, 1, 2, 3]);
});
