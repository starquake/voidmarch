import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PARTS, PART_NAMES, nextPart, partLabel, tierCss, tierColor, tierFromPickup, withTiers, type PartId } from './parts.ts';
import { DEFAULT_LOADOUT, MAX_TIER, SHIELDS, WEAPONS } from './rules.gen.ts';

test('every part has a name, and the ids are unique', () => {
  assert.equal(PARTS.length, 12);
  assert.equal(new Set(PARTS).size, PARTS.length);
  for (const p of PARTS) {
    assert.ok(PART_NAMES[p].length > 0);
  }
});

test('a label puts the tier before the name', () => {
  assert.equal(partLabel('zapper', 0), 'Zapper');
  assert.equal(partLabel('zapper', 2), 'Mega Zapper');
  assert.equal(partLabel('burst', MAX_TIER), 'Hyper Burst Engine');
});

test('tiers have the mockup colors, plain none', () => {
  assert.equal(tierColor(0), undefined);
  assert.equal(tierColor(1), 0x5ad1ff);
  assert.equal(tierColor(2), 0xc77dff);
  assert.equal(tierColor(3), 0xffc93c);
  assert.equal(tierCss(0), '#d8f8ff');
  assert.equal(tierCss(3), '#ffc93c');
});

test('a pickup shows the tier it would give', () => {
  const unlocks = new Map<PartId, number>([
    ['autoCannon', 0],
    ['zapper', 2],
    ['rockets', MAX_TIER],
  ]);
  assert.equal(tierFromPickup(unlocks, 'bigSpaceGun'), 0);
  assert.equal(tierFromPickup(unlocks, 'autoCannon'), 1);
  assert.equal(tierFromPickup(unlocks, 'zapper'), 3);
  assert.equal(tierFromPickup(unlocks, 'rockets'), undefined);
});

test('a loadout takes the tiers the player owns', () => {
  const unlocks = new Map<PartId, number>([
    ['autoCannon', 2],
    ['front', 1],
  ]);
  assert.deepEqual(withTiers(DEFAULT_LOADOUT, unlocks), {
    ...DEFAULT_LOADOUT,
    weaponTier: 2,
    engineTier: 0,
    shieldTier: 1,
  });
});

test("a slot's key fits the next owned part, wrapping round (#191)", () => {
  const owned = new Map<PartId, number>([
    ['autoCannon', 0],
    ['zapper', 1],
    ['bigSpaceGun', 0],
  ]);
  assert.deepEqual(WEAPONS, ['autoCannon', 'rockets', 'bigSpaceGun', 'zapper']);
  assert.equal(nextPart(WEAPONS, 'autoCannon', owned), 'bigSpaceGun', 'rockets are skipped: not owned');
  assert.equal(nextPart(WEAPONS, 'bigSpaceGun', owned), 'zapper');
  assert.equal(nextPart(WEAPONS, 'zapper', owned), 'autoCannon', 'round to the first');
  assert.equal(nextPart(SHIELDS, 'front', owned), 'front', 'one owned part stays put');
  assert.equal(nextPart(WEAPONS, 'rockets', owned), 'bigSpaceGun', 'a fitted part not owned still moves on');
  assert.equal(nextPart(WEAPONS, 'autoCannon', undefined), 'rockets', 'every part where anything goes');
});
