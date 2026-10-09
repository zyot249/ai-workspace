import * as THREE from 'three'
import { createTestRenderer } from './gpu-utils'
import { createPostPipeline, probePostSupport, skyForDirectPipeline, TONE_MAPPING, type PostPipeline } from '../../app/journey/post'
import type { Vec3 } from '../../app/journey/stops'

const FOG_FULL_DEPTH = 9
const FULL_FOG_EXPONENT = 3 // exp(-(3)^2) < 0.0002 of the object colour remains
const MIN_FOG_PROBE_DEPTH = 12
const FACADE_CELL = [0.16, 0.22] as const
const WINDOW_SEARCH_DISTANCE = 10
const INSPECTION_STANDOFF = 4
const INSPECTION_INSTANCES = 6

function readPixel(gl: WebGL2RenderingContext, x: number, y: number): number[] {
  const out = new Uint8Array(4)
  gl.readPixels(Math.round(x), Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
  return Array.from(out)
}

const toBytes = (rgb: readonly number[]): number[] => rgb.map(v => Math.round(v * 255))
const absDelta = (a: readonly number[], b: readonly number[]): number[] => a.slice(0, 3).map((v, i) => Math.abs(v - b[i]!))

export interface ParityInput { sky: Vec3; fog: Vec3; exposure: number }
export interface ParityResult { skyDelta: number[]; fogDelta: number[]; directSky: number[]; composerSky: number[] }

// Upper half shows the background; the lower half is a plane at depth 9 with
// FogExp2 density 1, so its pixel is the fully fogged limit (fog colour).
export function parity({ sky, fog, exposure }: ParityInput): ParityResult {
  const fixture = createTestRenderer({ width: 64, height: 64 })
  const { renderer, recorder } = fixture
  renderer.toneMapping = TONE_MAPPING; renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMappingExposure = exposure
  const scene = new THREE.Scene()
  scene.background = new THREE.Color().setRGB(...sky, THREE.SRGBColorSpace)
  scene.fog = new THREE.FogExp2(0, 1)
  ;(scene.fog as THREE.FogExp2).color.setRGB(...fog, THREE.SRGBColorSpace)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20); camera.position.z = 10
  const geometry = new THREE.PlaneGeometry(2, 1)
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.2, 0.2, 0.2) })
  const plane = new THREE.Mesh(geometry, material)
  plane.position.set(0, -0.5, 10 - FOG_FULL_DEPTH)
  scene.add(plane)
  const gl = renderer.getContext() as WebGL2RenderingContext
  const skyAt = [32, 48], fogAt = [32, 16]
  let post: PostPipeline | null = null
  try {
    post = createPostPipeline(renderer, scene, camera)
    if (!post) throw new Error('parity requires the composer path')
    post.setLook(exposure, 0)
    post.render()
    const composerSky = readPixel(gl, skyAt[0]!, skyAt[1]!)
    const composerFog = readPixel(gl, fogAt[0]!, fogAt[1]!)
    const expectedSky = toBytes(skyForDirectPipeline(sky, exposure))
    if (absDelta(composerSky, expectedSky).some(d => d > 3)) throw new Error('OutputPass differs from CPU Neutral reference')
    post.dispose(); post = null
    const mappedSky = skyForDirectPipeline(sky, exposure), mappedFog = skyForDirectPipeline(fog, exposure)
    ;(scene.background as THREE.Color).setRGB(...mappedSky, THREE.SRGBColorSpace)
    ;(scene.fog as THREE.FogExp2).color.setRGB(...mappedFog, THREE.SRGBColorSpace)
    renderer.setRenderTarget(null)
    renderer.render(scene, camera)
    recorder.assertClean()
    const directSky = readPixel(gl, skyAt[0]!, skyAt[1]!)
    const directFog = readPixel(gl, fogAt[0]!, fogAt[1]!)
    return {
      skyDelta: absDelta(composerSky, directSky), fogDelta: absDelta(composerFog, directFog),
      directSky, composerSky,
    }
  } finally { post?.dispose(); geometry.dispose(); material.dispose(); fixture.dispose() }
}

export interface ResizeResult { sizes: [number, number][]; expected: [number, number][] }

export function resizeSynthetic(): ResizeResult {
  const fixture = createTestRenderer({ width: 320, height: 180 })
  const { renderer, recorder } = fixture
  renderer.toneMapping = TONE_MAPPING; renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); camera.position.z = 2
  const gl = renderer.getContext() as WebGL2RenderingContext
  const sizes: [number, number][] = [], expected: [number, number][] = []
  let targets: { bloom: { renderTargetBright: THREE.WebGLRenderTarget } } | undefined
  let post: PostPipeline | null = null
  try {
    post = createPostPipeline(renderer, scene, camera, { onTargets: t => { targets = t } })
    if (!post || !targets) throw new Error('resize requires the composer path')
    const observe = () => {
      post!.render(); recorder.assertClean()
      const bright = targets!.bloom.renderTargetBright
      sizes.push([bright.width, bright.height])
      expected.push([Math.round(gl.drawingBufferWidth / 2), Math.round(gl.drawingBufferHeight / 2)])
    }
    observe()
    for (const [w, h, dpr] of [[321, 181, 1], [321, 181, 2], [257, 129, 1.5]] as const) {
      renderer.setPixelRatio(dpr); renderer.setSize(w, h, false)
      post.setSize(w, h, dpr)
      observe()
    }
    return { sizes, expected }
  } finally { post?.dispose(); fixture.dispose() }
}

export interface RestoreResult { before: number[][]; after: number[][]; shaderError: string | null; glError: number }

export async function restoreSynthetic(): Promise<RestoreResult> {
  const fixture = createTestRenderer({ width: 321, height: 181 })
  const { renderer, recorder, canvas } = fixture
  renderer.setPixelRatio(2); renderer.setSize(321, 181, false)
  renderer.toneMapping = TONE_MAPPING; renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); camera.position.z = 2
  const geometry = new THREE.PlaneGeometry(0.4, 0.4)
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2, 2, 2) })
  scene.add(new THREE.Mesh(geometry, material))
  const gl = renderer.getContext() as WebGL2RenderingContext
  let post: PostPipeline | null = null
  const sample = (): number[][] => {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
    // Quad right edge is x = .6*w; the next samples sit just outside it.
    return [readPixel(gl, w / 2, h / 2), ...[3, 6, 10].map(dx => readPixel(gl, Math.ceil(w * 0.6) + dx, h / 2))]
  }
  try {
    post = createPostPipeline(renderer, scene, camera)
    if (!post) throw new Error('restore requires the composer path')
    post.setSize(321, 181, 2); post.setLook(1.25, 0.42); post.render()
    const before = sample()
    const extension = gl.getExtension('WEBGL_lose_context')
    if (!extension) throw new Error('WEBGL_lose_context unavailable; run in a browser that supports it')
    const restored = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Context restore timed out')), 10000)
      canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault()
        setTimeout(() => extension.restoreContext(), 100)
      }, { once: true })
      canvas.addEventListener('webglcontextrestored', () => { clearTimeout(timeout); resolve() }, { once: true })
    })
    extension.loseContext()
    await restored
    renderer.setSize(321, 181, false); post.setSize(321, 181, 2)
    post.setLook(1.25, 0.42); post.render()
    recorder.assertClean()
    return { before, after: sample(), shaderError: recorder.error?.message ?? null, glError: gl.getError() }
  } finally { post?.dispose(); geometry.dispose(); material.dispose(); fixture.dispose() }
}

// ---- Actual-scene operations -------------------------------------------------

interface ActualContext { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer }

function opaqueMeshes(scene: THREE.Scene): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  scene.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.some(m => m.transparent)) return
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).computeBoundingSphere()
    meshes.push(mesh)
  })
  return meshes
}

function pixelOf(clip: THREE.Vector3, gl: WebGL2RenderingContext): [number, number] {
  return [(clip.x * 0.5 + 0.5) * gl.drawingBufferWidth, (clip.y * 0.5 + 0.5) * gl.drawingBufferHeight]
}

function settle(chapter: number): ActualContext {
  window.cityGpu.mountJourney({ tier: 'full', lowPower: false, width: 640, height: 360 })
  window.cityGpu.renderJourney({ chapter, frames: 180 })
  return window.cityGpu.getJourneyContext()
}

export interface ActualParityResult { skyDelta: number[]; fogDelta: number[]; shaderError: string | null; glError: number }

export function actualParity({ chapter }: { chapter: number }): ActualParityResult {
  const { scene, camera, renderer } = settle(chapter)
  const gl = renderer.getContext() as WebGL2RenderingContext
  const fog = scene.fog as THREE.FogExp2
  const background = scene.background as THREE.Color
  const exposure = renderer.toneMappingExposure
  const savedBackground = background.clone(), savedFog = fog.color.clone(), savedDensity = fog.density
  const meshes = opaqueMeshes(scene)
  camera.updateMatrixWorld()
  const ray = new THREE.Raycaster()
  let post: PostPipeline | null = null
  try {
    // Pick points by scene projection: unobstructed sky, and the deepest opaque
    // surface in view. The journey's own geometry may not reach the depth where
    // authored density fully fogs it, so raise the density until it does; both
    // pipelines see the same value.
    const isInterior = (object: THREE.Object3D, ndc: THREE.Vector2): boolean =>
      [[3, 0], [-3, 0], [0, 3], [0, -3]].every(([dx, dy]) => {
        const nearby = new THREE.Vector2(ndc.x + dx! * 2 / gl.drawingBufferWidth, ndc.y + dy! * 2 / gl.drawingBufferHeight)
        ray.setFromCamera(nearby, camera)
        return ray.intersectObjects(meshes, false)[0]?.object === object
      })
    let skyPoint: [number, number] | null = null, fogPoint: [number, number] | null = null, fogDepth = 0
    for (let iy = -19; iy <= 19; iy++) for (let ix = -19; ix <= 19; ix++) {
      const ndc = new THREE.Vector2(ix / 20, iy / 20)
      ray.setFromCamera(ndc, camera)
      const hit = ray.intersectObjects(meshes, false)[0]
      const px: [number, number] = [(ndc.x * 0.5 + 0.5) * gl.drawingBufferWidth, (ndc.y * 0.5 + 0.5) * gl.drawingBufferHeight]
      if (!hit && !skyPoint && iy > 0) skyPoint = px
      // Interior pixels only: MSAA edges resolve differently per pipeline.
      if (hit && hit.distance > fogDepth && isInterior(hit.object, ndc)) { fogDepth = hit.distance; fogPoint = px }
    }
    if (!skyPoint) throw new Error(`chapter ${chapter}: no unobstructed sky pixel`)
    if (!fogPoint || fogDepth < MIN_FOG_PROBE_DEPTH) throw new Error(`chapter ${chapter}: no deep opaque pixel (deepest ${fogDepth.toFixed(1)})`)
    fog.density = FULL_FOG_EXPONENT / fogDepth
    post = createPostPipeline(renderer, scene, camera)
    if (!post) throw new Error('parity requires the composer path')
    post.setLook(exposure, 0); post.render()
    const composerSky = readPixel(gl, ...skyPoint), composerFog = readPixel(gl, ...fogPoint)
    post.dispose(); post = null
    // Colours were authored sRGB; read them back in sRGB before mapping.
    const authoredSky = background.getRGB(new THREE.Color(), THREE.SRGBColorSpace)
    const authoredFog = fog.color.getRGB(new THREE.Color(), THREE.SRGBColorSpace)
    background.setRGB(...skyForDirectPipeline([authoredSky.r, authoredSky.g, authoredSky.b], exposure), THREE.SRGBColorSpace)
    fog.color.setRGB(...skyForDirectPipeline([authoredFog.r, authoredFog.g, authoredFog.b], exposure), THREE.SRGBColorSpace)
    renderer.setRenderTarget(null)
    renderer.render(scene, camera)
    const directSky = readPixel(gl, ...skyPoint), directFog = readPixel(gl, ...fogPoint)
    return {
      skyDelta: absDelta(composerSky, directSky), fogDelta: absDelta(composerFog, directFog),
      ...diagnosticsOf(renderer),
    }
  } finally {
    background.copy(savedBackground); fog.color.copy(savedFog); fog.density = savedDensity
    post?.dispose(); window.cityGpu.dispose()
  }
}

function diagnosticsOf(renderer: THREE.WebGLRenderer): { shaderError: string | null; glError: number } {
  const d = window.cityGpu.diagnostics()
  void renderer
  return { shaderError: d.shaderError, glError: d.glError }
}

const byteLuminance = (p: readonly number[]): number => 0.2126 * p[0]! + 0.7152 * p[1]! + 0.0722 * p[2]!
const isObservedLitWindow = (center: readonly number[], wall: readonly number[]): boolean =>
  center[0]! + center[1]! + center[2]! >= 300 && byteLuminance(center) - byteLuminance(wall) >= 30

interface WindowCandidate {
  instance: number; face: 'x' | 'z'; sign: number; cellX: number; cellY: number
  distance: number; world: THREE.Matrix4; scale: THREE.Vector3
}

function facadePoint(c: WindowCandidate, cellU: number, cellV: number): THREE.Vector3 {
  const u = (c.cellX + cellU) * FACADE_CELL[0], y = (c.cellY + cellV) * FACADE_CELL[1]
  const local = c.face === 'x'
    ? new THREE.Vector3(c.sign * 0.5, y / c.scale.y - 0.5, u / c.scale.z)
    : new THREE.Vector3(u / c.scale.x, y / c.scale.y - 0.5, c.sign * 0.5)
  return local.applyMatrix4(c.world)
}

type ChosenWindow = { candidate: WindowCandidate; center: [number, number]; neighbor: [number, number] }

function candidatesFor(near: THREE.InstancedMesh, camera: THREE.Camera): WindowCandidate[] {
  const transform = new THREE.Matrix4()
  const candidates: WindowCandidate[] = []
  for (let instance = 0; instance < near.count; instance++) {
    near.getMatrixAt(instance, transform)
    const world = new THREE.Matrix4().multiplyMatrices(near.matrixWorld, transform)
    const scale = new THREE.Vector3().setFromMatrixScale(transform)
    for (const face of ['x', 'z'] as const) for (const sign of [-1, 1]) {
      const width = face === 'x' ? scale.z : scale.x
      for (let cellX = Math.ceil(-width / 2 / FACADE_CELL[0]); cellX < width / 2 / FACADE_CELL[0] - 0.5; cellX++) {
        for (let cellY = 0; (cellY + 0.82) * FACADE_CELL[1] < scale.y; cellY++) {
          const candidate = { instance, face, sign, cellX, cellY, distance: 0, world, scale }
          const point = facadePoint(candidate, 0.5, 0.5)
          candidate.distance = point.distanceTo(camera.position)
          if (candidate.distance > WINDOW_SEARCH_DISTANCE) continue
          const clip = point.clone().project(camera)
          if (Math.abs(clip.x) > 0.95 || Math.abs(clip.y) > 0.95 || Math.abs(clip.z) > 1) continue
          candidates.push(candidate)
        }
      }
    }
  }
  return candidates.sort((a, b) => a.distance - b.distance)
}

// Finds a lit window whose centre, wall and just-outside neighbour pixels are
// all provably on the same near-building instance for this camera.
function findLitWindow(near: THREE.InstancedMesh, camera: THREE.Camera, scene: THREE.Scene,
  renderer: THREE.WebGLRenderer, meshes: THREE.Mesh[]): ChosenWindow | undefined {
  const gl = renderer.getContext() as WebGL2RenderingContext
  camera.updateMatrixWorld()
  const ray = new THREE.Raycaster()
  const hitsSameWall = (point: THREE.Vector3, instance: number): boolean => {
    const clip = point.clone().project(camera)
    ray.setFromCamera(new THREE.Vector2(clip.x, clip.y), camera)
    const hit = ray.intersectObjects(meshes, false)[0]
    return hit?.object === near && hit.instanceId === instance
  }
  renderer.setRenderTarget(null)
  renderer.render(scene, camera)
  for (const candidate of candidatesFor(near, camera)) {
    const centerPoint = facadePoint(candidate, 0.5, 0.5)
    if (!hitsSameWall(centerPoint, candidate.instance)) continue
    const center = pixelOf(centerPoint.clone().project(camera), gl)
    const wallPoint = facadePoint(candidate, 0.05, 0.5)
    if (!hitsSameWall(wallPoint, candidate.instance)) continue
    const wall = pixelOf(wallPoint.clone().project(camera), gl)
    if (!isObservedLitWindow(readPixel(gl, ...center), readPixel(gl, ...wall))) continue
    // Right window edge (cell-local u = 0.8), then 2 physical pixels outward.
    const edge = pixelOf(facadePoint(candidate, 0.8, 0.5).project(camera), gl)
    const outward = Math.sign(edge[0] - center[0]) || 1
    const neighbor: [number, number] = [edge[0] + outward * 2, edge[1]]
    ray.setFromCamera(new THREE.Vector2(neighbor[0] / gl.drawingBufferWidth * 2 - 1, neighbor[1] / gl.drawingBufferHeight * 2 - 1), camera)
    const hit = ray.intersectObjects(meshes, false)[0]
    if (hit?.object !== near || hit.instanceId !== candidate.instance) continue
    return { candidate, center, neighbor }
  }
  return undefined
}

// Cameras standing a few units off each face of the nearest buildings, for
// chapters whose journey camera has no near-building facade in view.
function* inspectionCameras(near: THREE.InstancedMesh, journey: THREE.PerspectiveCamera): Generator<THREE.PerspectiveCamera> {
  const transform = new THREE.Matrix4()
  const order = Array.from({ length: near.count }, (_, i) => {
    near.getMatrixAt(i, transform)
    return { i, d: new THREE.Vector3().setFromMatrixPosition(transform).distanceTo(journey.position) }
  }).sort((a, b) => a.d - b.d).slice(0, INSPECTION_INSTANCES)
  for (const { i } of order) {
    near.getMatrixAt(i, transform)
    const world = new THREE.Matrix4().multiplyMatrices(near.matrixWorld, transform)
    for (const local of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]) {
      const scale = new THREE.Vector3().setFromMatrixScale(transform)
      const faceCenter = new THREE.Vector3(local.x * 0.5, 0.8 / scale.y - 0.5, local.z * 0.5).applyMatrix4(world)
      const normal = local.clone().transformDirection(world)
      const camera = new THREE.PerspectiveCamera(journey.fov, journey.aspect, 0.1, 120)
      camera.position.copy(faceCenter).addScaledVector(normal, INSPECTION_STANDOFF)
      camera.lookAt(faceCenter)
      camera.updateMatrixWorld()
      yield camera
    }
  }
}

export interface ActualChapterResult {
  windowDistance: number; camera: 'journey' | 'inspection'; candidates: number
  on: number[][]; off: number[][]; shaderError: string | null; glError: number
}

export function actualChapter({ chapter }: { chapter: 2 | 3 }): ActualChapterResult {
  const { scene, camera: journeyCamera, renderer } = settle(chapter)
  const gl = renderer.getContext() as WebGL2RenderingContext
  const near = scene.getObjectByName('journey-building-near') as THREE.InstancedMesh | undefined
  if (!near?.isInstancedMesh) throw new Error('actual near facade mesh missing')
  const meshes = opaqueMeshes(scene)
  let camera: THREE.Camera = journeyCamera
  let which: 'journey' | 'inspection' = 'journey'
  let chosen = findLitWindow(near, camera, scene, renderer, meshes)
  if (!chosen) {
    which = 'inspection'
    for (const inspection of inspectionCameras(near, journeyCamera)) {
      chosen = findLitWindow(near, inspection, scene, renderer, meshes)
      if (chosen) { camera = inspection; break }
    }
  }
  if (!chosen) throw new Error(`chapter ${chapter}: no near visible lit window found from journey or inspection cameras`)
  const found = chosen

  const savedExposure = renderer.toneMappingExposure
  let post: PostPipeline | null = null
  try {
    post = createPostPipeline(renderer, scene, camera, { probeSupport: probePostSupport })
    if (!post) throw new Error('halo check requires the composer path')
    const capture = (strength: number): number[][] => {
      post!.setLook(savedExposure, strength); post!.render()
      return [readPixel(gl, ...found.center), readPixel(gl, ...found.neighbor)]
    }
    const strength = chapter === 2 ? 0.28 : 0.42
    const on = capture(strength), off = capture(0)
    return { windowDistance: found.candidate.distance, camera: which, candidates: candidatesFor(near, camera).length, on, off, ...diagnosticsOf(renderer) }
  } finally {
    renderer.toneMappingExposure = savedExposure
    post?.dispose(); window.cityGpu.dispose()
  }
}
