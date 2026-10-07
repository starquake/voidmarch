import Phaser from 'phaser';

import { enlargedSize } from '../display.ts';

/**
 * The blend Phaser's parallel filters finish with, cut down to the modes
 * they and the bloom use: copy, add and normal. Phaser's own FilterBlend
 * compiles every blend mode into one shader, which some phones' GPUs (a
 * PowerVR D-Series) run without an error but draw black (#180).
 *
 * A top image smaller than the output, the bloom's half-size glow, is read
 * with bilinear lookups made by hand, since framebuffers in pixel-art mode
 * filter to the nearest pixel. It is read as the full-size copy the bloom
 * drew before #234: at that copy's pixel centers, rounded to its 8 bits, so
 * the glow is the same without drawing the copy.
 */
const FRAGMENT = [
  '#pragma phaserTemplate(shaderName)',
  // mediump can be 16 bits on a phone, too coarse for pixel positions past 2048 (#180).
  '#ifdef GL_FRAGMENT_PRECISION_HIGH',
  'precision highp float;',
  '#else',
  'precision mediump float;',
  '#endif',
  'uniform sampler2D uMainSampler;',
  'uniform sampler2D uMainSampler2;',
  'uniform vec2 topSize;',
  'uniform vec2 copySize;',
  'uniform float amount;',
  'uniform vec4 color;',
  'uniform float mode;',
  'varying vec2 outTexCoord;',
  '#pragma phaserTemplate(fragmentHeader)',
  'vec4 top ()',
  '{',
  '    if (topSize.x == 0.0) {',
  '        return texture2D(uMainSampler2, outTexCoord);',
  '    }',
  '    vec2 at = (floor(outTexCoord * copySize) + 0.5) / copySize;',
  '    vec2 p = at * topSize - 0.5;',
  '    vec2 f = fract(p);',
  '    vec2 i = floor(p);',
  '    vec4 a = texture2D(uMainSampler2, (i + vec2(0.5, 0.5)) / topSize);',
  '    vec4 b = texture2D(uMainSampler2, (i + vec2(1.5, 0.5)) / topSize);',
  '    vec4 c = texture2D(uMainSampler2, (i + vec2(0.5, 1.5)) / topSize);',
  '    vec4 d = texture2D(uMainSampler2, (i + vec2(1.5, 1.5)) / topSize);',
  '    return floor(mix(mix(a, b, f.x), mix(c, d, f.x), f.y) * 255.0 + 0.5) / 255.0;',
  '}',
  'void main ()',
  '{',
  '    vec4 base = texture2D(uMainSampler, outTexCoord);',
  '    vec4 blend = top() * color;',
  '    vec4 blended = blend + base * (1.0 - blend.a);',
  '    if (mode > 1.5) {',
  '        blended = blend;',
  '    } else if (mode > 0.5) {',
  '        blended = base + blend;',
  '    }',
  '    gl_FragColor = mix(base, blended, amount);',
  '}',
].join('\n');

/** What the blend reads from its controller: Phaser's Blend, or the parallel filters' copy. */
interface BlendController {
  blendMode: number;
  glTexture: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper;
  amount: number;
  color: number[];
}

/** The modes the shader knows: anything else draws as normal. */
function modeOf(blendMode: number): number {
  if (blendMode === Phaser.BlendModes.COPY) {
    return 2;
  }

  return blendMode === Phaser.BlendModes.ADD ? 1 : 0;
}

/** Phaser's FilterBlend in a small shader. */
class SmallBlendNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super('FilterBlend', manager, undefined, FRAGMENT);
  }

  override setupTextures(controller: Phaser.Filters.Controller, textures: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper[]): void {
    textures[1] = (controller as unknown as BlendController).glTexture;
  }

  override setupUniforms(controller: Phaser.Filters.Controller, drawingContext: Phaser.Renderer.WebGL.DrawingContext): void {
    const blend = controller as unknown as BlendController;
    const top = blend.glTexture;
    const sameSize = top.width === drawingContext.width && top.height === drawingContext.height;
    const copy = enlargedSize(top, drawingContext);
    this.programManager.setUniform('uMainSampler2', 1);
    this.programManager.setUniform('topSize', sameSize ? [0, 0] : [top.width, top.height]);
    this.programManager.setUniform('copySize', [copy.width, copy.height]);
    this.programManager.setUniform('amount', blend.amount);
    this.programManager.setUniform('color', blend.color);
    this.programManager.setUniform('mode', modeOf(blend.blendMode));
  }
}

const registered = new WeakSet<Phaser.Renderer.WebGL.WebGLRenderer>();

/** Puts the small blend in Phaser's place, once, before Phaser makes its own on first use. */
export function registerSmallBlend(renderer: Phaser.Renderer.WebGL.WebGLRenderer): void {
  if (registered.has(renderer)) {
    return;
  }
  registered.add(renderer);
  renderer.renderNodes.addNode('FilterBlend', new SmallBlendNode(renderer.renderNodes));
}
