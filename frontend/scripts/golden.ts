/**
 * Writes internal/sim/testdata/golden.json: the TypeScript rules run over
 * fixed scenarios, which the Go port (internal/sim) replays and must match.
 * Run with `make golden`.
 */
import { writeFileSync } from 'node:fs';

import { DEFAULT_ORDERS, arrive, formationPoint, think, type BrainEnemy, type Orders } from '../src/sim/brain.ts';
import { ENEMY_KINDS } from '../src/sim/enemies.ts';
import { hitTargetAlong } from '../src/sim/hits.ts';
import type { InputSnapshot, ShipCommand } from '../src/sim/input.ts';
import { ENGINES, WEAPONS, type Loadout } from '../src/sim/loadout.ts';
import { normalize, rotateOffset, seededRandom, snapAngle, triangleWave, wrapAngle } from '../src/sim/math.ts';
import { enemyPattern } from '../src/sim/patterns.ts';
import { ProjectilePool, travelled, type ProjectileKind } from '../src/sim/projectiles.ts';
import { Sandbox } from '../src/sim/sandbox.ts';
import { createShip, stepShip, type Ship } from '../src/sim/ship.ts';
import { ENEMY_BULLET_STATS, TICK_SECONDS, WEAPON_STATS } from '../src/sim/tuning.ts';
import { stepWeapon } from '../src/sim/weapons.ts';
import { applyWorldEdge } from '../src/sim/world.ts';

const out = new URL('../../internal/sim/testdata/golden.json', import.meta.url);

const random = seededRandom(20260928);
const between = (min: number, max: number): number => min + random() * (max - min);

const shipState = (s: Ship): number[] => [s.x, s.y, s.vx, s.vy, s.angle, s.cooldown, s.charging, s.nextMuzzle];

const angles = Array.from({ length: 40 }, () => between(-20, 20));

const math = {
  wrapAngle: angles.map((a) => [a, wrapAngle(a)]),
  snapAngle: angles.flatMap((a) => [0, 8, 16].map((steps) => [a, steps, snapAngle(a, steps)])),
  normalize: [[0, 0], [3, 4], ...angles.map((a) => [a, between(-5, 5)])].map(([x = 0, y = 0]) => {
    const n = normalize(x, y);

    return [x, y, n.x, n.y];
  }),
  rotateOffset: angles.map((a) => {
    const [f, r] = [between(-50, 50), between(-50, 50)];
    const o = rotateOffset(f, r, a);

    return [f, r, a, o.x, o.y];
  }),
  triangleWave: Array.from({ length: 40 }, (_, i) => i * 0.0625).map((p) => [p, triangleWave(p)]),
  random: [0, 1, 0x5eed, 20260927, 4294967295].map((seed) => {
    const r = seededRandom(seed);

    return { seed, values: Array.from({ length: 12 }, () => r()) };
  }),
};

const command = (): ShipCommand => {
  const move = normalize(Math.round(between(-1, 1)), Math.round(between(-1, 1)));

  return { moveX: move.x, moveY: move.y, aimX: between(-400, 400), aimY: between(-400, 400), fire: random() < 0.7 };
};

/** Replays from a known start, so the Go side can build the same ship. */
const shipScenarios = ENGINES.flatMap((engine) =>
  [0, 16].map((snap) => {
    const x = between(-100, 100);
    const y = between(-100, 100);
    const ship = createShip(x, y, { weapon: 'autoCannon', engine, shield: 'front' });
    ship.rotationSnap = snap;
    const commands: ShipCommand[] = [];
    const states: number[][] = [];
    for (let t = 0; t < 120; t++) {
      const cmd = command();
      commands.push(cmd);
      stepShip(ship, cmd, TICK_SECONDS);
      states.push(shipState(ship));
    }

    return { engine, snap, x, y, commands, states };
  }),
);
const weapons = WEAPONS.map((weapon) => {
  const ship = createShip(0, 0, { weapon, engine: 'base', shield: 'front' });
  const ticks: { fire: boolean; angle: number; x: number; y: number }[] = [];
  const results: { chargeStarted: boolean; shots: number[][]; state: number[] }[] = [];
  for (let t = 0; t < 150; t++) {
    const tick = { fire: t % 50 < 35, angle: between(-4, 4), x: between(-50, 50), y: between(-50, 50) };
    ticks.push(tick);
    ship.angle = tick.angle;
    ship.x = tick.x;
    ship.y = tick.y;
    const step = stepWeapon(ship, tick.fire, TICK_SECONDS);
    results.push({
      chargeStarted: step.chargeStarted,
      shots: step.shots.map((s) => [s.muzzle, s.x, s.y, s.angle]),
      state: shipState(ship),
    });
  }

  return { weapon, ticks, results };
});

const kinds: ProjectileKind[] = [...WEAPONS, 'klaedBullet', 'klaedBigBullet'];
const projectiles = kinds.map((kind) => {
  const stats = kind in WEAPON_STATS ? WEAPON_STATS[kind as keyof typeof WEAPON_STATS] : ENEMY_BULLET_STATS[kind as keyof typeof ENEMY_BULLET_STATS];
  const pool = new ProjectilePool(4);
  const angle = between(-3, 3);
  const p = pool.spawn({ kind, x: between(-20, 20), y: between(-20, 20), angle });
  const origin = [p.originX, p.originY, angle];
  const trace: number[][] = [];
  for (let t = 0; t < 80; t++) {
    const expired = pool.step(TICK_SECONDS, () => true);
    trace.push([p.x, p.y, p.age, Number(expired.length > 0)]);
  }

  return { kind, origin, travelled: [0.1, 0.5, 1, 2].map((age) => [age, travelled(stats, age)]), trace };
});

const hits = Array.from({ length: 30 }, () => {
  const targets = Array.from({ length: 4 }, (_, id) => ({ id, x: between(-60, 60), y: between(-60, 60), radius: between(5, 15) }));
  const segment = [between(-80, 80), between(-80, 80), between(-80, 80), between(-80, 80)] as const;
  const hit = hitTargetAlong(segment[0], segment[1], segment[2], segment[3], targets);

  return { targets, segment, hit: hit?.id ?? -1 };
});

const worldEdge = Array.from({ length: 30 }, () => {
  const ship = createShip(between(-2100, 2100), between(-2100, 2100));
  ship.vx = between(-300, 300);
  ship.vy = between(-300, 300);
  const before = [ship.x, ship.y, ship.vx, ship.vy];
  applyWorldEdge(ship, TICK_SECONDS);

  return { before, after: [ship.x, ship.y, ship.vx, ship.vy] };
});

const patterns = ENEMY_KINDS.flatMap((kind) =>
  Array.from({ length: 8 }, () => {
    const [x, y, angle, seed] = [between(-300, 300), between(-300, 300), between(-4, 4), Math.floor(random() * 2 ** 32)];

    return { kind, x, y, angle, seed, bullets: enemyPattern(kind, x, y, angle, seed).map((b) => [b.x, b.y, b.angle]) };
  }),
);

const enemies = (n: number): BrainEnemy[] =>
  Array.from({ length: n }, (_, id) => ({
    id: id + 1,
    kind: ENEMY_KINDS[id % ENEMY_KINDS.length] ?? 'scout',
    x: between(-500, 500),
    y: between(-500, 500),
    attackedWing: random() < 0.5,
  }));

const orderSets: Orders[] = [
  { ...DEFAULT_ORDERS },
  { ...DEFAULT_ORDERS, stance: 'aggressive', supportFirst: true },
  { ...DEFAULT_ORDERS, stance: 'defensive', fire: 'return', resources: 'conserve' },
  { ...DEFAULT_ORDERS, stance: 'hold', holdX: 120, holdY: -80 },
  { ...DEFAULT_ORDERS, fire: 'hold', resources: 'conserve' },
  { ...DEFAULT_ORDERS, oneShot: { kind: 'regroup' } },
  { ...DEFAULT_ORDERS, oneShot: { kind: 'goHome' } },
  { ...DEFAULT_ORDERS, oneShot: { kind: 'shieldMe' } },
  { ...DEFAULT_ORDERS, stance: 'aggressive', oneShot: { kind: 'focus', enemyId: 2 } },
];

const weaponsForBrain: Loadout['weapon'][] = ['autoCannon', 'bigSpaceGun'];
const brain = orderSets.flatMap((orders, i) =>
  weaponsForBrain.map((weapon) => {
    const self = createShip(between(-200, 200), between(-200, 200), { weapon, engine: 'base', shield: 'front' });
    self.vx = between(-100, 100);
    self.vy = between(-100, 100);
    self.angle = between(-3, 3);
    self.damage = i % 4;
    const owner = { x: between(-200, 200), y: between(-200, 200), vx: between(-150, 150), vy: between(-150, 150), angle: between(-3, 3) };
    const view = { self, owner, slot: i % 4, enemies: enemies(5) };
    const seed = 1000 + i;
    const think1 = think(view, orders, seededRandom(seed));

    return {
      self: shipState(self).concat([self.damage]),
      weapon,
      owner,
      slot: view.slot,
      enemies: view.enemies,
      orders,
      seed,
      command: [think1.command.moveX, think1.command.moveY, think1.command.aimX, think1.command.aimY, Number(think1.command.fire)],
      done: think1.done,
      formation: [formationPoint(owner, view.slot).x, formationPoint(owner, view.slot).y],
      arrive: [arrive(self, { x: 0, y: 0 }).x, arrive(self, { x: 0, y: 0 }).y],
    };
  }),
);

/** The whole local world: a ship, three companions under changing orders, and enemies. */
const sandboxes = [0, 1].map((variant) => {
  const sandbox = new Sandbox();
  sandbox.controlMode = variant === 0 ? 'ship' : 'screen';
  for (let n = 1; n <= 3; n++) {
    sandbox.addCompanion(n, n * 30, 120);
  }
  const frames: { input: InputSnapshot; seconds: number; enemies: BrainEnemy[]; order: number }[] = [];
  const trace: { ship: number[]; companions: number[][]; shots: number[][]; ticks: number }[] = [];
  const field = enemies(6);
  for (let f = 0; f < 240; f++) {
    for (const e of field) {
      e.x += between(-3, 3);
      e.y += between(-3, 3);
    }
    const order = f % 60 === 10 ? Math.floor(f / 60) : -1;
    const input: InputSnapshot = {
      up: random() < 0.5,
      down: random() < 0.2,
      left: random() < 0.3,
      right: random() < 0.3,
      pointerX: between(-400, 400),
      pointerY: between(-400, 400),
      fire: random() < 0.6,
    };
    const seconds = between(0.01, 0.04);
    const snapshot = field.map((e) => ({ ...e }));
    frames.push({ input, seconds, enemies: snapshot, order });
    if (order >= 0) {
      const next = orderSets[(order * 2 + variant) % orderSets.length] ?? DEFAULT_ORDERS;
      for (const c of sandbox.companions) {
        sandbox.order(c, next);
      }
    }
    const events = sandbox.advance(seconds, input, snapshot);
    trace.push({
      ship: shipState(sandbox.ship),
      companions: sandbox.companions.map((c) => shipState(c.ship)),
      shots: events.shots.map((s) => [s.companion, s.id, s.x, s.y, s.angle]),
      ticks: events.ticks,
    });
  }

  return { controlMode: sandbox.controlMode, frames, trace };
});

writeFileSync(
  out,
  `${JSON.stringify({ math, ships: shipScenarios, weapons, projectiles, hits, worldEdge, patterns, brain, sandboxes, orderSets })}\n`,
);
