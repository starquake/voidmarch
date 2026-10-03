import Phaser from 'phaser';

/** The render node's name, as Phaser looks filters up. */
const RESAMPLE_NODE = 'FilterResample';

/**
 * Bilinear lookups, made by hand because framebuffers in pixel-art mode
 * filter to the nearest pixel: halving averages each 2x2 block, and
 * doubling blends smoothly instead of making blocks.
 */
const FRAGMENT = [
  '#pragma phaserTemplate(shaderName)',
  'precision mediump float;',
  'uniform sampler2D uMainSampler;',
  'uniform vec2 inputSize;',
  'varying vec2 outTexCoord;',
  '#pragma phaserTemplate(fragmentHeader)',
  'void main ()',
  '{',
  '    vec2 p = outTexCoord * inputSize - 0.5;',
  '    vec2 f = fract(p);',
  '    vec2 i = floor(p);',
  '    vec4 a = texture2D(uMainSampler, (i + vec2(0.5, 0.5)) / inputSize);',
  '    vec4 b = texture2D(uMainSampler, (i + vec2(1.5, 0.5)) / inputSize);',
  '    vec4 c = texture2D(uMainSampler, (i + vec2(0.5, 1.5)) / inputSize);',
  '    vec4 d = texture2D(uMainSampler, (i + vec2(1.5, 1.5)) / inputSize);',
  '    gl_FragColor = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
  '}',
].join('\n');

/**
 * A filter that resizes the image by scale, smoothly: the bloom halves its
 * image before its threshold and blur, and doubles it back after, so those
 * passes cover a quarter of the pixels (#143).
 */
export class Resample extends Phaser.Filters.Controller {
  readonly scale: number;

  constructor(camera: Phaser.Cameras.Scene2D.Camera, scale: number) {
    super(camera, RESAMPLE_NODE);
    this.scale = scale;
  }
}

/** Draws its input into a context scale times its size. */
class ResampleNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  private inputSize: [number, number] = [1, 1];

  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super(RESAMPLE_NODE, manager, undefined, FRAGMENT);
  }

  override run(
    controller: Phaser.Filters.Controller,
    inputDrawingContext: Phaser.Renderer.WebGL.DrawingContext,
    outputDrawingContext?: Phaser.Renderer.WebGL.DrawingContext,
  ): Phaser.Renderer.WebGL.DrawingContext {
    const scale = controller instanceof Resample ? controller.scale : 1;
    this.inputSize = [inputDrawingContext.width, inputDrawingContext.height];
    const output =
      outputDrawingContext ??
      this.manager.renderer.drawingContextPool.get(
        Math.max(1, Math.round(inputDrawingContext.width * scale)),
        Math.max(1, Math.round(inputDrawingContext.height * scale)),
      );

    // Padding would shift the halved image against the full one it's added to.
    return super.run(controller, inputDrawingContext, output, new Phaser.Geom.Rectangle());
  }

  override setupUniforms(): void {
    this.programManager.setUniform('inputSize', this.inputSize);
  }
}

/** Makes the Resample filter known to the renderer, once. */
export function registerResample(renderer: Phaser.Renderer.WebGL.WebGLRenderer): void {
  if (renderer.renderNodes.getNode(RESAMPLE_NODE) === null) {
    renderer.renderNodes.addNodeConstructor(RESAMPLE_NODE, ResampleNode);
  }
}
