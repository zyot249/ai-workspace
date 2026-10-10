import * as THREE from 'three'
import {
  createLamps, lampHeadPosition, lampPositions, LAMP_SPACING_FULL, type LampField, STREET_NAME_PREFIX, STREET_NAMES,
} from '../../app/journey/lamps'
import { WAYPOINTS } from '../../app/journey/path'
import { createCars, createTraffic } from '../../app/journey/traffic'
import { linearLuminance } from '../../app/journey/window-look'
import { createTestRenderer, diagnostics } from './gpu-utils'

type Part = 'posts' | 'heads' | 'halos' | 'pools'
type Pixels = Float32Array | Uint8Array

// Top-down map of the whole street: x from -36 to 8, z from -74 to 14, 12 pixels per unit.
const MAP = { left: -36, right: 8, centerZ: -30, halfDepth: 44, pixelsPerUnit: 12 } as const
const MAP_WIDTH = (MAP.right - MAP.left) * MAP.pixelsPerUnit
const MAP_HEIGHT = 2 * MAP.halfDepth * MAP.pixelsPerUnit
const TRAFFIC_PIXELS_PER_UNIT = 8
const CORNER_RADIUS = 2.5
const LIT_BYTE = 2
const POOL_AWAY = 4

function topDownCamera(): THREE.OrthographicCamera {
  const centerX = (MAP.left + MAP.right) / 2
  const halfWidth = (MAP.right - MAP.left) / 2
  const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, MAP.halfDepth, -MAP.halfDepth, 0.1, 50)
  camera.position.set(centerX, 10, MAP.centerZ)
  camera.up.set(0, 0, -1)
  camera.lookAt(centerX, 0, MAP.centerZ)
  return camera
}

// Pixel of a world point in the top-down map. Row 0 is the bottom, so it is the largest z.
function mapPixel(x: number, z: number, pixelsPerUnit: number = MAP.pixelsPerUnit): { col: number; row: number } {
  return {
    col: Math.floor((x - MAP.left) * pixelsPerUnit),
    row: Math.floor((MAP.centerZ + MAP.halfDepth - z) * pixelsPerUnit),
  }
}

function partOf(mesh: THREE.Object3D): Part | null {
  for (const part of ['posts', 'heads', 'halos', 'pools'] as const) if (STREET_NAMES[part] === mesh.name) return part
  return null
}

interface Shot {
  width: number
  height: number
  camera: THREE.Camera
  ratio: number
  show: readonly Part[]
  fogDensity?: number
  // Float targets keep HDR head colors. Additive blending needs 8-bit targets: 32-bit float blending needs an extension.
  float?: boolean
  // Collapse every instance except this lamp's, so a neighbouring halo cannot sit behind it on the view axis.
  onlyLamp?: number
}

// Renders the real lamp field alone, into a linear target with no tone mapping, and hands the pixels to `read`.
function renderShot<T>(shot: Shot, read: (pixels: Pixels, field: LampField) => T): { value: T; shaderError: string | null; glError: number } {
  const gpu = createTestRenderer({ width: shot.width, height: shot.height })
  const { renderer, recorder } = gpu
  const target = new THREE.WebGLRenderTarget(shot.width, shot.height, shot.float
    ? { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false }
    : { depthBuffer: true, stencilBuffer: false })
  const field = createLamps(LAMP_SPACING_FULL)
  const scene = new THREE.Scene()
  if (shot.fogDensity !== undefined) scene.fog = new THREE.FogExp2(0x808080, shot.fogDensity)
  field.update(shot.ratio)
  const collapsed = new THREE.Matrix4().makeScale(0, 0, 0)
  for (const mesh of field.objects) {
    if (shot.onlyLamp !== undefined) {
      for (let i = 0; i < mesh.count; i++) if (i !== shot.onlyLamp) mesh.setMatrixAt(i, collapsed)
      mesh.instanceMatrix.needsUpdate = true
    }
    const part = partOf(mesh)
    mesh.visible = part !== null && shot.show.includes(part)
    scene.add(mesh)
  }
  renderer.setPixelRatio(1)
  renderer.setSize(shot.width, shot.height, false)
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  renderer.setClearColor(0x000000, 1)
  target.texture.colorSpace = THREE.LinearSRGBColorSpace
  try {
    if (shot.float && !renderer.getContext().getExtension('EXT_color_buffer_float')) {
      throw new Error('Street GPU tests require readable float color targets')
    }
    renderer.setRenderTarget(target)
    renderer.render(scene, shot.camera)
    recorder.assertClean()
    const pixels: Pixels = shot.float ? new Float32Array(shot.width * shot.height * 4) : new Uint8Array(shot.width * shot.height * 4)
    renderer.readRenderTargetPixels(target, 0, 0, shot.width, shot.height, pixels)
    return { value: read(pixels, field), shaderError: recorder.error?.message ?? null, glError: renderer.getContext().getError() }
  } finally {
    renderer.setRenderTarget(null)
    target.dispose()
    field.dispose()
    gpu.dispose()
  }
}

// Spec test 9b. A camera `distance` units in front of lamp 0's head, in fog, with and without the halo and pool meshes.
export function probeStreetFog(input: { density: number; distance: number; ratio: number }) {
  const size = 64
  const head = lampHeadPosition(lampPositions(LAMP_SPACING_FULL)[0]!)
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)
  camera.position.set(head.x, head.y, head.z + input.distance)
  camera.lookAt(head.x, head.y, head.z)
  camera.updateMatrixWorld()
  const shot = { width: size, height: size, camera, ratio: input.ratio, fogDensity: input.density, onlyLamp: 0 }
  const withLights = renderShot({ ...shot, show: ['halos', 'pools'] }, pixels => Uint8Array.from(pixels as Uint8Array))
  const without = renderShot({ ...shot, show: [] }, pixels => Uint8Array.from(pixels as Uint8Array))
  let maxDifference = 0
  let centerGain = 0
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const i = 4 * (row * size + col)
      for (let c = 0; c < 3; c++) maxDifference = Math.max(maxDifference, Math.abs(withLights.value[i + c]! - without.value[i + c]!))
      if (Math.abs(row - size / 2) <= 1 && Math.abs(col - size / 2) <= 1) {
        centerGain = Math.max(centerGain, (withLights.value[i]! - without.value[i]!) / 255)
      }
    }
  }
  return {
    maxDifference, centerGain,
    shaderError: withLights.shaderError ?? without.shaderError,
    glError: withLights.glError || without.glError,
  }
}

// Spec test 11. Linear luminance of every lamp head's center pixel, looking straight down.
export function probeStreetHeads(ratio: number) {
  const result = renderShot({ width: MAP_WIDTH, height: MAP_HEIGHT, camera: topDownCamera(), ratio, show: ['heads'], float: true },
    (pixels, field) => field.lamps.map(lamp => {
      const head = lampHeadPosition(lamp)
      const { col, row } = mapPixel(head.x, head.z)
      const i = 4 * (row * MAP_WIDTH + col)
      return linearLuminance([pixels[i]!, pixels[i + 1]!, pixels[i + 2]!])
    }))
  return { luminance: result.value, shaderError: result.shaderError, glError: result.glError }
}

// Spec test 12. The pool of lamp 0, at its center and POOL_AWAY units further along the road.
export function probeStreetPools(ratio: number) {
  const lamp = lampPositions(LAMP_SPACING_FULL)[0]!
  const centerX = lamp.x + 1.2 * Math.cos(lamp.armAngle)
  const centerZ = lamp.z - 1.2 * Math.sin(lamp.armAngle)
  // Lamp 0 stands on the first leg, which runs toward -Z.
  const result = renderShot({ width: MAP_WIDTH, height: MAP_HEIGHT, camera: topDownCamera(), ratio, show: ['pools'] }, pixels => {
    const red = (x: number, z: number) => {
      const { col, row } = mapPixel(x, z)
      return pixels[4 * (row * MAP_WIDTH + col)]! / 255
    }
    return { under: red(centerX, centerZ), away: red(centerX, centerZ - POOL_AWAY) }
  })
  return { ...result.value, shaderError: result.shaderError, glError: result.glError }
}

// Spec test 10. Camera `distance` from lamp 0's head at a yaw around it; the halo's half-intensity width along the center row.
export function probeStreetHalo(input: { yawDegrees: number; distance: number }) {
  const size = 400
  const head = lampHeadPosition(lampPositions(LAMP_SPACING_FULL)[0]!)
  const yaw = (input.yawDegrees * Math.PI) / 180
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)
  camera.position.set(head.x + input.distance * Math.sin(yaw), head.y, head.z + input.distance * Math.cos(yaw))
  camera.lookAt(head.x, head.y, head.z)
  camera.updateMatrixWorld()
  // Only lamp 0: at yaw 0 and 90 another lamp's halo would sit exactly behind it on the view axis.
  const result = renderShot({ width: size, height: size, camera, ratio: 1, show: ['halos'], onlyLamp: 0 }, pixels => {
    const row = size / 2
    const red = (col: number) => pixels[4 * (row * size + col)]!
    let peak = 0
    for (let col = 0; col < size; col++) peak = Math.max(peak, red(col))
    const center = size / 2
    let left = center
    let right = center
    while (left > 0 && red(left - 1) >= peak / 2) left--
    while (right < size - 1 && red(right + 1) >= peak / 2) right++
    return { widthPx: right - left + 1, centerColumn: (left + right + 1) / 2, peak }
  })
  return { ...result.value, shaderError: result.shaderError, glError: result.glError }
}

// Spec test 14. Top-down renders of the traffic alone at each time. Bodies are drawn unlit so only their instance color shows.
export function probeTraffic(input: { cars: number; times: readonly number[] }) {
  const width = (MAP.right - MAP.left) * TRAFFIC_PIXELS_PER_UNIT
  const height = 2 * MAP.halfDepth * TRAFFIC_PIXELS_PER_UNIT
  const gpu = createTestRenderer({ width, height })
  const { renderer, recorder } = gpu
  const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, stencilBuffer: false })
  const traffic = createTraffic(createCars(input.cars))
  const flat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const scene = new THREE.Scene()
  for (const mesh of traffic.objects) {
    if (mesh.name === STREET_NAMES.carBodies) {
      ;(mesh.material as THREE.Material).dispose()
      mesh.material = flat
    } else {
      mesh.visible = false
    }
    scene.add(mesh)
  }
  const camera = topDownCamera()
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  renderer.setClearColor(0x000000, 1)
  target.texture.colorSpace = THREE.LinearSRGBColorSpace
  const corners = WAYPOINTS.slice(1, -1)
  try {
    const masks: Uint8Array[] = []
    let nearCorner = 0
    for (const t of input.times) {
      traffic.update(1, t)
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      recorder.assertClean()
      const pixels = new Uint8Array(width * height * 4)
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
      const mask = new Uint8Array(width * height)
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const i = 4 * (row * width + col)
          if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) < LIT_BYTE) continue
          mask[row * width + col] = 1
          const x = MAP.left + (col + 0.5) / TRAFFIC_PIXELS_PER_UNIT
          const z = MAP.centerZ + MAP.halfDepth - (row + 0.5) / TRAFFIC_PIXELS_PER_UNIT
          if (corners.some(corner => Math.hypot(x - corner.x, z - corner.z) <= CORNER_RADIUS)) nearCorner++
        }
      }
      masks.push(mask)
    }
    let changed = 0
    const [first, second] = masks
    if (first && second) for (let i = 0; i < first.length; i++) if (first[i] !== second[i]) changed++
    return {
      objects: traffic.objects.length,
      lit: masks.map(mask => mask.reduce((sum, value) => sum + value, 0)),
      changed, nearCorner,
      shaderError: recorder.error?.message ?? null,
      glError: renderer.getContext().getError(),
    }
  } finally {
    renderer.setRenderTarget(null)
    target.dispose()
    flat.dispose()
    traffic.dispose()
    gpu.dispose()
  }
}

// The street meshes in the mounted journey: counts, culling, render order and instance colors.
export function streetState() {
  const { scene } = window.cityGpu.getJourneyContext()
  const read = (name: string) => {
    const mesh = scene.getObjectByName(name) as THREE.InstancedMesh | undefined
    if (!mesh) return null
    return {
      count: mesh.count, frustumCulled: mesh.frustumCulled, renderOrder: mesh.renderOrder,
      colors: Array.from(mesh.instanceColor?.array ?? []),
    }
  }
  return {
    posts: read(STREET_NAMES.posts), heads: read(STREET_NAMES.heads), halos: read(STREET_NAMES.halos),
    pools: read(STREET_NAMES.pools), carBodies: read(STREET_NAMES.carBodies), carLights: read(STREET_NAMES.carLights),
  }
}

// Like contactShadowDrawCalls: hide everything except the street meshes and count direct-path draw calls.
export function streetDrawCalls() {
  const { scene, camera, renderer } = window.cityGpu.getJourneyContext()
  const hidden: THREE.Object3D[] = []
  for (const child of scene.children) {
    if (child.name.startsWith(STREET_NAME_PREFIX) || !child.visible) continue
    child.visible = false
    hidden.push(child)
  }
  const autoReset = renderer.info.autoReset
  try {
    renderer.setRenderTarget(null)
    renderer.info.autoReset = false
    renderer.info.reset()
    renderer.render(scene, camera)
    const base = diagnostics(renderer)
    return { calls: renderer.info.render.calls, shaderError: base.shaderError, glError: base.glError }
  } finally {
    renderer.info.autoReset = autoReset
    for (const object of hidden) object.visible = true
  }
}
