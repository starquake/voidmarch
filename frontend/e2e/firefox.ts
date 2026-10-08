import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A home folder this process holds until it lets go. */
export interface FirefoxHome {
  path: string;
  release: () => void;
}

/** Whether a process with this id is running. */
function running(pid: number): boolean {
  // Not a pid yet: the holder has made the lock but not written its id.
  if (!Number.isInteger(pid) || pid <= 0) {
    return true;
  }
  try {
    process.kill(pid, 0);

    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Claims a home folder in dir for one Firefox on macOS (#247), held with a
 * lock file so no other Firefox uses it at the same time, from this run or
 * another (#312). The folders are kept and reused: macOS keeps the folders
 * Firefox makes in them from other apps, so they could not be removed. A lock
 * whose holder is gone is taken over.
 */
export function claimFirefoxHome(dir: string = tmpdir()): FirefoxHome {
  for (let n = 0; ; ) {
    const path = join(dir, `voidmarch-e2e-firefox-${String(n)}`);
    const lock = join(path, 'lock');
    mkdirSync(path, { recursive: true });
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' });

      return {
        path,
        release: () => {
          rmSync(lock, { force: true });
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
    }
    let holder: number;
    try {
      holder = Number(readFileSync(lock, 'utf8'));
    } catch {
      // Released in between: try this folder again.
      continue;
    }
    if (running(holder)) {
      n++;
      continue;
    }
    // One rename wins when two take over the same stale lock; both then try this folder again.
    try {
      const stale = `${lock}.${String(process.pid)}`;
      renameSync(lock, stale);
      rmSync(stale, { force: true });
    } catch {
      // Another process took it over first.
    }
  }
}
