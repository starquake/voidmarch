import type Phaser from 'phaser';

import type {
  EnemyDestroyed,
  EnemyFired,
  Snapshot,
  SquadronInfo,
  SquadronJoined,
  SquadronOrdered,
  Squadrons,
  Welcome,
} from '../gen/voidmarch/v1/messages_pb.js';
import { CompanionMode, CompanionOneShot } from '../gen/voidmarch/v1/messages_pb.js';
import { ServerClock } from '../net/clock.ts';
import type { WireFormat } from '../net/codec.ts';
import { Connection } from '../net/connection.ts';
import { INTERPOLATION_DELAY_TICKS, StateBuffer, type Pose } from '../net/interpolation.ts';
import {
  fromCompanionMode,
  fromCompanionOneShot,
  fromEnemyKind,
  fromShipState,
  fromWeapon,
  toCompanionMode,
  toCompanionOneShot,
  type RemoteShip,
} from '../net/mapping.ts';
import { ORDER_ITEMS, type OrderContext, type OrderItem } from '../ordermenu.ts';
import { loadLastSquadron, saveLastSquadron } from '../settings.ts';
import { squadronChoices, type SquadronScreen } from '../squadrons.ts';
import { TimedQueue } from '../net/remoteshots.ts';
import { weaponTiming } from '../sprites.ts';
import { ENEMY_RADIUS, type EnemyKind } from '../sim/enemies.ts';
import type { WeaponId } from '../sim/loadout.ts';
import { isWeapon, type FrameEvents, type Sandbox, type ShotSpawn } from '../simwasm.ts';
import {
  ENEMY_SOUND_RANGE,
  ENEMY_VOLLEY_RANGE,
  SAFE_ZONE_RADIUS,
  SHIP_RADIUS,
  TICK_SECONDS,
  WEAPON_STATS,
} from '../sim/tuning.ts';
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
  /** Set for another player's companion: its owner's id. */
  ownerId: string;
  /** The squadron shown in a player's label. */
  squadron: string;
}

/** How long a notice (a refused summon, a companion sent home) stays in the HUD. */
const NOTICE_MS = 4000;

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
  /** Where the player picks a squadron when there's one to pick. */
  squadronScreen: SquadronScreen;
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
  /** Set for a companion: its owner's player id. */
  ownerId: string;
}

const now = (): number => performance.now();

/** A player's name label, with their squadron once they have one. */
const playerLabel = (name: string, squadron: string): string => (squadron === '' ? name : `${name} · ${squadron}`);

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
  lastEnemyDestroyed: number | undefined;
  hitsTaken = 0;
  /** Enemies this player's companions shot down. */
  companionKills = 0;
  /** The enemy the player last hit, and when (performance.now() ms): what they're shooting at. */
  lastHit: { id: number; atMs: number } | undefined;
  /** How many companions the server allows each player. */
  companionLimit = 0;
  /** The squadrons as the server last listed them, and the player's own, "" before choosing. */
  squadrons: Squadrons | undefined;
  squadron = '';
  private notice: { text: string; untilMs: number } | undefined;
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
          // A companion can fire before its first snapshot arrives; its owner is known by then.
          const owner = remote.playerId.split('/')[0] ?? '';
          if (shot === undefined || (!this.remotes.has(remote.playerId) && !this.remotes.has(owner))) {
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
        companionGranted: () => {
          // The hub flies it: it arrives in the next snapshot like any ship.
        },
        companionRefused: (reason) => {
          this.say(reason);
        },
        squadrons: (list) => {
          this.squadrons = list;
          if (options.squadronScreen.open) {
            options.squadronScreen.update(list);
          }
        },
        squadronJoined: (joined) => {
          this.squadronJoined(joined);
        },
        squadronRefused: (reason) => {
          options.squadronScreen.showError(reason);
        },
        squadronOrdered: (ordered) => {
          this.squadronOrdered(ordered);
        },
        companionDismissed: (number, takenBy) => {
          this.say(takenBy === '' ? `companion ${String(number)} went home` : `${takenBy} took over companion ${String(number)}`);
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

  /** Other players and their companions, for the HUD and the E2E tests. */
  get others(): RemoteDebug[] {
    return [...this.remotes.entries()].map(([id, r]) => ({
      id,
      name: r.name,
      colour: r.colour,
      x: r.view.root.x,
      y: r.view.root.y,
      ownerId: r.ownerId,
    }));
  }

  /** The latest notice for the HUD, while it lasts. */
  get noticeText(): string | undefined {
    return this.notice !== undefined && now() < this.notice.untilMs ? this.notice.text : undefined;
  }

  /** Companion ships waiting in the shared hangar, once the server has listed them. */
  get hangar(): number | undefined {
    return this.squadrons?.hangar;
  }

  /** How many companions the player has out, as the server last listed them. */
  get companionCount(): number {
    return this.squadronInfo?.members.find((m) => m.playerId === this.playerId)?.companions ?? 0;
  }

  /** The player's squadron as the server last listed it. */
  get squadronInfo(): SquadronInfo | undefined {
    return this.squadrons?.squadrons.find((s) => s.name === this.squadron);
  }

  /** Sends the player's order to the squadron, whose other players see it as a callout. */
  orderSquadron(item: OrderItem, context: OrderContext): void {
    this.connection.sendSquadronOrder({
      mode: item.kind === 'mode' ? toCompanionMode(item.mode) : CompanionMode.UNSPECIFIED,
      oneShot: item.kind === 'oneShot' ? toCompanionOneShot(item.oneShot) : CompanionOneShot.UNSPECIFIED,
      x: context.pointX,
      y: context.pointY,
      focusEnemyId: context.focusEnemyId ?? 0,
    });
  }

  /** Asks the server for a companion, or says why there can't be one. */
  summon(): void {
    const { ship } = this.options.sim;
    if (this.status !== 'online') {
      this.say('companions need the server');
    } else if (this.companionCount >= this.companionLimit) {
      this.say('all your companions are already out');
    } else if (Math.hypot(ship.x, ship.y) > SAFE_ZONE_RADIUS) {
      this.say('summon companions at the home planet');
    } else if (this.hangar === 0) {
      this.say('the hangar is empty');
    } else {
      this.connection.sendSummon();
    }
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
    const seconds = nowMs / 1000;
    this.connection.sendState(this.options.sim.ship, nowMs);
    for (const shot of events.shots) {
      this.connection.sendShot(shot);
    }

    const serverTick = this.clock.tickAt(nowMs);
    if (serverTick === undefined) {
      return frame;
    }
    const renderTick = serverTick - INTERPOLATION_DELAY_TICKS;

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

  /**
   * Everyone flies in a squadron: with squadrons to choose from the player
   * picks on the join screen, and with none they start their own.
   */
  private pickSquadron(list: Squadrons | undefined): void {
    if (list === undefined || squadronChoices(list).choices.length === 0) {
      this.connection.sendChooseSquadron('');

      return;
    }
    this.options.squadronScreen.show(list, loadLastSquadron(), (name) => {
      this.connection.sendChooseSquadron(name);
    });
  }

  /** In a squadron now; a takeover puts the ship where the companion was. */
  private squadronJoined(joined: SquadronJoined): void {
    this.options.squadronScreen.hide();
    this.squadron = joined.name;
    saveLastSquadron(joined.name);
    if (joined.tookOver) {
      this.options.sim.placeShip(joined.x, joined.y);
    }
  }

  /** A squadmate's order, as a callout: the hub gives it to every companion. */
  private squadronOrdered(ordered: SquadronOrdered): void {
    const order = ordered.order;
    if (order === undefined) {
      return;
    }
    const mode = fromCompanionMode(order.mode);
    const oneShot = fromCompanionOneShot(order.oneShot);
    const item = ORDER_ITEMS.find(
      (i) => (i.kind === 'mode' && i.mode === mode) || (i.kind === 'oneShot' && i.oneShot === oneShot),
    );
    if (item !== undefined) {
      this.say(`${ordered.name}: ${item.label}`);
    }
  }

  /** Shows a notice in the HUD for a few seconds. */
  say(text: string): void {
    this.notice = { text, untilMs: now() + NOTICE_MS };
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
    // One shot down waits for its destruction instead: the hub's companions
    // shoot during a tick, so its snapshot already lacks the enemy.
    for (const [id, enemy] of this.enemies) {
      if (enemy.destroyedAt === undefined && enemy.lastSeen < this.latestSnapshot && enemy.lastSeen < renderTick) {
        enemy.view.destroy(false);
        this.enemies.delete(id);
      }
    }
  }

  /** The player's companions as drawn: the hub flies them, so they come in snapshots. */
  private ownCompanions(): Remote[] {
    return [...this.remotes.values()].filter((r) => r.ownerId !== '' && r.ownerId === this.playerId);
  }

  /**
   * The player's shots against enemies as drawn, reported to the server (the
   * design's trust model); enemy bullets against the local ship and the
   * player's companions, which only flash them until health exists (#5). The
   * hub tests the companions' own shots. Each projectile is tested along the
   * path it flew during the frame's stepSeconds, so low frame rates don't skip
   * hits.
   */
  private testHits(frame: NetFrame, stepSeconds: number): void {
    const targets = [...this.enemies.entries()].map(([id, e]) => ({
      id,
      x: e.view.x,
      y: e.view.y,
      radius: ENEMY_RADIUS[e.view.kind],
    }));
    const { ship } = this.options.sim;
    // The player's own ship, then their companions as drawn.
    const companions = this.ownCompanions();
    const wing = [
      { id: -1, x: ship.x, y: ship.y, radius: SHIP_RADIUS },
      ...companions.map((c, i) => ({ id: i, x: c.view.root.x, y: c.view.root.y, radius: SHIP_RADIUS })),
    ];
    for (const p of this.options.sim.projectiles.items) {
      if (!p.active || p.faction === 'remote') {
        continue;
      }
      const from = this.options.sim.positionAt(p, Math.max(0, p.age - stepSeconds));
      if (p.faction === 'own' && isWeapon(p.kind)) {
        const target = this.options.sim.hitTargetAlong(from.x, from.y, p.x, p.y, targets);
        if (target !== undefined) {
          this.options.sim.projectiles.deactivate(p);
          this.lastHit = { id: target.id, atMs: now() };
          this.connection.sendHit(target.id, p.shotId, WEAPON_STATS[p.kind].damage);
          this.enemies.get(target.id)?.view.flash();
          frame.enemyHits.push({ x: p.x, y: p.y });
        }
      } else if (p.faction === 'enemy') {
        const hit = this.options.sim.hitTargetAlong(from.x, from.y, p.x, p.y, wing);
        if (hit === undefined) {
          continue;
        }
        this.options.sim.projectiles.deactivate(p);
        if (hit.id === -1) {
          this.hitsTaken++;
          frame.hitsOnMe.push({ x: p.x, y: p.y });
        } else {
          companions[hit.id]?.view.flash(this.options.scene);
          frame.enemyHits.push({ x: p.x, y: p.y });
        }
      }
    }
  }

  /** Whether a point is within range of the player or one of their companions. */
  private nearWing(x: number, y: number, range: number): boolean {
    const { ship } = this.options.sim;
    const ships = [{ x: ship.x, y: ship.y }, ...this.ownCompanions().map((c) => ({ x: c.view.root.x, y: c.view.root.y }))];

    return ships.some((s) => Math.hypot(s.x - x, s.y - y) <= range);
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
    // Companions can be far from the player (holding a point), and enemies fire at them too.
    if (!this.nearWing(origin.x, origin.y, ENEMY_VOLLEY_RANGE)) {
      return;
    }
    for (const bullet of this.options.sim.enemyPattern(volley.kind, origin.x, origin.y, volley.angle, volley.seed)) {
      this.options.sim.projectiles.spawn(bullet, { ageSeconds, faction: 'enemy', owner: String(volley.enemyId) });
    }
    const ship = this.options.sim.ship;
    if (Math.hypot(origin.x - ship.x, origin.y - ship.y) <= ENEMY_VOLLEY_RANGE) {
      this.options.audio.enemyShot();
    }
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
      this.lastEnemyDestroyed = destroyed.enemyId;
    } else if (this.playerId !== undefined && destroyed.byPlayerId.startsWith(`${this.playerId}/`)) {
      this.companionKills++;
    }
  }

  private welcome(welcome: Welcome): void {
    this.status = 'online';
    this.playerId = welcome.playerId;
    this.companionLimit = welcome.companionLimit;
    this.squadrons = welcome.squadrons;
    this.squadron = welcome.squadron;
    if (welcome.squadron === '') {
      this.pickSquadron(welcome.squadrons);
    }
    this.clock = new ServerClock(welcome.tickRate);
    this.tickRate = welcome.tickRate;
    this.resetTimeline(welcome.tickRate);
    this.clock.observe(welcome.tick, now());
    // A reconnect keeps the ship where it is; only the first join places it.
    if (!this.spawned) {
      this.spawned = true;
      this.options.sim.placeShip(welcome.spawnX, welcome.spawnY);
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
      const remote =
        this.remotes.get(player.playerId) ??
        this.add(player.playerId, player.name, player.colour, player.ownerId, player.squadron);
      if (player.ownerId === '' && remote.squadron !== player.squadron) {
        remote.squadron = player.squadron;
        remote.view.setLabel(
          this.options.scene,
          this.options.ships,
          playerLabel(player.name, player.squadron),
          player.colour,
          this.options.labelResolution(),
        );
      }
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

  /** A remote ship: another player, or (with an owner) one of their companions. */
  private add(id: string, name: string, colour: number, ownerId: string, squadron: string): Remote {
    const { scene, ships } = this.options;
    const view = new ShipView(scene, ships, 0, 0);
    // A companion's seat is "<owner>/<n>": tinted in its owner's colour, labelled "name n".
    const label = ownerId === '' ? playerLabel(name, squadron) : `${name} ${id.slice(ownerId.length + 1)}`;
    if (ownerId !== '') {
      view.setTint(colour);
    }
    view.setLabel(scene, ships, label, colour, this.options.labelResolution());
    const remote: Remote = {
      view,
      buffer: new StateBuffer<RemoteShip>(),
      animator: new WeaponAnimator(weaponTiming('autoCannon')),
      weapon: 'autoCannon',
      name,
      colour,
      ownerId,
      squadron,
    };
    this.remotes.set(id, remote);

    return remote;
  }

  private remove(id: string): void {
    this.remotes.get(id)?.view.destroy();
    this.remotes.delete(id);
  }
}
