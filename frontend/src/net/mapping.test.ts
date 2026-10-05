import assert from 'node:assert/strict';
import { test } from 'node:test';

import { create } from '@bufbuild/protobuf';

import { CompanionMode, CompanionOneShot, EnemyFaction, EnemyKind, Engine, Shield, ShipStateSchema, UnlockSchema, Weapon } from '../gen/voidmarch/v1/messages_pb.js';
import { MODES } from '../ordermenu.ts';
import { ENGINES, SHIELDS, WEAPONS } from '../sim/loadout.ts';
import { MAX_TIER } from '../sim/rules.gen.ts';
import type { Ship } from '../simwasm.ts';
import {
  fromCompanionMode,
  fromCompanionOneShot,
  fromEnemyFaction,
  fromEnemyKind,
  fromLoadout,
  fromPart,
  fromShipState,
  fromUnlocks,
  fromWeapon,
  tierOf,
  toCompanionMode,
  toCompanionOneShot,
  toShipState,
  toWeapon,
} from './mapping.ts';

/** A ship at (x, y), at rest, with the default parts. */
const createShip = (x: number, y: number): Ship => ({
  x,
  y,
  vx: 0,
  vy: 0,
  angle: -Math.PI / 2,
  thrusting: false,
  loadout: { weapon: 'autoCannon', engine: 'base', shield: 'front', weaponTier: 0, engineTier: 0, shieldTier: 0 },
  damage: 0,
  shield: 3,
  sinceHit: 0,
  downFor: 0,
  revive: 0,
  cooldown: 0,
  charging: 0,
  nextMuzzle: 0,
  rotationSnap: 0,
});

test('every loadout survives the round trip through the wire', () => {
  for (const weapon of WEAPONS) {
    for (const engine of ENGINES) {
      for (const shield of SHIELDS) {
        const ship = { ...createShip(12, -3), loadout: { weapon, engine, shield, weaponTier: 3, engineTier: 2, shieldTier: 1 }, angle: 1.5, thrusting: true, damage: 2, shield: 1.5, revive: 0 };
        const remote = fromShipState(toShipState(ship));
        assert.deepEqual(remote, { x: 12, y: -3, vx: 0, vy: 0, angle: 1.5, thrusting: true, loadout: { weapon, engine, shield, weaponTier: 3, engineTier: 2, shieldTier: 1 }, damage: 2, shield: 1.5, revive: 0 });
      }
    }
  }
});

test('weapons map both ways', () => {
  for (const weapon of WEAPONS) {
    assert.equal(fromWeapon(toWeapon(weapon)), weapon);
  }
});

test('unknown or missing parts fall back to the defaults', () => {
  const remote = fromShipState(create(ShipStateSchema, { x: 1, damage: 99 }));
  assert.deepEqual(remote.loadout, { weapon: 'autoCannon', engine: 'base', shield: 'front', weaponTier: 0, engineTier: 0, shieldTier: 0 });
  assert.equal(remote.damage, 3);
  assert.equal(fromWeapon(Weapon.UNSPECIFIED), 'autoCannon');
});

test('enemy kinds map from the wire', () => {
  assert.equal(fromEnemyKind(EnemyKind.SCOUT), 'scout');
  assert.equal(fromEnemyKind(EnemyKind.FIGHTER), 'fighter');
  assert.equal(fromEnemyKind(EnemyKind.DREADNOUGHT), 'dreadnought');
  assert.equal(fromEnemyKind(EnemyKind.FRIGATE), 'frigate');
  assert.equal(fromEnemyKind(EnemyKind.BOMBER), 'bomber');
  assert.equal(fromEnemyKind(EnemyKind.TORPEDO), 'torpedo');
  assert.equal(fromEnemyKind(EnemyKind.SUPPORT), 'support');
  assert.equal(fromEnemyKind(EnemyKind.UNSPECIFIED), 'scout');
});

test('enemy factions map from the wire, unset as the Kla\'ed', () => {
  assert.equal(fromEnemyFaction(EnemyFaction.KLAED), 'klaed');
  assert.equal(fromEnemyFaction(EnemyFaction.NAIRAN), 'nairan');
  assert.equal(fromEnemyFaction(EnemyFaction.NAUTOLAN), 'nautolan');
  assert.equal(fromEnemyFaction(EnemyFaction.UNSPECIFIED), 'klaed');
});

test('modes and one-shots round-trip through the wire', () => {
  for (const mode of MODES) {
    assert.equal(fromCompanionMode(toCompanionMode(mode)), mode);
  }
  for (const oneShot of ['focus', 'regroup', 'goHome'] as const) {
    assert.equal(fromCompanionOneShot(toCompanionOneShot(oneShot)), oneShot);
  }
  assert.equal(fromCompanionMode(CompanionMode.UNSPECIFIED), undefined);
  assert.equal(fromCompanionOneShot(CompanionOneShot.UNSPECIFIED), undefined);
});

test('a wire tier above Hyper is held to Hyper', () => {
  assert.equal(tierOf(undefined), 0);
  assert.equal(tierOf(2), 2);
  assert.equal(tierOf(9), MAX_TIER);
});

test('wire parts and unlocks map to the sim ids', () => {
  const unlocks = fromUnlocks([
    create(UnlockSchema, { part: { kind: { case: 'weapon', value: Weapon.ZAPPER } }, tier: 2 }),
    create(UnlockSchema, { part: { kind: { case: 'engine', value: Engine.BURST } }, tier: 9 }),
    create(UnlockSchema, { part: { kind: { case: 'shield', value: Shield.ROUND } }, tier: 0 }),
    create(UnlockSchema, { tier: 1 }),
  ]);
  assert.deepEqual(
    [...unlocks],
    [
      ['zapper', 2],
      ['burst', MAX_TIER],
      ['round', 0],
    ],
  );
  assert.equal(fromPart(undefined), undefined);
});

test('a wire loadout maps with its tiers, and a missing one is the default', () => {
  assert.deepEqual(fromLoadout({ $typeName: 'voidmarch.v1.Loadout', weapon: Weapon.ZAPPER, engine: Engine.BURST, shield: Shield.ROUND, weaponTier: 3, engineTier: 1, shieldTier: 0 }), {
    weapon: 'zapper',
    engine: 'burst',
    shield: 'round',
    weaponTier: 3,
    engineTier: 1,
    shieldTier: 0,
  });
  assert.equal(fromLoadout(undefined).weapon, 'autoCannon');
});
