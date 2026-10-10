import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createFalloffTexture } from './falloff-texture'
import { clearsCornerBlocks, clearsFootprints } from './footprints'
import { clearsPath, PATH_TOTAL_LENGTH, pathPointAt, ROAD_HALF_WIDTH } from './path'
import { seeded } from './random'
import { attenuateAdditiveFog, replaceOrThrow } from './shader-utils'
import { smoothstep } from './sky-mirror'
import { gainFor } from './window-look'

export const LAMP_SPACING_FULL = 6
export const LAMP_SPACING_LOW_POWER = 8
// Distance from the road center line to a lamp post.
export const LAMP_OFFSET = ROAD_HALF_WIDTH + 0.3
export const LAMP_BASE_Y = -1
export const POST_HEIGHT = 2.4
export const ARM_LENGTH = 0.5
export const LAMP_HEAD_Y = LAMP_BASE_Y + POST_HEIGHT
// Switch-on thresholds fall in [LAMP_ON_MIN, LAMP_ON_MIN + LAMP_ON_SPREAD); a lamp fades in over LAMP_FADE.
export const LAMP_ON_MIN = 0.15
export const LAMP_ON_SPREAD = 0.2
export const LAMP_FADE = 0.05
// Linear luminance every bloom-capable street light reaches (spec 02's brightness contract).
export const STREET_LIGHT_LUMINANCE = 2.3
export const LAMP_LIGHT_HEX = 0xffc983
export const DARK_GLASS_HEX = 0x2a2a30
export const LAMP_LIGHT_GAIN = gainFor(LAMP_LIGHT_HEX, STREET_LIGHT_LUMINANCE)

const FOOTPRINT_PAD = 0.2
const PATH_CLEARANCE = ROAD_HALF_WIDTH + 0.2
const THRESHOLD_SEED = 9100
const STATION_EPSILON = 1e-9

export interface Lamp {
  // Path distance of the station the lamp belongs to.
  distance: number
  x: number
  z: number
  side: 1 | -1
  armAngle: number
}

// The arm points along local +X; a rotation by `theta` about Y maps +X to (cos theta, 0, -sin theta).
// It must point at the road center, which is -side * (rightX, rightZ) from the post.
export function armAngleFor(side: 1 | -1, rightX: number, rightZ: number): number {
  return Math.atan2(side * rightZ, -side * rightX)
}

// One lamp per side at every station, minus positions inside a set-piece footprint, a corner
// block, or within PATH_CLEARANCE of ANY road leg (a lamp near a corner can sit on the next leg).
export function lampPositions(spacing: number): Lamp[] {
  if (!(spacing > 0)) throw new RangeError(`lamp spacing must be positive, got ${spacing}`)
  const lamps: Lamp[] = []
  const first = spacing / 2
  const last = PATH_TOTAL_LENGTH - spacing / 2
  for (let i = 0; first + i * spacing <= last + STATION_EPSILON; i++) {
    const distance = first + i * spacing
    const point = pathPointAt(distance)
    for (const side of [1, -1] as const) {
      const x = point.x + point.rightX * LAMP_OFFSET * side
      const z = point.z + point.rightZ * LAMP_OFFSET * side
      if (!clearsFootprints(x, z, FOOTPRINT_PAD)) continue
      if (!clearsCornerBlocks(x, z, FOOTPRINT_PAD)) continue
      if (!clearsPath(x, z, PATH_CLEARANCE)) continue
      lamps.push({ distance, x, z, side, armAngle: armAngleFor(side, point.rightX, point.rightZ) })
    }
  }
  return lamps
}

// World position of the lamp head: the far end of the arm, at the top of the post.
export function lampHeadPosition(lamp: Pick<Lamp, 'x' | 'z' | 'armAngle'>): { x: number; y: number; z: number } {
  return {
    x: lamp.x + ARM_LENGTH * Math.cos(lamp.armAngle),
    y: LAMP_HEAD_Y,
    z: lamp.z - ARM_LENGTH * Math.sin(lamp.armAngle),
  }
}

export function lampThreshold(index: number): number {
  return LAMP_ON_MIN + LAMP_ON_SPREAD * seeded(THRESHOLD_SEED + index)
}

// smoothstep(threshold, threshold + LAMP_FADE, windowLitRatio): 0 at or below the threshold, 1 above it plus the fade.
export function lampIntensity(threshold: number, windowLitRatio: number): number {
  return smoothstep(threshold, threshold + LAMP_FADE, windowLitRatio)
}

export const STREET_NAME_PREFIX = 'journey-street-'
export const STREET_NAMES = {
  posts: 'journey-street-posts',
  heads: 'journey-street-heads',
  halos: 'journey-street-halos',
  pools: 'journey-street-pools',
  carBodies: 'journey-street-car-bodies',
  carLights: 'journey-street-car-lights',
} as const
// After spec 04's shadow quads (1), before the road markings (2); halos draw over the markings.
export const POOL_RENDER_ORDER = 1.5
export const HALO_RENDER_ORDER = 3

const HEAD_RADIUS = 0.12
const HALO_SIZE = 0.9
const POOL_SIZE = 3.2
const POOL_Y = -0.992
const POOL_OFFSET = 1.2
const HALO_BRIGHTNESS = 0.9
const POOL_BRIGHTNESS = 0.5
const RATIO_QUANTUM = 1e-3
const POST_COLOR = 0x2a2a2f
const ARM_THICKNESS = 0.05

const warm = new THREE.Color(LAMP_LIGHT_HEX)
const litHead = new THREE.Color(LAMP_LIGHT_HEX).multiplyScalar(LAMP_LIGHT_GAIN)
const darkGlass = new THREE.Color(DARK_GLASS_HEX)

// mix(dark glass, warm * gain, intensity)
export function headColor(intensity: number, out: THREE.Color): THREE.Color {
  return out.copy(darkGlass).lerp(litHead, intensity)
}

// Additive light needs no HDR: it adds on top. Zero intensity is exactly black, which adds nothing.
export function glowColor(intensity: number, brightness: number, out: THREE.Color): THREE.Color {
  return out.copy(warm).multiplyScalar(intensity * brightness)
}

// View-space billboard: the instance center goes through the model-view matrix, then the quad
// corner is added in view space, scaled by the instance scale. A Points sprite was rejected
// because the GPU clamps point size, which would shrink the halo when the camera passes close.
const BILLBOARD_PROJECT = /* glsl */ `
vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
vec2 billboardScale = vec2( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ) );
mvPosition.xy += transformed.xy * billboardScale;
gl_Position = projectionMatrix * mvPosition;
`

function createHaloMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  })
  material.name = 'journey-street-halo'
  material.onBeforeCompile = shader => {
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <project_vertex>', BILLBOARD_PROJECT)
  }
  material.customProgramCacheKey = () => 'street-halo'
  attenuateAdditiveFog(material)
  return material
}

function createPoolMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  })
  material.name = 'journey-street-pool'
  material.customProgramCacheKey = () => 'street-pool'
  attenuateAdditiveFog(material)
  return material
}

// Cylinder translated up so its bottom is at y = 0, merged with the arm box at the top.
function createPostGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.04, 0.05, POST_HEIGHT, 6)
  pole.translate(0, POST_HEIGHT / 2, 0)
  const arm = new THREE.BoxGeometry(ARM_LENGTH, ARM_THICKNESS, ARM_THICKNESS)
  arm.translate(ARM_LENGTH / 2, POST_HEIGHT - ARM_THICKNESS / 2, 0)
  const merged = mergeGeometries([pole, arm])
  pole.dispose()
  arm.dispose()
  if (!merged) throw new Error('Lamp post and arm geometries do not share attributes')
  return merged
}

export interface LampField {
  readonly lamps: readonly Lamp[]
  // Posts, heads, pools, halos: four draw calls.
  readonly objects: readonly THREE.InstancedMesh[]
  update(windowLitRatio: number): void
  dispose(): void
}

// Module-level scratch objects: the per-frame update allocates nothing.
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const noRotation = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)
const scratchColor = new THREE.Color()

function place(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, size: number, quaternion: THREE.Quaternion) {
  position.set(x, y, z)
  scale.setScalar(size)
  matrix.compose(position, quaternion, scale)
  mesh.setMatrixAt(index, matrix)
}

export function createLamps(spacing: number): LampField {
  const lamps = lampPositions(spacing)
  const thresholds = lamps.map((_, i) => lampThreshold(i))
  const falloff = createFalloffTexture()

  const postMaterial = new THREE.MeshStandardMaterial({ color: POST_COLOR, roughness: 0.7 })
  postMaterial.name = 'journey-street-post'
  const headMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  headMaterial.name = 'journey-street-head'
  const poolGeometry = new THREE.PlaneGeometry(1, 1)
  poolGeometry.rotateX(-Math.PI / 2)

  const posts = new THREE.InstancedMesh(createPostGeometry(), postMaterial, lamps.length)
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), headMaterial, lamps.length)
  const pools = new THREE.InstancedMesh(poolGeometry, createPoolMaterial(falloff), lamps.length)
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), createHaloMaterial(falloff), lamps.length)
  posts.name = STREET_NAMES.posts
  heads.name = STREET_NAMES.heads
  pools.name = STREET_NAMES.pools
  halos.name = STREET_NAMES.halos
  pools.renderOrder = POOL_RENDER_ORDER
  halos.renderOrder = HALO_RENDER_ORDER
  const objects = [posts, heads, pools, halos] as const
  for (const mesh of objects) mesh.frustumCulled = false

  lamps.forEach((lamp, i) => {
    const head = lampHeadPosition(lamp)
    place(posts, i, lamp.x, LAMP_BASE_Y, lamp.z, 1, rotation.setFromAxisAngle(UP, lamp.armAngle))
    place(heads, i, head.x, head.y, head.z, HEAD_RADIUS, noRotation)
    place(halos, i, head.x, head.y, head.z, HALO_SIZE, noRotation)
    place(pools, i, lamp.x + POOL_OFFSET * Math.cos(lamp.armAngle), POOL_Y,
      lamp.z - POOL_OFFSET * Math.sin(lamp.armAngle), POOL_SIZE, noRotation)
  })
  for (const mesh of objects) mesh.instanceMatrix.needsUpdate = true

  function writeColors(windowLitRatio: number) {
    for (const [i, threshold] of thresholds.entries()) {
      const intensity = lampIntensity(threshold, windowLitRatio)
      heads.setColorAt(i, headColor(intensity, scratchColor))
      halos.setColorAt(i, glowColor(intensity, HALO_BRIGHTNESS, scratchColor))
      pools.setColorAt(i, glowColor(intensity, POOL_BRIGHTNESS, scratchColor))
    }
    for (const mesh of [heads, halos, pools]) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }
  // Create the color attributes before the first render: three decides USE_INSTANCING_COLOR from them.
  writeColors(0)
  let lastKey = 0

  return {
    lamps,
    objects,
    update(windowLitRatio) {
      const key = Math.round(windowLitRatio / RATIO_QUANTUM)
      if (key === lastKey) return
      lastKey = key
      writeColors(windowLitRatio)
    },
    dispose() {
      for (const mesh of objects) {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
      falloff.dispose()
    },
  }
}
