import * as THREE from 'three'
import { createJourneyScene, type JourneyScene, type JourneySceneOptions } from '../../app/journey/scene'
import type { StopState } from '../../app/journey/stops'
import { buildingDrawCalls } from './buildings-probe'
import { probeFacade } from './facade-probe'
import { probeGradient } from './gradient-probe'
import { breakRestoredComponent, componentResourceCounts, componentStatus, componentThemeStatus, mountComponent, setComponentDark, unmountComponent } from './component-probe'
import './post-probe'
import { diagnostics as rendererDiagnostics, readFrame as rendererFrame } from './gpu-utils'
import { measureRenderCost } from './render-cost'
import { skyProbe } from './sky-probe'
import { probeWindows } from './windows-probe'

let journey: JourneyScene | null = null
let renderer: THREE.WebGLRenderer | null = null
let context: { scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null
let canvas: HTMLCanvasElement | null = null
let latestFrame: number[] | null = null
let appliedState: StopState | null = null
// The composer renders fullscreen passes after the scene, which resets renderer.info; keep the scene's own draw calls.
let sceneCalls: number | null = null
let last = { chapter: 0, progress: 0, time: 0 }

function requireRenderer(): THREE.WebGLRenderer {
  if (!renderer) throw new Error('Mount a journey first')
  return renderer
}

function currentDiagnostics() {
  const base = rendererDiagnostics(requireRenderer())
  return sceneCalls === null ? base : { ...base, calls: sceneCalls }
}

const cityGpu = {
  sky: skyProbe,
  probeFacade,
  probeGradient,
  probeWindows,
  buildingDrawCalls,
  mountComponent,
  breakRestoredComponent,
  componentStatus,
  componentThemeStatus,
  setComponentDark,
  componentResourceCounts,
  unmountComponent,
  mountJourney(options: { tier: 'full' | 'lite' | 'reduced'; lowPower: boolean; width?: number; height?: number; initialDark?: boolean },
    observers?: Pick<JourneySceneOptions, 'onRenderer' | 'onSceneReady' | 'onStateApplied'>) {
    cityGpu.dispose()
    canvas = document.createElement('canvas')
    document.body.append(canvas)
    last = { chapter: 0, progress: 0, time: 0 }
    journey = createJourneyScene(canvas, options.tier, [{ title: 'GPU test exhibit', date: '2026-10' }], {
      lowPower: options.lowPower,
      onRenderer(value) {
        renderer = value; value.setPixelRatio(1)
        sceneCalls = null
        const originalRender = value.render.bind(value)
        value.render = (object, camera) => {
          originalRender(object, camera)
          if ((object as THREE.Scene).isScene) sceneCalls = value.info.render.calls
        }
        observers?.onRenderer?.(value)
      },
      onSceneReady(value) { context = value; observers?.onSceneReady?.(value) },
      onStateApplied(state) {
        appliedState = state
        observers?.onStateApplied?.(state)
      },
    })
    journey.resize(options.width ?? 640, options.height ?? 360)
    journey.setTheme(options.initialDark ?? true, { animate: false })
  },
  renderJourney(options: { chapter: number; progress?: number; time?: number; frames?: number }) {
    if (!journey) throw new Error('Mount a journey first')
    last = { chapter: options.chapter, progress: options.progress ?? 0, time: options.time ?? 0 }
    for (let i = 0; i < (options.frames ?? 240); i++) journey.update(last.chapter, last.progress, last.time, { x: 0, y: 0 })
    latestFrame = rendererFrame(requireRenderer())
    return currentDiagnostics()
  },
  setJourneyTheme(isDark: boolean, options?: { animate?: boolean }) {
    if (!journey) throw new Error('Mount a journey first')
    journey.setTheme(isDark, options)
    latestFrame = rendererFrame(requireRenderer())
  },
  stepJourney(input: { chapter?: number; progress?: number; time: number }) {
    return cityGpu.renderJourney({ chapter: input.chapter ?? last.chapter,
      progress: input.progress ?? last.progress, time: input.time, frames: 1 })
  },
  journeyState() {
    if (!appliedState) throw new Error('Journey has not applied a state')
    const { scene, camera, renderer } = cityGpu.getJourneyContext()
    const sun = scene.getObjectByName('journey-sun') as THREE.DirectionalLight
    const hemi = scene.getObjectByName('journey-hemi') as THREE.HemisphereLight
    const stars = scene.children.find(object => object instanceof THREE.Points) as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | undefined
    return { state: appliedState, camera: camera.position.toArray(),
      sunIntensity: sun.intensity, sunPosition: sun.position.toArray(), sunColor: sun.color.toArray(),
      hemiIntensity: hemi.intensity, hemiColor: hemi.color.toArray(), starOpacity: stars?.material.opacity ?? null,
      programs: (renderer.info.programs ?? []).map(program => program.id).sort((a, b) => a - b) }
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
        buildings: mesh.userData.buildingCount as number,
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
  diagnostics() { return currentDiagnostics() },
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
    appliedState = null
    canvas?.remove()
    canvas = null
  },
}

declare global {
  interface Window {
    cityGpu: typeof cityGpu
    __cityGpuRendererObserver?: (renderer: THREE.WebGLRenderer) => void
    __cityGpuThemeObserver?: (isDark: boolean, options?: { animate?: boolean }) => void
  }
}
window.cityGpu = cityGpu
