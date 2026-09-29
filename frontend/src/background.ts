/**
 * Keeps the game ticking while its tab is hidden (#57). A hidden tab gets no
 * animation frames, and the page's own timers are throttled to a second or
 * worse; a dedicated worker's timer isn't, and its messages still reach the
 * page. So while hidden, a worker's tick steps the game instead.
 */

/** What the ticker needs from the page: its visibility, and a clock. */
export interface Page {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** A timer that calls back every intervalMs until stopped. */
export interface Timer {
  start(intervalMs: number, tick: () => void): void;
  stop(): void;
}

/** How often the hidden game steps: the server's tick rate. */
export const BACKGROUND_INTERVAL_MS = 50;

const WORKER_SOURCE = `let timer;
onmessage = (event) => {
  clearInterval(timer);
  if (event.data > 0) {
    timer = setInterval(() => postMessage(0), event.data);
  }
};`;

/** A timer run by a worker made from a blob, which the page's CSP allows (worker-src blob:). */
export function workerTimer(): Timer {
  let worker: Worker | undefined;

  return {
    start(intervalMs, tick) {
      worker ??= new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' })));
      worker.onmessage = tick;
      worker.postMessage(intervalMs);
    },
    stop() {
      worker?.postMessage(0);
    },
  };
}

/**
 * Calls onTick with the milliseconds since the last tick, every
 * BACKGROUND_INTERVAL_MS while the page is hidden, and stops when it shows.
 */
export class BackgroundTicker {
  private readonly page: Page;
  private readonly timer: Timer;
  private readonly now: () => number;
  private readonly onTick: (deltaMs: number) => void;
  private last = 0;
  private running = false;
  private readonly changed = (): void => {
    this.sync();
  };

  constructor(onTick: (deltaMs: number) => void, page: Page, timer: Timer, now: () => number) {
    this.onTick = onTick;
    this.page = page;
    this.timer = timer;
    this.now = now;
  }

  /** Starts watching the page's visibility. */
  start(): void {
    this.page.addEventListener('visibilitychange', this.changed);
    this.sync();
  }

  /** Stops watching, and ticking. */
  stop(): void {
    this.page.removeEventListener('visibilitychange', this.changed);
    this.halt();
  }

  /** Whether the worker is stepping the game. */
  get ticking(): boolean {
    return this.running;
  }

  private sync(): void {
    if (this.page.visibilityState !== 'hidden') {
      this.halt();

      return;
    }
    if (this.running) {
      return;
    }
    this.running = true;
    this.last = this.now();
    this.timer.start(BACKGROUND_INTERVAL_MS, () => {
      const at = this.now();
      this.onTick(at - this.last);
      this.last = at;
    });
  }

  private halt(): void {
    if (this.running) {
      this.running = false;
      this.timer.stop();
    }
  }
}
