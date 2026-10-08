import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BINARY, RUN_DIR } from './server.ts';

/**
 * Builds the server once for the run, into a folder of its own that also
 * holds each worker's database, and removes the folder when the run ends.
 * With E2E_BASE_URL set, the specs use that server and nothing is built.
 */
export default function globalSetup(): () => void {
  if (process.env.E2E_BASE_URL !== undefined) {
    return () => undefined;
  }
  const dir = mkdtempSync(join(tmpdir(), 'voidmarch-e2e-'));
  const remove = (): void => {
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    // No version control stamp: CI's Firefox job builds as root in a checkout another user owns.
    execFileSync('go', ['build', '-buildvcs=false', '-o', join(dir, BINARY), './cmd/voidmarch'], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      stdio: 'inherit',
    });
  } catch (err) {
    remove();
    throw err;
  }
  // Workers start after the global setup and inherit its environment.
  process.env[RUN_DIR] = dir;

  return remove;
}
