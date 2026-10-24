import type { FrameRegion } from './capture'

/**
 * Focus peaking on the GPU (WebGL 2): edges of the live picture that are in focus light up in a
 * colour. Found in full camera resolution, then drawn at the size of the view – each screen pixel
 * shows the strongest peak it covers, so thin edges stay visible when the picture is shown smaller.
 *
 * An edge counts as sharp by its shape, not by its contrast: how steep it is right at the pixel,
 * compared with how steep it is over a few pixels around it. A sharp edge rises within a pixel or
 * two (much steeper up close), a blurred one rises slowly (about the same either way) – however
 * bright or dark both sides are. Steepness below the noise of the camera never counts.
 */

const VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`

/** How sharp each pixel of the visible part of the frame is (0–1), one texel per frame pixel. */
const EDGES = `#version 300 es
precision highp float;
uniform sampler2D frame;
uniform ivec2 origin;
/** Steepness (brightness 0–1 per pixel) an edge needs at least – above the noise. */
uniform float minSlope;
/** How much steeper up close than over the wider span a sharp edge is at least. */
uniform float minRatio;
out vec4 result;

float luma(ivec2 p) {
  ivec2 size = textureSize(frame, 0);
  return dot(texelFetch(frame, clamp(p, ivec2(0), size - 1), 0).rgb, vec3(0.299, 0.587, 0.114));
}

/** Steepness at p (brightness per pixel): a Sobel filter with its taps step pixels apart. */
float slope(ivec2 p, int step) {
  float a = luma(p + ivec2(-step, -step));
  float b = luma(p + ivec2(0, -step));
  float c = luma(p + ivec2(step, -step));
  float d = luma(p + ivec2(-step, 0));
  float f = luma(p + ivec2(step, 0));
  float g = luma(p + ivec2(-step, step));
  float h = luma(p + ivec2(0, step));
  float i = luma(p + ivec2(step, step));
  float gx = (c + 2.0 * f + i) - (a + 2.0 * d + g);
  float gy = (g + 2.0 * h + i) - (a + 2.0 * b + c);
  return length(vec2(gx, gy)) / (8.0 * float(step));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) + origin;
  float near = slope(p, 1);
  float wide = slope(p, 3);
  float ratio = near / max(wide, 1e-4);
  float strength = smoothstep(minSlope, minSlope * 1.5, near)
    * smoothstep(minRatio, minRatio + 0.35, ratio);
  result = vec4(strength, 0.0, 0.0, 1.0);
}`

/** The peaks in their colour, at the size of the view. */
const PEAKS = `#version 300 es
precision highp float;
uniform sampler2D edges;
uniform vec2 scale;
uniform float height;
uniform vec3 color;
out vec4 result;

void main() {
  // Rows of the edges run from the top, the canvas counts from the bottom.
  vec2 pixel = vec2(gl_FragCoord.x - 0.5, height - gl_FragCoord.y - 0.5);
  ivec2 size = textureSize(edges, 0);
  ivec2 lo = ivec2(floor(pixel * scale));
  ivec2 hi = max(lo, ivec2(ceil((pixel + 1.0) * scale)) - 1);
  float strongest = 0.0;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      ivec2 q = lo + ivec2(x, y);
      if (q.x > hi.x || q.y > hi.y) continue;
      strongest = max(strongest, texelFetch(edges, clamp(q, ivec2(0), size - 1), 0).r);
    }
  }
  float alpha = strongest * 0.95;
  result = vec4(color * alpha, alpha);
}`

function compile(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const program = gl.createProgram()
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, fragment]
  ] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader konnte nicht übersetzt werden')
    }
    gl.attachShader(program, shader)
  }
  gl.bindAttribLocation(program, 0, 'position')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Shader konnte nicht verbunden werden')
  }
  return program
}

function texture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  for (const param of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
    gl.texParameteri(gl.TEXTURE_2D, param, gl.NEAREST)
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

export interface PeakingOptions {
  /** Part of the frame the view shows (frame pixels). */
  region: FrameRegion
  /** Steepness (brightness 0–1 per pixel) an edge needs at least – keep it above the noise. */
  minSlope: number
  /** How much steeper up close than over a few pixels a sharp edge is (1 = not at all, up to 3). */
  minRatio: number
  /** `#rrggbb` */
  color: string
}

export class PeakingRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly edgesProgram: WebGLProgram
  private readonly peaksProgram: WebGLProgram
  private readonly frame: WebGLTexture
  private readonly edges: WebGLTexture
  private readonly framebuffer: WebGLFramebuffer
  private edgesSize = { width: 0, height: 0 }

  /** Throws if the canvas has no WebGL 2. */
  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
    if (!gl) throw new Error('WebGL 2 ist nicht verfügbar')
    this.gl = gl
    this.edgesProgram = compile(gl, EDGES)
    this.peaksProgram = compile(gl, PEAKS)
    // One triangle that covers the whole target.
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.frame = texture(gl)
    this.edges = texture(gl)
    this.framebuffer = gl.createFramebuffer()
  }

  /** Draws the peaks of the current video frame onto the canvas (sized by the caller). */
  render(video: HTMLVideoElement, { region, minSlope, minRatio, color }: PeakingOptions): void {
    const { gl, canvas } = this
    const width = Math.max(1, Math.round(region.width))
    const height = Math.max(1, Math.round(region.height))

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.frame)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)

    gl.bindTexture(gl.TEXTURE_2D, this.edges)
    if (this.edgesSize.width !== width || this.edgesSize.height !== height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null)
      this.edgesSize = { width, height }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.edges, 0)
    gl.viewport(0, 0, width, height)
    gl.useProgram(this.edgesProgram)
    gl.bindTexture(gl.TEXTURE_2D, this.frame)
    gl.uniform1i(gl.getUniformLocation(this.edgesProgram, 'frame'), 0)
    gl.uniform2i(
      gl.getUniformLocation(this.edgesProgram, 'origin'),
      Math.round(region.x),
      Math.round(region.y)
    )
    gl.uniform1f(gl.getUniformLocation(this.edgesProgram, 'minSlope'), minSlope)
    gl.uniform1f(gl.getUniformLocation(this.edgesProgram, 'minRatio'), minRatio)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.peaksProgram)
    gl.bindTexture(gl.TEXTURE_2D, this.edges)
    const at = (name: string): WebGLUniformLocation | null =>
      gl.getUniformLocation(this.peaksProgram, name)
    gl.uniform1i(at('edges'), 0)
    gl.uniform2f(at('scale'), width / canvas.width, height / canvas.height)
    gl.uniform1f(at('height'), canvas.height)
    const n = parseInt(color.slice(1), 16)
    gl.uniform3f(at('color'), ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  clear(): void {
    const { gl } = this
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
