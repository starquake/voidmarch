/**
 * Writes internal/sim/testdata/golden.json: the TypeScript rules run over
 * fixed scenarios, which the Go port (internal/sim) replays and must match.
 * Run with `make golden`; `make golden-check` (`--check`) compares a fresh
 * run with the committed file, allowing the last bits of a float.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { ENEMY_KINDS } from '../src/sim/enemies.ts';
import { hitTargetAlong } from '../src/sim/hits.ts';
import type { ShipCommand } from '../src/sim/input.ts';
import { ENGINES, WEAPONS } from '../src/sim/loadout.ts';
import { normalize, rotateOffset, seededRandom, snapAngle, triangleWave, wrapAngle } from '../src/sim/math.ts';
import { enemyPattern } from '../src/sim/patterns.ts';
import { ProjectilePool, travelled, type ProjectileKind } from '../src/sim/projectiles.ts';
import { createShip, stepShip, type Ship } from '../src/sim/ship.ts';
import { ENEMY_BULLET_STATS, TICK_SECONDS, WEAPON_STATS } from '../src/sim/tuning.ts';
import { stepWeapon } from '../src/sim/weapons.ts';
import { applyWorldEdge } from '../src/sim/world.ts';

const defaultOut = new URL('../../internal/sim/testdata/golden.json', import.meta.url);

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

/**
 * What the TypeScript still runs. The brain and the companions' sandbox runs
 * moved to the hub (#51); their recorded cases stay in the file, frozen, as
 * the Go tests' regression cases.
 */
const data = { math, ships: shipScenarios, weapons, projectiles, hits, worldEdge, patterns };

/** Where got and want first differ, allowing the last bits of a float to (as Math.sin may across platforms). */
function firstDifference(got: unknown, want: unknown, path: string): string | undefined {
  if (typeof got === 'number' && typeof want === 'number') {
    return Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)) ? undefined : `${path}: ${String(got)} != ${String(want)}`;
  }
  if (typeof got !== 'object' || got === null || typeof want !== 'object' || want === null) {
    return got === want ? undefined : `${path}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`;
  }
  const keys = new Set([...Object.keys(got), ...Object.keys(want)]);
  for (const key of keys) {
    const diff = firstDifference((got as Record<string, unknown>)[key], (want as Record<string, unknown>)[key], `${path}.${key}`);
    if (diff !== undefined) {
      return diff;
    }
  }

  return undefined;
}

const committed = JSON.parse(readFileSync(defaultOut, 'utf8')) as Record<string, unknown>;
if (process.argv[2] === '--check') {
  // A JSON round trip, so undefined fields drop out as they do in the file.
  const fresh = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const recorded = Object.fromEntries(Object.keys(fresh).map((key) => [key, committed[key]]));
  const diff = firstDifference(fresh, recorded, 'golden');
  if (diff !== undefined) {
    console.error(`the golden cases are stale (${diff}): change internal/sim to match, then run make golden`);
    process.exit(1);
  }
} else {
  writeFileSync(process.argv[2] ?? defaultOut, `${JSON.stringify({ ...committed, ...data })}\n`);
}
