import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/** The variable that hands the run's folder, holding the built server, from the global setup to the workers. */
export const RUN_DIR = 'VOIDMARCH_E2E_DIR';

/** The server binary's name in the run's folder. */
export const BINARY = 'voidmarch';

/** How long a server may take to listen and answer its health check. */
const START_MS = 30_000;

/** How long a server may take to shut down before it is killed. */
const STOP_MS = 10_000;

/** The server's log line saying where it listens. */
const LISTENING = /\bmsg=listening url=(\S+?)\/?$/;

/** A server started for one worker. */
export interface Server {
  /** Where it listens, with no trailing slash. */
  url: string;
  /** Shuts it down and waits for it to exit. */
  stop: () => Promise<void>;
}

/** The environment an E2E server runs with, over the inherited one. */
function serverEnv(dbPath: string): Record<string, string> {
  return {
    APP_ENV: 'development',
    HOST: '127.0.0.1',
    // Any free port: the server logs the one it got.
    PORT: '0',
    // Room under the 16-ship fleet cap for the derelict spec's rescue (#52).
    POOL_START: '13',
    DB_PATH: dbPath,
    // Every spec registers its players from one address.
    REGISTER_LIMIT: '0',
    // Every kill drops a part, so the pickup spec needn't wait for luck.
    DROP_CHANCE: '1',
    // The test map, with the Frigate near home (#89).
    MAP: 'e2e',
  };
}

/**
 * Starts the server built in dir, with a database of its own named name, and
 * waits until it answers its health check.
 */
export async function startServer(dir: string, name: string): Promise<Server> {
  const child = spawn(join(dir, BINARY), [], {
    env: { ...process.env, ...serverEnv(join(dir, `${name}.db`)) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve();
    });
  });
  // A worker that exits without its teardown takes its server along.
  const killOnExit = (): void => {
    child.kill();
  };
  process.once('exit', killOnExit);
  const stop = async (): Promise<void> => {
    process.off('exit', killOnExit);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), STOP_MS);
      await exited;
      clearTimeout(timer);
    }
  };

  // The log is read to its end, so a full pipe never blocks the server.
  const recent: string[] = [];
  const listening = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`the server did not listen within ${String(START_MS)} ms:\n${recent.join('\n')}`));
    }, START_MS);
    createInterface({ input: child.stdout }).on('line', (line) => {
      recent.push(line);
      if (recent.length > 20) {
        recent.shift();
      }
      const url = LISTENING.exec(line)?.[1];
      if (url !== undefined) {
        clearTimeout(timer);
        resolve(url);
      }
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    void exited.then(() => {
      clearTimeout(timer);
      reject(new Error(`the server exited before listening:\n${recent.join('\n')}`));
    });
  });

  try {
    const url = await listening;
    const health = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(START_MS) });
    if (!health.ok) {
      throw new Error(`the server's health check answered ${String(health.status)}`);
    }

    return { url, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}
