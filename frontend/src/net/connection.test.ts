import assert from 'node:assert/strict';
import { test } from 'node:test';

import { create, fromBinary, fromJsonString, toBinary } from '@bufbuild/protobuf';

import {
  ClientMessageSchema,
  ServerMessageSchema,
  Weapon,
  type ClientMessage,
  type ServerMessage,
} from '../gen/voidmarch/v1/messages_pb.js';
import type { Ship } from '../simwasm.ts';
import {
  CLOSE_TRY_AGAIN_LATER,
  CLOSE_UNKNOWN_TOKEN,
  Connection,
  type ConnectionEvents,
  type SocketLike,
  type Timers,
} from './connection.ts';

/** A ship at (x, y), at rest, with the default parts. */
const createShip = (x: number, y: number): Ship => ({
  x,
  y,
  vx: 0,
  vy: 0,
  angle: -Math.PI / 2,
  thrusting: false,
  loadout: { weapon: 'autoCannon', engine: 'base', shield: 'front' },
  damage: 0,
  shield: 3,
  sinceHit: 0,
  downFor: 0,
  revive: 0,
  cooldown: 0,
  charging: 0,
  nextMuzzle: 0,
  rotationSnap: 0,
});

class FakeSocket implements SocketLike {
  binaryType: BinaryType = 'blob';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  sent: (string | Uint8Array<ArrayBuffer>)[] = [];
  closedWith: number | undefined;

  send(data: string | Uint8Array<ArrayBuffer>): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.closedWith = code;
  }

  open(): void {
    this.onopen?.({} as Event);
  }

  deliver(message: ServerMessage): void {
    const bytes = toBinary(ServerMessageSchema, message);
    this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as MessageEvent);
  }

  drop(code: number): void {
    this.onclose?.({ code } as CloseEvent);
  }

  messages(): ClientMessage[] {
    return this.sent.map((data) =>
      typeof data === 'string' ? fromJsonString(ClientMessageSchema, data) : fromBinary(ClientMessageSchema, data),
    );
  }
}

class FakeTimers implements Timers {
  pending: { fn: () => void; ms: number }[] = [];

  setTimeout(fn: () => void, ms: number): unknown {
    this.pending.push({ fn, ms });

    return this.pending.length;
  }

  clearTimeout(): void {
    this.pending = [];
  }

  fire(): number | undefined {
    const next = this.pending.shift();
    next?.fn();

    return next?.ms;
  }
}

interface Recorded {
  events: string[];
}

function setup(format: 'binary' | 'json' = 'binary'): { conn: Connection; sockets: FakeSocket[]; timers: FakeTimers; log: Recorded } {
  const sockets: FakeSocket[] = [];
  const timers = new FakeTimers();
  const log: Recorded = { events: [] };
  const events: ConnectionEvents = {
    welcome: (w) => log.events.push(`welcome ${w.playerId}`),
    snapshot: (s) => log.events.push(`snapshot ${s.tick}`),
    shot: (s) => log.events.push(`shot ${s.playerId}`),
    left: (id) => log.events.push(`left ${id}`),
    full: () => log.events.push('full'),
    unknownToken: () => log.events.push('unknown token'),
    disconnected: () => log.events.push('disconnected'),
    enemyFired: (f) => log.events.push(`enemy fired ${f.enemyId}`),
    enemyDestroyed: (d) => log.events.push(`enemy destroyed ${d.enemyId}`),
    shotEnded: (e) => log.events.push(`shot ended ${e.playerId}:${e.shotId}`),
    companionGranted: (g) => log.events.push(`granted ${g.companion}`),
    companionRefused: (reason) => log.events.push(`refused ${reason}`),
    companionDismissed: (n, by) => log.events.push(`dismissed ${n}${by === '' ? '' : ` by ${by}`}`),
    squadrons: (list) => log.events.push(`squadrons ${String(list.squadrons.length)}`),
    squadronJoined: (j) => log.events.push(`joined ${j.name}`),
    squadronRefused: (reason) => log.events.push(`squadron refused ${reason}`),
    squadronOrdered: (o) => log.events.push(`ordered by ${o.playerId}`),
  };
  const conn = new Connection({
    url: 'ws://test/ws',
    token: 'tok',
    format,
    events,
    timers,
    socket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);

      return socket;
    },
  });

  return { conn, sockets, timers, log };
}

const welcome = (tickRate = 20): ServerMessage =>
  create(ServerMessageSchema, { kind: { case: 'welcome', value: { playerId: 'me', tickRate } } });

function welcomed(format: 'binary' | 'json' = 'binary'): ReturnType<typeof setup> & { socket: FakeSocket } {
  const s = setup(format);
  s.conn.start();
  const socket = s.sockets[0];
  assert.ok(socket !== undefined);
  socket.open();
  socket.deliver(welcome());

  return { ...s, socket };
}

test('the connection says hello with its token and reads arraybuffers', () => {
  const { conn, sockets } = setup();
  conn.start();
  const socket = sockets[0];
  assert.ok(socket !== undefined);
  assert.equal(socket.binaryType, 'arraybuffer');

  socket.open();
  const hello = socket.messages()[0];
  assert.ok(hello?.kind.case === 'hello');
  assert.equal(hello.kind.value.token, 'tok');
});

test('JSON mode sends text frames', () => {
  const { socket } = welcomed('json');
  assert.equal(typeof socket.sent[0], 'string');
});

test('server messages reach their events', () => {
  const { conn, socket, log } = welcomed();
  socket.deliver(create(ServerMessageSchema, { kind: { case: 'snapshot', value: { tick: 7 } } }));
  socket.deliver(create(ServerMessageSchema, { kind: { case: 'shot', value: { playerId: 'mo' } } }));
  socket.deliver(create(ServerMessageSchema, { kind: { case: 'left', value: { playerId: 'mo' } } }));
  socket.deliver(create(ServerMessageSchema, { kind: { case: 'enemyFired', value: { enemyId: 3 } } }));
  socket.deliver(create(ServerMessageSchema, { kind: { case: 'enemyDestroyed', value: { enemyId: 3 } } }));
  socket.deliver(create(ServerMessageSchema, { kind: { case: 'shotEnded', value: { playerId: 'mo', shotId: 9 } } }));
  socket.deliver(create(ServerMessageSchema, { kind: { case: 'companionGranted', value: { companion: 2 } } }));
  socket.deliver(create(ServerMessageSchema, { kind: { case: 'companionRefused', value: { reason: 'your wing is full' } } }));
  socket.deliver(create(ServerMessageSchema, { kind: { case: 'companionDismissed', value: { companion: 3 } } }));
  assert.deepEqual(log.events, [
    'welcome me',
    'snapshot 7',
    'shot mo',
    'left mo',
    'enemy fired 3',
    'enemy destroyed 3',
    'shot ended mo:9',
    'granted 2',
    'refused your wing is full',
    'dismissed 3',
  ]);
  assert.equal(conn.connected, true);
});

test('state is sent at most at the tick rate, and only once welcomed', () => {
  const { conn, sockets } = setup();
  conn.start();
  const socket = sockets[0];
  assert.ok(socket !== undefined);
  socket.open();
  const ship = createShip(5, 6);
  conn.sendState(ship, 0);
  assert.equal(socket.messages().length, 1, 'only the hello before the welcome');

  socket.deliver(welcome(20));
  conn.sendState(ship, 1000);
  conn.sendState(ship, 1030);
  conn.sendState(ship, 1050);
  const states = socket.messages().filter((m) => m.kind.case === 'state');
  assert.equal(states.length, 2);
  assert.equal(states[0]?.kind.case === 'state' ? states[0].kind.value.x : 0, 5);
});

test('shots carry their pool ids and the wire weapon', () => {
  const { conn, socket } = welcomed();
  conn.sendShot({ id: 1, weapon: 'rockets', muzzle: 1, x: 1, y: 2, angle: 0.5 });
  conn.sendShot({ id: 2, weapon: 'zapper', muzzle: 0, x: 1, y: 2, angle: 0.5 });
  const shots = socket.messages().flatMap((m) => (m.kind.case === 'shot' ? [m.kind.value] : []));
  assert.deepEqual(
    shots.map((s) => [s.id, s.weapon, s.muzzle]),
    [
      [1, Weapon.ROCKETS, 1],
      [2, Weapon.ZAPPER, 0],
    ],
  );
});

test('shots before the welcome are not sent', () => {
  const { conn, sockets } = setup();
  conn.start();
  conn.sendShot({ id: 1, weapon: 'rockets', muzzle: 1, x: 1, y: 2, angle: 0.5 });
  assert.deepEqual(sockets[0]?.sent, []);
});

test('a dropped connection retries with growing waits, reset by a welcome', () => {
  const { conn, sockets, timers } = setup();
  conn.start();
  sockets[0]?.drop(1006);
  assert.equal(conn.connected, false);
  assert.equal(timers.fire(), 1000);
  sockets[1]?.drop(1006);
  assert.equal(timers.fire(), 2000);
  sockets[2]?.drop(1006);
  assert.equal(timers.fire(), 4000);
  sockets[3]?.drop(1006);
  assert.equal(timers.fire(), 8000);
  sockets[4]?.drop(1006);
  assert.equal(timers.fire(), 10_000);

  sockets[5]?.open();
  sockets[5]?.deliver(welcome());
  sockets[5]?.drop(1006);
  assert.equal(timers.fire(), 1000);
});

test('a full frontier is reported and retried later', () => {
  const { conn, sockets, timers, log } = setup();
  conn.start();
  sockets[0]?.open();
  sockets[0]?.deliver(create(ServerMessageSchema, { kind: { case: 'full', value: {} } }));
  sockets[0]?.drop(CLOSE_TRY_AGAIN_LATER);
  assert.deepEqual(log.events, ['full', 'disconnected']);
  assert.equal(timers.fire(), 10_000);
  assert.equal(sockets.length, 2);
});

test('an unknown token stops the connection and asks for a new name', () => {
  const { conn, sockets, timers, log } = setup();
  conn.start();
  sockets[0]?.drop(CLOSE_UNKNOWN_TOKEN);
  assert.deepEqual(log.events, ['disconnected', 'unknown token']);
  assert.equal(timers.pending.length, 0);
});

test('stop closes the socket and does not reconnect', () => {
  const { conn, socket, timers } = welcomed();
  conn.stop();
  assert.equal(socket.closedWith, 1000);
  socket.drop(1000);
  assert.equal(timers.pending.length, 0);
  assert.equal(conn.connected, false);
});

test('hits are reported once welcomed', () => {
  const { conn, socket } = welcomed();
  conn.sendHit(3, 9, 4);
  const hits = socket.messages().flatMap((m) => (m.kind.case === 'hit' ? [m.kind.value] : []));
  assert.deepEqual(
    hits.map((h) => [h.enemyId, h.shotId, h.damage]),
    [[3, 9, 4]],
  );
});

test('hits before the welcome are not sent', () => {
  const { conn, sockets } = setup();
  conn.start();
  conn.sendHit(3, 9, 4);
  assert.deepEqual(sockets[0]?.sent, []);
});

test('summon, dismiss, and a hit carry what the server needs, and never a companion state', () => {
  const { conn, socket } = welcomed();
  conn.sendState(createShip(1, 2), 1000);
  conn.sendSummon();
  conn.sendDismiss(2);
  conn.sendHit(7, 5, 1);
  const kinds = socket.messages().map((m) => m.kind);
  assert.ok(kinds.some((k) => k.case === 'summon'));
  assert.ok(kinds.some((k) => k.case === 'dismiss' && k.value.companion === 2));
  assert.ok(kinds.some((k) => k.case === 'hit' && k.value.enemyId === 7 && k.value.shotId === 5));
  assert.ok(!kinds.some((k) => k.case === 'companion'), 'the hub flies companions');
});

test('nothing about companions is sent before the welcome', () => {
  const { conn, sockets } = setup();
  conn.start();
  sockets[0]?.open();
  conn.sendSummon();
  conn.sendDismiss(1);
  assert.equal(sockets[0]?.messages().length, 1, 'only the hello');
});
