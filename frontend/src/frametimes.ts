/** How far back frame times count, in ms. */
const WINDOW_MS = 1000;

/** A frame's time and when it ended. */
interface Frame {
  at: number;
  ms: number;
}

/** The frame times of the last second: their average, and the worst of them (#143). */
export class FrameTimes {
  private frames: Frame[] = [];

  /** Notes a frame that took ms and ended at now (ms). */
  add(ms: number, now: number): void {
    this.frames.push({ at: now, ms });
    const since = now - WINDOW_MS;
    const first = this.frames.findIndex((f) => f.at > since);
    this.frames = first < 0 ? [] : this.frames.slice(first);
  }

  /** The average frame time of the last second, 0 before the first frame. */
  get average(): number {
    return this.frames.length === 0 ? 0 : this.frames.reduce((sum, f) => sum + f.ms, 0) / this.frames.length;
  }

  /** The longest frame of the last second, 0 before the first frame. */
  get worst(): number {
    return this.frames.reduce((most, f) => Math.max(most, f.ms), 0);
  }
}

/** WebGL 1's GPU timer, where the browser offers it. */
interface TimerQueryExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
  QUERY_RESULT_EXT: number;
  QUERY_RESULT_AVAILABLE_EXT: number;
  createQueryEXT(): WebGLQuery | null;
  deleteQueryEXT(query: WebGLQuery | null): void;
  beginQueryEXT(target: number, query: WebGLQuery): void;
  endQueryEXT(target: number): void;
  getQueryObjectEXT(query: WebGLQuery, pname: number): number | boolean;
}

/** The GL calls a GPU timer needs. */
export interface TimerGl {
  getExtension(name: string): unknown;
  getParameter(pname: number): unknown;
}

/**
 * Times the GPU's work for each frame with EXT_disjoint_timer_query, where
 * the browser offers it (#143): Chrome does, Firefox only behind a pref.
 * Results arrive a few frames late; a disjoint frame (the GPU was
 * interrupted) is dropped.
 */
export class GpuTimer {
  /** The GPU time of the latest frame measured, in ms, if any. */
  last: number | undefined;
  private readonly gl: TimerGl;
  private readonly ext: TimerQueryExt | undefined;
  private active: WebGLQuery | undefined;
  private pending: WebGLQuery[] = [];

  constructor(gl: TimerGl) {
    this.gl = gl;
    this.ext = (gl.getExtension('EXT_disjoint_timer_query') ?? undefined) as TimerQueryExt | undefined;
  }

  /** Whether the browser offers a GPU timer. */
  get available(): boolean {
    return this.ext !== undefined;
  }

  /** Starts timing a frame's GPU work. */
  begin(): void {
    if (this.ext === undefined || this.active !== undefined) {
      return;
    }
    const query = this.ext.createQueryEXT();
    if (query === null) {
      return;
    }
    this.ext.beginQueryEXT(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  /** Stops timing the frame, and reads the frames whose results are in. */
  end(): void {
    const ext = this.ext;
    if (ext === undefined || this.active === undefined) {
      return;
    }
    ext.endQueryEXT(ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = undefined;
    const disjoint = this.gl.getParameter(ext.GPU_DISJOINT_EXT) === true;
    while (this.pending.length > 0) {
      const query = this.pending[0];
      if (query === undefined || ext.getQueryObjectEXT(query, ext.QUERY_RESULT_AVAILABLE_EXT) !== true) {
        break;
      }
      if (!disjoint) {
        this.last = Number(ext.getQueryObjectEXT(query, ext.QUERY_RESULT_EXT)) / 1e6;
      }
      ext.deleteQueryEXT(query);
      this.pending.shift();
    }
  }
}
