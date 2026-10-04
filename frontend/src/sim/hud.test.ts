import assert from 'node:assert/strict';
import { test } from 'node:test';

import { connectionToast, hullPips, joinNames, panelRows, shieldPips, type PanelState } from './hud.ts';
import { MAX_DAMAGE } from './rules.gen.ts';

test('the hull has a pip per hit the ship can still take', () => {
  assert.deepEqual(hullPips(0), { on: MAX_DAMAGE, of: MAX_DAMAGE });
  assert.deepEqual(hullPips(1), { on: MAX_DAMAGE - 1, of: MAX_DAMAGE });
  assert.deepEqual(hullPips(MAX_DAMAGE), { on: 0, of: MAX_DAMAGE });
  assert.deepEqual(hullPips(MAX_DAMAGE + 2), { on: 0, of: MAX_DAMAGE });
});

test('the shield has a pip per whole charge, out of its strength', () => {
  assert.deepEqual(shieldPips(2.7, 3), { on: 2, of: 3 });
  assert.deepEqual(shieldPips(3, 3), { on: 3, of: 3 });
  assert.deepEqual(shieldPips(-1, 2), { on: 0, of: 2 });
  assert.deepEqual(shieldPips(9, 2), { on: 2, of: 2 });
});

test('names join as a sentence', () => {
  assert.equal(joinNames([]), '');
  assert.equal(joinNames(['Mira']), 'Mira');
  assert.equal(joinNames(['Mira', 'Jo']), 'Mira and Jo');
  assert.equal(joinNames(['Mira', 'Jo', 'Sam']), 'Mira, Jo and Sam');
});

const FULL: PanelState = {
  squadron: { name: 'Alpha', others: ['Mira', 'Jo'], companions: 0, order: 'Escort', mode: 'escort' },
  hangar: 13,
  sector: { name: 'D4', state: 'home' },
  mission: 'C3',
  event: 'E4 under attack · 6:34',
};

test('the panel labels every row, as mocked', () => {
  assert.deepEqual(
    panelRows(FULL).map((r) => `${r.label}: ${r.value}${r.alert ? ' (alert)' : ''}`),
    [
      'Squadron: Alpha, with Mira and Jo',
      'Orders: Escort: companions fly with you',
      'Hangar: 13 ships to summon',
      "You're in: D4, the home sector",
      'Mission: Clear sector C3',
      'Alert: E4 under attack · 6:34 (alert)',
    ],
  );
});

test('the panel leaves out what is not there, and words the rest to fit', () => {
  const alone = panelRows({
    squadron: { name: 'Beta', others: [], companions: 1, order: 'Hold here', mode: 'hold' },
    hangar: 1,
    sector: { name: 'E3', state: 'hostile' },
    mission: '',
    event: '',
  });
  assert.deepEqual(
    alone.map((r) => `${r.label}: ${r.value}`),
    ['Squadron: Beta, with 1 companion', 'Orders: Hold here: companions hold their spot', 'Hangar: 1 ship to summon', "You're in: E3, hostile"],
  );
  assert.deepEqual(
    panelRows({ squadron: undefined, hangar: 0, sector: { name: 'D1', state: 'unknown' }, mission: undefined, event: '' }).map((r) => r.value),
    ['empty', 'D1'],
  );
  assert.deepEqual(panelRows({ squadron: undefined, hangar: undefined, sector: undefined, mission: undefined, event: '' }), []);
  const unknownMode = panelRows({ ...FULL, squadron: { name: 'A', others: [], companions: 2, order: 'Odd', mode: 'odd' } });
  assert.equal(unknownMode[0]?.value, 'A, with 2 companions');
  assert.equal(unknownMode[1]?.value, 'Odd');
});

test('the connection toasts only while it is not online', () => {
  assert.equal(connectionToast('online'), undefined);
  assert.equal(connectionToast(undefined), 'Playing alone');
  assert.equal(connectionToast('offline'), 'Offline, reconnecting');
  assert.equal(connectionToast('full'), 'The frontier is full, try again soon');
  assert.equal(connectionToast('connecting'), 'Connecting');
});
