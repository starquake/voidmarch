import assert from 'node:assert/strict';
import { test } from 'node:test';

import { create } from '@bufbuild/protobuf';

import { WorldEventKind, WorldEventSchema } from '../gen/voidmarch/v1/messages_pb.js';
import { eventEndBanner, eventLine, eventStartBanner } from './events.ts';

const attack = create(WorldEventSchema, { kind: WorldEventKind.ATTACK, sector: 'D3', endsTick: 12_000 });
const distress = create(WorldEventSchema, { kind: WorldEventKind.DISTRESS, sector: 'C4', endsTick: 2400 });

test('the HUD line names the event and counts down', () => {
  assert.equal(eventLine(attack, 0, 20), 'D3 under attack · 10:00');
  assert.equal(eventLine(attack, 10_960, 20), 'D3 under attack · 0:52');
  assert.equal(eventLine(distress, 360, 20), 'Distress call in C4 · 1:42');
  assert.equal(eventLine(distress, 9999, 20), 'Distress call in C4 · 0:00');
  assert.equal(eventLine(undefined, 0, 20), '');
});

test('a starting event says what to do and to follow the red arrow', () => {
  assert.match(eventStartBanner(attack).join('\n'), /^Sector D3 is under attack!\n.*Frigate.*\n.*red arrow/);
  assert.match(eventStartBanner(distress).join('\n'), /^Distress call from sector C4\nDestroy its guard.*derelict.*\n.*red arrow/);
});

test('an ending event says how it went', () => {
  assert.deepEqual(eventEndBanner(attack, true), ['Sector D3 held!', 'A ship joins the hangar.']);
  assert.deepEqual(eventEndBanner(attack, false), ['Sector D3 has fallen']);
  assert.deepEqual(eventEndBanner(distress, true), ['Derelict rescued in sector C4']);
  assert.deepEqual(eventEndBanner(distress, false), ['The derelict in sector C4 was lost']);
});
