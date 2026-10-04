import Phaser from 'phaser';

/**
 * The blend Phaser's parallel filters finish with, cut down to the modes
 * they and the bloom use: copy, add and normal. Phaser's own FilterBlend
 * compiles every blend mode into one shader, which some phones' GPUs (a
 * PowerVR D-Series) run without an error but draw black (#180).
 */
const FRAGMENT = [
  '#pragma phaserTemplate(shaderName)',
  'precision mediump float;',
  'uniform sampler2D uMainSampler;',
  'uniform sampler2D uMainSampler2;',
  'uniform float amount;',
  'uniform vec4 color;',
  'uniform float mode;',
  'varying vec2 outTexCoord;',
  '#pragma phaserTemplate(fragmentHeader)',
  'void main ()',
  '{',
  '    vec4 base = texture2D(uMainSampler, outTexCoord);',
  '    vec4 blend = texture2D(uMainSampler2, outTexCoord) * color;',
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

  override setupUniforms(controller: Phaser.Filters.Controller): void {
    const blend = controller as unknown as BlendController;
    this.programManager.setUniform('uMainSampler2', 1);
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
