import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadControlMode, saveControlMode } from './settings.ts';

const memoryStore = (): Pick<Storage, 'getItem' | 'setItem'> => {
  const data = new Map<string, string>();

  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
};

const brokenStore: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
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
