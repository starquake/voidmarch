import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { sheets } from './sprites.ts';

const STATIC_DIR = path.join(import.meta.dirname, '../../internal/web/static');

/** Reads width and height from a PNG's IHDR chunk. */
const pngSize = (file: string): { width: number; height: number } => {
  const data = readFileSync(file);

  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
};

test('every sheet matches its PNG: frames laid out in one row', () => {
  for (const sheet of sheets()) {
    const file = path.join(STATIC_DIR, sheet.url.replace(/^\/static\//, ''));
    const { width, height } = pngSize(file);
    assert.equal(width, sheet.frameWidth * sheet.frames, `${sheet.key}: width ${width}`);
    assert.equal(height, sheet.frameHeight, `${sheet.key}: height ${height}`);
  }
});

test('sheet keys are unique', () => {
  const all = sheets().map((s) => s.key);
  assert.equal(new Set(all).size, all.length);
});
