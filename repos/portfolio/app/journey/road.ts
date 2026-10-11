import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ASPHALT_TILE_UNITS, createAsphaltTexture, PUDDLE_GLSL } from './asphalt'
import { ROAD_MARKING_RENDER_ORDER } from './contact-shadows'
import { headingFor, type Rect, roadRects, SIDEWALK_HEIGHT } from './path'
import { DASH_LENGTH, DASH_WIDTH, dashPositions, sidewalkPolygon } from './road-layout'
import { replaceOrThrow } from './shader-utils'
import type { Vec3 } from './stops'

export const ROAD_Y = -1
export const DASH_Y = -0.99
// The texture averages about 0.5 gray and drives roughness through its green channel, so a scale of 1.8 gives a dry roughness near 0.9.
export const ROAD_ROUGHNESS_SCALE = 1.8
const ROAD_BUMP_SCALE = 0.4
const SIDEWALK_BUMP_SCALE = 0.3
const WET_ROUGHNESS = 0.35
const WET_SHEEN = 0.5
const DASH_COLOR = 0xf5e6a8
const DASH_OPACITY = 0.55

export interface RoadUniforms {
  uWetness: { value: number }
  uSkyTint: { value: THREE.Color }
}

// UVs come from world position, so coplanar quads that overlap (a leg and its joint) sample the same texel.
function bakeWorldUv(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position')
  const uv = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / ASPHALT_TILE_UNITS
    uv[i * 2 + 1] = position.getZ(i) / ASPHALT_TILE_UNITS
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

// A world-space quad facing up, built straight from a rectangle.
export function flatQuadGeometry(rect: Rect, y: number): THREE.BufferGeometry {
  const [minX, minZ, maxX, maxZ] = rect
  const corners = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]] as const
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap(([x, z]) => [x, y, z]), 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(corners.flatMap(() => [0, 1, 0]), 3))
  bakeWorldUv(geometry)
  geometry.setIndex([0, 3, 2, 0, 2, 1])
  return geometry
}

function mergeOrThrow(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(geometries)
  if (!merged) throw new Error('[journey] road geometries could not be merged')
  for (const geometry of geometries) geometry.dispose()
  return merged
}

// Both sidewalk strips extruded to SIDEWALK_HEIGHT above the road surface, merged into one geometry.
export function sidewalkGeometry(): THREE.BufferGeometry {
  const strips = ([-1, 1] as const).map(side => {
    // Shape y is -z: rotating by -90 degrees about X sends (x, y, depth) to (x, depth, -y).
    const shape = new THREE.Shape(sidewalkPolygon(side).map(point => new THREE.Vector2(point.x, -point.z)))
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: SIDEWALK_HEIGHT, bevelEnabled: false })
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(0, ROAD_Y, 0)
    bakeWorldUv(geometry)
    return geometry
  })
  return mergeOrThrow(strips)
}

export function createDashes(): THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const dashes = dashPositions()
  const geometry = new THREE.PlaneGeometry(DASH_WIDTH, DASH_LENGTH)
  geometry.rotateX(-Math.PI / 2) // flat, long axis along Z; the instance heading turns it to the leg
  // `transparent: true` is required: opacity alone leaves the mesh in the opaque queue, where renderOrder
  // would not place it after the transparent shadow quads.
  const material = new THREE.MeshBasicMaterial({ color: DASH_COLOR, opacity: DASH_OPACITY, transparent: true })
  material.name = 'journey-road-dash'
  const mesh = new THREE.InstancedMesh(geometry, material, dashes.length)
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const unit = new THREE.Vector3(1, 1, 1)
  dashes.forEach((dash, i) => {
    quaternion.setFromAxisAngle(up, headingFor(dash.dirX, dash.dirZ))
    mesh.setMatrixAt(i, matrix.compose(position.set(dash.x, DASH_Y, dash.z), quaternion, unit))
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  mesh.renderOrder = ROAD_MARKING_RENDER_ORDER
  mesh.name = 'journey-road-dashes'
  return mesh
}

const vertexDeclarations = 'varying vec2 vWorldPos;'
const fragmentDeclarations = `
uniform float uWetness;
uniform vec3 uSkyTint;
varying vec2 vWorldPos;
${PUDDLE_GLSL}`

export function createRoadMaterial(texture: THREE.Texture, uniforms: RoadUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0x1a1a1f, roughness: ROAD_ROUGHNESS_SCALE, roughnessMap: texture, bumpMap: texture, bumpScale: ROAD_BUMP_SCALE,
  })
  material.name = 'journey-road'
  material.precision = 'highp'
  material.customProgramCacheKey = () => `road-wet-${material.defines?.ROAD_DEBUG_PUDDLE ?? 0}`
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <common>', `#include <common>\n${vertexDeclarations}`)
    // `worldpos_vertex` is conditional, and the road meshes are not instanced, so compute the world position here.
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xz;`)
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <common>', `#include <common>\n${fragmentDeclarations}`)
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float puddle = puddleMask(vWorldPos);
float wetAmt = uWetness * puddle;
roughnessFactor = mix(roughnessFactor, ${WET_ROUGHNESS.toFixed(2)}, wetAmt);`)
    // After lighting, so outgoingLight is complete, and before tone mapping. `normal` is the view-space normal
    // after bump mapping; vViewPosition points from the fragment to the camera.
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <opaque_fragment>', `vec3 wetView = normalize(vViewPosition);
float wetFresnel = pow(1.0 - clamp(dot(normal, wetView), 0.0, 1.0), 4.0);
outgoingLight += uSkyTint * wetFresnel * wetAmt * ${WET_SHEEN.toFixed(1)};
#include <opaque_fragment>`)
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <dithering_fragment>', `#include <dithering_fragment>
#ifdef ROAD_DEBUG_PUDDLE
gl_FragColor = vec4(vec3(puddle), 1.0);
#endif`)
  }
  return material
}

export interface Road {
  readonly group: THREE.Group
  readonly surface: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  readonly sidewalks: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  readonly dashes: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  readonly uniforms: RoadUniforms
  update(wetness: number, skyColor: Vec3): void
}

// Road surface (the five road rectangles merged), sidewalks with curbs, and the dashed center line:
// three draw calls. The scene's dispose() reaches the geometries and the shared texture by traversal.
export function createRoad(maxAnisotropy: number): Road {
  const texture = createAsphaltTexture(maxAnisotropy)
  const uniforms: RoadUniforms = { uWetness: { value: 0 }, uSkyTint: { value: new THREE.Color() } }

  const surface = new THREE.Mesh(
    mergeOrThrow(roadRects().map(rect => flatQuadGeometry(rect, ROAD_Y))),
    createRoadMaterial(texture, uniforms),
  )
  surface.name = 'journey-road-surface'

  const sidewalkMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a4a52, roughness: 0.9, bumpMap: texture, bumpScale: SIDEWALK_BUMP_SCALE,
  })
  sidewalkMaterial.name = 'journey-sidewalk'
  const sidewalks = new THREE.Mesh(sidewalkGeometry(), sidewalkMaterial)
  sidewalks.name = 'journey-sidewalks'

  const dashes = createDashes()
  const group = new THREE.Group()
  group.name = 'journey-road'
  group.add(surface, sidewalks, dashes)

  return {
    group, surface, sidewalks, dashes, uniforms,
    update(wetness, skyColor) {
      uniforms.uWetness.value = wetness
      uniforms.uSkyTint.value.setRGB(skyColor[0], skyColor[1], skyColor[2], THREE.SRGBColorSpace)
    },
  }
}
