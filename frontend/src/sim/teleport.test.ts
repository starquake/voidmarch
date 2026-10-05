import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TELEPORT_DURATION_S, teleportFrame } from './teleport.ts';
import {
  TELEPORT_CLOSE_S,
  TELEPORT_FLASH_RADIUS,
  TELEPORT_FLASH_S,
  TELEPORT_HOLD_S,
  TELEPORT_SHIELD_START_SCALE,
  TELEPORT_SHRINK_S,
} from './tuning.ts';

const CLOSED = TELEPORT_CLOSE_S;
const SHRINKING = TELEPORT_CLOSE_S + TELEPORT_HOLD_S;
const SHRUNK = SHRINKING + TELEPORT_SHRINK_S;

test('the teleport lasts its four phases', () => {
  assert.equal(TELEPORT_DURATION_S, TELEPORT_CLOSE_S + TELEPORT_HOLD_S + TELEPORT_SHRINK_S + TELEPORT_FLASH_S);
});

test('it starts with the shield wide and invisible, and the hull whole', () => {
  const f = teleportFrame(0);
  assert.equal(f.shieldScale, TELEPORT_SHIELD_START_SCALE);
  assert.equal(f.shieldAlpha, 0);
  assert.equal(f.hullScale, 1);
  assert.equal(f.white, false);
  assert.equal(f.flashRadius, 0);
  assert.equal(f.done, false);
});

test('the shield closes in and fades in, the hull untouched', () => {
  const early = teleportFrame(CLOSED * 0.25);
  const late = teleportFrame(CLOSED * 0.75);
  assert.ok(early.shieldScale < TELEPORT_SHIELD_START_SCALE && late.shieldScale < early.shieldScale && late.shieldScale > 1);
  assert.ok(early.shieldAlpha > 0 && late.shieldAlpha > early.shieldAlpha && late.shieldAlpha < 1);
  assert.equal(late.hullScale, 1);
  assert.equal(late.flashRadius, 0);
});

test('closed, the shield holds at the hull size, fully shown', () => {
  for (const t of [CLOSED, (CLOSED + SHRINKING) / 2]) {
    const f = teleportFrame(t);
    assert.equal(f.shieldScale, 1, `at ${String(t)}`);
    assert.equal(f.shieldAlpha, 1, `at ${String(t)}`);
    assert.equal(f.hullScale, 1, `at ${String(t)}`);
    assert.equal(f.white, false, `at ${String(t)}`);
    assert.equal(f.flashRadius, 0, `at ${String(t)}`);
  }
});

test('the shrink starts light, from whole, with no flash yet', () => {
  const f = teleportFrame(SHRINKING);
  assert.equal(f.white, true);
  assert.equal(f.hullScale, 1);
  assert.equal(f.shieldScale, 1);
  assert.equal(f.flashRadius, 0);
});

test('then hull and shield turn light and shrink while the flash grows', () => {
  const f = teleportFrame((SHRINKING + SHRUNK) / 2);
  assert.equal(f.white, true);
  assert.ok(f.hullScale > 0 && f.hullScale < 1);
  assert.equal(f.shieldScale, f.hullScale);
  assert.ok(f.flashRadius > 0 && f.flashRadius < TELEPORT_FLASH_RADIUS);
  assert.ok(f.flashAlpha > 0);
});

test('the flash peaks as the hull reaches nothing', () => {
  const f = teleportFrame(SHRUNK);
  assert.equal(f.hullScale, 0);
  assert.equal(f.shieldScale, 0);
  assert.equal(f.flashRadius, TELEPORT_FLASH_RADIUS);
  assert.equal(f.flashAlpha, 1);
  assert.equal(f.done, false);
});

test('the flash collapses to a point', () => {
  const mid = teleportFrame(SHRUNK + TELEPORT_FLASH_S / 2);
  assert.ok(mid.flashRadius > 0 && mid.flashRadius < TELEPORT_FLASH_RADIUS);
  assert.equal(mid.hullScale, 0);
  assert.equal(mid.done, false);
});

test('it is done at and after its length, with nothing left to draw', () => {
  for (const t of [TELEPORT_DURATION_S, TELEPORT_DURATION_S + 5]) {
    const f = teleportFrame(t);
    assert.equal(f.done, true, `at ${String(t)}`);
    assert.equal(f.hullScale, 0);
    assert.equal(f.shieldAlpha, 0);
    assert.equal(f.flashRadius, 0);
    assert.equal(f.flashAlpha, 0);
  }
});

test('no scale or alpha goes negative, before, during or after', () => {
  for (let t = -0.5; t <= TELEPORT_DURATION_S + 0.5; t += 0.01) {
    const f = teleportFrame(t);
    for (const [name, value] of Object.entries(f)) {
      if (typeof value === 'number') {
        assert.ok(value >= 0, `${name} = ${String(value)} at ${t.toFixed(2)}`);
      }
    }
    assert.ok(f.shieldAlpha <= 1 && f.flashAlpha <= 1, `alpha above 1 at ${t.toFixed(2)}`);
  }
});
