import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_ORDERS, formationPoint, think, type BrainEnemy, type Orders } from './brain.ts';
import type { ShipCommand } from './input.ts';
import { createShip, stepShip, type Ship } from './ship.ts';
import { BRAIN_IN_FORMATION, BRAIN_TIGHT_FORMATION, FORMATION_SLOTS, TICK_SECONDS } from './tuning.ts';

const still: ShipCommand = { moveX: 0, moveY: 0, aimX: 0, aimY: -1000, fire: false };

/** Steps a companion and its owner together for the given seconds. */
function fly(
  self: Ship,
  owner: Ship,
  seconds: number,
  options: { orders?: Orders; ownerCommand?: ShipCommand; enemies?: BrainEnemy[]; slot?: number } = {},
): void {
  for (let t = 0; t < seconds; t += TICK_SECONDS) {
    const step = think(
      { self, owner, slot: options.slot ?? 0, enemies: options.enemies ?? [] },
      options.orders ?? DEFAULT_ORDERS,
    );
    stepShip(self, step.command, TICK_SECONDS);
    stepShip(owner, options.ownerCommand ?? { ...still, aimX: owner.x, aimY: owner.y - 1000 }, TICK_SECONDS);
  }
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

test('formation slots sit behind the owner and turn with it', () => {
  const owner = createShip(0, 0);
  owner.angle = -Math.PI / 2;
  for (let slot = 0; slot < FORMATION_SLOTS.length; slot++) {
    assert.ok(formationPoint(owner, slot).y > 0, `slot ${String(slot)} is behind an owner facing up`);
  }
  assert.ok(formationPoint(owner, 0).x < 0 && formationPoint(owner, 1).x > 0, 'slots 0 and 1 are left and right');

  owner.angle = 0;
  assert.ok(formationPoint(owner, 2).x < 0, 'behind an owner facing right is to the left');
});

test('a companion settles into its slot and stays there', () => {
  const owner = createShip(0, 0);
  const self = createShip(220, 160);
  fly(self, owner, 3);
  assert.ok(distance(self, formationPoint(owner, 0)) < BRAIN_IN_FORMATION, 'in its slot');
  assert.ok(Math.hypot(self.vx, self.vy) < 30, 'and at rest');
});

test('each companion takes its own slot', () => {
  const owner = createShip(0, 0);
  const a = createShip(100, 100);
  const b = createShip(100, 100);
  fly(a, owner, 3, { slot: 0 });
  fly(b, owner, 3, { slot: 1 });
  assert.ok(distance(a, b) > 60);
});

test('a companion follows the owner through a turn', () => {
  const owner = createShip(0, 0);
  const self = createShip(0, 60);
  fly(self, owner, 2);
  owner.angle = 0;
  fly(self, owner, 3, { ownerCommand: { ...still, aimX: 1000, aimY: 0 } });
  assert.ok(distance(self, formationPoint(owner, 0)) < BRAIN_IN_FORMATION);
});

test('a companion keeps up with a flying owner', () => {
  const owner = createShip(0, 0);
  const self = createShip(0, 60);
  const flying: ShipCommand = { moveX: 1, moveY: 0, aimX: 10_000, aimY: 0, fire: false };
  fly(self, owner, 4, { ownerCommand: flying });
  assert.ok(distance(self, formationPoint(owner, 0)) < 40, 'within 40 px of its slot at full speed');
  fly(self, owner, 2);
  assert.ok(distance(self, formationPoint(owner, 0)) < BRAIN_IN_FORMATION, 'back in its slot once the owner stops');
});

test('with nothing to shoot, a companion holds fire and looks where the owner looks', () => {
  const owner = createShip(0, 0);
  owner.angle = 0;
  const self = createShip(-40, 40);
  const { command, done } = think({ self, owner, slot: 0, enemies: [] }, DEFAULT_ORDERS);
  assert.equal(command.fire, false);
  assert.ok(command.aimX > self.x && Math.abs(command.aimY - self.y) < 1);
  assert.equal(done, false);
});

test('the defensive stance flies a tighter formation', () => {
  const owner = createShip(0, 0);
  const self = createShip(100, 100);
  fly(self, owner, 3, { orders: { ...DEFAULT_ORDERS, stance: 'defensive' } });
  assert.ok(distance(self, formationPoint(owner, 0, BRAIN_TIGHT_FORMATION)) < BRAIN_IN_FORMATION);
  assert.ok(distance(self, owner) < distance(formationPoint(owner, 0), owner));
});

test('the hold stance stays at the hold point while the owner flies off', () => {
  const owner = createShip(0, 0);
  const self = createShip(0, 60);
  const orders: Orders = { ...DEFAULT_ORDERS, stance: 'hold', holdX: -150, holdY: 80 };
  fly(self, owner, 4, { orders, ownerCommand: { moveX: 1, moveY: 0, aimX: 10_000, aimY: 0, fire: false } });
  assert.ok(distance(self, { x: -150, y: 80 }) < BRAIN_IN_FORMATION);
  assert.ok(distance(self, owner) > 300);
});
