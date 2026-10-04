/** How many errors the diagnostics keep, newest last. */
const KEEP = 4;

/**
 * Diagnostics for a device the game misbehaves on (`?diag=1`, #180): the
 * WebGL renderer's limits, and the errors the page and WebGL report, shown
 * in the HUD, where a phone without developer tools can still read them.
 */
export class Diagnostics {
  private readonly errors: string[] = [];
  private readonly info: string[];
  private readonly gl: WebGLRenderingContext | WebGL2RenderingContext | undefined;
  private readonly canvas: HTMLCanvasElement;

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext | undefined, canvas: HTMLCanvasElement) {
    this.gl = gl;
    this.canvas = canvas;
    this.info = describe(gl);
    window.addEventListener('error', (event) => {
      this.note(`error: ${event.message}`);
    });
    window.addEventListener('unhandledrejection', (event) => {
      this.note(`rejected: ${String(event.reason)}`);
    });
    const consoleError = console.error.bind(console);
    console.error = (...args: unknown[]): void => {
      this.note(`console: ${args.map(String).join(' ')}`);
      consoleError(...args);
    };
  }

  /** Reads WebGL's error flag once a frame, keeping any error it held. */
  check(): void {
    const code = this.gl?.getError() ?? 0;
    if (code !== 0) {
      this.note(`gl error 0x${code.toString(16)}`);
    }
  }

  /** The lines for the HUD; the canvas's size as it is now, since a phone turning changes it. */
  lines(): string[] {
    const size = `canvas ${String(this.canvas.width)}x${String(this.canvas.height)} window ${String(window.innerWidth)}x${String(window.innerHeight)} dpr ${String(window.devicePixelRatio)}`;

    return [...this.info, size, ...this.errors];
  }

  private note(message: string): void {
    this.errors.push(message.slice(0, 160));
    if (this.errors.length > KEEP) {
      this.errors.shift();
    }
  }
}

/** Two lines about the renderer: WebGL's version and GPU, then its limits and float precision. */
function describe(gl: WebGLRenderingContext | WebGL2RenderingContext | undefined): string[] {
  if (gl === undefined) {
    return ['no WebGL'];
  }
  const version = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl1';
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = debug === null ? 'gpu ?' : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
  const maxTexture = String(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0;
  const mediump = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT)?.precision ?? 0;

  return [`${version} · ${gpu}`, `max texture ${maxTexture} · fragment highp ${String(highp)} mediump ${String(mediump)} bits`];
}
