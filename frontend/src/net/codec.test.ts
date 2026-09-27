import assert from 'node:assert/strict';
import { test } from 'node:test';

import { create, fromBinary, fromJsonString, toBinary, toJsonString } from '@bufbuild/protobuf';

import {
  ClientMessageSchema,
  ServerMessageSchema,
  Weapon,
} from '../gen/voidmarch/v1/messages_pb.js';
import { decodeServer, encodeClient, wireFormatFrom } from './codec.ts';

const shotMessage = create(ClientMessageSchema, {
  kind: { case: 'shot', value: { id: 7, weapon: Weapon.ROCKETS, muzzle: 1, x: 1, y: 2, angle: -0.5 } },
});

test('the page picks JSON only when asked', () => {
  assert.equal(wireFormatFrom(''), 'binary');
  assert.equal(wireFormatFrom('?wire=json'), 'json');
  assert.equal(wireFormatFrom('?wire=xml&mock=1'), 'binary');
});

test('client messages encode as binary bytes', () => {
  const data = encodeClient(shotMessage, 'binary');
  assert.ok(data instanceof Uint8Array);
  assert.deepEqual(fromBinary(ClientMessageSchema, data), shotMessage);
});

test('client messages encode as readable JSON text', () => {
  const data = encodeClient(shotMessage, 'json');
  assert.equal(typeof data, 'string');
  assert.match(String(data), /"weapon":\s*"WEAPON_ROCKETS"/);
  assert.deepEqual(fromJsonString(ClientMessageSchema, String(data)), shotMessage);
});

test('server messages decode from binary and text frames alike', () => {
  const message = create(ServerMessageSchema, {
    kind: { case: 'welcome', value: { playerId: 'p1', colour: 0x8fd8ff, spawnX: 180, spawnY: 0, tick: 42, tickRate: 20 } },
  });
  const bytes = toBinary(ServerMessageSchema, message);

  assert.deepEqual(decodeServer(bytes), message);
  assert.deepEqual(decodeServer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), message);
  assert.deepEqual(decodeServer(toJsonString(ServerMessageSchema, message)), message);
});
