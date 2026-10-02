import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bossBar, type DrawnBoss } from './boss.ts';
import { DREADNOUGHT_BASE_HP, DREADNOUGHT_SHIELD, FRIGATE_REACH, FRIGATE_SHIELD } from '../sim/rules.gen.ts';

const frigate = (over: Partial<DrawnBoss> = {}): DrawnBoss => ({
  kind: 'frigate',
  x: 0,
  y: 0,
  hp: 96,
  maxHp: 130,
  shield: FRIGATE_SHIELD / 2,
  scaledFor: 3,
  ...over,
});

test('the bar names the Frigate and shows its health, shield and the players it was scaled for', () => {
  assert.deepEqual(bossBar([frigate()], 100, 0), {
    name: "KLA'ED FRIGATE",
    health: 96 / 130,
    shield: 0.5,
    text: '96 / 130 · scaled for 3 online',
  });
});

test('the bar names the Dreadnought and fills its shield against its own size', () => {
  const max = DREADNOUGHT_BASE_HP * 4;
  const dreadnought = frigate({ kind: 'dreadnought', hp: max / 2, maxHp: max, shield: DREADNOUGHT_SHIELD / 4, scaledFor: 3 });
  assert.deepEqual(bossBar([dreadnought], 0, 0), {
    name: "KLA'ED DREADNOUGHT",
    health: 0.5,
    shield: 0.25,
    text: `${String(max / 2)} / ${String(max)} · scaled for 3 online`,
  });
});

test('the bar shows only within reach, for the nearest boss', () => {
  assert.equal(bossBar([frigate()], FRIGATE_REACH + 1, 0), undefined);
  assert.equal(bossBar([], 0, 0), undefined);
  const far = frigate({ x: 500, hp: 10 });
  assert.equal(bossBar([far, frigate()], 100, 0)?.text, '96 / 130 · scaled for 3 online');
});

test('a boss scaled for nobody yet, or a companion, reads plainly', () => {
  assert.equal(bossBar([frigate({ hp: 40, maxHp: 40, scaledFor: 0 })], 0, 0)?.text, '40 / 40');
  assert.equal(bossBar([frigate({ scaledFor: 1.5 })], 0, 0)?.text, '96 / 130 · scaled for 1.5 online');
});

test('the fills stay between 0 and 1, and an enemy without health has no bar', () => {
  const bar = bossBar([frigate({ hp: -3, shield: FRIGATE_SHIELD * 2 })], 0, 0);
  assert.ok(bar !== undefined);
  assert.equal(bar.health, 0);
  assert.equal(bar.shield, 1);
  assert.equal(bar.text, '0 / 130 · scaled for 3 online');
  assert.equal(bossBar([frigate({ maxHp: 0 })], 0, 0), undefined);
  assert.equal(bossBar([frigate({ kind: 'fighter' })], 0, 0), undefined);
});
