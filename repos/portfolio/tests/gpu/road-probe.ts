import * as THREE from 'three'
import { puddleMaskAt } from '../../app/journey/asphalt'
import { type Rect, roadRects } from '../../app/journey/path'
import { createRoad, ROAD_Y } from '../../app/journey/road'
import { createTestRenderer, readPixel } from './gpu-utils'

export const ROAD_BOUNDS = { minX: -30, maxX: 4, minZ: -70, maxZ: 12 }
const PIXELS_PER_UNIT = 10
const MASK_GRID = 20

export function insideRects(rects: readonly Rect[], x: number, z: number, inset = 0): boolean {
  return rects.some(([minX, minZ, maxX, maxZ]) =>
    x >= minX + inset && x <= maxX - inset && z >= minZ + inset && z <= maxZ - inset)
}

// A point on the first leg whose neighborhood is all puddle, closest to (0, -10).
export function findPuddlePoint(): { x: number; z: number } {
  let best: { x: number; z: number; distance: number } | null = null
  for (let x = -2; x <= 2; x += 0.25) for (let z = -22; z <= 0; z += 0.25) {
    if (puddleMaskAt(x, z) < 0.97) continue
    let wet = true
    for (let dx = -1; dx <= 1; dx += 0.5) for (let dz = -1; dz <= 1; dz += 0.5) if (puddleMaskAt(x + dx, z + dz) < 0.9) wet = false
    const distance = Math.hypot(x, z + 10)
    if (wet && (!best || distance < best.distance)) best = { x, z, distance }
  }
  if (!best) throw new Error('No puddle point on the first leg; PUDDLE_ORIGIN changed?')
  return { x: best.x, z: best.z }
}

export function topDownCamera(bounds = ROAD_BOUNDS): THREE.OrthographicCamera {
  const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 0.1, 200)
  camera.up.set(0, 0, -1) // screen up is -Z, screen right is +X
  camera.position.set((bounds.minX + bounds.maxX) / 2, 50, (bounds.minZ + bounds.maxZ) / 2)
  camera.lookAt(camera.position.x, 0, camera.position.z)
  return camera
}

// Pixel (x from left, y from the bottom, as readPixels wants) of a world point under topDownCamera.
export function topDownPixel(x: number, z: number, height: number, bounds = ROAD_BOUNDS): { px: number; py: number } {
  return {
    px: Math.floor((x - bounds.minX) * PIXELS_PER_UNIT),
    py: height - 1 - Math.floor((z - bounds.minZ) * PIXELS_PER_UNIT),
  }
}

function configure(renderer: THREE.WebGLRenderer): void {
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
}

// Renders only the road surface with ROAD_DEBUG_PUDDLE and reads back the mask on a 20 x 20 grid over the road.
function probeMask() {
  const width = (ROAD_BOUNDS.maxX - ROAD_BOUNDS.minX) * PIXELS_PER_UNIT
  const height = (ROAD_BOUNDS.maxZ - ROAD_BOUNDS.minZ) * PIXELS_PER_UNIT
  const ctx = createTestRenderer({ width, height })
  try {
    const { renderer, recorder } = ctx
    configure(renderer)
    const road = createRoad(renderer.capabilities.getMaxAnisotropy())
    road.surface.material.defines = { ...road.surface.material.defines, ROAD_DEBUG_PUDDLE: 1 }
    road.surface.material.needsUpdate = true
    const scene = new THREE.Scene()
    scene.add(road.surface)
    renderer.render(scene, topDownCamera())
    recorder.assertClean()
    const rects = roadRects()
    const samples: { x: number; z: number; gpu: number; cpu: number }[] = []
    for (let i = 0; i < MASK_GRID; i++) for (let j = 0; j < MASK_GRID; j++) {
      const x = ROAD_BOUNDS.minX + (i + 0.5) * (ROAD_BOUNDS.maxX - ROAD_BOUNDS.minX) / MASK_GRID
      const z = ROAD_BOUNDS.minZ + (j + 0.5) * (ROAD_BOUNDS.maxZ - ROAD_BOUNDS.minZ) / MASK_GRID
      if (!insideRects(rects, x, z, 0.3)) continue
      const { px, py } = topDownPixel(x, z, height)
      samples.push({ x, z, gpu: readPixel(renderer, px, py)[0]! / 255, cpu: puddleMaskAt(x, z) })
    }
    return { samples, shaderError: recorder.error?.message ?? null, glError: renderer.getContext().getError() }
  } finally {
    ctx.dispose()
  }
}

// Lights are absent, so the only light in the pixel is the Fresnel sheen term.
function probeSheen(input: { cameraY: number; distance: number; wetness: number }) {
  const ctx = createTestRenderer({ width: 160, height: 90 })
  try {
    const { renderer, recorder } = ctx
    configure(renderer)
    const road = createRoad(renderer.capabilities.getMaxAnisotropy())
    road.update(input.wetness, [0.5, 0.6, 0.8])
    const scene = new THREE.Scene()
    scene.add(road.surface)
    const point = findPuddlePoint()
    const camera = new THREE.PerspectiveCamera(40, 160 / 90, 0.1, 200)
    camera.position.set(point.x, input.cameraY, point.z + input.distance)
    camera.lookAt(point.x, ROAD_Y, point.z)
    renderer.render(scene, camera)
    recorder.assertClean()
    return { pixel: readPixel(renderer, 80, 45), shaderError: recorder.error?.message ?? null, glError: renderer.getContext().getError() }
  } finally {
    ctx.dispose()
  }
}

export const roadProbe = { probeMask, probeSheen }
