import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { pieceFrames, stamps, type LayerLayout } from './layers.ts';
import { layerSheets } from './sprites.ts';

const STATIC_DIR = path.join(import.meta.dirname, '../../internal/web/static');

const layout = (url: string): LayerLayout => JSON.parse(readFileSync(path.join(STATIC_DIR, url.replace(/^\/static\//, '')), 'utf8')) as LayerLayout;

const sample: LayerLayout = {
  width: 20,
  height: 10,
  frames: 3,
  pieces: [
    { x: 0, y: 1, width: 20, height: 8, sheetX: 0, sheetY: 0, frames: 1 },
    { x: 5, y: 2, width: 4, height: 3, sheetX: 0, sheetY: 8, frames: 3 },
  ],
};

test("each piece's frames follow its first to the right in the sheet", () => {
  assert.deepEqual(pieceFrames(sample), [
    { name: '0/0', x: 0, y: 0, width: 20, height: 8 },
    { name: '1/0', x: 0, y: 8, width: 4, height: 3 },
    { name: '1/1', x: 4, y: 8, width: 4, height: 3 },
    { name: '1/2', x: 8, y: 8, width: 4, height: 3 },
  ]);
});

test('a frame draws the still piece and each animated piece at that frame, at their places', () => {
  assert.deepEqual(stamps(sample, 2), [
    { name: '0/0', x: 0, y: 1 },
    { name: '1/2', x: 5, y: 2 },
  ]);
  const names = new Set(pieceFrames(sample).map((f) => f.name));
  for (let frame = 0; frame < sample.frames; frame++) {
    for (const s of stamps(sample, frame)) {
      assert.ok(names.has(s.name), s.name);
    }
  }
});

test("the stars layers' pieces sit inside their frame, and the animated ones apart, over the layer's frames", () => {
  for (const sheet of layerSheets()) {
    const l = layout(sheet.layoutUrl);
    assert.equal(l.frames, 9, sheet.key);
    l.pieces.forEach((p, i) => {
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.width <= l.width && p.y + p.height <= l.height, `${sheet.key} piece ${String(i)}`);
      assert.ok(p.frames === 1 || p.frames === l.frames, `${sheet.key} piece ${String(i)}: ${String(p.frames)} frames`);
      // The still piece has the animated ones' places cleared, so only those must not overlap.
      for (const q of p.frames === 1 ? [] : l.pieces.slice(i + 1)) {
        const apart = q.x >= p.x + p.width || p.x >= q.x + q.width || q.y >= p.y + p.height || p.y >= q.y + q.height;
        assert.ok(apart, `${sheet.key}: pieces at ${String(p.x)},${String(p.y)} and ${String(q.x)},${String(q.y)} overlap`);
      }
    });
  }
});
