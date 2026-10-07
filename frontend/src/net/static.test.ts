import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STATIC, staticBase, versioned } from './static.ts';

test("a module under a build's prefix gives that prefix, so its relative imports share it", () => {
  assert.equal(staticBase('https://voidmarch.example/static/v/0123abcd/js/entry.js'), '/static/v/0123abcd/');
  assert.equal(staticBase('http://127.0.0.1:8080/static/v/0123abcd/js/main.js?x=1'), '/static/v/0123abcd/');
});

test('an unversioned module gives /static/', () => {
  assert.equal(staticBase('http://127.0.0.1:8080/static/js/entry.js'), '/static/');
});

test('a module from anywhere else gives /static/', () => {
  assert.equal(staticBase('file:///home/me/voidmarch/frontend/src/net/static.ts'), '/static/');
  assert.equal(staticBase('http://127.0.0.1:8080/elsewhere/js/entry.js'), '/static/');
  assert.equal(staticBase('http://127.0.0.1:8080/static/v/0123abcd/entry.js'), '/static/');
  assert.equal(staticBase('blob:http://127.0.0.1:8080/9b7a'), '/static/');
});

test('outside a browser the files are unversioned', () => {
  assert.equal(STATIC, '/static/');
});

test('a /static/ URL moves under the base, and any other stays as it is', () => {
  const base = '/static/v/0123abcd/';
  assert.equal(versioned('/static/js/vendor/phaser.js', base), '/static/v/0123abcd/js/vendor/phaser.js');
  assert.equal(versioned('/static/js/main.js', '/static/'), '/static/js/main.js');
  assert.equal(versioned('/api/players', base), '/api/players');
  assert.equal(versioned('/staticfile.js', base), '/staticfile.js');
  assert.equal(versioned('/static/js/main.js'), '/static/js/main.js');
});
