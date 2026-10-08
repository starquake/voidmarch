import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bannerStyle } from './announcement.ts';

const SIZE = { fontPx: 14, paddingXPx: 12, paddingYPx: 8 };

test('the banner is gold Exo 2 in a see-through black box with a gold border, 22% down', () => {
  assert.deepEqual(bannerStyle(SIZE, 1), {
    top: '22%',
    fontFamily: "'Exo 2', sans-serif",
    fontSize: '14px',
    padding: '7px 11px',
    borderWidth: '1px',
    borderColor: '#ffd27a',
    color: '#ffd27a',
    background: 'rgb(0 0 0 / 60%)',
  });
});

test('on a phone the banner shrinks with the touch controls, border included', () => {
  const style = bannerStyle(SIZE, 0.5);
  assert.equal(style.fontSize, '7px');
  assert.equal(style.padding, '3.5px 5.5px');
  assert.equal(style.borderWidth, '0.5px');
  assert.equal(style.top, '22%');
});
