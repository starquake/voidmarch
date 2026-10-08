/** The renderer name Chromium and Safari report in place of the real one. */
const MASKED_RENDERER = 'WebKit WebGL';

/** Renderers that draw on the CPU: Chromium's, Mesa's, Windows' and macOS's. */
const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|microsoft basic render|apple software renderer/i;

/** What rendererName reads from a WebGL context. */
export interface RendererSource {
  readonly RENDERER: number;
  getParameter(pname: number): unknown;
  getExtension(name: 'WEBGL_debug_renderer_info'): WEBGL_debug_renderer_info | null;
}

/**
 * The GPU's name as WebGL reports it: RENDERER, or the debug extension's
 * unmasked name where the browser masks RENDERER. Asking only then keeps
 * Firefox, which reports the name and deprecates the extension, quiet.
 */
export function rendererName(gl: RendererSource): string {
  const plain = String(gl.getParameter(gl.RENDERER));
  if (plain !== MASKED_RENDERER) {
    return plain;
  }
  const debug = gl.getExtension('WEBGL_debug_renderer_info');

  return debug === null ? plain : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
}

/** Whether the renderer draws in software, with no GPU behind it (#234). */
export function isSoftwareRenderer(name: string): boolean {
  return SOFTWARE_RENDERERS.test(name);
}
