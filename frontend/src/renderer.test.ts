import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSoftwareRenderer, rendererName, type RendererSource } from './renderer.ts';

const RENDERER = 0x1f01;
const UNMASKED_RENDERER_WEBGL = 0x9246;

/** A context reporting plain as RENDERER, and unmasked through the debug extension unless it's undefined. */
function context(plain: string, unmasked: string | undefined): RendererSource & { askedForExtension: boolean } {
  return {
    RENDERER,
    askedForExtension: false,
    getParameter(pname: number): unknown {
      return pname === UNMASKED_RENDERER_WEBGL ? unmasked : plain;
    },
    getExtension() {
      this.askedForExtension = true;

      return unmasked === undefined ? null : { UNMASKED_RENDERER_WEBGL, UNMASKED_VENDOR_WEBGL: 0x9245 };
    },
  };
}

test('a renderer that draws on the CPU is software', () => {
  for (const name of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'Google SwiftShader',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'ANGLE (Mesa, llvmpipe (LLVM 15.0.7 256 bits), OpenGL 4.5)',
    'softpipe',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Apple Software Renderer',
  ]) {
    assert.equal(isSoftwareRenderer(name), true, name);
  }
});

test('a GPU, a masked name or none is not software', () => {
  for (const name of [
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)',
    'Apple GPU',
    'Adreno (TM) 650',
    'Mali-G78',
    'PowerVR D-Series DXT-48-1536',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Intel(R) UHD Graphics 620',
    'WebKit WebGL',
    '',
  ]) {
    assert.equal(isSoftwareRenderer(name), false, name);
  }
});

test('the name is RENDERER where the browser reports it, without asking for the extension', () => {
  const gl = context('llvmpipe, or similar', 'llvmpipe (LLVM 15.0.7, 256 bits)');
  assert.equal(rendererName(gl), 'llvmpipe, or similar');
  assert.equal(gl.askedForExtension, false);
});

test('a masked RENDERER is looked up through the debug extension', () => {
  assert.equal(rendererName(context('WebKit WebGL', 'Google SwiftShader')), 'Google SwiftShader');
});

test('without the debug extension a masked RENDERER stays masked', () => {
  assert.equal(rendererName(context('WebKit WebGL', undefined)), 'WebKit WebGL');
});
