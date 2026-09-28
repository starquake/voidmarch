import assert from 'node:assert/strict';
import { test } from 'node:test';

import { create } from '@bufbuild/protobuf';

import { EnemyKind, ShipStateSchema, Weapon } from '../gen/voidmarch/v1/messages_pb.js';
import { ENGINES, SHIELDS, WEAPONS } from '../sim/loadout.ts';
import { createShip } from '../sim/ship.ts';
import { fromEnemyKind, fromShipState, fromWeapon, toShipState, toWeapon } from './mapping.ts';

test('every loadout survives the round trip through the wire', () => {
  for (const weapon of WEAPONS) {
    for (const engine of ENGINES) {
      for (const shield of SHIELDS) {
        const ship = createShip(12, -3, { weapon, engine, shield });
        ship.angle = 1.5;
        ship.thrusting = true;
        ship.damage = 2;
        const remote = fromShipState(toShipState(ship));
        assert.deepEqual(remote, { x: 12, y: -3, angle: 1.5, thrusting: true, loadout: { weapon, engine, shield }, damage: 2 });
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
