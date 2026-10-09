import * as THREE from 'three'
import { createTestRenderer } from './gpu-utils'
import {
  createPostPipeline, probePostSupport, TONE_MAPPING,
  type PostPipeline, type PostTargets,
} from '../../app/journey/post'

type PostFault = 'half-float' | 'samples' | 'framebuffer'

interface SyntheticInput {
  width: number; height: number; pixelRatio: number; luminance: number; strength: number
  exposure?: number; fault?: PostFault
}
interface SyntheticResult {
  pipeline: 'composer' | 'direct'
  center: number[]; adjacent: number[]
  sizes: { full: [number, number]; bright: [number, number]; mips: [number, number][] } | null
  shaderError: string | null; glError: number
}
interface RendererState {
  targetRestored: boolean; color: number; alpha: number; auto: boolean
  viewport: number[]; scissor: number[]; scissorTest: boolean
}
interface LifetimeResult {
  counts: number[]; expected: RendererState; created: RendererState; rendered: RendererState
  thrown: RendererState; baselineTextures: number; remainingTextures: number
  shaderError: string | null; glError: number
}

function synthetic({ width, height, pixelRatio, luminance, strength, exposure = 1, fault }: SyntheticInput): SyntheticResult {
  const fixture = createTestRenderer({ width, height })
  const { renderer, recorder } = fixture
  renderer.setPixelRatio(pixelRatio); renderer.setSize(width, height, false)
  renderer.toneMapping = TONE_MAPPING; renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); camera.position.z = 2
  const geometry = new THREE.PlaneGeometry(0.4, 0.4)
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(luminance, luminance, luminance) })
  scene.add(new THREE.Mesh(geometry, material))
  let resources: PostTargets | undefined
  const gl = renderer.getContext() as WebGL2RenderingContext
  const originalStatus = gl.checkFramebufferStatus.bind(gl)
  const originalFormat = gl.getInternalformatParameter.bind(gl)
  if (fault === 'framebuffer') gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_UNSUPPORTED
  if (fault === 'samples') {
    gl.getInternalformatParameter = (target, internalformat, pname) => {
      if (internalformat === gl.RGBA16F) throw new Error('fixture sample query failure')
      return originalFormat(target, internalformat, pname)
    }
  }
  let post: PostPipeline | null = null
  try {
    post = createPostPipeline(renderer, scene, camera, {
      probeSupport: fault === 'half-float' ? () => null : probePostSupport,
      onTargets: targets => { resources = targets },
    })
    post?.setLook(exposure, strength); renderer.toneMappingExposure = exposure
    if (post) post.render(); else renderer.render(scene, camera)
    recorder.assertClean()
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
    const pixel = (x: number, y: number): number[] => {
      const out = new Uint8Array(4)
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
      return Array.from(out)
    }
    // Quad right edge is x = .6*w. Three pixels outside avoids raster coverage.
    return {
      pipeline: post ? 'composer' : 'direct', center: pixel(Math.floor(w / 2), Math.floor(h / 2)),
      adjacent: pixel(Math.ceil(w * 0.6) + 3, Math.floor(h / 2)),
      sizes: resources ? {
        full: [resources.composer.renderTarget1.width, resources.composer.renderTarget1.height],
        bright: [resources.bloom.renderTargetBright.width, resources.bloom.renderTargetBright.height],
        mips: resources.bloom.renderTargetsHorizontal.map(t => [t.width, t.height] as [number, number]),
      } : null,
      shaderError: recorder.error?.message ?? null, glError: gl.getError(),
    }
  } finally {
    gl.checkFramebufferStatus = originalStatus
    gl.getInternalformatParameter = originalFormat
    post?.dispose(); geometry.dispose(); material.dispose(); fixture.dispose()
  }
}

function lifetime(): LifetimeResult {
  const fixture = createTestRenderer({ width: 128, height: 128 })
  const { renderer, recorder } = fixture
  renderer.toneMapping = TONE_MAPPING
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10)
  camera.position.z = 2
  const sentinel = new THREE.WebGLRenderTarget(128, 128)
  renderer.setRenderTarget(sentinel)
  const baselineTextures = renderer.info.memory.textures
  renderer.setClearColor(0x123456, 0.4); renderer.autoClear = false
  renderer.setViewport(2, 3, 100, 90); renderer.setScissor(4, 5, 80, 70); renderer.setScissorTest(true)
  function state(): RendererState {
    return {
      targetRestored: renderer.getRenderTarget() === sentinel,
      color: renderer.getClearColor(new THREE.Color()).getHex(), alpha: renderer.getClearAlpha(), auto: renderer.autoClear,
      viewport: renderer.getViewport(new THREE.Vector4()).toArray(), scissor: renderer.getScissor(new THREE.Vector4()).toArray(),
      scissorTest: renderer.getScissorTest(),
    }
  }
  const expected = state(), counts: number[] = []
  let targets: PostTargets | undefined, post: PostPipeline | null = null
  try {
    post = createPostPipeline(renderer, scene, camera, { onTargets: t => { targets = t } })
    if (!post || !targets) throw new Error('lifetime test requires supported composer')
    const t = targets
    const owned = new Set<THREE.EventDispatcher<{ dispose: object }>>([
      t.composer.renderTarget1, t.composer.renderTarget2, t.bloom.renderTargetBright,
      ...t.bloom.renderTargetsHorizontal, ...t.bloom.renderTargetsVertical,
      t.output.material, t.bloom.materialHighPassFilter, ...t.bloom.separableBlurMaterials,
      t.bloom.compositeMaterial, t.bloom.blendMaterial,
    ] as unknown as THREE.EventDispatcher<{ dispose: object }>[])
    for (const resource of owned) {
      const index = counts.push(0) - 1
      resource.addEventListener('dispose', () => { counts[index] = counts[index]! + 1 })
    }
    const created = state()
    post.setLook(1.25, 0.42); post.render(); const rendered = state()
    const original = t.output.render
    t.output.render = () => { throw new Error('fixture output render failure') }
    let propagated = false
    try { post.render() } catch (error) { propagated = String(error).includes('fixture output render failure') }
    finally { t.output.render = original }
    if (!propagated) throw new Error('render exception was swallowed')
    const thrown = state()
    post.dispose(); post.dispose()
    renderer.setRenderTarget(sentinel); renderer.render(scene, camera)
    return {
      counts, expected, created, rendered, thrown, baselineTextures,
      remainingTextures: renderer.info.memory.textures, shaderError: recorder.error?.message ?? null,
      glError: renderer.getContext().getError(),
    }
  } finally { post?.dispose(); sentinel.dispose(); fixture.dispose() }
}

let sawOutput = false
let restoreActualRenderer: (() => void) | undefined

function mountActual(input: { tier: 'full' | 'lite' | 'reduced'; lowPower: boolean; forceNoHalfFloat?: boolean; width: number; height: number }): void {
  sawOutput = false
  let restoreExtension: (() => void) | undefined
  try {
    window.cityGpu.mountJourney(input, {
      onRenderer(renderer) {
        const oldHas = renderer.extensions.has
        if (input.forceNoHalfFloat) {
          renderer.extensions.has = name => ['EXT_color_buffer_float', 'EXT_color_buffer_half_float'].includes(name)
            ? false : oldHas.call(renderer.extensions, name)
          restoreExtension = () => { renderer.extensions.has = oldHas }
        }
        const oldRender = renderer.render
        renderer.render = function (object, camera) {
          const mesh = object as THREE.Mesh
          const material = mesh.material
          if (mesh.isMesh && !Array.isArray(material) && material?.name === 'OutputShader') sawOutput = true
          return oldRender.call(renderer, object, camera)
        }
        restoreActualRenderer = () => { renderer.render = oldRender }
      },
    })
  } finally { restoreExtension?.() }
}

function actualDiagnostics() {
  const { renderer, scene } = window.cityGpu.getJourneyContext()
  const owned = new Set<THREE.MeshBasicMaterial>()
  scene.traverse(object => {
    const material = (object as THREE.Mesh).material
    if (material instanceof THREE.MeshBasicMaterial &&
      ['journey-lamp-glow', 'journey-courtyard-window'].includes(material.name)) owned.add(material)
  })
  return {
    ...window.cityGpu.diagnostics(), composer: sawOutput, toneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure, expectedToneMapping: TONE_MAPPING,
    ownedLuminance: [...owned].map(m => 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b),
  }
}

function disposeActual(): void {
  restoreActualRenderer?.(); restoreActualRenderer = undefined
  window.cityGpu.dispose()
}

let originalPostCompile: THREE.Material['onBeforeCompile'] | undefined

// RawShaderMaterial inherits Material.prototype.onBeforeCompile, so patching it
// reaches the fullscreen post programs without touching facade shaders.
function installPostFault(stage: 'output' | 'bloom' = 'output'): void {
  if (originalPostCompile) throw new Error('post fault already installed')
  const original = THREE.Material.prototype.onBeforeCompile
  originalPostCompile = original
  THREE.Material.prototype.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
    original.call(this, shader, renderer)
    const isBloom = 'uniforms' in this && Boolean((this as THREE.ShaderMaterial).uniforms.luminosityThreshold)
    if ((stage === 'output' && this.name === 'OutputShader') || (stage === 'bloom' && isBloom)) {
      shader.fragmentShader += '\ninvalid_post_fullscreen_token;\n'
    }
  }
}

function restorePostFault(): void {
  if (originalPostCompile) THREE.Material.prototype.onBeforeCompile = originalPostCompile
  originalPostCompile = undefined
}

const cityPost = { synthetic, lifetime, mountActual, actualDiagnostics, disposeActual, installPostFault, restorePostFault }
declare global { interface Window { cityPost: typeof cityPost } }
window.cityPost = cityPost
