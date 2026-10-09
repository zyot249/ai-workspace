import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { getShaderErrorRecorder } from './shader-utils'
import type { Vec3 } from './stops'

export const TONE_MAPPING = THREE.NeutralToneMapping

export const POST_EMISSIVES = {
  lamp: { hex: 0xffdca8, gain: 2.8 },
  courtyard: { hex: 0xffe1a8, gain: 2.7 },
} as const

const BLOOM_MIN_STRENGTH = 0.01
const NEUTRAL_COMPRESSION_START = 0.8 - 0.04
const NEUTRAL_DESATURATION = 0.15

export function bloomEnabled(strength: number): boolean {
  return strength >= BLOOM_MIN_STRENGTH
}

// CPU mirror of three's NeutralToneMapping (see tonemapping_pars_fragment).
export function neutralToneMap(rgbLinear: Vec3, exposure: number): [number, number, number] {
  let c = rgbLinear.map(v => v * exposure) as [number, number, number]
  const x = Math.min(...c)
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04
  c = c.map(v => v - offset) as [number, number, number]
  const peak = Math.max(...c)
  if (peak < NEUTRAL_COMPRESSION_START) return c
  const d = 1 - NEUTRAL_COMPRESSION_START
  const newPeak = 1 - d * d / (peak + d - NEUTRAL_COMPRESSION_START)
  const g = 1 - 1 / (NEUTRAL_DESATURATION * (peak - newPeak) + 1)
  return c.map(v => (v * newPeak / peak) * (1 - g) + newPeak * g) as [number, number, number]
}

// Authored sRGB -> linear -> tone map -> sRGB, for sky and fog on the direct pipeline.
export function skyForDirectPipeline(authoredSrgb: Vec3, exposure: number): [number, number, number] {
  const linear = new THREE.Color().setRGB(...authoredSrgb, THREE.SRGBColorSpace)
  const mapped = neutralToneMap([linear.r, linear.g, linear.b], exposure)
  const color = new THREE.Color().setRGB(...mapped)
  const output = color.getRGB(new THREE.Color(), THREE.SRGBColorSpace)
  return [output.r, output.g, output.b]
}

const MAX_HDR_SAMPLES = 4
const BLOOM_RADIUS = 0.5
const BLOOM_THRESHOLD = 1.0

export interface PostPipeline {
  render(): void
  setSize(width: number, height: number, pixelRatio: number): void
  setLook(exposure: number, bloomStrength: number): void
  dispose(): void
}
export type PostSupport = { samples: number } | null
export interface PostTargets { composer: EffectComposer; bloom: UnrealBloomPass; output: OutputPass }
export interface PostPipelineOptions {
  probeSupport?: typeof probePostSupport
  onTargets?: (targets: PostTargets) => void
}

export function probePostSupport(renderer: THREE.WebGLRenderer): PostSupport {
  if (!(renderer.extensions.has('EXT_color_buffer_float') ||
    renderer.extensions.has('EXT_color_buffer_half_float'))) return null
  try {
    const gl = renderer.getContext() as WebGL2RenderingContext
    const counts = Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES) as Int32Array)
    const samples = Math.max(0, ...counts.filter(n => Number.isInteger(n) && n > 0 && n <= MAX_HDR_SAMPLES))
    return { samples }
  } catch { return null }
}

function drainProbeErrors(gl: WebGL2RenderingContext): void {
  if (gl.isContextLost()) throw new Error('[journey] context lost during post probe')
  while (gl.getError() !== gl.NO_ERROR) {
    if (gl.isContextLost()) throw new Error('[journey] context lost during post probe')
  }
}

// Reusable render-state snapshot; restores in `finally` so an addon that
// throws mid-render cannot leave the renderer on one of its targets.
function preservingState<T>(renderer: THREE.WebGLRenderer, action: () => T): T {
  const saved = {
    target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
    color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), auto: renderer.autoClear,
    viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(),
  }
  try { return action() } finally {
    renderer.setClearColor(saved.color, saved.alpha); renderer.autoClear = saved.auto
    renderer.setRenderTarget(saved.target, saved.face, saved.mip)
    renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor)
    renderer.setScissorTest(saved.scissorTest)
  }
}

function targetsComplete(gl: WebGL2RenderingContext, renderer: THREE.WebGLRenderer, chain: EffectComposer, glow: UnrealBloomPass): boolean {
  let complete = true
  const targets = [chain.renderTarget1, chain.renderTarget2, glow.renderTargetBright,
    ...glow.renderTargetsHorizontal, ...glow.renderTargetsVertical]
  for (const rt of targets) {
    renderer.setRenderTarget(rt)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) complete = false
  }
  if (gl.getError() !== gl.NO_ERROR) complete = false
  return complete
}

// Returns null when HDR bloom is unsupported; callers then render directly.
// Shader and JS failures propagate so the scene's unavailable guard handles them.
export function createPostPipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene,
  camera: THREE.Camera, options: PostPipelineOptions = {}): PostPipeline | null {
  const gl = renderer.getContext() as WebGL2RenderingContext
  const recorder = getShaderErrorRecorder(renderer)
  recorder?.assertClean()
  if (gl.isContextLost()) throw new Error('[journey] context lost before post probe')
  if (gl.getError() !== gl.NO_ERROR) throw new Error('[journey] GL error before post probe')
  const support = (options.probeSupport ?? probePostSupport)(renderer)
  if (!support) { renderer.setRenderTarget(null); drainProbeErrors(gl); return null }
  const drawing = renderer.getDrawingBufferSize(new THREE.Vector2())
  const target = new THREE.WebGLRenderTarget(Math.max(1, drawing.x), Math.max(1, drawing.y), {
    type: THREE.HalfFloatType, samples: support.samples,
  })
  let composer: EffectComposer | undefined
  let bloom: UnrealBloomPass | undefined
  let output: OutputPass | undefined
  let renderPass: RenderPass | undefined
  let disposed = false
  function cleanup() {
    if (disposed) return
    disposed = true
    output?.dispose()
    if (bloom) { bloom.materialHighPassFilter.dispose(); bloom.dispose() }
    renderPass?.dispose()
    if (composer) composer.dispose() // owns target + clone + copyPass
    else target.dispose()
  }
  try {
    composer = new EffectComposer(renderer, target)
    composer.setPixelRatio(1)
    composer.setSize(drawing.x, drawing.y)
    renderPass = new RenderPass(scene, camera)
    bloom = new UnrealBloomPass(drawing, 0.5, BLOOM_RADIUS, BLOOM_THRESHOLD)
    output = new OutputPass()
    composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(output)
    const chain = composer, glow = bloom
    let complete = true
    preservingState(renderer, () => {
      chain.render() // forced bloom; caller has already applied instance matrices/camera
      recorder?.assertClean() // shader failure is never a capability fallback
      complete = targetsComplete(gl, renderer, chain, glow)
    })
    if (!complete) { cleanup(); renderer.setRenderTarget(null); drainProbeErrors(gl); return null }
    options.onTargets?.({ composer: chain, bloom: glow, output })
    return {
      render() { preservingState(renderer, () => chain.render()) },
      setSize(w, h, dpr) {
        // Match renderer's integer drawing-buffer allocation at fractional DPR.
        chain.setPixelRatio(1)
        chain.setSize(Math.max(1, Math.floor(w * dpr)), Math.max(1, Math.floor(h * dpr)))
      },
      setLook(exposure, strength) {
        renderer.toneMappingExposure = exposure
        glow.strength = strength; glow.enabled = bloomEnabled(strength)
      },
      dispose: cleanup,
    }
  } catch (error) {
    cleanup(); renderer.setRenderTarget(null)
    throw error
  }
}
