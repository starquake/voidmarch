import type Phaser from 'phaser';

import type { EnemyDestroyed, EnemyFired, Snapshot, Welcome } from '../gen/voidmarch/v1/messages_pb.js';
import { ServerClock } from '../net/clock.ts';
import type { WireFormat } from '../net/codec.ts';
import { Connection } from '../net/connection.ts';
import { INTERPOLATION_DELAY_TICKS, StateBuffer, type Pose } from '../net/interpolation.ts';
import { fromEnemyKind, fromShipState, fromWeapon, type RemoteShip } from '../net/mapping.ts';
import { TimedQueue } from '../net/remoteshots.ts';
import { weaponTiming } from '../sprites.ts';
import { ENEMY_RADIUS, type EnemyKind } from '../sim/enemies.ts';
import { hitTargetAlong } from '../sim/hits.ts';
import type { WeaponId } from '../sim/loadout.ts';
import { enemyPattern } from '../sim/patterns.ts';
import { isWeapon, positionAt } from '../sim/projectiles.ts';
import type { ShotSpawn } from '../sim/weapons.ts';
import type { FrameEvents, Sandbox } from '../sim/sandbox.ts';
import { ENEMY_SOUND_RANGE, ENEMY_VOLLEY_RANGE, SHIP_RADIUS, TICK_SECONDS, WEAPON_STATS } from '../sim/tuning.ts';
import { WeaponAnimator } from '../weaponframes.ts';
import type { ShipAudio } from './audio.ts';
import { EnemyView } from './enemyview.ts';
import { ShipView, type ShipParent } from './shipview.ts';

/** Where the game is with the server. */
export type NetStatus = 'connecting' | 'online' | 'offline' | 'full';

/** Another player's shot, waiting for the delayed timeline. */
interface RemoteShotItem {
  from: string;
  id: number;
  shot: ShotSpawn;
}

interface Remote {
  view: ShipView;
  buffer: StateBuffer<RemoteShip>;
  animator: WeaponAnimator;
  weapon: WeaponId;
  name: string;
  colour: number;
}

export interface NetPlayOptions {
  scene: Phaser.Scene;
  ships: ShipParent;
  sim: Sandbox;
  audio: ShipAudio;
  url: string;
  token: string;
  format: WireFormat;
  /** Text resolution for names, so they stay crisp at the camera's zoom. */
  labelResolution: () => number;
  /** The server forgot the token (it restarted); the player registers again. */
  onUnknownToken: () => void;
}

interface Enemy {
  view: EnemyView;
  buffer: StateBuffer<Pose>;
  /** The last snapshot tick it was in. */
  lastSeen: number;
  /** The tick it was shot down at, once the server said so. */
  destroyedAt: number | undefined;
}

/** Another player's shot that hit an enemy, waiting for the delayed timeline. */
interface ShotEnd {
  owner: string;
  shotId: number;
}

/** An enemy volley, waiting for the delayed timeline. */
interface EnemyVolley {
  enemyId: number;
  kind: EnemyKind;
  tick: number;
  seed: number;
  angle: number;
  /** Where the enemy was when the volley was announced, if it isn't known at tick. */
  x: number;
  y: number;
}

/** Where hits landed this frame, for sparks and flashes. */
export interface NetFrame {
  enemyHits: { x: number; y: number }[];
  hitsOnMe: { x: number; y: number }[];
}

/** An enemy as the E2E tests see it. */
export interface EnemyDebug {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
}

/** A remote player as the E2E tests see them. */
export interface RemoteDebug {
  id: string;
  name: string;
  colour: number;
  x: number;
  y: number;
}

const now = (): number => performance.now();

/**
 * Plays with others: sends the local ship and its shots, and draws everyone
 * else a moment in the past, their shots included, so both line up.
 */
export class NetPlay {
  status: NetStatus = 'connecting';
  playerId: string | undefined;
  private readonly options: NetPlayOptions;
  private readonly connection: Connection;
  private readonly remotes = new Map<string, Remote>();
  private readonly enemies = new Map<number, Enemy>();
  private enemyVolleys = new TimedQueue<EnemyVolley>(20);
  private enemyWarnings = new TimedQueue<number>(20);
  private destructions = new TimedQueue<EnemyDestroyed>(20);
  private shotEnds = new TimedQueue<ShotEnd>(20);
  private latestSnapshot = 0;
  private tickRate = 20;
  /** Enemies this player shot down, and enemy bullets that hit this ship. */
  enemiesDestroyed = 0;
  hitsTaken = 0;
  private clock = new ServerClock(20);
  private shots = new TimedQueue<RemoteShotItem>(20);
  private spawned = false;

  constructor(options: NetPlayOptions) {
    this.options = options;
    this.connection = new Connection({
      url: options.url,
      token: options.token,
      format: options.format,
      events: {
        welcome: (welcome) => {
          this.welcome(welcome);
        },
        snapshot: (snapshot) => {
          this.snapshot(snapshot);
        },
        shot: (remote) => {
          const shot = remote.shot;
          if (shot === undefined || !this.remotes.has(remote.playerId)) {
            return;
          }
          this.shots.add(remote.tick, {
            from: remote.playerId,
            id: shot.id,
            shot: { weapon: fromWeapon(shot.weapon), muzzle: shot.muzzle, x: shot.x, y: shot.y, angle: shot.angle },
          });
        },
        left: (playerId) => {
          this.remove(playerId);
        },
        full: () => {
          this.status = 'full';
        },
        unknownToken: () => {
          options.onUnknownToken();
        },
        disconnected: () => {
          if (this.status !== 'full') {
            this.status = 'offline';
          }
          for (const id of [...this.remotes.keys()]) {
            this.remove(id);
          }
          for (const [id, enemy] of this.enemies) {
            enemy.view.destroy(false);
            this.enemies.delete(id);
          }
          this.resetTimeline(this.tickRate);
          options.sim.projectiles.clear('remote');
          options.sim.projectiles.clear('enemy');
        },
        enemyFired: (fired) => {
          this.enemyFired(fired);
        },
        enemyDestroyed: (destroyed) => {
          const enemy = this.enemies.get(destroyed.enemyId);
          if (enemy !== undefined) {
            enemy.destroyedAt = destroyed.tick;
          }
          this.destructions.add(destroyed.tick, destroyed);
        },
        shotEnded: (ended) => {
          this.shotEnds.add(ended.tick, { owner: ended.playerId, shotId: ended.shotId });
        },
      },
    });
  }

  start(): void {
    this.connection.start();
  }

  stop(): void {
    this.connection.stop();
  }

  /** Other players, for the HUD and the E2E tests. */
  get others(): RemoteDebug[] {
    return [...this.remotes.entries()].map(([id, r]) => ({
      id,
      name: r.name,
      colour: r.colour,
      x: r.view.root.x,
      y: r.view.root.y,
    }));
  }

  /** Enemies as drawn, for the E2E tests. */
  get enemyList(): EnemyDebug[] {
    return [...this.enemies.entries()].map(([id, e]) => ({ id, kind: e.view.kind, x: e.view.x, y: e.view.y }));
  }

  /**
   * Once a frame: send the local ship, draw the others and the enemies, spawn
   * their shots, and test hits. Returns where hits landed.
   */
  update(events: FrameEvents): NetFrame {
    const frame: NetFrame = { enemyHits: [], hitsOnMe: [] };
    const nowMs = now();
    this.connection.sendState(this.options.sim.ship, nowMs);
    for (const shot of events.shots) {
      this.connection.sendShot(shot);
    }

    const serverTick = this.clock.tickAt(nowMs);
    if (serverTick === undefined) {
      return frame;
    }
    const renderTick = serverTick - INTERPOLATION_DELAY_TICKS;
    const seconds = nowMs / 1000;

    for (const remote of this.remotes.values()) {
      const ship = remote.buffer.sample(renderTick);
      if (ship === undefined) {
        continue;
      }
      if (ship.loadout.weapon !== remote.weapon) {
        remote.weapon = ship.loadout.weapon;
        remote.animator = new WeaponAnimator(weaponTiming(remote.weapon));
      }
      remote.view.setLoadout(ship.loadout);
      remote.view.setDamage(ship.damage);
      remote.view.setThrusting(ship.thrusting);
      remote.view.place(ship.x, ship.y, ship.angle);
      remote.view.weapon.setFrame(remote.animator.frame(seconds));
    }

    const volleys = new Set<string>();
    for (const { item: due, ageSeconds } of this.shots.due(renderTick)) {
      this.options.sim.projectiles.spawn(
        { kind: due.shot.weapon, x: due.shot.x, y: due.shot.y, angle: due.shot.angle },
        { ageSeconds, faction: 'remote', owner: due.from, shotId: due.id },
      );
      // Weapons that fire every muzzle at once (the zapper) get one sound per volley.
      const volley = WEAPON_STATS[due.shot.weapon].alternate ? undefined : `${due.from}:${due.shot.weapon}`;
      if (volley === undefined || !volleys.has(volley)) {
        this.options.audio.remoteShot(due.shot.weapon);
      }
      if (volley !== undefined) {
        volleys.add(volley);
      }
      const shooter = this.remotes.get(due.from);
      if (shooter !== undefined) {
        const stats = WEAPON_STATS[due.shot.weapon];
        shooter.animator.release(seconds, stats.alternate ? due.shot.muzzle : 0, stats.alternate ? stats.muzzles.length : 1);
      }
    }
    for (const { item: ended } of this.shotEnds.due(renderTick)) {
      this.options.sim.projectiles.end(ended.owner, ended.shotId);
    }

    this.drawEnemies(renderTick);
    this.testHits(frame, events.ticks * TICK_SECONDS);

    return frame;
  }

  private drawEnemies(renderTick: number): void {
    for (const enemy of this.enemies.values()) {
      const pose = enemy.buffer.sample(renderTick);
      if (pose !== undefined) {
        enemy.view.place(pose.x, pose.y, pose.angle);
      }
    }
    for (const { item: enemyId } of this.enemyWarnings.due(renderTick)) {
      this.enemies.get(enemyId)?.view.warn();
    }
    for (const { item: volley, ageSeconds } of this.enemyVolleys.due(renderTick)) {
      this.fireVolley(volley, ageSeconds);
    }
    for (const { item: destroyed } of this.destructions.due(renderTick)) {
      this.destroyEnemy(destroyed);
    }
    // Missing from a newer snapshot and passed on the timeline: it despawned.
    for (const [id, enemy] of this.enemies) {
      if (enemy.lastSeen < this.latestSnapshot && enemy.lastSeen < renderTick) {
        enemy.view.destroy(false);
        this.enemies.delete(id);
      }
    }
  }

  /**
   * Own shots against enemies as drawn, reported to the server (the design's
   * trust model); enemy bullets against the local ship, which only flash it
   * until health exists (#5). Each projectile is tested along the path it
   * flew during the frame's stepSeconds, so low frame rates don't skip hits.
   */
  private testHits(frame: NetFrame, stepSeconds: number): void {
    const targets = [...this.enemies.entries()].map(([id, e]) => ({
      id,
      x: e.view.x,
      y: e.view.y,
      radius: ENEMY_RADIUS[e.view.kind],
    }));
    const ship = this.options.sim.ship;
    const me = [{ id: 'me', x: ship.x, y: ship.y, radius: SHIP_RADIUS }];
    for (const p of this.options.sim.projectiles.items) {
      if (!p.active || p.faction === 'remote') {
        continue;
      }
      const from = positionAt(p, Math.max(0, p.age - stepSeconds));
      if (p.faction === 'own' && isWeapon(p.kind)) {
        const target = hitTargetAlong(from.x, from.y, p.x, p.y, targets);
        if (target !== undefined) {
          p.active = false;
          this.connection.sendHit(target.id, p.shotId, WEAPON_STATS[p.kind].damage);
          this.enemies.get(target.id)?.view.flash();
          frame.enemyHits.push({ x: p.x, y: p.y });
        }
      } else if (p.faction === 'enemy' && hitTargetAlong(from.x, from.y, p.x, p.y, me) !== undefined) {
        p.active = false;
        this.hitsTaken++;
        frame.hitsOnMe.push({ x: p.x, y: p.y });
      }
    }
  }

  /**
   * Spawns a volley's bullets from where the enemy is at its tick, unless it
   * was shot down first or is too far away to matter.
   */
  private fireVolley(volley: EnemyVolley, ageSeconds: number): void {
    const enemy = this.enemies.get(volley.enemyId);
    if (enemy === undefined || (enemy.destroyedAt !== undefined && enemy.destroyedAt < volley.tick)) {
      return;
    }
    const origin = enemy.buffer.sample(volley.tick) ?? volley;
    const ship = this.options.sim.ship;
    if (Math.hypot(origin.x - ship.x, origin.y - ship.y) > ENEMY_VOLLEY_RANGE) {
      return;
    }
    for (const bullet of enemyPattern(volley.kind, origin.x, origin.y, volley.angle, volley.seed)) {
      this.options.sim.projectiles.spawn(bullet, { ageSeconds, faction: 'enemy', owner: String(volley.enemyId) });
    }
    this.options.audio.enemyShot();
  }

  private enemyFired(fired: EnemyFired): void {
    this.enemyWarnings.add(fired.tick - fired.warnTicks, fired.enemyId);
    this.enemyVolleys.add(fired.tick, {
      enemyId: fired.enemyId,
      kind: fromEnemyKind(fired.kind),
      tick: fired.tick,
      seed: fired.seed,
      angle: fired.angle,
      x: fired.x,
      y: fired.y,
    });
  }

  private destroyEnemy(destroyed: EnemyDestroyed): void {
    const enemy = this.enemies.get(destroyed.enemyId);
    if (enemy === undefined) {
      return;
    }
    this.enemies.delete(destroyed.enemyId);
    const ship = this.options.sim.ship;
    if (Math.hypot(enemy.view.x - ship.x, enemy.view.y - ship.y) <= ENEMY_SOUND_RANGE) {
      this.options.audio.enemyDestroyed();
    }
    enemy.view.destroy(true);
    if (destroyed.byPlayerId === this.playerId) {
      this.enemiesDestroyed++;
    }
  }

  private welcome(welcome: Welcome): void {
    this.status = 'online';
    this.playerId = welcome.playerId;
    this.clock = new ServerClock(welcome.tickRate);
    this.tickRate = welcome.tickRate;
    this.resetTimeline(welcome.tickRate);
    this.clock.observe(welcome.tick, now());
    // A reconnect keeps the ship where it is; only the first join places it.
    if (!this.spawned) {
      this.spawned = true;
      const { ship, previous } = this.options.sim;
      ship.x = previous.x = welcome.spawnX;
      ship.y = previous.y = welcome.spawnY;
      ship.vx = 0;
      ship.vy = 0;
    }
  }

  /** Drops everything waiting for the delayed timeline. */
  private resetTimeline(tickRate: number): void {
    this.shots = new TimedQueue<RemoteShotItem>(tickRate);
    this.enemyVolleys = new TimedQueue<EnemyVolley>(tickRate);
    this.enemyWarnings = new TimedQueue<number>(tickRate);
    this.destructions = new TimedQueue<EnemyDestroyed>(tickRate);
    this.shotEnds = new TimedQueue<ShotEnd>(tickRate);
  }

  private snapshot(snapshot: Snapshot): void {
    this.clock.observe(snapshot.tick, now());
    this.latestSnapshot = snapshot.tick;
    for (const player of snapshot.players) {
      if (player.state === undefined) {
        continue;
      }
      const remote = this.remotes.get(player.playerId) ?? this.add(player.playerId, player.name, player.colour);
      remote.buffer.push(snapshot.tick, fromShipState(player.state));
    }

    for (const state of snapshot.enemies) {
      let enemy = this.enemies.get(state.enemyId);
      if (enemy === undefined) {
        enemy = {
          view: new EnemyView(this.options.scene, this.options.ships, fromEnemyKind(state.kind)),
          buffer: new StateBuffer<Pose>(),
          lastSeen: snapshot.tick,
          destroyedAt: undefined,
        };
        this.enemies.set(state.enemyId, enemy);
      }
      enemy.lastSeen = snapshot.tick;
      enemy.buffer.push(snapshot.tick, { x: state.x, y: state.y, angle: state.angle });
    }
  }

  private add(id: string, name: string, colour: number): Remote {
    const { scene, ships } = this.options;
    const view = new ShipView(scene, ships, 0, 0);
    view.setLabel(scene, ships, name, colour, this.options.labelResolution());
    const remote: Remote = {
      view,
      buffer: new StateBuffer<RemoteShip>(),
      animator: new WeaponAnimator(weaponTiming('autoCannon')),
      weapon: 'autoCannon',
      name,
      colour,
    };
    this.remotes.set(id, remote);

    return remote;
  }

  private remove(id: string): void {
    this.remotes.get(id)?.view.destroy();
    this.remotes.delete(id);
  }
}
