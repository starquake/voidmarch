import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WeaponAnimator, type WeaponTiming } from './weaponframes.ts';

const cannon: WeaponTiming = { frames: 7, releaseFrames: [1, 2], releaseFps: 10 };
const rockets: WeaponTiming = { frames: 17, releaseFrames: [2, 4, 6, 8, 10, 12], releaseFps: 5 };
const bigGun: WeaponTiming = { frames: 12, releaseFrames: [7], releaseFps: 10 };

test('an idle weapon rests on frame 0', () => {
  assert.equal(new WeaponAnimator(cannon).frame(5), 0);
});

test('a charge plays the frames before the release over the charge time', () => {
  const gun = new WeaponAnimator(bigGun);
  gun.charge(10, 0.7);
  assert.equal(gun.frame(10), 0);
  assert.equal(gun.frame(10.35), 3);
  assert.equal(gun.frame(10.69), 6);
  assert.equal(gun.frame(10.9), 6, 'holds the last charge frame until the release');
});

test('the release plays the recoil, then returns to rest', () => {
  const gun = new WeaponAnimator(bigGun);
  gun.charge(0, 0.7);
  gun.release(0.7, 0, 1);
  assert.equal(gun.frame(0.7), 7);
  assert.equal(gun.frame(0.95), 9);
  assert.equal(gun.frame(1.19), 11);
  assert.equal(gun.frame(1.3), 0);
});

test('the auto cannon shows each barrel on its own shot', () => {
  const gun = new WeaponAnimator(cannon);
  gun.release(0, 0, 2);
  assert.equal(gun.frame(0.05), 1);
  assert.equal(gun.frame(0.2), 1, 'holds between shots');
  gun.release(0.2, 1, 2);
  assert.equal(gun.frame(0.2), 2);
  assert.equal(gun.frame(0.45), 4);
});

test('a part-played cycle snaps back to rest after a pause', () => {
  const gun = new WeaponAnimator(cannon);
  gun.release(0, 0, 2);
  assert.equal(gun.frame(0.5), 1);
  assert.equal(gun.frame(1), 0);
  gun.release(1.1, 0, 2);
  assert.equal(gun.frame(1.1), 1, 'starts a fresh cycle');
});

test('rocket pods empty one by one, alternating sides', () => {
  const pods = new WeaponAnimator(rockets);
  const seen: number[] = [];
  for (let shot = 0; shot < 6; shot++) {
    pods.release(shot, shot % 2, 2);
    seen.push(pods.frame(shot));
  }
  assert.deepEqual(seen, [2, 4, 6, 8, 10, 12]);
});

test('a release from the other side skips to that side', () => {
  const pods = new WeaponAnimator(rockets);
  pods.release(0, 1, 2);
  assert.equal(pods.frame(0), 4);
});

test('reset returns to rest', () => {
  const gun = new WeaponAnimator(bigGun);
  gun.charge(0, 0.5);
  gun.reset();
  assert.equal(gun.frame(0.2), 0);
});
