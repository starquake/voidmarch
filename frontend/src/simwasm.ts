/**
 * The browser's part of the sim: the player's ship and every projectile drawn,
 * run by the Go rules (internal/sim) compiled to WebAssembly (cmd/simwasm).
 * Only numbers cross; this module mirrors the state into objects the scenes
 * read, and turns their changes into calls.
 */
import {
  ENEMY_KINDS,
  ENGINES,
  FACTIONS,
  LAYOUT,
  MAX_DAMAGE,
  PROJECTILE_KINDS,
  RESPAWN_DELAY,
  SHIELDS,
  WEAPONS,
  type EnemyKind,
  type EngineId,
  type Faction,
  type ProjectileKind,
  type ShieldId,
  type WeaponId,
} from './sim/rules.gen.ts';
import { toCommand, type ControlMode, type InputSnapshot } from './sim/input.ts';
import type { Vec } from './sim/math.ts';

/** One part per slot; see docs/design.md, "Loadout". */
export interface Loadout {
  weapon: WeaponId;
  engine: EngineId;
  shield: ShieldId;
}

/** The player's ship, as the sim last left it. Change it through the Sandbox. */
export interface Ship {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** Facing in radians; 0 is +x, and y grows downward. */
  readonly angle: number;
  readonly thrusting: boolean;
  readonly loadout: Readonly<Loadout>;
  /** Hits taken: an index into DAMAGE_STATES. */
  readonly damage: number;
  /** Shield charges left, fractional while recharging. */
  readonly shield: number;
  /** Seconds since the last hit, absorbed or not. */
  readonly sinceHit: number;
  /** Seconds down, 0 while up (#47). */
  readonly downFor: number;
  /** A downed ship's revive progress, from 0 to 1. */
  readonly revive: number;
  readonly cooldown: number;
  readonly charging: number;
  readonly nextMuzzle: number;
  /** 0 for free rotation, else the number of facing directions. */
  readonly rotationSnap: number;
}

/** A projectile in flight, or a free slot. */
export interface Projectile {
  readonly slot: number;
  readonly active: boolean;
  readonly kind: ProjectileKind;
  readonly faction: Faction;
  /** The remote player or enemy it belongs to; empty for own shots. */
  readonly owner: string;
  readonly shotId: number;
  /** A burst's shard number, from 1; 0 for any other projectile (#72). */
  readonly shard: number;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly age: number;
}

/** A projectile to create: where, which way, and what it is. */
export interface ProjectileSpawn {
  kind: ProjectileKind;
  x: number;
  y: number;
  angle: number;
}

export interface SpawnOptions {
  /** Already this old: a shot seen late on the delayed timeline. */
  ageSeconds?: number;
  faction?: Faction;
  owner?: string;
  /** The shot's id for its owner; own shots get the next one. */
  shotId?: number;
}

/** A shot leaving the ship: where, which way, from which weapon and barrel. */
export interface ShotSpawn {
  weapon: WeaponId;
  muzzle: number;
  x: number;
  y: number;
  angle: number;
}

/** A shot the local ship fired, with its id in the projectile pool. */
export type FiredShot = ShotSpawn & { id: number };

/** What happened during one frame's ticks, for effects and sounds. */
export interface FrameEvents {
  ticks: number;
  /** Weapons whose charge started this frame. */
  charges: WeaponId[];
  shots: FiredShot[];
  /** Projectiles that ran out, with the shot and owner a burst is seeded from (#72). */
  expired: { kind: ProjectileKind; faction: Faction; x: number; y: number; shotId: number; owner: string }[];
}

/** Something a projectile can hit: a circle in world space. */
export interface Target<Id> {
  id: Id;
  x: number;
  y: number;
  radius: number;
}

/** A ship as enemy bullets meet it: a charged shield's arc, then the hull. */
export interface ShipTarget<Id> {
  id: Id;
  x: number;
  y: number;
  /** Facing in radians, which the shield's arc is centered on. */
  angle: number;
  shield: ShieldId;
  /** The shield's charges left. */
  charges: number;
}

/** A ship or enemy the local ship can bump into. */
export interface BumpBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Names the body for the ram cooldown: the same body, the same key. */
  key: number;
  /** +1 or -1: which way along x the ship goes when both sit on one point. */
  side: number;
  /** Set when it only pushes, never rams: the player's own companions (#68). */
  gentle?: boolean;
}

/** The exports of cmd/simwasm. */
interface Exports {
  memory?: WebAssembly.Memory;
  // Standard Go names its memory mem; TinyGo, memory.
  mem?: WebAssembly.Memory;
  statePointer(): number;
  scratchPointer(): number;
  advance(
    frameSeconds: number,
    moveX: number,
    moveY: number,
    aimX: number,
    aimY: number,
    fire: number,
    squadmateDistance: number,
    friendDistance: number,
  ): void;
  respawn(x: number, y: number): number;
  takeHit(from: number): number;
  shipScan(stepSeconds: number, n: number): number;
  setControlMode(screen: number): void;
  placeShip(x: number, y: number): void;
  setLoadout(weapon: number, engine: number, shield: number): void;
  setDamage(damage: number): void;
  setRotationSnap(steps: number): void;
  spawn(kind: number, faction: number, x: number, y: number, angle: number, age: number, shotId: number): number;
  deactivate(slot: number): void;
  clear(faction: number): void;
  hitsPointer(): number;
  hitScan(faction: number, stepSeconds: number, n: number): number;
  steer(faction: number, stepSeconds: number, n: number): void;
  burstSeed(n: number, shotId: number): number;
  burst(weapon: number, faction: number, x: number, y: number, shotId: number, seed: number, from: number): number;
  bump(n: number): number;
  enemyPattern(kind: number, x: number, y: number, angle: number, seed: number): number;
}

/** The Go runtime's JavaScript side, from wasm_exec.js (TinyGo's or standard Go's). */
export interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

const SCRATCH_SIZE = LAYOUT.scratchSize;
const PATTERN_SIZE = 4;

const at = <T>(list: readonly T[], i: number, fallback: T): T => list[i] ?? fallback;

/** Instantiates the module with a Go runtime and starts it; its exports then stay callable. */
export async function instantiate(bytes: BufferSource, go: GoRuntime): Promise<Exports> {
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  // main blocks forever, so run's promise never settles: don't wait for it.
  void go.run(instance);

  return instance.exports as unknown as Exports;
}

/** T with its fields writable, all the way down: the mirrors this module keeps up to date. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

/** The local world, stepped at a fixed rate by the WebAssembly sim. */
export class Sandbox {
  readonly ship: Ship;
  /** Ship position before the last tick, for smooth drawing between ticks. */
  readonly previous: Vec = { x: 0, y: 0 };
  readonly projectiles: Projectiles;
  private readonly exports: Exports;
  private mode: ControlMode = 'ship';
  private alphaValue = 0;
  private readonly shipState: Mutable<Ship>;

  constructor(exports: Exports) {
    this.exports = exports;
    this.shipState = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      thrusting: false,
      loadout: { weapon: WEAPONS[0], engine: ENGINES[0], shield: SHIELDS[0] },
      damage: 0,
      shield: 0,
      sinceHit: 0,
      downFor: 0,
      revive: 0,
      cooldown: 0,
      charging: 0,
      nextMuzzle: 0,
      rotationSnap: 0,
    };
    this.ship = this.shipState;
    this.projectiles = new Projectiles(this);
    this.read();
  }

  /** How far the display is between the last two ticks, from 0 to 1. */
  get alpha(): number {
    return this.alphaValue;
  }

  /** How WASD maps to movement; ship-relative unless the player switched. */
  get controlMode(): ControlMode {
    return this.mode;
  }

  set controlMode(mode: ControlMode) {
    this.mode = mode;
    this.exports.setControlMode(mode === 'screen' ? 1 : 0);
  }

  /**
   * Runs as many fixed ticks as frameSeconds covers, using the same input for
   * each. The nearest squadmate that is up decides the shield's formation
   * bonus, and it or any friendly ship that is up revives a downed ship.
   */
  advance(frameSeconds: number, input: InputSnapshot, squadmateDistance = Infinity, friendDistance = Infinity): FrameEvents {
    const cmd = toCommand(input);
    this.exports.advance(frameSeconds, cmd.moveX, cmd.moveY, cmd.aimX, cmd.aimY, cmd.fire ? 1 : 0, squadmateDistance, friendDistance);

    return this.read();
  }

  /** Applies a hit on the ship from direction from, as shipScan reports it; true when the shield took it. */
  takeHit(from: number): boolean {
    const absorbed = this.exports.takeHit(from) !== 0;
    this.read();

    return absorbed;
  }

  /** Whether the ship is down (#47). */
  get downed(): boolean {
    return this.ship.damage >= MAX_DAMAGE;
  }

  /** Whether the downed ship's player may respawn yet. */
  get canRespawn(): boolean {
    return this.downed && this.ship.downFor >= RESPAWN_DELAY;
  }

  /** Brings the downed ship back at (x, y), whole, once its player may; true when it did. */
  respawn(x: number, y: number): boolean {
    const done = this.exports.respawn(x, y) !== 0;
    this.read();

    return done;
  }

  /** Puts the ship at (x, y) at rest, as a spawn or a takeover does. */
  placeShip(x: number, y: number): void {
    this.exports.placeShip(x, y);
    this.read();
  }

  setLoadout(loadout: Loadout): void {
    this.exports.setLoadout(
      WEAPONS.indexOf(loadout.weapon),
      ENGINES.indexOf(loadout.engine),
      SHIELDS.indexOf(loadout.shield),
    );
    this.read();
  }

  setDamage(damage: number): void {
    this.exports.setDamage(damage);
    this.read();
  }

  setRotationSnap(steps: number): void {
    this.exports.setRotationSnap(steps);
    this.read();
  }

  /**
   * Tests every active projectile of the faction along the path it flew in
   * the last stepSeconds against the targets, ends the ones that hit, and
   * returns what hit what: one call for the frame.
   */
  hitScan<Id>(
    faction: Faction,
    stepSeconds: number,
    targets: readonly Target<Id>[],
  ): { projectile: Projectile; target: Target<Id>; goesOn: boolean }[] {
    const n = this.writeTargets(targets);
    const count = this.exports.hitScan(FACTIONS.indexOf(faction), stepSeconds, n);
    if (count === 0) {
      return [];
    }
    const pointer = this.exports.hitsPointer();
    const triples = new Float64Array(this.memory(), pointer, count * 3);
    const hits = Array.from({ length: count }, (_, i) => [triples[i * 3] ?? -1, triples[i * 3 + 1] ?? -1, triples[i * 3 + 2] === 1] as const);
    this.read();
    const out: { projectile: Projectile; target: Target<Id>; goesOn: boolean }[] = [];
    for (const [slot, index, goesOn] of hits) {
      const projectile = this.projectiles.items[slot];
      const target = targets[index];
      if (projectile !== undefined && target !== undefined) {
        out.push({ projectile, target, goesOn });
      }
    }

    return out;
  }

  /**
   * Turns the seeking projectiles of the faction toward the nearest of the
   * targets ahead of them, by at most their turn rate over stepSeconds (#72).
   */
  steer<Id>(faction: Faction, stepSeconds: number, targets: readonly Target<Id>[]): void {
    const n = this.writeTargets(targets);
    this.exports.steer(FACTIONS.indexOf(faction), stepSeconds, n);
    this.read();
  }

  /**
   * Scatters the star a shot of weapon bursts into where it ended, as
   * projectiles of the faction named by the shot's id and owner. The owner
   * seeds it, so every screen draws the same star. The shards pass the
   * enemies the shot in slot from hit. Returns the shards.
   */
  burst(weapon: WeaponId, faction: Faction, x: number, y: number, shotId: number, owner: string, from = -1): Projectile[] {
    const scratch = this.scratch();
    const units = Array.from(owner.slice(0, SCRATCH_SIZE), (_, i) => owner.charCodeAt(i));
    scratch.set(units);
    const seed = this.exports.burstSeed(units.length, shotId);
    const count = this.exports.burst(WEAPONS.indexOf(weapon), FACTIONS.indexOf(faction), x, y, shotId, seed >>> 0, from);
    const slots = Array.from(this.scratch().subarray(0, count));

    return this.projectiles.adopt(slots, faction === 'own' ? '' : owner);
  }

  /** Writes targets into scratch for a scan, and returns how many fit. */
  private writeTargets<Id>(targets: readonly Target<Id>[]): number {
    const n = Math.min(targets.length, LAYOUT.maxTargets);
    const scratch = this.scratch();
    for (let i = 0; i < n; i++) {
      const t = targets[i];
      if (t !== undefined) {
        scratch.set([t.x, t.y, t.radius, typeof t.id === 'number' ? t.id : i], i * LAYOUT.targetSize);
      }
    }

    return n;
  }

  /**
   * Tests every enemy bullet along the path it flew in the last stepSeconds
   * against the ships, a charged shield's arc before the hull, and ends the
   * ones that hit. Returns what hit which ship, and the direction of the
   * contact from it, for takeHit.
   */
  shipScan<Id>(
    stepSeconds: number,
    ships: readonly ShipTarget<Id>[],
  ): { projectile: Projectile; ship: ShipTarget<Id>; from: number }[] {
    const n = Math.min(ships.length, LAYOUT.maxTargets);
    const scratch = this.scratch();
    for (let i = 0; i < n; i++) {
      const s = ships[i];
      if (s !== undefined) {
        scratch.set([s.x, s.y, s.angle, SHIELDS.indexOf(s.shield), s.charges], i * LAYOUT.shipTargetSize);
      }
    }
    const count = this.exports.shipScan(stepSeconds, n);
    if (count === 0) {
      return [];
    }
    const triples = new Float64Array(this.memory(), this.exports.hitsPointer(), count * 3);
    const hits = Array.from({ length: count }, (_, i) => [triples[i * 3] ?? -1, triples[i * 3 + 1] ?? -1, triples[i * 3 + 2] ?? 0] as const);
    this.read();
    const out: { projectile: Projectile; ship: ShipTarget<Id>; from: number }[] = [];
    for (const [slot, index, from] of hits) {
      const projectile = this.projectiles.items[slot];
      const ship = ships[index];
      if (projectile !== undefined && ship !== undefined) {
        out.push({ projectile, ship, from });
      }
    }

    return out;
  }

  /**
   * Pushes the ship out of every body it overlaps and applies a hit for
   * each ram, from the rammed body's side. Returns the rams, by index into
   * bodies, and whether the shield took each.
   */
  bump(bodies: readonly BumpBody[]): { index: number; absorbed: boolean }[] {
    const n = Math.min(bodies.length, LAYOUT.maxTargets);
    const scratch = this.scratch();
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (b !== undefined) {
        scratch.set([b.x, b.y, b.radius, b.vx, b.vy, b.key, b.side, b.gentle === true ? 1 : 0], i * LAYOUT.bumpSize);
      }
    }
    const count = this.exports.bump(n);
    const rams: { index: number; absorbed: boolean }[] = [];
    if (count > 0) {
      const pairs = new Float64Array(this.memory(), this.exports.hitsPointer(), count * 2);
      for (let i = 0; i < count; i++) {
        rams.push({ index: pairs[i * 2] ?? -1, absorbed: pairs[i * 2 + 1] === 1 });
      }
    }
    this.read();

    return rams;
  }

  /** The bullets of an enemy's volley: pure and seeded, the same on every client. */
  enemyPattern(kind: EnemyKind, x: number, y: number, angle: number, seed: number): ProjectileSpawn[] {
    const n = this.exports.enemyPattern(ENEMY_KINDS.indexOf(kind), x, y, angle, seed >>> 0);
    const scratch = this.scratch();
    const out: ProjectileSpawn[] = [];
    for (let i = 0; i < n; i++) {
      const b = i * PATTERN_SIZE;
      out.push({
        kind: at(PROJECTILE_KINDS, scratch[b] ?? 0, PROJECTILE_KINDS[0]),
        x: scratch[b + 1] ?? x,
        y: scratch[b + 2] ?? y,
        angle: scratch[b + 3] ?? angle,
      });
    }

    return out;
  }

  /** The module's calls, for the projectile pool. */
  get calls(): Exports {
    return this.exports;
  }

  private memory(): ArrayBuffer {
    const memory = this.exports.memory ?? this.exports.mem;
    if (memory === undefined) {
      throw new Error('the sim module exports no memory');
    }

    return memory.buffer;
  }

  /**
   * The state array, viewed afresh: a call may have grown the memory, which
   * detaches older views. The pointer comes first for the same reason.
   */
  state(): Float64Array {
    const pointer = this.exports.statePointer();

    return new Float64Array(this.memory(), pointer, LAYOUT.stateSize);
  }

  private scratch(): Float64Array {
    const pointer = this.exports.scratchPointer();

    return new Float64Array(this.memory(), pointer, SCRATCH_SIZE);
  }

  /** Mirrors the state into the ship and projectiles, and returns the frame's events. */
  read(): FrameEvents {
    const s = this.state();
    const get = (i: number): number => s[i] ?? 0;
    const ship = this.shipState;
    ship.x = get(LAYOUT.shipX);
    ship.y = get(LAYOUT.shipY);
    ship.vx = get(LAYOUT.shipVX);
    ship.vy = get(LAYOUT.shipVY);
    ship.angle = get(LAYOUT.shipAngle);
    ship.thrusting = get(LAYOUT.shipThrusting) !== 0;
    ship.cooldown = get(LAYOUT.shipCooldown);
    ship.charging = get(LAYOUT.shipCharging);
    ship.nextMuzzle = get(LAYOUT.shipNextMuzzle);
    ship.damage = get(LAYOUT.shipDamage);
    ship.shield = get(LAYOUT.shipShieldCharge);
    ship.sinceHit = get(LAYOUT.shipSinceHit);
    ship.downFor = get(LAYOUT.shipDownFor);
    ship.revive = get(LAYOUT.shipRevive);
    ship.rotationSnap = get(LAYOUT.shipRotationSnap);
    ship.loadout.weapon = at(WEAPONS, get(LAYOUT.shipWeapon), WEAPONS[0]);
    ship.loadout.engine = at(ENGINES, get(LAYOUT.shipEngine), ENGINES[0]);
    ship.loadout.shield = at(SHIELDS, get(LAYOUT.shipShield), SHIELDS[0]);
    this.previous.x = get(LAYOUT.previousX);
    this.previous.y = get(LAYOUT.previousY);
    this.alphaValue = get(LAYOUT.alpha);
    this.projectiles.read(s);

    const events: FrameEvents = { ticks: get(LAYOUT.ticks), charges: [], shots: [], expired: [] };
    for (let i = 0; i < get(LAYOUT.shots); i++) {
      const b = LAYOUT.shotsOffset + i * LAYOUT.shotSize;
      events.shots.push({
        id: get(b + LAYOUT.shotId),
        weapon: at(WEAPONS, get(b + LAYOUT.shotWeapon), WEAPONS[0]),
        muzzle: get(b + LAYOUT.shotMuzzle),
        x: get(b + LAYOUT.shotX),
        y: get(b + LAYOUT.shotY),
        angle: get(b + LAYOUT.shotAngle),
      });
    }
    for (let i = 0; i < get(LAYOUT.charges); i++) {
      events.charges.push(at(WEAPONS, get(LAYOUT.chargesOffset + i), WEAPONS[0]));
    }
    for (let i = 0; i < get(LAYOUT.expired); i++) {
      const b = LAYOUT.expiredOffset + i * LAYOUT.expiredSize;
      events.expired.push({
        kind: at(PROJECTILE_KINDS, get(b + LAYOUT.expiredKind), PROJECTILE_KINDS[0]),
        faction: at(FACTIONS, get(b + LAYOUT.expiredFaction), FACTIONS[0]),
        x: get(b + LAYOUT.expiredX),
        y: get(b + LAYOUT.expiredY),
        shotId: get(b + LAYOUT.expiredShotId),
        owner: this.projectiles.ownerOf(get(b + LAYOUT.expiredSlot)),
      });
    }

    return events;
  }
}

/** The projectile pool, run by the sim; owners are kept here, since only numbers cross. */
export class Projectiles {
  readonly items: readonly Projectile[];
  private readonly slots: Mutable<Projectile>[];
  private readonly owners: string[];
  private readonly sandbox: Sandbox;

  constructor(sandbox: Sandbox) {
    this.sandbox = sandbox;
    this.slots = Array.from({ length: LAYOUT.projectileCapacity }, (_, slot) => ({
      slot,
      active: false,
      kind: PROJECTILE_KINDS[0],
      faction: FACTIONS[0],
      owner: '',
      shotId: 0,
      shard: 0,
      x: 0,
      y: 0,
      angle: 0,
      age: 0,
    }));
    this.owners = this.slots.map(() => '');
    this.items = this.slots;
  }

  get activeCount(): number {
    return this.slots.reduce((n, p) => n + Number(p.active), 0);
  }

  /** Starts a projectile and returns it. */
  spawn(shot: ProjectileSpawn, options: SpawnOptions = {}): Projectile {
    const faction = options.faction ?? 'own';
    const slot = this.sandbox.calls.spawn(
      PROJECTILE_KINDS.indexOf(shot.kind),
      FACTIONS.indexOf(faction),
      shot.x,
      shot.y,
      shot.angle,
      options.ageSeconds ?? 0,
      options.shotId ?? 0,
    );
    this.owners[slot] = options.owner ?? '';
    this.read(this.sandbox.state());
    const p = this.slots[slot];
    if (p === undefined) {
      throw new Error(`the sim refused to spawn ${shot.kind}`);
    }

    return p;
  }

  /** Ends a projectile, as a hit does. */
  deactivate(p: Projectile): void {
    this.sandbox.calls.deactivate(p.slot);
    this.read(this.sandbox.state());
  }

  /** Ends every projectile of a faction: the server's are gone once offline. */
  clear(faction: Faction): void {
    this.sandbox.calls.clear(FACTIONS.indexOf(faction));
    this.read(this.sandbox.state());
  }

  /** The remote owner of the projectile in slot, '' for an own shot. */
  ownerOf(slot: number): string {
    return this.owners[slot] ?? '';
  }

  /** Takes on projectiles the sim spawned itself, a burst's shards, for owner. */
  adopt(slots: readonly number[], owner: string): Projectile[] {
    for (const slot of slots) {
      this.owners[slot] = owner;
    }
    this.read(this.sandbox.state());

    return slots.map((slot) => this.slots[slot]).filter((p): p is Mutable<Projectile> => p !== undefined);
  }

  /** Ends a remote player's shot, or a shard of its burst, that hit something, and returns it. */
  end(owner: string, shotId: number, shard = 0): Projectile | undefined {
    const p = this.slots.find(
      (q) => q.active && q.faction === 'remote' && q.owner === owner && q.shotId === shotId && q.shard === shard,
    );
    if (p !== undefined) {
      this.deactivate(p);
    }

    return p;
  }

  /** Mirrors the pool from the state array. */
  read(s: Float64Array): void {
    for (const p of this.slots) {
      const b = LAYOUT.poolOffset + p.slot * LAYOUT.projectileSize;
      p.active = (s[b + LAYOUT.projectileActive] ?? 0) !== 0;
      p.kind = at(PROJECTILE_KINDS, s[b + LAYOUT.projectileKind] ?? 0, PROJECTILE_KINDS[0]);
      p.faction = at(FACTIONS, s[b + LAYOUT.projectileFaction] ?? 0, FACTIONS[0]);
      // Own shots are spawned inside the sim, so they own no name.
      p.owner = p.faction === 'own' ? '' : (this.owners[p.slot] ?? '');
      p.x = s[b + LAYOUT.projectileX] ?? 0;
      p.y = s[b + LAYOUT.projectileY] ?? 0;
      p.angle = s[b + LAYOUT.projectileAngle] ?? 0;
      p.age = s[b + LAYOUT.projectileAge] ?? 0;
      p.shotId = s[b + LAYOUT.projectileShotId] ?? 0;
      p.shard = s[b + LAYOUT.projectileShard] ?? 0;
    }
  }
}

/** Whether a projectile kind is a player weapon's shot. */
export function isWeapon(kind: ProjectileKind): kind is WeaponId {
  return (WEAPONS as readonly string[]).includes(kind);
}

let loaded: Sandbox | undefined;

/**
 * Fetches and starts the sim once, with the Go runtime the page loaded
 * (wasm/wasm_exec.js defines Go), and returns the page's one Sandbox.
 */
export async function loadSim(url: string): Promise<Sandbox> {
  if (loaded === undefined) {
    const Go = (globalThis as unknown as { Go?: new () => GoRuntime }).Go;
    if (Go === undefined) {
      throw new Error('wasm_exec.js did not load: no Go runtime');
    }
    const response = await fetch(url);
    loaded = new Sandbox(await instantiate(await response.arrayBuffer(), new Go()));
  }

  return loaded;
}

/** The page's Sandbox, once loadSim has run. */
export function sandbox(): Sandbox {
  if (loaded === undefined) {
    throw new Error('the sim is not loaded yet');
  }

  return loaded;
}
