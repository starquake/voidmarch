import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { InputSnapshot } from './input.ts';
import { Sandbox } from './sandbox.ts';
import {
  BRAIN_ORDER_JITTER,
  BRAIN_REACTION_MAX,
  BRAIN_REACTION_MIN,
  MAX_TICKS_PER_FRAME,
  TICK_SECONDS,
  WEAPON_STATS,
} from './tuning.ts';

const input = (overrides: Partial<InputSnapshot> = {}): InputSnapshot => ({
  up: false,
  down: false,
  left: false,
  right: false,
  pointerX: 0,
  pointerY: -1000,
  fire: false,
  ...overrides,
});

test('advance runs whole ticks and carries the remainder', () => {
  const sandbox = new Sandbox();
  assert.equal(sandbox.advance(TICK_SECONDS * 2.5, input()).ticks, 2);
  assert.ok(Math.abs(sandbox.alpha - 0.5) < 1e-6);
  assert.equal(sandbox.advance(TICK_SECONDS * 0.6, input()).ticks, 1);
});

test('advance caps the ticks after a long stall', () => {
  const sandbox = new Sandbox();
  assert.equal(sandbox.advance(10, input()).ticks, MAX_TICKS_PER_FRAME);
});

test('holding W moves the ship up and remembers the previous position', () => {
  const sandbox = new Sandbox();
  const startY = sandbox.ship.y;
  sandbox.advance(0.5, input({ up: true }));
  assert.ok(sandbox.ship.y < startY);
  assert.ok(sandbox.previous.y > sandbox.ship.y);
});

test('a charging weapon reports the charge, then the shot', () => {
  const sandbox = new Sandbox();
  sandbox.ship.loadout.weapon = 'bigSpaceGun';
  const first = sandbox.advance(TICK_SECONDS, input({ fire: true }));
  assert.deepEqual(first.charges, ['bigSpaceGun']);
  assert.equal(first.shots.length, 0);

  let shots = 0;
  for (let t = 0; t < 1; t += TICK_SECONDS) {
    shots += sandbox.advance(TICK_SECONDS, input()).shots.length;
  }
  assert.equal(shots, 1);
});

test('firing spawns projectiles and reports shots and expiries', () => {
  const sandbox = new Sandbox();
  const events = sandbox.advance(TICK_SECONDS, input({ fire: true }));
  assert.equal(events.shots.length, 1);
  assert.equal(sandbox.projectiles.activeCount, 1);

  let expired = 0;
  for (let t = 0; t < WEAPON_STATS.autoCannon.lifetime + 0.2; t += TICK_SECONDS) {
    expired += sandbox.advance(TICK_SECONDS, input()).expired.length;
  }
  assert.equal(expired, 1);
});

test('ship-relative control is the default: W flies toward the aim', () => {
  const sandbox = new Sandbox();
  const startX = sandbox.ship.x;
  const aimRight = input({ up: true, pointerX: 10_000, pointerY: sandbox.ship.y });
  for (let i = 0; i < 30; i++) {
    sandbox.advance(TICK_SECONDS, aimRight);
  }
  assert.equal(sandbox.controlMode, 'ship');
  assert.ok(sandbox.ship.x > startX + 20);
});

test('screen-relative control: W flies up whatever the aim', () => {
  const sandbox = new Sandbox();
  sandbox.controlMode = 'screen';
  const start = { x: sandbox.ship.x, y: sandbox.ship.y };
  const aimRight = input({ up: true, pointerX: 10_000, pointerY: sandbox.ship.y });
  for (let i = 0; i < 30; i++) {
    sandbox.advance(TICK_SECONDS, aimRight);
  }
  assert.ok(sandbox.ship.y < start.y - 20);
  assert.ok(Math.abs(sandbox.ship.x - start.x) < 1e-9);
});

test('a companion flies with its owner and forgets a finished one-shot', () => {
  const sandbox = new Sandbox();
  const companion = sandbox.addCompanion(1, sandbox.ship.x + 150, sandbox.ship.y + 150);
  companion.orders = { ...companion.orders, oneShot: { kind: 'regroup' } };
  for (let t = 0; t < 3; t += TICK_SECONDS) {
    sandbox.advance(TICK_SECONDS, input());
  }
  assert.ok(Math.hypot(companion.ship.x - sandbox.ship.x, companion.ship.y - sandbox.ship.y) < 100, 'back in formation');
  assert.equal(companion.orders.oneShot, undefined);
});

test("a companion's shots carry its number, in the pool and the frame's shots", () => {
  const sandbox = new Sandbox();
  const companion = sandbox.addCompanion(2, sandbox.ship.x - 40, sandbox.ship.y + 40);
  companion.orders = { ...companion.orders, stance: 'aggressive' };
  const enemies = [{ id: 1, kind: 'scout' as const, x: sandbox.ship.x, y: sandbox.ship.y - 200, attackedWing: true }];
  const shots = [];
  for (let t = 0; t < 2; t += TICK_SECONDS) {
    shots.push(...sandbox.advance(TICK_SECONDS, input(), enemies).shots);
  }
  assert.ok(shots.length > 0, 'it fired');
  assert.ok(shots.every((s) => s.companion === 2), 'only the companion fired');
  const fired = sandbox.projectiles.items.filter((p) => p.active);
  assert.ok(fired.every((p) => p.owner === '2' && p.faction === 'own'));
});

test('the player keeps their own shots, numbered 0', () => {
  const sandbox = new Sandbox();
  assert.equal(sandbox.advance(TICK_SECONDS, input({ fire: true })).shots[0]?.companion, 0);
});

test('companions can be removed, and adding a number again replaces it', () => {
  const sandbox = new Sandbox();
  sandbox.addCompanion(1, 0, 0);
  sandbox.addCompanion(2, 0, 0);
  sandbox.addCompanion(1, 5, 5);
  assert.deepEqual(
    sandbox.companions.map((c) => c.number),
    [2, 1],
  );
  sandbox.removeCompanion(2);
  assert.deepEqual(
    sandbox.companions.map((c) => c.number),
    [1],
  );
});

test("removing a companion ends its shots in flight, and only its", () => {
  const sandbox = new Sandbox();
  sandbox.projectiles.spawn({ kind: 'autoCannon', x: 0, y: 0, angle: 0 }, { owner: '2' });
  sandbox.projectiles.spawn({ kind: 'autoCannon', x: 0, y: 0, angle: 0 }, { owner: '1' });
  sandbox.projectiles.spawn({ kind: 'autoCannon', x: 0, y: 0, angle: 0 });
  sandbox.removeCompanion(2);
  assert.deepEqual(
    sandbox.projectiles.items.filter((p) => p.active).map((p) => p.owner),
    ['1', ''],
  );
});

test('companions react late, each at its own pace', () => {
  const sandbox = new Sandbox();
  const companions = [1, 2, 3].map((n) => sandbox.addCompanion(n, 0, 200));
  const min = Math.round(BRAIN_REACTION_MIN / TICK_SECONDS);
  const max = Math.round(BRAIN_REACTION_MAX / TICK_SECONDS);
  for (const c of companions) {
    assert.ok(c.reactionTicks >= min && c.reactionTicks <= max, String(c.reactionTicks));
  }
  assert.ok(new Set(companions.map((c) => c.reactionTicks)).size > 1, 'not all the same');
});

test('an order arrives after the reaction time, not at once, and not for all at once', () => {
  const sandbox = new Sandbox();
  const companions = [1, 2, 3].map((n) => sandbox.addCompanion(n, 0, 200));
  for (const c of companions) {
    sandbox.order(c, { ...c.orders, stance: 'aggressive' });
    assert.equal(c.orders.stance, 'escort', 'not yet');
    assert.equal(sandbox.ordersFor(c).stance, 'aggressive', 'but on its way');
  }
  const arrived: number[] = [];
  for (let tick = 1; arrived.length < 3 && tick < 200; tick++) {
    sandbox.advance(TICK_SECONDS, input());
    for (const c of companions) {
      if (c.orders.stance === 'aggressive' && !arrived.includes(c.number)) {
        arrived.push(c.number);
        assert.ok(tick * TICK_SECONDS >= BRAIN_REACTION_MIN - 1e-9, 'no sooner than the fastest reaction');
        assert.ok(tick * TICK_SECONDS <= BRAIN_REACTION_MAX + BRAIN_ORDER_JITTER + TICK_SECONDS, 'no later than the slowest');
      }
    }
  }
  assert.equal(arrived.length, 3);
});

test('a companion follows where its owner was, a moment ago', () => {
  const sandbox = new Sandbox();
  const c = sandbox.addCompanion(1, sandbox.ship.x, sandbox.ship.y + 60);
  for (let t = 0; t < 1; t += TICK_SECONDS) {
    sandbox.advance(TICK_SECONDS, input());
  }
  // The owner jumps; for a few ticks the companion still steers for the old spot.
  const before = { vx: c.ship.vx, vy: c.ship.vy };
  sandbox.ship.x += 300;
  sandbox.advance(TICK_SECONDS, input());
  assert.ok(Math.abs(c.ship.vx - before.vx) < 20, 'no reaction on the next tick');
  for (let t = 0; t < BRAIN_REACTION_MAX + 0.1; t += TICK_SECONDS) {
    sandbox.advance(TICK_SECONDS, input());
  }
  assert.ok(c.ship.vx > 50, 'but heads after it once it has seen the move');
});
