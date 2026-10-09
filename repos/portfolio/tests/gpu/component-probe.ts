import * as THREE from 'three'
import { createApp, h, nextTick, ref, type App } from 'vue'
import JourneyCanvas from '../../app/components/JourneyCanvas.vue'

const invalid = '\n#error deliberately invalid journey shader\n'
let app: App | null = null
let capturedRenderer: THREE.WebGLRenderer | null = null
let capturedCanvas: HTMLCanvasElement | null = null
let capturedScene: THREE.Scene | null = null
let previousObserver: Window['__cityGpuRendererObserver']
let componentDark = ref(false)
let previousThemeObserver: Window['__cityGpuThemeObserver']
let themeCalls: { isDark: boolean; animate: boolean | undefined }[] = []
type ShaderFault = 'glsl' | 'missing-marker'
let creationFault: { fault: ShaderFault; prefix: string } | null = null
let unavailable = 0
let disposed = 0
let updatesAfterFailure = 0
const observed = new Map<{ dispose(): void }, number>()

function breakFacadeShader(scene: THREE.Scene, fault: ShaderFault = 'glsl', prefix = 'journey-facade-') {
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if (!material.name.startsWith(prefix)) continue
      const originalCompile = material.onBeforeCompile.bind(material)
      material.onBeforeCompile = (shader, renderer) => {
        if (fault === 'missing-marker') shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '')
        originalCompile(shader, renderer)
        if (fault === 'glsl') shader.fragmentShader += invalid
      }
      material.needsUpdate = true
    }
  })
}

function track(resource: { dispose(): void }) {
  if (observed.has(resource)) return
  observed.set(resource, 0)
  const originalDispose = resource.dispose.bind(resource)
  resource.dispose = () => {
    observed.set(resource, observed.get(resource)! + 1)
    originalDispose()
  }
}

function observeSceneResources(scene: THREE.Scene) {
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return
    track(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      track(material)
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) track(value)
    }
  })
}

export async function mountComponent(options: { failure: 'none' | 'creation' | 'missing-marker' | 'sky-creation'; beforeMount?: () => void; chapter?: number; initialDark?: boolean }): Promise<void> {
  unmountComponent()
  unavailable = 0
  disposed = 0
  updatesAfterFailure = 0
  observed.clear()
  creationFault = options.failure === 'creation' ? { fault: 'glsl', prefix: 'journey-facade-' }
    : options.failure === 'missing-marker' ? { fault: 'missing-marker', prefix: 'journey-facade-' }
      : options.failure === 'sky-creation' ? { fault: 'glsl', prefix: 'journey-sky' }
        : null
  componentDark = ref(options.initialDark ?? false)
  themeCalls = []
  previousThemeObserver = window.__cityGpuThemeObserver
  window.__cityGpuThemeObserver = (isDark, themeOptions) => {
    themeCalls.push({ isDark, animate: themeOptions?.animate })
    previousThemeObserver?.(isDark, themeOptions)
  }
  previousObserver = window.__cityGpuRendererObserver
  window.__cityGpuRendererObserver = renderer => {
    capturedRenderer = renderer
    capturedCanvas = renderer.domElement
    const originalRender = renderer.render.bind(renderer)
    const originalDispose = renderer.dispose.bind(renderer)
    renderer.render = (scene, camera) => {
      if (unavailable > 0) updatesAfterFailure++
      // The composer also renders fullscreen quads through this method; only the journey scene counts.
      if (!(scene as THREE.Scene).isScene) return originalRender(scene, camera)
      observeSceneResources(scene as THREE.Scene)
      capturedScene = scene as THREE.Scene
      if (creationFault) {
        const { fault, prefix } = creationFault
        creationFault = null
        breakFacadeShader(capturedScene, fault, prefix)
      }
      originalRender(scene, camera)
    }
    renderer.dispose = () => { disposed++; originalDispose() }
  }
  options.beforeMount?.()
  const host = document.querySelector('#journey-component')
  if (!host) throw new Error('Journey component host missing')
  app = createApp({ render: () => h(JourneyCanvas, {
    chapter: options.chapter ?? 3, progress: 0, isDark: componentDark.value,
    projectItems: [{ title: 'Disposal probe', date: '2026-10' }],
    onUnavailable() { unavailable++ },
  }) })
  app.mount(host)
  await nextTick()
}

export async function breakRestoredComponent(options: { beforeRestore?: () => void } = {}): Promise<void> {
  if (!capturedCanvas || !capturedRenderer) throw new Error('Component renderer unavailable')
  const target = capturedCanvas
  const extension = capturedRenderer.getContext().getExtension('WEBGL_lose_context')
  if (!extension) throw new Error('WEBGL_lose_context unavailable')
  const restored = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Component context restore timed out')), 10000)
    target.addEventListener('webglcontextlost', event => {
      event.preventDefault()
      options.beforeRestore ? options.beforeRestore() : breakFacadeShader(capturedScene!)
      setTimeout(() => extension.restoreContext(), 100)
    }, { once: true })
    target.addEventListener('webglcontextrestored', () => { clearTimeout(timeout); resolve() }, { once: true })
  })
  extension.loseContext()
  await restored
}

export function componentStatus() {
  const canvas = document.querySelector<HTMLCanvasElement>('#journey-component canvas')
  return {
    unavailable,
    visible: Boolean(canvas && getComputedStyle(canvas).display !== 'none'),
    updatesAfterFailure,
    disposed,
  }
}

export async function setComponentDark(isDark: boolean): Promise<void> {
  componentDark.value = isDark
  await nextTick()
}

export function componentThemeStatus() {
  const sky = capturedScene?.background
  const rgb = sky instanceof THREE.Color ? sky.getRGB(new THREE.Color(), THREE.SRGBColorSpace).toArray() : null
  return { calls: [...themeCalls], sky: rgb }
}

export function componentResourceCounts(): number[] { return [...observed.values()] }

export function unmountComponent() {
  app?.unmount()
  app = null
  window.__cityGpuRendererObserver = previousObserver
  window.__cityGpuThemeObserver = previousThemeObserver
  capturedRenderer = null
  capturedCanvas = null
  capturedScene = null
  document.querySelector('#journey-component')?.replaceChildren()
}
