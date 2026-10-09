import * as THREE from 'three'
import { lerp } from './interpolate'
import { WAYPOINTS } from './path'
import { seeded } from './random'
import { toLinear } from './sky-mirror'
import { hexToRgb, type Vec3 } from './stops'

const xs = WAYPOINTS.map(w => w.x)
const zs = WAYPOINTS.map(w => w.z)
// Centre of the path's bounding box, about (-13, -29). The ground, haze and far
// rings are centred here, not on the camera: the path is 100 units long, so a
// camera-centred ring would cut through buildings near the far end.
export const SCENE_CENTER = {
  x: (Math.min(...xs) + Math.max(...xs)) / 2,
  z: (Math.min(...zs) + Math.max(...zs)) / 2,
} as const

export const GROUND_NAME = 'journey-ground'
export const GROUND_HALF_SIZE = 130
export const GROUND_Y = -1.01
export const HAZE_NAME = 'journey-haze'
export const HAZE_RADIUS = 136
export const HAZE_HEIGHT = 40
export const HAZE_BASE_Y = -1
export const HAZE_BOTTOM_ALPHA = 0.85

const HAZE_RENDER_ORDER = -900
const HAZE_SEGMENTS = { full: 64, lite: 32 } as const
const SILHOUETTE_INK = hexToRgb('#15182a')
const SILHOUETTE_BASE_Y = -1
const FOOTPRINT_MIN = 5
const FOOTPRINT_MAX = 10
const GROUND_COLOR = 0x14141a

export interface RingConfig {
  name: string
  minDistance: number
  maxDistance: number
  minHeight: number
  maxHeight: number
  inkMix: number
  fullCount: number
  liteCount: number
  seed: number
}

export const RINGS: Readonly<Record<'a' | 'b', RingConfig>> = {
  a: { name: 'journey-far-ring-a', minDistance: 100, maxDistance: 110, minHeight: 10, maxHeight: 26,
    inkMix: 0.22, fullCount: 36, liteCount: 36, seed: 9100 },
  b: { name: 'journey-far-ring-b', minDistance: 116, maxDistance: 124, minHeight: 14, maxHeight: 34,
    inkMix: 0.1, fullCount: 36, liteCount: 20, seed: 9300 },
}

export interface SilhouetteBox {
  x: number
  z: number
  distance: number
  width: number
  depth: number
  height: number
  rotation: number
}

// One box per equal angular slice, jittered within its slice, so the ring has no gaps or clumps.
export function silhouetteLayout(ring: RingConfig, count: number, seed: number): SilhouetteBox[] {
  return Array.from({ length: count }, (_, i) => {
    const s = seed + i * 7
    const angle = (i + seeded(s)) / count * Math.PI * 2
    const distance = lerp(ring.minDistance, ring.maxDistance, seeded(s + 1))
    return {
      x: SCENE_CENTER.x + Math.cos(angle) * distance,
      z: SCENE_CENTER.z + Math.sin(angle) * distance,
      distance,
      width: lerp(FOOTPRINT_MIN, FOOTPRINT_MAX, seeded(s + 2)),
      depth: lerp(FOOTPRINT_MIN, FOOTPRINT_MAX, seeded(s + 3)),
      height: lerp(ring.minHeight, ring.maxHeight, seeded(s + 4)),
      rotation: -angle,
    }
  })
}

// sRGB horizon colour mixed toward the silhouette ink.
export function farColor(horizon: Vec3, amount: number): Vec3 {
  const channel = (i: 0 | 1 | 2) => Math.min(1, Math.max(0, lerp(horizon[i], SILHOUETTE_INK[i], amount)))
  return [channel(0), channel(1), channel(2)]
}

// One plane under the whole bent path, centred on the scene. At 130 units from
// the centre its edge is at least 80 units from every camera position, where
// the thinnest fog (density 0.035) leaves about 4e-4 of the ground colour. Past
// the edge the dome shows the same fog colour, so the edge disappears.
export function createGround(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_HALF_SIZE * 2, GROUND_HALF_SIZE * 2),
    new THREE.MeshStandardMaterial({ color: GROUND_COLOR, roughness: 1 }),
  )
  ground.name = GROUND_NAME
  ground.rotation.x = -Math.PI / 2
  ground.position.set(SCENE_CENTER.x, GROUND_Y, SCENE_CENTER.z)
  return ground
}

// A backdrop beyond the ground edge and both rings. Alpha comes from the RGBA
// vertex colour (r186 reads it with vertexColors); the material colour tints it.
export function createHazeMesh(radialSegments: number): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> {
  const geometry = new THREE.CylinderGeometry(HAZE_RADIUS, HAZE_RADIUS, HAZE_HEIGHT, radialSegments, 1, true)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 4)
  for (let i = 0; i < position.count; i++) {
    const t = (position.getY(i) + HAZE_HEIGHT / 2) / HAZE_HEIGHT
    colors.set([1, 1, 1, HAZE_BOTTOM_ALPHA * (1 - t)], i * 4)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = HAZE_NAME
  mesh.renderOrder = HAZE_RENDER_ORDER
  mesh.position.set(SCENE_CENTER.x, HAZE_BASE_Y + HAZE_HEIGHT / 2, SCENE_CENTER.z)
  return mesh
}

interface Ring {
  mesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>
  inkMix: number
}

function createRing(config: RingConfig, lowPower: boolean): Ring {
  const boxes = silhouetteLayout(config, lowPower ? config.liteCount : config.fullCount, config.seed)
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const vertexCount = geometry.getAttribute('position').count
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3))
  // White material: r186 multiplies material, vertex and instance colour, so the
  // vertex gradient carries the whole colour. Never call setColorAt here. Fog is
  // off on purpose: at these distances FogExp2 would hide the boxes entirely.
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, fog: false })
  const mesh = new THREE.InstancedMesh(geometry, material, boxes.length)
  mesh.name = config.name
  const up = new THREE.Vector3(0, 1, 0)
  boxes.forEach((box, i) => {
    mesh.setMatrixAt(i, new THREE.Matrix4().compose(
      new THREE.Vector3(box.x, SILHOUETTE_BASE_Y + box.height / 2, box.z),
      new THREE.Quaternion().setFromAxisAngle(up, box.rotation),
      new THREE.Vector3(box.width, box.height, box.depth),
    ))
  })
  mesh.instanceMatrix.needsUpdate = true
  return { mesh, inkMix: config.inkMix }
}

// Bottom vertices take the horizon colour so the base melts into the haze line.
function writeRingColors(geometry: THREE.BufferGeometry, bottom: Vec3, top: Vec3): void {
  const position = geometry.getAttribute('position')
  const color = geometry.getAttribute('color') as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) color.setXYZ(i, ...(position.getY(i) < 0 ? bottom : top))
  color.needsUpdate = true
}

export interface FarSkyline {
  readonly objects: readonly THREE.Object3D[]
  update(fogColor: Vec3): void
}

export function createFarSkyline(lowPower: boolean): FarSkyline {
  const haze = createHazeMesh(lowPower ? HAZE_SEGMENTS.lite : HAZE_SEGMENTS.full)
  const rings = [createRing(RINGS.a, lowPower), createRing(RINGS.b, lowPower)]
  return {
    objects: [haze, ...rings.map(ring => ring.mesh)],
    // `fogColor` is the authored sRGB horizon colour, never the CPU-mapped one:
    // these materials are tone-mapped like the dome.
    update(fogColor) {
      haze.material.color.setRGB(fogColor[0], fogColor[1], fogColor[2], THREE.SRGBColorSpace)
      const bottom = toLinear(fogColor)
      for (const ring of rings) writeRingColors(ring.mesh.geometry, bottom, toLinear(farColor(fogColor, ring.inkMix)))
    },
  }
}
