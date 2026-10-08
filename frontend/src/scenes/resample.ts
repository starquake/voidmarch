import Phaser from 'phaser';

/** The render node's name, as Phaser looks filters up. */
const RESAMPLE_NODE = 'FilterResample';

/**
 * Bilinear lookups, made by hand because framebuffers in pixel-art mode
 * filter to the nearest pixel: halving averages each 2x2 block. Then what's
 * below the threshold goes, as Phaser's Threshold filter does it, from the
 * average rounded to 8 bits, as that filter read it from its own pass
 * before #234.
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
  'uniform vec2 inputSize;',
  'uniform float threshold;',
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
  '    vec4 color = floor(mix(mix(a, b, f.x), mix(c, d, f.x), f.y) * 255.0 + 0.5) / 255.0;',
  '    gl_FragColor = clamp((color - threshold) / (1.0 - threshold), 0.0, 1.0);',
  '}',
].join('\n');

/**
 * A filter that resizes the image by scale, smoothly, keeping only what's
 * brighter than threshold: the bloom halves its image as it picks out the
 * bright parts, so its blur covers a quarter of the pixels (#143, #234).
 */
export class Resample extends Phaser.Filters.Controller {
  readonly scale: number;
  readonly threshold: number;

  constructor(camera: Phaser.Cameras.Scene2D.Camera, scale: number, threshold = 0) {
    super(camera, RESAMPLE_NODE);
    this.scale = scale;
    this.threshold = threshold;
  }
}

/** Draws its input into a context scale times its size. */
class ResampleNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  private inputSize: [number, number] = [1, 1];
  private threshold = 0;

  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super(RESAMPLE_NODE, manager, undefined, FRAGMENT);
  }

  override run(
    controller: Phaser.Filters.Controller,
    inputDrawingContext: Phaser.Renderer.WebGL.DrawingContext,
    outputDrawingContext?: Phaser.Renderer.WebGL.DrawingContext,
  ): Phaser.Renderer.WebGL.DrawingContext {
    const resample = controller instanceof Resample ? controller : undefined;
    const scale = resample?.scale ?? 1;
    this.threshold = resample?.threshold ?? 0;
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
    this.programManager.setUniform('threshold', this.threshold);
  }
}

/** Makes the Resample filter known to the renderer, once. */
export function registerResample(renderer: Phaser.Renderer.WebGL.WebGLRenderer): void {
  if (renderer.renderNodes.getNode(RESAMPLE_NODE) === null) {
    renderer.renderNodes.addNodeConstructor(RESAMPLE_NODE, ResampleNode);
  }
}
