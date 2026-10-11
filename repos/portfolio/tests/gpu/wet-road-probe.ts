import * as THREE from 'three'
import { type Rect, roadRects } from '../../app/journey/path'
import { reflectInPuddles, REFLECT_LAYER } from '../../app/journey/reflect-layer'
import { REFLECT_PLANE_Y } from '../../app/journey/reflection'
import { createRoad } from '../../app/journey/road'
import { createGround } from '../../app/journey/skyline-far'
import { createWetRoad, type WetRoad } from '../../app/journey/wet-road'
import { createTestRenderer, readFrame, readPixel } from './gpu-utils'
import { findPuddlePoint, insideRects, topDownCamera, topDownPixel } from './road-probe'

const WIDTH = 320
const HEIGHT = 180
const BACKGROUND = 0x101828
const OVERLAY_BOUNDS = { minX: -33, maxX: 7, minZ: -70, maxZ: 12 }
// Linear HDR, warm: far above 1 so even a faint alpha saturates the 8-bit pixel.
const WARM_MARKER: [number, number, number] = [3, 2, 0.8]

interface Rig {
  ctx: ReturnType<typeof createTestRenderer>
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  wetRoad: WetRoad
  setWetness(wetness: number, fogDensity?: number): void
  frame(): void
  center(): number[]
  dispose(): void
}

function createRig(): Rig {
  const ctx = createTestRenderer({ width: WIDTH, height: HEIGHT })
  const { renderer, recorder } = ctx
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND)
  scene.fog = new THREE.FogExp2(BACKGROUND, 0.02)
  const road = createRoad(renderer.capabilities.getMaxAnisotropy())
  scene.add(road.group)
  const wetRoad = createWetRoad(renderer)
  if (!wetRoad) {
    ctx.dispose()
    throw new Error('The wet road is unavailable in this browser')
  }
  scene.add(wetRoad.overlay)
  const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 260)
  return {
    ctx, scene, camera, wetRoad,
    setWetness(wetness, fogDensity = 0) {
      road.update(wetness, [0, 0, 0]) // black sky tint: the road's own sheen adds nothing to the pixels under test
      wetRoad.setLook(wetness, fogDensity)
    },
    frame() {
      camera.updateMatrixWorld()
      wetRoad.render(scene, camera)
      renderer.render(scene, camera)
      recorder.assertClean()
    },
    center: () => readPixel(renderer, WIDTH / 2, HEIGHT / 2),
    dispose: () => ctx.dispose(),
  }
}

// Camera low over a puddle, looking at it. Returns the puddle point.
function aimAtPuddle(rig: Rig): { x: number; z: number } {
  const point = findPuddlePoint()
  rig.camera.position.set(point.x, 0.5, point.z + 8)
  rig.camera.lookAt(point.x, REFLECT_PLANE_Y, point.z)
  return point
}

// The point whose mirror image, seen from `camera`, lands on `point`: along the reflected ray, `distance` past it.
function mirrorImageSource(camera: THREE.Vector3, point: { x: number; z: number }, distance = 4): THREE.Vector3 {
  const ray = new THREE.Vector3(point.x - camera.x, REFLECT_PLANE_Y - camera.y, point.z - camera.z).normalize()
  return new THREE.Vector3(point.x, REFLECT_PLANE_Y, point.z).add(new THREE.Vector3(ray.x, -ray.y, ray.z).multiplyScalar(distance))
}

function marker(position: THREE.Vector3, size: number, color: [number, number, number]): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({ fog: false })
  material.color.setRGB(...color)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material)
  mesh.position.copy(position)
  return mesh
}

function probeReflection() {
  const rig = createRig()
  try {
    const point = aimAtPuddle(rig)
    const box = marker(mirrorImageSource(rig.camera.position, point), 1.2, WARM_MARKER)
    rig.scene.add(box)
    reflectInPuddles(box)

    rig.setWetness(0); rig.frame()
    const dry = rig.center()
    rig.setWetness(0.7); rig.frame()
    const wet = rig.center()

    rig.setWetness(0.02)
    const passesBefore = rig.wetRoad.stats.passes
    rig.frame()
    const intro = rig.center()
    const passesAfter = rig.wetRoad.stats.passes

    rig.setWetness(0.7, 0.5); rig.frame()
    const fogged = rig.center()

    box.layers.disable(REFLECT_LAYER) // main camera only: a decoy that must not appear in the puddle
    rig.setWetness(0.7); rig.frame()
    const decoy = rig.center()

    rig.scene.remove(box); rig.frame()
    const withoutMarker = rig.center()
    return { dry, wet, intro, fogged, decoy, withoutMarker, passesBefore, passesAfter,
      shaderError: rig.ctx.recorder.error?.message ?? null, glError: rig.ctx.renderer.getContext().getError() }
  } finally {
    rig.dispose()
  }
}

function probeLights() {
  const rig = createRig()
  try {
    const point = aimAtPuddle(rig)
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }))
    box.position.copy(mirrorImageSource(rig.camera.position, point))
    const sun = new THREE.DirectionalLight(0xffffff, 3)
    sun.position.set(0, 2, 6) // shines on the +z face, the face the reflection ray hits
    rig.scene.add(box, sun)
    reflectInPuddles(box, sun)
    rig.setWetness(0.7)
    rig.frame()
    const lit = rig.center()
    sun.layers.disable(REFLECT_LAYER) // the light stays in the main scene only
    rig.frame()
    const unlit = rig.center()
    return { lit, unlit, shaderError: rig.ctx.recorder.error?.message ?? null, glError: rig.ctx.renderer.getContext().getError() }
  } finally {
    rig.dispose()
  }
}

// Top-down render of the overlay alone with every on-road fragment forced to opaque red.
function probeCoverage() {
  const width = (OVERLAY_BOUNDS.maxX - OVERLAY_BOUNDS.minX) * 10
  const height = (OVERLAY_BOUNDS.maxZ - OVERLAY_BOUNDS.minZ) * 10
  const ctx = createTestRenderer({ width, height })
  try {
    const { renderer, recorder } = ctx
    renderer.toneMapping = THREE.NoToneMapping
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    const wetRoad = createWetRoad(renderer)
    if (!wetRoad) throw new Error('The wet road is unavailable in this browser')
    wetRoad.overlay.material.defines = { WET_DEBUG_COVERAGE: 1 }
    wetRoad.overlay.material.needsUpdate = true
    wetRoad.setLook(0.7, 0)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x000000)
    scene.add(wetRoad.overlay)
    renderer.render(scene, topDownCamera(OVERLAY_BOUNDS))
    recorder.assertClean()
    const rects = roadRects()
    const joints: Rect[] = rects.slice(3)
    const inside: [number, number][] = [[2.8, -28.8]]
    for (const [minX, minZ, maxX, maxZ] of joints) {
      for (const x of [minX + 0.05, maxX - 0.05]) for (const z of [minZ + 0.05, maxZ - 0.05]) inside.push([x, z])
    }
    // Just outside the squares and the leg rectangles.
    const outside: [number, number][] = [[3.1, -20], [3.05, -29.05], [-1, -29.1], [-22.95, -29.05], [-29.05, -30]]
    const cases = [...inside, ...outside].map(([x, z]) => {
      const { px, py } = topDownPixel(x, z, height, OVERLAY_BOUNDS)
      return { x, z, insideRoad: insideRects(rects, x, z), pixel: readPixel(renderer, px, py) }
    })
    wetRoad.dispose()
    return { cases, shaderError: recorder.error?.message ?? null, glError: renderer.getContext().getError() }
  } finally {
    ctx.dispose()
  }
}

const MIRROR_CASES = [
  { name: 'leg 1', camera: [0, 0.5, -6], dir: [0, 0, -1] },
  { name: 'leg 2', camera: [-8, 0.5, -26], dir: [-1, 0, 0] },
  { name: 'leg 3', camera: [-26, 0.5, -40], dir: [0, 0, -1] },
  { name: 'joint', camera: [-1, 0.5, -24.5], dir: [0, 0, -1] },
] as const

// A small bright box beside the camera's heading. Its reflection must land where the mirror law puts it, whichever
// way the leg runs: one shared overlay and one texture matrix must serve all three rotated legs and the joints.
function probeMirror(index: number) {
  const mirrorCase = MIRROR_CASES[index]
  if (!mirrorCase) throw new Error(`Unknown mirror case ${index}`)
  const rig = createRig()
  try {
    rig.wetRoad.overlay.material.defines = { WET_DEBUG_FLOOD: 1 }
    rig.wetRoad.overlay.material.needsUpdate = true
    rig.setWetness(0.7)
    const cam = new THREE.Vector3(...mirrorCase.camera)
    const dir = new THREE.Vector3(...mirrorCase.dir)
    const right = dir.clone().cross(new THREE.Vector3(0, 1, 0))
    rig.camera.position.copy(cam)
    rig.camera.lookAt(cam.clone().addScaledVector(dir, 5).setY(-0.5))
    const center = cam.clone().addScaledVector(dir, 5).addScaledVector(right, 2.2).setY(0.2)
    const box = marker(center, 0.3, [30, 0, 0])
    rig.scene.add(box)
    reflectInPuddles(box)

    rig.frame()
    const withReflection = readFrame(rig.ctx.renderer)
    box.layers.disable(REFLECT_LAYER)
    rig.frame()
    const mainOnly = readFrame(rig.ctx.renderer)

    let count = 0, sumX = 0, sumY = 0
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      const delta = Math.abs(withReflection[i * 4]! - mainOnly[i * 4]!)
      // Half-resolution HDR reflection blended through a shallow Fresnel term changes red by ~51 here.
      if (delta <= 20) continue
      count++
      sumX += (i % WIDTH) + 0.5
      sumY += Math.floor(i / WIDTH) + 0.5
    }
    const image = new THREE.Vector3(center.x, 2 * REFLECT_PLANE_Y - center.y, center.z)
    const t = (REFLECT_PLANE_Y - cam.y) / (image.y - cam.y)
    const hit = cam.clone().lerp(image, t)
    rig.camera.updateMatrixWorld()
    const ndc = image.clone().project(rig.camera)
    return {
      name: mirrorCase.name,
      hitOnRoad: insideRects(roadRects(), hit.x, hit.z),
      predicted: [(ndc.x * 0.5 + 0.5) * WIDTH, (ndc.y * 0.5 + 0.5) * HEIGHT],
      centroid: count > 0 ? [sumX / count, sumY / count] : null,
      count,
      shaderError: rig.ctx.recorder.error?.message ?? null,
      glError: rig.ctx.renderer.getContext().getError(),
    }
  } finally {
    rig.dispose()
  }
}

function probeRoadOnly() {
  const rig = createRig()
  try {
    rig.scene.add(createGround(), new THREE.HemisphereLight(0xffffff, 0x556677, 1))
    const point = findPuddlePoint()
    rig.camera.position.set(point.x + 7, 5, point.z + 6)
    rig.camera.lookAt(point.x + 2, -1, point.z - 3)
    rig.camera.updateMatrixWorld()
    const box = marker(mirrorImageSource(rig.camera.position, point), 1.2, WARM_MARKER)
    rig.scene.add(box)
    reflectInPuddles(box)
    rig.setWetness(0.7)
    const spots = {
      road: new THREE.Vector3(point.x, REFLECT_PLANE_Y, point.z),
      sidewalk: new THREE.Vector3(3.45, -0.85, point.z - 1),
      ground: new THREE.Vector3(8, -1.01, point.z - 3),
    }
    const pixelOf = (name: keyof typeof spots): [number, number] => {
      const ndc = spots[name].clone().project(rig.camera)
      if (Math.abs(ndc.x) > 0.95 || Math.abs(ndc.y) > 0.95) throw new Error(`${name} sample is outside the view; move the camera`)
      return [Math.floor((ndc.x * 0.5 + 0.5) * WIDTH), Math.floor((ndc.y * 0.5 + 0.5) * HEIGHT)]
    }
    const pixels = { road: pixelOf('road'), sidewalk: pixelOf('sidewalk'), ground: pixelOf('ground') }
    const read = () => ({
      road: readPixel(rig.ctx.renderer, ...pixels.road),
      sidewalk: readPixel(rig.ctx.renderer, ...pixels.sidewalk),
      ground: readPixel(rig.ctx.renderer, ...pixels.ground),
    })
    rig.wetRoad.enabled = true; rig.frame()
    const on = read()
    rig.wetRoad.enabled = false; rig.frame()
    const off = read()
    return { on, off, shaderError: rig.ctx.recorder.error?.message ?? null, glError: rig.ctx.renderer.getContext().getError() }
  } finally {
    rig.dispose()
  }
}

function snapshot(rig: Rig) {
  const { renderer } = rig.ctx
  const visibility: Record<string, boolean> = {}
  rig.scene.traverse(object => { if (object.name !== 'thrower') visibility[object.uuid] = object.visible })
  return {
    targetIsNull: renderer.getRenderTarget() === null,
    autoClear: renderer.autoClear,
    clearAlpha: renderer.getClearAlpha(),
    clearColor: renderer.getClearColor(new THREE.Color()).getHex(),
    clippingPlanes: renderer.clippingPlanes.length,
    localClipping: renderer.localClippingEnabled,
    scissorTest: renderer.getScissorTest(),
    viewport: renderer.getViewport(new THREE.Vector4()).toArray(),
    visibility,
  }
}

function probeHygiene() {
  const rig = createRig()
  try {
    const point = aimAtPuddle(rig)
    rig.setWetness(0.7)
    rig.camera.updateMatrixWorld()
    const before = snapshot(rig)
    rig.wetRoad.render(rig.scene, rig.camera)
    const afterPass = snapshot(rig)

    const thrower = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    thrower.name = 'thrower'
    thrower.position.copy(mirrorImageSource(rig.camera.position, point))
    thrower.onBeforeRender = () => { throw new Error('forced reflection failure') }
    reflectInPuddles(thrower)
    rig.scene.add(thrower)
    let message: string | null = null
    try { rig.wetRoad.render(rig.scene, rig.camera) } catch (error) { message = error instanceof Error ? error.message : String(error) }
    const afterThrow = snapshot(rig)
    rig.scene.remove(thrower)

    rig.frame() // the next normal frame must render without errors
    return { before, afterPass, afterThrow, message, shaderError: rig.ctx.recorder.error?.message ?? null,
      glError: rig.ctx.renderer.getContext().getError() }
  } finally {
    rig.dispose()
  }
}

function probeForcedFailure() {
  const ctx = createTestRenderer({ width: 160, height: 90 })
  try {
    const failed = createWetRoad(ctx.renderer, { checkComplete: () => false })
    const gl = ctx.renderer.getContext()
    const failure = { isNull: failed === null, targetIsNull: ctx.renderer.getRenderTarget() === null, glError: gl.getError() }
    const working = createWetRoad(ctx.renderer)
    const success = { isNull: working === null, glError: gl.getError() }
    working?.dispose()
    return { failure, success, shaderError: ctx.recorder.error?.message ?? null }
  } finally {
    ctx.dispose()
  }
}

export const wetRoadProbe = {
  probeReflection, probeLights, probeCoverage, probeMirror, probeRoadOnly, probeHygiene, probeForcedFailure,
}
