import { create } from '@bufbuild/protobuf';

import {
  ClientMessageSchema,
  type CompanionGranted,
  type EnemyDestroyed,
  type EnemyFired,
  type RemoteShot,
  type ShotEnded,
  type Snapshot,
  type SquadronJoined,
  type PickupDropped,
  type PickupTaken,
  type DerelictRescued,
  type SectorCleared,
  type SquadronOrder,
  type SquadronOrdered,
  type Squadrons,
  type Welcome,
} from '../gen/voidmarch/v1/messages_pb.js';
import type { FiredShot, Ship } from '../simwasm.ts';
import { decodeServer, encodeClient, type WireFormat } from './codec.ts';
import { toShipState, toWeapon } from './mapping.ts';

/** The server closes with this when it doesn't know the token (it restarted). */
export const CLOSE_UNKNOWN_TOKEN = 4001;
/** The server closes with this after Full. */
export const CLOSE_TRY_AGAIN_LATER = 1013;

const BACKOFF_MS = [1000, 2000, 4000, 8000] as const;
const MAX_BACKOFF_MS = 10_000;
const FULL_RETRY_MS = 10_000;

/** The part of the browser's WebSocket this uses, so tests can stand in. */
export interface SocketLike {
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
}

export interface ConnectionEvents {
  welcome(welcome: Welcome): void;
  snapshot(snapshot: Snapshot): void;
  shot(shot: RemoteShot): void;
  left(playerId: string): void;
  /** The frontier is full; the connection retries on its own. */
  full(): void;
  /** The server forgot the token; the player must register again. */
  unknownToken(): void;
  /** The link dropped; the connection is retrying. */
  disconnected(): void;
  enemyFired(fired: EnemyFired): void;
  enemyDestroyed(destroyed: EnemyDestroyed): void;
  /** Another player's shot hit something; remove it. */
  shotEnded(ended: ShotEnded): void;
  /** A summon was granted: a companion's number and where to put it. */
  companionGranted(granted: CompanionGranted): void;
  /** A summon was refused, with the reason to show. */
  companionRefused(reason: string): void;
  /** The server took a companion's seat back. */
  companionDismissed(companion: number, takenBy: string): void;
  /** The squadrons changed. */
  squadrons(list: Squadrons): void;
  /** The player is in a squadron now. */
  squadronJoined(joined: SquadronJoined): void;
  /** Joining a squadron was refused, with the reason to show. */
  squadronRefused(reason: string): void;
  /** A squadmate gave an order. */
  squadronOrdered(ordered: SquadronOrdered): void;
  /** A kill dropped a part (#77). */
  pickupDropped(dropped: PickupDropped): void;
  /** A pickup was collected, and who gained what. */
  pickupTaken(taken: PickupTaken): void;
  /** A derelict was rescued into the hangar (#52). */
  derelictRescued(rescued: DerelictRescued): void;
  /** A sector's garrison is destroyed (#99). */
  sectorCleared(cleared: SectorCleared): void;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ConnectionOptions {
  url: string;
  token: string;
  format: WireFormat;
  events: ConnectionEvents;
  socket?: (url: string) => SocketLike;
  timers?: Timers;
}

const browserTimers: Timers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => {
    window.clearTimeout(handle as number);
  },
};

/**
 * One player's link to the server: Hello, then states at the server's tick
 * rate and a message per shot. It reconnects on its own, so the game keeps
 * running offline and picks the others up again when the server is back.
 */
export class Connection {
  private readonly options: ConnectionOptions;
  private readonly makeSocket: (url: string) => SocketLike;
  private readonly timers: Timers;
  private socket: SocketLike | undefined;
  private retry: unknown;
  private attempts = 0;
  private stopped = false;
  private welcomed = false;
  private stateIntervalMs = 50;
  private lastStateAt = Number.NEGATIVE_INFINITY;

  constructor(options: ConnectionOptions) {
    this.options = options;
    this.makeSocket = options.socket ?? ((url) => new WebSocket(url));
    this.timers = options.timers ?? browserTimers;
  }

  /** Whether the server has welcomed this connection and it is still open. */
  get connected(): boolean {
    return this.welcomed;
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.timers.clearTimeout(this.retry);
    this.socket?.close(1000);
    this.socket = undefined;
    this.welcomed = false;
  }

  /** Sends the ship's state at most at the server's tick rate; the hub flies the companions. */
  sendState(ship: Ship, nowMs: number): void {
    if (!this.welcomed || nowMs - this.lastStateAt < this.stateIntervalMs) {
      return;
    }
    this.lastStateAt = nowMs;
    this.send(create(ClientMessageSchema, { kind: { case: 'state', value: toShipState(ship) } }));
  }

  /** Joins the named squadron, or starts a new one when name is empty. */
  sendChooseSquadron(name: string): void {
    if (this.welcomed) {
      this.send(create(ClientMessageSchema, { kind: { case: 'chooseSquadron', value: { name } } }));
    }
  }

  /** Gives the squadron an order, which the server passes to the squadmates. */
  sendSquadronOrder(order: Omit<SquadronOrder, '$typeName'>): void {
    if (this.welcomed) {
      this.send(create(ClientMessageSchema, { kind: { case: 'squadronOrder', value: order } }));
    }
  }

  /** Asks the server for a companion. */
  sendSummon(): void {
    if (this.welcomed) {
      this.send(create(ClientMessageSchema, { kind: { case: 'summon', value: {} } }));
    }
  }

  /** Gives a companion's seat back. */
  sendDismiss(companion: number): void {
    if (this.welcomed) {
      this.send(create(ClientMessageSchema, { kind: { case: 'dismiss', value: { companion } } }));
    }
  }

  /** Sends a shot under its projectile-pool id, which a hit later reports. */
  sendShot(shot: FiredShot): void {
    if (!this.welcomed) {
      return;
    }
    this.send(
      create(ClientMessageSchema, {
        kind: {
          case: 'shot',
          value: {
            id: shot.id,
            weapon: toWeapon(shot.weapon),
            muzzle: shot.muzzle,
            x: shot.x,
            y: shot.y,
            angle: shot.angle,
          },
        },
      }),
    );
  }

  /** Reports that one of our shots hit an enemy; the server trusts it. */
  /** Reports a hit on an enemy: by a shot, a shard of its burst, or a ram (shot 0); goesOn when a piercing shot carries on (#72). */
  sendHit(enemyId: number, shotId: number, damage: number, shard = 0, goesOn = false): void {
    if (this.welcomed) {
      this.send(create(ClientMessageSchema, { kind: { case: 'hit', value: { enemyId, shotId, damage, shard, goesOn } } }));
    }
  }

  /** Says our ship flew over a pickup; the server decides who gets it. */
  sendCollect(id: number): void {
    if (this.welcomed) {
      this.send(create(ClientMessageSchema, { kind: { case: 'collect', value: { id } } }));
    }
  }

  private open(): void {
    const socket = this.makeSocket(this.options.url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      this.send(create(ClientMessageSchema, { kind: { case: 'hello', value: { token: this.options.token } } }), socket);
    };
    socket.onmessage = (event) => {
      this.receive(event.data as string | ArrayBuffer);
    };
    socket.onclose = (event) => {
      this.closed(socket, event.code);
    };
    this.socket = socket;
  }

  private receive(data: string | ArrayBuffer): void {
    const message = decodeServer(data);
    const events = this.options.events;
    switch (message.kind.case) {
      case 'welcome':
        this.welcomed = true;
        this.attempts = 0;
        if (message.kind.value.tickRate > 0) {
          this.stateIntervalMs = 1000 / message.kind.value.tickRate;
        }
        events.welcome(message.kind.value);
        break;
      case 'snapshot':
        events.snapshot(message.kind.value);
        break;
      case 'shot':
        events.shot(message.kind.value);
        break;
      case 'left':
        events.left(message.kind.value.playerId);
        break;
      case 'full':
        events.full();
        break;
      case 'enemyFired':
        events.enemyFired(message.kind.value);
        break;
      case 'enemyDestroyed':
        events.enemyDestroyed(message.kind.value);
        break;
      case 'shotEnded':
        events.shotEnded(message.kind.value);
        break;
      case 'companionGranted':
        events.companionGranted(message.kind.value);
        break;
      case 'companionRefused':
        events.companionRefused(message.kind.value.reason);
        break;
      case 'companionDismissed':
        events.companionDismissed(message.kind.value.companion, message.kind.value.takenBy);
        break;
      case 'squadrons':
        events.squadrons(message.kind.value);
        break;
      case 'squadronJoined':
        events.squadronJoined(message.kind.value);
        break;
      case 'squadronRefused':
        events.squadronRefused(message.kind.value.reason);
        break;
      case 'squadronOrdered':
        events.squadronOrdered(message.kind.value);
        break;
      case 'pickupDropped':
        events.pickupDropped(message.kind.value);
        break;
      case 'pickupTaken':
        events.pickupTaken(message.kind.value);
        break;
      case 'derelictRescued':
        events.derelictRescued(message.kind.value);
        break;
      case 'sectorCleared':
        events.sectorCleared(message.kind.value);
        break;
      default:
    }
  }

  private closed(socket: SocketLike, code: number): void {
    if (socket !== this.socket) {
      return;
    }
    this.socket = undefined;
    this.welcomed = false;
    if (this.stopped) {
      return;
    }
    this.options.events.disconnected();
    if (code === CLOSE_UNKNOWN_TOKEN) {
      this.options.events.unknownToken();

      return;
    }

    const delay =
      code === CLOSE_TRY_AGAIN_LATER ? FULL_RETRY_MS : (BACKOFF_MS[this.attempts] ?? MAX_BACKOFF_MS);
    this.attempts++;
    this.retry = this.timers.setTimeout(() => {
      this.open();
    }, delay);
  }

  private send(message: Parameters<typeof encodeClient>[0], socket = this.socket): void {
    const data = encodeClient(message, this.options.format);
    // protobuf-es always allocates a plain ArrayBuffer, never a shared one.
    socket?.send(typeof data === 'string' ? data : (data as Uint8Array<ArrayBuffer>));
  }
}
