import * as THREE from 'three'
import { createJourneyScene, type JourneyScene, type JourneySceneOptions } from '../../app/journey/scene'
import { probeFacade } from './facade-probe'
import { breakRestoredComponent, componentResourceCounts, componentStatus, mountComponent, unmountComponent } from './component-probe'
import { diagnostics as rendererDiagnostics, readFrame as rendererFrame } from './gpu-utils'
import { measureRenderCost } from './render-cost'

let journey: JourneyScene | null = null
let renderer: THREE.WebGLRenderer | null = null
let context: { scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null
let canvas: HTMLCanvasElement | null = null
let latestFrame: number[] | null = null
let last = { chapter: 0, progress: 0, time: 0 }

function requireRenderer(): THREE.WebGLRenderer {
  if (!renderer) throw new Error('Mount a journey first')
  return renderer
}

const cityGpu = {
  probeFacade,
  mountComponent,
  breakRestoredComponent,
  componentStatus,
  componentResourceCounts,
  unmountComponent,
  mountJourney(options: { tier: 'full' | 'lite' | 'reduced'; lowPower: boolean; width?: number; height?: number },
    observers?: Pick<JourneySceneOptions, 'onRenderer' | 'onSceneReady'>) {
    cityGpu.dispose()
    canvas = document.createElement('canvas')
    document.body.append(canvas)
    last = { chapter: 0, progress: 0, time: 0 }
    journey = createJourneyScene(canvas, options.tier, [{ title: 'GPU test exhibit', date: '2026-10' }], {
      lowPower: options.lowPower,
      onRenderer(value) { renderer = value; value.setPixelRatio(1); observers?.onRenderer?.(value) },
      onSceneReady(value) { context = value; observers?.onSceneReady?.(value) },
    })
    journey.resize(options.width ?? 640, options.height ?? 360)
  },
  renderJourney(options: { chapter: number; progress?: number; time?: number; frames?: number }) {
    if (!journey) throw new Error('Mount a journey first')
    last = { chapter: options.chapter, progress: options.progress ?? 0, time: options.time ?? 0 }
    for (let i = 0; i < (options.frames ?? 240); i++) journey.update(last.chapter, last.progress, last.time, { x: 0, y: 0 })
    latestFrame = rendererFrame(requireRenderer())
    return rendererDiagnostics(requireRenderer())
  },
  getJourneyContext() {
    if (!context) throw new Error('Journey warmup did not complete')
    return { ...context, renderer: requireRenderer() }
  },
  journeyLayers() {
    const { scene } = cityGpu.getJourneyContext()
    return scene.children
      .filter((object): object is THREE.InstancedMesh => object instanceof THREE.InstancedMesh
        && object.material instanceof THREE.Material && object.material.name.startsWith('journey-facade-'))
      .map(mesh => ({
        count: mesh.count,
        seedCount: mesh.geometry.getAttribute('aSeed').count,
        frustumCulled: mesh.frustumCulled,
        variant: (mesh.material as THREE.Material).name,
      }))
  },
  resizeJourney(width: number, height: number) {
    if (!journey) throw new Error('Mount a journey first')
    latestFrame = null
    journey.resize(width, height)
  },
  getJourneyUpdate() {
    if (!journey) throw new Error('Mount a journey first')
    const mounted = journey
    return () => mounted.update(last.chapter, last.progress, last.time, { x: 0, y: 0 })
  },
  async measureJourney(options: { chapter: number; durationMs?: number }) {
    cityGpu.renderJourney({ chapter: options.chapter, frames: 240 })
    return measureRenderCost(requireRenderer(), cityGpu.getJourneyUpdate(), options.durationMs)
  },
  diagnostics() { return rendererDiagnostics(requireRenderer()) },
  readFrame() {
    if (!latestFrame) throw new Error('Render a journey frame before reading its pixels')
    return latestFrame
  },
  async loseAndRestore() {
    if (!canvas) throw new Error('Mount a journey first')
    const target = canvas
    const gl = requireRenderer().getContext()
    const extension = gl.getExtension('WEBGL_lose_context')
    if (!extension) throw new Error('WEBGL_lose_context unavailable')
    const restored = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Context restore timed out')), 10000)
      target.addEventListener('webglcontextlost', event => {
        event.preventDefault()
        setTimeout(() => extension.restoreContext(), 100)
      }, { once: true })
      target.addEventListener('webglcontextrestored', () => { clearTimeout(timeout); resolve() }, { once: true })
    })
    extension.loseContext()
    await restored
    return cityGpu.renderJourney({ ...last, frames: 1 })
  },
  dispose() {
    journey?.dispose()
    journey = null
    renderer = null
    context = null
    latestFrame = null
    canvas?.remove()
    canvas = null
  },
}

declare global {
  interface Window {
    cityGpu: typeof cityGpu
    __cityGpuRendererObserver?: (renderer: THREE.WebGLRenderer) => void
  }
}
window.cityGpu = cityGpu
