import assert from 'node:assert/strict';
import { test } from 'node:test';

import { create } from '@bufbuild/protobuf';

import { CompanionMode, CompanionOneShot, EnemyKind, ShipStateSchema, Weapon } from '../gen/voidmarch/v1/messages_pb.js';
import { MODES } from '../ordermenu.ts';
import { ENGINES, SHIELDS, WEAPONS } from '../sim/loadout.ts';
import type { Ship } from '../simwasm.ts';
import {
  fromCompanionMode,
  fromCompanionOneShot,
  fromEnemyKind,
  fromShipState,
  fromWeapon,
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
  loadout: { weapon: 'autoCannon', engine: 'base', shield: 'front' },
  damage: 0,
  shield: 3,
  sinceHit: 0,
  cooldown: 0,
  charging: 0,
  nextMuzzle: 0,
  rotationSnap: 0,
});

test('every loadout survives the round trip through the wire', () => {
  for (const weapon of WEAPONS) {
    for (const engine of ENGINES) {
      for (const shield of SHIELDS) {
        const ship = { ...createShip(12, -3), loadout: { weapon, engine, shield }, angle: 1.5, thrusting: true, damage: 2, shield: 1.5 };
        const remote = fromShipState(toShipState(ship));
        assert.deepEqual(remote, { x: 12, y: -3, angle: 1.5, thrusting: true, loadout: { weapon, engine, shield }, damage: 2, shield: 1.5 });
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
  assert.deepEqual(remote.loadout, { weapon: 'autoCannon', engine: 'base', shield: 'front' });
  assert.equal(remote.damage, 3);
  assert.equal(fromWeapon(Weapon.UNSPECIFIED), 'autoCannon');
});

test('enemy kinds map from the wire', () => {
  assert.equal(fromEnemyKind(EnemyKind.SCOUT), 'scout');
  assert.equal(fromEnemyKind(EnemyKind.FIGHTER), 'fighter');
  assert.equal(fromEnemyKind(EnemyKind.UNSPECIFIED), 'scout');
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
