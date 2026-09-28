import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_ORDERS, formationPoint, think, type BrainEnemy, type Orders } from './brain.ts';
import type { ShipCommand } from './input.ts';
import { seededRandom } from './math.ts';
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
  const random = seededRandom(7);
  for (let t = 0; t < seconds; t += TICK_SECONDS) {
    const step = think(
      { self, owner, slot: options.slot ?? 0, enemies: options.enemies ?? [] },
      options.orders ?? DEFAULT_ORDERS,
      random,
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
  const { command, done } = think({ self, owner, slot: 0, enemies: [] }, DEFAULT_ORDERS, seededRandom(1));
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

/** A companion at (x, y) facing (fx, fy), with its owner at the origin facing up. */
function facing(x: number, y: number, fx: number, fy: number): { self: Ship; owner: Ship } {
  const self = createShip(x, y);
  self.angle = Math.atan2(fy - y, fx - x);

  return { self, owner: createShip(0, 0) };
}

const enemy = (id: number, x: number, y: number, extra: Partial<BrainEnemy> = {}): BrainEnemy => ({
  id,
  kind: 'scout',
  x,
  y,
  attackedWing: false,
  ...extra,
});

const decide = (self: Ship, owner: Ship, enemies: BrainEnemy[], orders: Partial<Orders> = {}) =>
  think({ self, owner, slot: 0, enemies }, { ...DEFAULT_ORDERS, ...orders }, seededRandom(3));

test('escorting, a companion shoots an enemy near its owner once it faces it', () => {
  const { self, owner } = facing(-40, 40, 150, -150);
  const { command } = decide(self, owner, [enemy(1, 150, -150)]);
  assert.equal(command.fire, true);
  assert.ok(Math.abs(Math.atan2(command.aimY - self.y, command.aimX - self.x) - self.angle) < 0.1, 'aimed at it');

  self.angle += 1;
  assert.equal(decide(self, owner, [enemy(1, 150, -150)]).command.fire, false, 'not while facing away');
});

test('escorting, a companion ignores enemies far from its owner', () => {
  const { self, owner } = facing(-40, 40, 500, -300);
  assert.equal(decide(self, owner, [enemy(1, 500, -300)]).command.fire, false);
});

test('it fires only within its weapon range', () => {
  const { self, owner } = facing(-280, 280, 250, -250);
  const { command } = decide(self, owner, [enemy(1, 250, -250)]);
  assert.equal(command.fire, false, 'the auto cannon reaches about 470 px, this is 750');
});

test('aggressive, a companion hunts within its leash, the weakest first', () => {
  const { self, owner } = facing(-40, 40, 0, -400);
  const fighter = enemy(1, -100, -150, { kind: 'fighter' });
  const scout = enemy(2, 200, -350);
  const { command } = decide(self, owner, [fighter, scout], { stance: 'aggressive' });
  const aimAt = Math.atan2(command.aimY - self.y, command.aimX - self.x);
  assert.ok(Math.abs(aimAt - Math.atan2(scout.y - self.y, scout.x - self.x)) < 0.1, 'the Scout, though the Fighter is nearer');
  assert.ok(command.moveX > 0 && command.moveY < 0, 'flying toward it');

  const far = enemy(3, 0, -700);
  assert.equal(decide(self, owner, [far], { stance: 'aggressive' }).command.moveY >= 0, true, 'not past the leash');
});

test('an aggressive companion closes in on its target', () => {
  const self = createShip(-40, 40);
  const owner = createShip(0, 0);
  fly(self, owner, 3, { orders: { ...DEFAULT_ORDERS, stance: 'aggressive' }, enemies: [enemy(1, 250, -300)] });
  assert.ok(Math.abs(distance(self, { x: 250, y: -300 }) - 130) < 20, 'at attack distance');
});

test('return fire and the defensive stance shoot only attackers', () => {
  const { self, owner } = facing(-40, 40, 100, -100);
  const quiet = enemy(1, 100, -100);
  const attacker = enemy(2, 100, -100, { attackedWing: true });
  for (const orders of [{ fire: 'return' as const }, { stance: 'defensive' as const }]) {
    assert.equal(decide(self, owner, [quiet], orders).command.fire, false);
    assert.equal(decide(self, owner, [attacker], orders).command.fire, true);
  }
});

test('hold fire never fires, but a focus order does', () => {
  const { self, owner } = facing(-40, 40, 100, -100);
  const target = enemy(5, 100, -100, { attackedWing: true });
  assert.equal(decide(self, owner, [target], { fire: 'hold' }).command.fire, false);
  const focused = decide(self, owner, [target], { fire: 'hold', oneShot: { kind: 'focus', enemyId: 5 } });
  assert.equal(focused.command.fire, true);
  assert.equal(focused.done, false);
});

test('a focus order hunts its enemy anywhere and is done once it is gone', () => {
  const { self, owner } = facing(-40, 40, 0, -1000);
  const focus = { oneShot: { kind: 'focus' as const, enemyId: 9 } };
  const { command } = decide(self, owner, [enemy(9, 0, -900), enemy(1, 60, -60)], focus);
  assert.ok(command.moveY < 0, 'toward the focus target, past the nearer enemy');
  assert.equal(decide(self, owner, [enemy(1, 60, -60)], focus).done, true);
});

test('holding position, a companion shoots what its weapon reaches', () => {
  const { self, owner } = facing(-600, 0, -600, -300);
  const { command } = decide(self, owner, [enemy(1, -600, -300)], { stance: 'hold', holdX: -600, holdY: 0 });
  assert.equal(command.fire, true);
});

test('Support Ship priority changes nothing until Support Ships exist', () => {
  const { self, owner } = facing(-40, 40, 100, -100);
  const enemies = [enemy(1, 100, -100), enemy(2, -150, -100, { kind: 'fighter' })];
  assert.deepEqual(decide(self, owner, enemies, { supportFirst: true }), decide(self, owner, enemies));
});
