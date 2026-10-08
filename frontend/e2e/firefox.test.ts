import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { claimFirefoxHome } from './firefox.ts';

const dir = mkdtempSync(join(tmpdir(), 'voidmarch-firefox-test-'));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A folder of its own under dir, for one test. */
const folder = (name: string): string => {
  const path = join(dir, name);
  mkdirSync(path);

  return path;
};

test('two claims at once get different folders, and a released one is claimed again', () => {
  const root = folder('two');
  const first = claimFirefoxHome(root);
  const second = claimFirefoxHome(root);
  assert.notEqual(first.path, second.path);

  first.release();
  const third = claimFirefoxHome(root);
  assert.equal(third.path, first.path);
  second.release();
  third.release();
});

test('a folder whose holder is gone is taken over', () => {
  const root = folder('stale');
  const home = join(root, 'voidmarch-e2e-firefox-0');
  mkdirSync(home);
  // Far above any pid the system hands out.
  writeFileSync(join(home, 'lock'), '999999999');

  const claimed = claimFirefoxHome(root);
  assert.equal(claimed.path, home);
  claimed.release();
  assert.equal(existsSync(join(home, 'lock')), false);
});

test('a folder held by a running process is passed over', () => {
  const root = folder('held');
  const home = join(root, 'voidmarch-e2e-firefox-0');
  mkdirSync(home);
  writeFileSync(join(home, 'lock'), String(process.ppid));

  const claimed = claimFirefoxHome(root);
  assert.equal(claimed.path, join(root, 'voidmarch-e2e-firefox-1'));
  claimed.release();
});
