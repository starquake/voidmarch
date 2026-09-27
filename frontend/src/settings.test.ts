import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clearToken, loadAudioSettings, loadControlMode, loadToken, saveAudioSettings, saveControlMode, saveToken } from './settings.ts';

const memoryStore = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const data = new Map<string, string>();

  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

const brokenStore: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};

test('the control mode defaults to ship-relative', () => {
  assert.equal(loadControlMode(memoryStore()), 'ship');
  assert.equal(loadControlMode(undefined), 'ship');
});

test('a saved control mode is loaded back', () => {
  const store = memoryStore();
  saveControlMode('screen', store);
  assert.equal(loadControlMode(store), 'screen');
});

test('an unknown saved value falls back to ship-relative', () => {
  const store = memoryStore();
  store.setItem('voidmarch.controlMode', 'joystick');
  assert.equal(loadControlMode(store), 'ship');
});

test('denied storage neither throws nor remembers', () => {
  assert.doesNotThrow(() => {
    saveControlMode('screen', brokenStore);
  });
  assert.equal(loadControlMode(brokenStore), 'ship');
});

test('sound and music are on by default', () => {
  assert.deepEqual(loadAudioSettings(memoryStore()), { muted: false, music: true });
  assert.deepEqual(loadAudioSettings(undefined), { muted: false, music: true });
});

test('saved sound settings are loaded back', () => {
  const store = memoryStore();
  saveAudioSettings({ muted: true, music: false }, store);
  assert.deepEqual(loadAudioSettings(store), { muted: true, music: false });
});

test('damaged sound settings fall back field by field', () => {
  const store = memoryStore();
  store.setItem('voidmarch.audio', '{"muted": "yes", "music": false}');
  assert.deepEqual(loadAudioSettings(store), { muted: false, music: false });
  store.setItem('voidmarch.audio', 'not json');
  assert.deepEqual(loadAudioSettings(store), { muted: false, music: true });
  store.setItem('voidmarch.audio', '42');
  assert.deepEqual(loadAudioSettings(store), { muted: false, music: true });
});

test('denied storage keeps the default sound settings', () => {
  assert.doesNotThrow(() => {
    saveAudioSettings({ muted: true, music: true }, brokenStore);
  });
  assert.deepEqual(loadAudioSettings(brokenStore), { muted: false, music: true });
});

test('the token is kept, loaded and forgotten', () => {
  const store = memoryStore();
  assert.equal(loadToken(store), undefined);
  saveToken('abc', store);
  assert.equal(loadToken(store), 'abc');
  clearToken(store);
  assert.equal(loadToken(store), undefined);
});

test('denied storage has no token and does not throw', () => {
  assert.equal(loadToken(brokenStore), undefined);
  assert.equal(loadToken(undefined), undefined);
  assert.doesNotThrow(() => {
    saveToken('abc', brokenStore);
    clearToken(brokenStore);
  });
});
