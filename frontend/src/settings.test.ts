import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  clearToken,
  loadAudioSettings,
  loadBloomBroken,
  loadControlMode,
  loadDisplaySettings,
  loadIntroSeen,
  loadLastSquadron,
  loadSeenSeason,
  loadToken,
  loadViewSettings,
  saveAudioSettings,
  saveBloomBroken,
  saveControlMode,
  saveDisplaySettings,
  saveIntroSeen,
  saveLastSquadron,
  saveSeenSeason,
  saveToken,
  saveViewSettings,
} from './settings.ts';

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

test('the control mode defaults to screen-relative', () => {
  assert.equal(loadControlMode(memoryStore()), 'screen');
  assert.equal(loadControlMode(undefined), 'screen');
});

test('a saved control mode is loaded back', () => {
  const store = memoryStore();
  saveControlMode('ship', store);
  assert.equal(loadControlMode(store), 'ship');
});

test('an unknown saved value falls back to screen-relative', () => {
  const store = memoryStore();
  store.setItem('voidmarch.controlMode', 'joystick');
  assert.equal(loadControlMode(store), 'screen');
});

test('denied storage neither throws nor remembers', () => {
  assert.doesNotThrow(() => {
    saveControlMode('ship', brokenStore);
  });
  assert.equal(loadControlMode(brokenStore), 'screen');
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

test('the display runs at its own rate and full resolution by default, and both are remembered', () => {
  assert.deepEqual(loadDisplaySettings(memoryStore()), { fpsCap: false, cssPixels: false });
  const store = memoryStore();
  saveDisplaySettings({ fpsCap: true, cssPixels: true }, store);
  assert.deepEqual(loadDisplaySettings(store), { fpsCap: true, cssPixels: true });
  store.setItem('voidmarch.display', '{"fpsCap": 1, "cssPixels": true}');
  assert.deepEqual(loadDisplaySettings(store), { fpsCap: false, cssPixels: true }, 'damaged fields fall back one by one');
  store.setItem('voidmarch.display', 'not json');
  assert.deepEqual(loadDisplaySettings(store), { fpsCap: false, cssPixels: false });
  assert.doesNotThrow(() => {
    saveDisplaySettings({ fpsCap: true, cssPixels: true }, brokenStore);
  });
  assert.deepEqual(loadDisplaySettings(brokenStore), { fpsCap: false, cssPixels: false });
});

test('rotation is free and effects are on by default, and both are remembered (#145)', () => {
  assert.deepEqual(loadViewSettings(memoryStore()), { snapRotation: false, effects: true });
  const store = memoryStore();
  saveViewSettings({ snapRotation: true, effects: false }, store);
  assert.deepEqual(loadViewSettings(store), { snapRotation: true, effects: false });
  store.setItem('voidmarch.view', '{"snapRotation": "yes", "effects": false}');
  assert.deepEqual(loadViewSettings(store), { snapRotation: false, effects: false }, 'damaged fields fall back one by one');
  store.setItem('voidmarch.view', 'not json');
  assert.deepEqual(loadViewSettings(store), { snapRotation: false, effects: true });
  assert.doesNotThrow(() => {
    saveViewSettings({ snapRotation: true, effects: false }, brokenStore);
  });
  assert.deepEqual(loadViewSettings(brokenStore), { snapRotation: false, effects: true });
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

test('the last squadron is kept, and denied storage forgets it quietly', () => {
  const store = memoryStore();
  assert.equal(loadLastSquadron(store), undefined);
  saveLastSquadron('Beta', store);
  assert.equal(loadLastSquadron(store), 'Beta');
  assert.equal(loadLastSquadron(brokenStore), undefined);
  assert.doesNotThrow(() => {
    saveLastSquadron('Beta', brokenStore);
  });
});

test('the season whose victory screen was seen is remembered', () => {
  const store = memoryStore();
  assert.equal(loadSeenSeason(store), undefined);
  saveSeenSeason('1800000000', store);
  assert.equal(loadSeenSeason(store), '1800000000');
  saveSeenSeason('1800000000', brokenStore);
  assert.equal(loadSeenSeason(brokenStore), undefined);
});

test('a bloom found broken is remembered', () => {
  const store = memoryStore();
  assert.equal(loadBloomBroken(store), false);
  saveBloomBroken(store);
  assert.equal(loadBloomBroken(store), true);
  assert.doesNotThrow(() => {
    saveBloomBroken(brokenStore);
  });
  assert.equal(loadBloomBroken(brokenStore), false);
});

test('the intro screen, once closed, is remembered as seen (#193)', () => {
  const store = memoryStore();
  assert.equal(loadIntroSeen(store), false);
  saveIntroSeen(store);
  assert.equal(loadIntroSeen(store), true);
  assert.doesNotThrow(() => {
    saveIntroSeen(brokenStore);
  });
  assert.equal(loadIntroSeen(brokenStore), false, 'without storage it shows each visit');
});
