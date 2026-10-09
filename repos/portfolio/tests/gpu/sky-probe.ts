import * as THREE from 'three'
import { createPostPipeline } from '../../app/journey/post'
import { SKY_NAME } from '../../app/journey/sky'
import type { SkyVariant } from '../../app/journey/sky-mirror'
import { createHazeMesh, GROUND_NAME, HAZE_BASE_Y, HAZE_HEIGHT, HAZE_NAME, HAZE_RADIUS, RINGS } from '../../app/journey/skyline-far'
import type { StopState } from '../../app/journey/stops'
import { createTestRenderer, readPixel } from './gpu-utils'

const SETTLE_FRAMES = 160 // damping 0.08 leaves (0.92)^160, about 2e-6, of any change
const MID_BLEND_FRAMES = 36 // 0.6 s of 1/60 s steps: themeMix 0.5
const BACKDROP = new Set([SKY_NAME, HAZE_NAME, GROUND_NAME, RINGS.a.name, RINGS.b.name])
const WALL_WIDTH = 20
const WALL_DEPTH = 1
const WALL_COLOR = 0x303040
const WALL_SAMPLE_OFFSET = 3 // pixels above and below the wall's top edge
const INTERIOR_OFFSET = 1.5 // pixels; MSAA blends silhouette edges, so city samples must be interior
const HAZE_PROBE_HEIGHT = 400

export type SkyTheme = 'light' | 'dark' | 'mid'
export interface SkyMountInput { tier: 'full' | 'lite' | 'reduced'; lowPower: boolean; width?: number; height?: number }
export interface SkySampling { xStride: number; yStride: number; minH: number; maxH: number; column?: number }
export interface SkyViewInput {
  view?: { position?: [number, number, number]; direction: [number, number, number] }
  only?: string[]
  hide?: string[]
  bloom?: number
  domeUniforms?: Record<string, number>
  wall?: { distance: number; height: number }
  sampling?: SkySampling
  cityMask?: boolean
}
export interface SkySamples { x: number[]; y: number[]; rgb: number[]; dir: number[]; city: boolean[] }
export interface SkyWallSample { sky: number[]; top: number[]; skyDir: number[] }
export interface SkyViewResult {
  pipeline: 'composer' | 'direct'; variant: SkyVariant; reduced: boolean; width: number; height: number
  state: StopState; exposure: number; time: number
  cameraPosition: number[]; cameraForward: number[]; sunDirection: number[]
  samples: SkySamples; wall: SkyWallSample | null
  shaderError: string | null; glError: number
}

let mounted: SkyMountInput | null = null
let time = 0

function mount(input: SkyMountInput): void {
  window.cityGpu.mountJourney({ tier: input.tier, lowPower: input.lowPower, initialDark: false,
    width: input.width ?? 320, height: input.height ?? 180 })
  mounted = input
  time = 0
}

function settle(input: { theme: SkyTheme; chapter: number; progress?: number }): void {
  const { chapter } = input
  const progress = input.progress ?? 0
  const dark = input.theme === 'dark'
  // Two snaps: the second always changes the target, so it always applies,
  // whatever the previous settle left behind.
  window.cityGpu.setJourneyTheme(!dark, { animate: false })
  window.cityGpu.setJourneyTheme(dark, { animate: false })
  time = 0
  window.cityGpu.renderJourney({ chapter, progress, time, frames: SETTLE_FRAMES })
  if (input.theme !== 'mid') return
  window.cityGpu.setJourneyTheme(true)
  for (let f = 1; f <= MID_BLEND_FRAMES; f++) window.cityGpu.stepJourney({ chapter, progress, time: f / 60 })
  time = MID_BLEND_FRAMES / 60
  window.cityGpu.renderJourney({ chapter, progress, time, frames: SETTLE_FRAMES })
}

function rayThrough(camera: THREE.PerspectiveCamera, width: number, height: number, x: number, y: number,
  target: THREE.Vector3): THREE.Vector3 {
  return target.set((x + 0.5) / width * 2 - 1, (y + 0.5) / height * 2 - 1, 0.5)
    .unproject(camera).sub(camera.position).normalize()
}

function cityHitTest(scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number) {
  const meshes: THREE.Object3D[] = []
  scene.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || BACKDROP.has(mesh.name)) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.some(m => m.transparent)) return
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).computeBoundingSphere()
    meshes.push(mesh)
  })
  const raycaster = new THREE.Raycaster()
  const ray = new THREE.Vector3()
  const hits = (x: number, y: number) => {
    raycaster.set(camera.position, rayThrough(camera, width, height, x, y, ray))
    return raycaster.intersectObjects(meshes, false).length > 0
  }
  const offsets = [[0, 0], [INTERIOR_OFFSET, 0], [-INTERIOR_OFFSET, 0], [0, INTERIOR_OFFSET], [0, -INTERIOR_OFFSET]]
  return (x: number, y: number) => offsets.every(([dx, dy]) => hits(x + dx!, y + dy!))
}

function collect(frame: Uint8Array, width: number, height: number, camera: THREE.PerspectiveCamera,
  sampling: SkySampling | undefined, city: ((x: number, y: number) => boolean) | null): SkySamples {
  const out: SkySamples = { x: [], y: [], rgb: [], dir: [], city: [] }
  if (!sampling) return out
  const ray = new THREE.Vector3()
  const xs = sampling.column !== undefined
    ? [sampling.column]
    : Array.from({ length: Math.ceil(width / sampling.xStride) }, (_, i) => i * sampling.xStride)
  for (let y = 0; y < height; y += sampling.yStride) for (const x of xs) {
    rayThrough(camera, width, height, x, y, ray)
    if (ray.y < sampling.minH || ray.y > sampling.maxH) continue
    const o = (y * width + x) * 4
    out.x.push(x)
    out.y.push(y)
    out.rgb.push(frame[o]!, frame[o + 1]!, frame[o + 2]!)
    out.dir.push(ray.x, ray.y, ray.z)
    out.city.push(city ? city(x, y) : false)
  }
  return out
}

function addWall(scene: THREE.Scene, camera: THREE.PerspectiveCamera, wall: { distance: number; height: number }) {
  const forward = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(WALL_WIDTH, wall.height, WALL_DEPTH),
    new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 1 }))
  mesh.position.copy(camera.position).addScaledVector(forward, wall.distance).setY(-1 + wall.height / 2)
  mesh.lookAt(camera.position.x, mesh.position.y, camera.position.z)
  mesh.updateMatrixWorld()
  scene.add(mesh)
  // Front face, top edge: the point nearest the camera on the wall's top line.
  const topEdge = camera.position.clone().addScaledVector(forward, wall.distance - WALL_DEPTH / 2).setY(-1 + wall.height)
  return { mesh, topEdge }
}

function wallSample(frame: Uint8Array, width: number, height: number, camera: THREE.PerspectiveCamera,
  topEdge: THREE.Vector3): SkyWallSample {
  const clip = topEdge.clone().project(camera)
  const x = Math.min(width - 1, Math.max(0, Math.round((clip.x * 0.5 + 0.5) * width - 0.5)))
  const yTop = Math.round((clip.y * 0.5 + 0.5) * height - 0.5)
  const pixel = (y: number) => Array.from(frame.subarray((y * width + x) * 4, (y * width + x) * 4 + 3))
  const skyY = yTop + WALL_SAMPLE_OFFSET
  return { sky: pixel(skyY), top: pixel(yTop - WALL_SAMPLE_OFFSET),
    skyDir: rayThrough(camera, width, height, x, skyY, new THREE.Vector3()).toArray() }
}

function view(input: SkyViewInput): SkyViewResult {
  if (!mounted) throw new Error('Mount a sky view first')
  const { scene, camera, renderer } = window.cityGpu.getJourneyContext()
  const dome = scene.getObjectByName(SKY_NAME) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined
  if (!dome) throw new Error('sky dome missing')
  const { state } = window.cityGpu.journeyState()
  const undo: (() => void)[] = []
  const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), dome: dome.position.clone() }
  undo.push(() => {
    camera.position.copy(saved.position)
    camera.quaternion.copy(saved.quaternion)
    dome.position.copy(saved.dome)
    camera.updateMatrixWorld()
  })
  if (input.view) {
    if (input.view.position) camera.position.set(...input.view.position)
    camera.lookAt(camera.position.clone().add(new THREE.Vector3(...input.view.direction)))
    dome.position.copy(camera.position)
  }
  camera.updateMatrixWorld()
  for (const child of scene.children) {
    if (child instanceof THREE.Light) continue
    const hidden = (input.only && !input.only.includes(child.name)) || input.hide?.includes(child.name)
    if (!hidden) continue
    const was = child.visible
    child.visible = false
    undo.push(() => { child.visible = was })
  }
  for (const [key, value] of Object.entries(input.domeUniforms ?? {})) {
    const uniform = dome.material.uniforms[key]
    if (!uniform) throw new Error(`unknown dome uniform ${key}`)
    const was = uniform.value
    uniform.value = value
    undo.push(() => { uniform.value = was })
  }
  const wall = input.wall ? addWall(scene, camera, input.wall) : null
  if (wall) undo.push(() => { scene.remove(wall.mesh); wall.mesh.geometry.dispose(); wall.mesh.material.dispose() })
  try {
    const gl = renderer.getContext()
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight
    const frame = new Uint8Array(width * height * 4)
    let pipeline: 'composer' | 'direct' = 'direct'
    if (!mounted.lowPower) {
      const post = createPostPipeline(renderer, scene, camera)
      if (!post) throw new Error('composer pipeline unavailable')
      try {
        post.setLook(state.exposure, input.bloom ?? 0)
        post.render()
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, frame)
      } finally { post.dispose() }
      pipeline = 'composer'
    } else {
      renderer.setRenderTarget(null)
      renderer.render(scene, camera)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, frame)
    }
    const city = input.cityMask ? cityHitTest(scene, camera, width, height) : null
    const d = window.cityGpu.diagnostics()
    return {
      pipeline, variant: mounted.lowPower ? 'lite' : 'full', reduced: mounted.tier === 'reduced', width, height,
      state, exposure: state.exposure, time, cameraPosition: camera.position.toArray(),
      cameraForward: camera.getWorldDirection(new THREE.Vector3()).toArray(),
      sunDirection: (dome.material.uniforms.uSunDir!.value as THREE.Vector3).toArray(),
      samples: collect(frame, width, height, camera, input.sampling, city),
      wall: wall ? wallSample(frame, width, height, camera, wall.topEdge) : null,
      shaderError: d.shaderError, glError: d.glError,
    }
  } finally {
    for (const step of undo.reverse()) step()
  }
}

// Renders only the haze, white, over black, with linear output, so each
// pixel's red channel is the haze alpha at that height.
function hazeAlpha(): { bottom: number; middle: number; top: number; shaderError: string | null; glError: number } {
  const gpu = createTestRenderer({ width: 16, height: HAZE_PROBE_HEIGHT })
  const { renderer, recorder } = gpu
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  const haze = createHazeMesh(64)
  haze.material.color.setRGB(1, 1, 1)
  haze.position.set(0, HAZE_BASE_Y + HAZE_HEIGHT / 2, 0)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0)
  scene.add(haze)
  const camera = new THREE.OrthographicCamera(-1, 1, HAZE_BASE_Y + HAZE_HEIGHT, HAZE_BASE_Y, 0.1, HAZE_RADIUS * 2)
  camera.position.set(0, 0, 0)
  camera.lookAt(0, 0, -1)
  try {
    renderer.render(scene, camera)
    recorder.assertClean()
    const at = (row: number) => readPixel(renderer, 8, row)[0]! / 255
    return { bottom: at(0), middle: at(HAZE_PROBE_HEIGHT / 2 - 1), top: at(HAZE_PROBE_HEIGHT - 1),
      shaderError: recorder.error?.message ?? null, glError: renderer.getContext().getError() }
  } finally {
    haze.geometry.dispose()
    haze.material.dispose()
    gpu.dispose()
  }
}

export const skyProbe = { mount, settle, view, hazeAlpha }
