import assert from 'node:assert/strict';
import { test } from 'node:test';

import { changeOption, moveSelection, OPTION_IDS, optionRows, type Options } from './options.ts';

const OPTIONS: Options = {
  sound: true,
  music: true,
  controls: 'screen',
  snapRotation: false,
  effects: true,
  fpsCap: false,
  lowResolution: false,
};

test('the rows list all seven options, with their values as text', () => {
  assert.deepEqual(
    optionRows(OPTIONS).map((r) => `${r.label}: ${r.value}`),
    [
      'Sound: on',
      'Music: on',
      'Controls: screen-relative',
      'Rotation: free',
      'Effects: on',
      'Frame rate: the display\'s own',
      'Resolution: full',
    ],
  );
  const changed = OPTION_IDS.reduce(changeOption, OPTIONS);
  assert.deepEqual(
    optionRows(changed).map((r) => r.value),
    ['off', 'off', 'ship-relative', '16 directions', 'off', 'capped at 60', 'low'],
  );
});

test('changing an option turns it to its next value, and back', () => {
  for (const id of OPTION_IDS) {
    const once = changeOption(OPTIONS, id);
    assert.notDeepEqual(once[id], OPTIONS[id], id);
    assert.deepEqual({ ...once, [id]: OPTIONS[id] }, OPTIONS, `only ${id} changes`);
    assert.deepEqual(changeOption(once, id), OPTIONS, `${id} comes back`);
  }
});

test('the selection wraps round the rows', () => {
  assert.equal(moveSelection(0, 1, 7), 1);
  assert.equal(moveSelection(6, 1, 7), 0);
  assert.equal(moveSelection(0, -1, 7), 6);
  assert.equal(moveSelection(3, 0, 0), 0);
});
