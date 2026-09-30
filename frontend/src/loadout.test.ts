import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fitPart, loadoutEntries, stepPart } from './loadout.ts';
import type { PartId } from './sim/parts.ts';
import { DEFAULT_LOADOUT } from './sim/rules.gen.ts';

const unlocks = new Map<PartId, number>([
  ['autoCannon', 0],
  ['zapper', 3],
  ['rockets', 1],
  ['base', 0],
  ['front', 0],
]);

test('a slot lists its parts: owned ones with their tier, locked ones dimmed', () => {
  const weapons = loadoutEntries('weapon', unlocks, DEFAULT_LOADOUT);
  assert.deepEqual(
    weapons.map((e) => [e.part, e.label, e.locked, e.fitted]),
    [
      ['autoCannon', 'Auto Cannon', false, true],
      ['rockets', 'Super Rockets', false, false],
      ['bigSpaceGun', 'Big Space Gun', true, false],
      ['zapper', 'Hyper Zapper', false, false],
    ],
  );
  assert.equal(weapons[2]?.hint, 'not found yet');
  assert.equal(weapons[3]?.color, '#ffc93c');
});

test('fitting a part takes the tier the player owns it at', () => {
  assert.deepEqual(fitPart(DEFAULT_LOADOUT, 'weapon', 'zapper', unlocks), { ...DEFAULT_LOADOUT, weapon: 'zapper', weaponTier: 3 });
  assert.equal(fitPart(DEFAULT_LOADOUT, 'shield', 'front', unlocks).shieldTier, 0);
  assert.equal(fitPart(DEFAULT_LOADOUT, 'engine', 'base', unlocks).engine, 'base');
});

test('the arrow keys step through the owned parts, wrapping and skipping locked ones', () => {
  assert.equal(stepPart('weapon', unlocks, DEFAULT_LOADOUT, 1), 'rockets');
  assert.equal(stepPart('weapon', unlocks, { ...DEFAULT_LOADOUT, weapon: 'rockets' }, 1), 'zapper');
  assert.equal(stepPart('weapon', unlocks, DEFAULT_LOADOUT, -1), 'zapper');
  assert.equal(stepPart('engine', unlocks, DEFAULT_LOADOUT, 1), undefined);
});
