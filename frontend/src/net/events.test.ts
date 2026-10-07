import assert from 'node:assert/strict';
import { test } from 'node:test';

import { create } from '@bufbuild/protobuf';

import { WorldEventKind, WorldEventSchema } from '../gen/voidmarch/v1/messages_pb.js';
import { ATTACK_WARNING, AttackReminder, eventEndBanner, eventLine, eventStartBanner } from './events.ts';

const attack = create(WorldEventSchema, { kind: WorldEventKind.ATTACK, sector: 'D3', endsTick: 12_000 });
const distress = create(WorldEventSchema, { kind: WorldEventKind.DISTRESS, sector: 'C4', endsTick: 2400 });

test('the HUD line names the event and counts down', () => {
  assert.equal(eventLine(attack, 0, 20), 'D3 under attack · 10:00 to save it');
  assert.equal(eventLine(attack, 10_960, 20), 'D3 under attack · 0:52 to save it');
  assert.equal(eventLine(distress, 360, 20), 'Distress call in C4 · 1:42');
  assert.equal(eventLine(distress, 9999, 20), 'Distress call in C4 · 0:00');
  assert.equal(eventLine(undefined, 0, 20), '');
});

test('a starting event says what to do and to follow the red arrow', () => {
  assert.match(eventStartBanner(attack).join('\n'), /^Sector D3 is under attack!\n.*Frigate.*\n.*red arrow/);
  assert.equal(eventStartBanner(attack)[1], ATTACK_WARNING);
  assert.match(eventStartBanner(distress).join('\n'), /^Distress call from sector C4\nDestroy its guard.*derelict.*\n.*red arrow/);
});

test('an ending event says how it went', () => {
  assert.deepEqual(eventEndBanner(attack, true), ['Sector D3 held!', 'A ship joins the hangar.']);
  assert.deepEqual(eventEndBanner(attack, false), ['Sector D3 has fallen']);
  assert.deepEqual(eventEndBanner(distress, true), ['Derelict rescued in sector C4']);
  assert.deepEqual(eventEndBanner(distress, false), ['The derelict in sector C4 was lost']);
});

// The attack ends at tick 12_000; at 20 ticks a second, a minute left is tick 10_800.
const MINUTE_LEFT = 10_800;

/** The ticks at which reminder showed its banner, checking it at each of ticks. */
function shownAt(reminder: AttackReminder, event: typeof attack | undefined, ticks: number[]): number[] {
  return ticks.filter((tick) => {
    const banner = reminder.check(event, tick, 20);
    if (banner !== undefined) {
      assert.deepEqual(banner, [ATTACK_WARNING]);
    }

    return banner !== undefined;
  });
}

test('the warning comes back once, as an attack drops to a minute left', () => {
  const reminder = new AttackReminder();
  assert.deepEqual(shownAt(reminder, attack, [0, 6000, MINUTE_LEFT - 20, MINUTE_LEFT - 1, MINUTE_LEFT, MINUTE_LEFT + 1, 11_500, 11_999]), [
    MINUTE_LEFT,
  ]);
});

test('a frame that skips past the minute still shows it, while time is left', () => {
  assert.deepEqual(shownAt(new AttackReminder(), attack, [0, 11_000]), [11_000]);
  assert.deepEqual(shownAt(new AttackReminder(), attack, [0, 12_000]), []);
});

test('no reminder for a player who first sees the attack with a minute or less left', () => {
  assert.deepEqual(shownAt(new AttackReminder(), attack, [MINUTE_LEFT, 11_000, 11_999]), []);
  // Nor once the clock settles back across the minute.
  assert.deepEqual(shownAt(new AttackReminder(), attack, [MINUTE_LEFT, MINUTE_LEFT - 1, MINUTE_LEFT]), []);
});

test('a clock settling back across the minute does not show it twice', () => {
  assert.deepEqual(shownAt(new AttackReminder(), attack, [0, MINUTE_LEFT, MINUTE_LEFT - 1, MINUTE_LEFT, 11_000]), [MINUTE_LEFT]);
});

test('each attack gets its own reminder, and a distress call none', () => {
  const reminder = new AttackReminder();
  const next = create(WorldEventSchema, { kind: WorldEventKind.ATTACK, sector: 'E4', endsTick: 24_000 });
  assert.deepEqual(shownAt(reminder, attack, [0, 11_000]), [11_000]);
  assert.deepEqual(shownAt(reminder, undefined, [12_500]), []);
  assert.deepEqual(shownAt(reminder, next, [13_000, 23_000]), [23_000]);
  assert.deepEqual(shownAt(reminder, distress, [0, 2000]), []);
});

test('the same attack seen again, as after a reconnect, keeps its reminder', () => {
  const reminder = new AttackReminder();
  const again = create(WorldEventSchema, { kind: WorldEventKind.ATTACK, sector: 'D3', endsTick: 12_000 });
  assert.deepEqual(shownAt(reminder, attack, [0, 11_000]), [11_000]);
  assert.deepEqual(shownAt(reminder, again, [11_100]), []);

  const armed = new AttackReminder();
  assert.deepEqual(shownAt(armed, attack, [0]), []);
  assert.deepEqual(shownAt(armed, again, [11_000]), [11_000]);
});
