import type Phaser from 'phaser';

import type { Snapshot, Welcome } from '../gen/voidmarch/v1/messages_pb.js';
import { ServerClock } from '../net/clock.ts';
import type { WireFormat } from '../net/codec.ts';
import { Connection } from '../net/connection.ts';
import { INTERPOLATION_DELAY_TICKS, StateBuffer } from '../net/interpolation.ts';
import { fromShipState, fromWeapon } from '../net/mapping.ts';
import { TimedQueue } from '../net/remoteshots.ts';
import { weaponTiming } from '../sprites.ts';
import type { WeaponId } from '../sim/loadout.ts';
import type { ShotSpawn } from '../sim/weapons.ts';
import type { FrameEvents, Sandbox } from '../sim/sandbox.ts';
import { WEAPON_STATS } from '../sim/tuning.ts';
import { WeaponAnimator } from '../weaponframes.ts';
import type { ShipAudio } from './audio.ts';
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
  buffer: StateBuffer;
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

  /** Once a frame: send the local ship, draw the others, spawn their shots. */
  update(events: FrameEvents): void {
    const nowMs = now();
    this.connection.sendState(this.options.sim.ship, nowMs);
    for (const shot of events.shots) {
      this.connection.sendShot(shot);
    }

    const serverTick = this.clock.tickAt(nowMs);
    if (serverTick === undefined) {
      return;
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
  }

  private welcome(welcome: Welcome): void {
    this.status = 'online';
    this.playerId = welcome.playerId;
    this.clock = new ServerClock(welcome.tickRate);
    this.shots = new TimedQueue<RemoteShotItem>(welcome.tickRate);
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

  private snapshot(snapshot: Snapshot): void {
    this.clock.observe(snapshot.tick, now());
    for (const player of snapshot.players) {
      if (player.state === undefined) {
        continue;
      }
      const remote = this.remotes.get(player.playerId) ?? this.add(player.playerId, player.name, player.colour);
      remote.buffer.push(snapshot.tick, fromShipState(player.state));
    }
  }

  private add(id: string, name: string, colour: number): Remote {
    const { scene, ships } = this.options;
    const view = new ShipView(scene, ships, 0, 0);
    view.setLabel(scene, ships, name, colour, this.options.labelResolution());
    const remote: Remote = {
      view,
      buffer: new StateBuffer(),
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
