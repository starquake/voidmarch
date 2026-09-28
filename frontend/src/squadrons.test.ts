import assert from 'node:assert/strict';
import { test } from 'node:test';

import { create } from '@bufbuild/protobuf';

import { CompanionMode, SquadronsSchema } from './gen/voidmarch/v1/messages_pb.js';
import { modeName, pickFirst, squadronChoices } from './squadrons.ts';

const member = (name: string, companions = 0) => ({ playerId: name, name, companions });

const list = create(SquadronsSchema, {
  nextName: 'Epsilon',
  squadrons: [
    { name: 'Alpha', members: [member('Sanne', 1), member('Mo', 1)], mode: CompanionMode.ATTACK },
    { name: 'Beta', members: [member('Ana', 2)], mode: CompanionMode.GUARD },
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
  assert.deepEqual([alpha?.seats, alpha?.note, alpha?.mode], ['■■▣▣', 'you take over one of the companions', 'Attack']);
  assert.deepEqual([beta?.seats, beta?.note, beta?.mode], ['■▣▣□', '1 seat free', 'Guard']);
  assert.deepEqual([delta?.seats, delta?.note, delta?.mode], ['■□□□', '3 seats free', 'Escort']);
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

test('an unset mode reads as Escort', () => {
  assert.equal(modeName({ mode: CompanionMode.UNSPECIFIED }), 'Escort');
  assert.equal(modeName({ mode: CompanionMode.STEALTH }), 'Stealth');
});
