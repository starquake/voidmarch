import { fromBinary, fromJsonString, toBinary, toJsonString } from '@bufbuild/protobuf';

import {
  ClientMessageSchema,
  ServerMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from '../gen/voidmarch/v1/messages_pb.js';

/** Binary protobuf normally; protobuf JSON in text frames for debugging (?wire=json). */
export type WireFormat = 'binary' | 'json';

/** The format a page asks for in its query string. */
export function wireFormatFrom(search: string): WireFormat {
  return new URLSearchParams(search).get('wire') === 'json' ? 'json' : 'binary';
}

/** Encodes a message for the server: a string becomes a text frame, bytes a binary frame. */
export function encodeClient(message: ClientMessage, format: WireFormat): string | Uint8Array {
  return format === 'json' ? toJsonString(ClientMessageSchema, message) : toBinary(ClientMessageSchema, message);
}

/** Decodes a frame from the server; the frame type says the format. */
export function decodeServer(data: string | ArrayBuffer | Uint8Array): ServerMessage {
  if (typeof data === 'string') {
    return fromJsonString(ServerMessageSchema, data);
  }

  return fromBinary(ServerMessageSchema, data instanceof Uint8Array ? data : new Uint8Array(data));
}
