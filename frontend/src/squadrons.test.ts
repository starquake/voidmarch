import assert from 'node:assert/strict';
import { test } from 'node:test';

import { create } from '@bufbuild/protobuf';

import { SquadronsSchema } from './gen/voidmarch/v1/messages_pb.js';
import { moveNotice, pickFirst, squadronChoices } from './squadrons.ts';

const member = (name: string, companions = 0) => ({ playerId: name, name, companions });

const list = create(SquadronsSchema, {
  nextName: 'Epsilon',
  squadrons: [
    { name: 'Alpha', members: [member('Sanne', 1), member('Mo', 1)] },
    { name: 'Beta', members: [member('Ana', 2)] },
    { name: 'Gamma', members: [member('A'), member('B'), member('C'), member('D')] },
    { name: 'Delta', members: [member('Kees')] },
  ],
});

test('squadrons with room are choices, and full ones are only named', () => {
  const { choices, full } = squadronChoices(list);
  assert.deepEqual(
    choices.map((c) => c.name),
    ['Alpha', 'Beta', 'Delta'],
  );
  assert.deepEqual(full, ['Gamma']);
});

test('each choice shows its seats and what joining means', () => {
  const [alpha, beta, delta] = squadronChoices(list).choices;
  assert.deepEqual([alpha?.seats, alpha?.note], ['■■▣▣', 'you take over one of the companions']);
  assert.deepEqual([beta?.seats, beta?.note], ['■▣▣□', '1 seat free']);
  assert.deepEqual([delta?.seats, delta?.note], ['■□□□', '3 seats free']);
  assert.ok(alpha !== undefined);
  assert.deepEqual(alpha.players, ['Sanne', 'Mo']);
  assert.equal(alpha.companions, 2);
});

test('the pick is the squadron flown last, else the first', () => {
  const { choices } = squadronChoices(list);
  assert.equal(pickFirst(choices, 'Delta'), 'Delta');
  assert.equal(pickFirst(choices, 'Gamma'), 'Alpha', 'Gamma is full');
  assert.equal(pickFirst(choices, undefined), 'Alpha');
  assert.equal(pickFirst([], 'Alpha'), undefined);
});

test('reopened in a squadron, it is listed as current, even full of players', () => {
  const { choices, full } = squadronChoices(list, 'Gamma');
  assert.deepEqual(
    choices.map((c) => [c.name, c.current]),
    [
      ['Alpha', false],
      ['Beta', false],
      ['Gamma', true],
      ['Delta', false],
    ],
  );
  assert.deepEqual(full, []);
  const gamma = choices.find((c) => c.name === 'Gamma');
  assert.deepEqual([gamma?.seats, gamma?.note], ['■■■■', 'your squadron']);
  assert.equal(pickFirst(choices, 'Gamma'), 'Gamma', 'Enter stays');
});

test('a squadron with room is current too, and the others are not', () => {
  const { choices } = squadronChoices(list, 'Beta');
  assert.deepEqual(
    choices.filter((c) => c.current).map((c) => c.note),
    ['your squadron'],
  );
  assert.equal(choices.find((c) => c.name === 'Alpha')?.note, 'you take over one of the companions');
});

test('a move says where to, and what it cost', () => {
  const move = { name: 'Beta', started: false, tookOver: false, sentHome: 0 };
  assert.equal(moveNotice(move), 'Moved to Beta');
  assert.equal(moveNotice({ ...move, started: true }), 'Started squadron Beta');
  assert.equal(moveNotice({ ...move, tookOver: true }), "Moved to Beta, in a companion's seat");
  assert.equal(moveNotice({ ...move, sentHome: 1 }), 'Moved to Beta, a companion went home, no room');
  assert.equal(moveNotice({ ...move, tookOver: true, sentHome: 2 }), "Moved to Beta, in a companion's seat, 2 companions went home, no room");
});
