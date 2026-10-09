import * as THREE from 'three'
import { createFacadeMaterial, type FacadeUniforms } from './facade-material'
import { clearsCornerBlocks, clearsFootprints } from './footprints'
import { clearsPath, PATH_TOTAL_LENGTH, pathPointAt, ROAD_HALF_WIDTH } from './path'
import { POST_EMISSIVES } from './post'
import { seeded } from './random'

export const ROAD_CLEARANCE = ROAD_HALF_WIDTH + 0.3
export const BASE_Y = -1
export const PLACEMENT_ATTEMPTS = 8

// Generic background skyline, spread across the whole path as fill between the
// set-pieces rather than clustered at one depth. Each band has its own base
// clearance from the path so near/mid/far read as layered, not piled at the curb.
// `buildingDensity` scales how many of each band's baked instances are visible.
export const LAYERS = [
  { count: 24, sideSpread: 9, baseHeight: 1.4, color: 0x1f2438 },
  { count: 32, sideSpread: 13, baseHeight: 2.2, color: 0x2a2f4a },
  { count: 40, sideSpread: 18, baseHeight: 3.2, color: 0x353b5c },
] as const

export const SPIRE_COUNTS = [2, 2, 0] as const

const SETBACK_SPLIT = 0.62
const SETBACK_UPPER_FOOTPRINT = 0.7
const BLOCK_FOOTPRINT = 0.4
export const BLOCK_HEIGHT = 0.12
export const SPIRE_WIDTH = 0.1
export const BEACON_RADIUS = 0.04
export const BEACON_PERIOD = 1.6
export const BEACON_ON_TIME = 0.2
export const PART_STRIDE = 7
export const PART_KIND_BODY = 0
export const PART_KIND_EQUIPMENT = 1

export type Archetype = 'slab' | 'setback' | 'crowned' | 'spire'
type RolledArchetype = Exclude<Archetype, 'spire'>

const NEAR_WEIGHTS = [33, 33, 34] as const
const MID_WEIGHTS = [55, 30, 15] as const
const FAR_WEIGHTS = [70, 25, 5] as const
const ARCHETYPE_WEIGHTS = [NEAR_WEIGHTS, MID_WEIGHTS, FAR_WEIGHTS] as const

export interface Building {
  readonly x: number
  readonly z: number
  readonly width: number
  readonly depth: number
  readonly baseHeight: number
  readonly archetype: Archetype
  readonly spireLength: number
  readonly blinkPhase: number
}

export interface Placement {
  x: number
  z: number
  width: number
  depth: number
}

export interface PartRange {
  start: number
  count: number
}

export interface PartTransform {
  kind: 'body' | 'equipment'
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
}

// A building with no clear spot stays hidden for good (`width === 0`).
export const HIDDEN_BUILDING: Building = {
  x: 0, z: 0, width: 0, depth: 0, baseHeight: 0, archetype: 'slab', spireLength: 0, blinkPhase: 0,
}

const BOX_PART_COUNT: Record<Archetype, number> = { slab: 1, setback: 2, crowned: 2, spire: 2 }

export function rollArchetype(seed: number, layerIndex: number): RolledArchetype {
  const weights = ARCHETYPE_WEIGHTS[layerIndex] ?? FAR_WEIGHTS
  const roll = seeded(seed) * 100
  if (roll < weights[0]) return 'slab'
  if (roll < weights[0] + weights[1]) return 'setback'
  return 'crowned'
}

// Picks a point off to one side of the path that is clear of every road
// segment, set-piece footprint, and corner block for the building's whole
// axis-aligned rectangle. Candidates are generated exactly as before the
// footprint change; only the acceptance test is stricter. Tries a handful of
// seeded candidates and gives up (returns null, hidden off-scene) if none clear.
export function placeBuilding(seedBase: number, sideSpread: number): Placement | null {
  const width = 0.5 + seeded(seedBase + 100) * 0.6
  const depth = width * (0.7 + 0.6 * seeded(seedBase + 300))
  const minClear = ROAD_CLEARANCE + width / 2
  const halfExtent = Math.max(width, depth) / 2
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const s = seedBase + attempt * 977
    const distance = seeded(s + 400) * PATH_TOTAL_LENGTH
    const point = pathPointAt(distance)
    const half = Math.max(sideSpread / 2, minClear + 1)
    const side = seeded(s) < 0.5 ? -1 : 1
    const offset = side * (minClear + seeded(s + 1000) * (half - minClear))
    const x = point.x + point.rightX * offset
    const z = point.z + point.rightZ * offset
    if (clearsPath(x, z, ROAD_CLEARANCE + halfExtent) && clearsFootprints(x, z, halfExtent)
      && clearsCornerBlocks(x, z, halfExtent)) {
      return { x, z, width, depth }
    }
  }
  return null
}

// The `spireCount` tallest placed buildings become spires, so they read as
// landmarks in every seed. Ties go to the lower index.
export function assignSpires(buildings: readonly Building[], spireCount: number): Building[] {
  const chosen = new Set(
    buildings
      .map((building, index) => ({ building, index }))
      .filter(({ building }) => building.width > 0)
      .sort((a, b) => b.building.baseHeight - a.building.baseHeight || a.index - b.index)
      .slice(0, spireCount)
      .map(({ index }) => index),
  )
  return buildings.map((building, index): Building => (chosen.has(index) ? { ...building, archetype: 'spire' } : building))
}

export function createBuildings(layerIndex: number, count: number, spireCount: number): Building[] {
  const config = LAYERS[layerIndex]
  if (!config) throw new Error(`unknown building layer ${layerIndex}`)
  const seedBase = layerIndex * 1000
  const rolled = Array.from({ length: count }, (_, i): Building => {
    const placement = placeBuilding(seedBase + i, config.sideSpread)
    if (!placement) return HIDDEN_BUILDING
    return {
      ...placement,
      baseHeight: config.baseHeight * (0.5 + seeded(seedBase + i + 200)),
      archetype: rollArchetype(seedBase + i + 500, layerIndex),
      spireLength: 0.5 + 0.4 * seeded(seedBase + i + 600),
      blinkPhase: seeded(seedBase + i + 700),
    }
  })
  return assignSpires(rolled, spireCount)
}

export function partRangesFor(buildings: readonly Building[]): { ranges: PartRange[], total: number } {
  let total = 0
  const ranges = buildings.map((building): PartRange => {
    const count = BOX_PART_COUNT[building.archetype]
    const range = { start: total, count }
    total += count
    return range
  })
  return { ranges, total }
}

function writePart(
  out: Float32Array, offset: number, kind: number,
  x: number, y: number, z: number, sx: number, sy: number, sz: number,
): void {
  out[offset] = kind
  out[offset + 1] = x
  out[offset + 2] = y
  out[offset + 3] = z
  out[offset + 4] = sx
  out[offset + 5] = sy
  out[offset + 6] = sz
}

// A part is hidden (scale 0) when the building has no height or was never placed.
function isVisible(building: Building, height: number): boolean {
  return height > 0 && building.width > 0
}

// Writes the box parts (bodies and rooftop block) of one building as
// `PART_STRIDE` floats each: kind, x, y, z, sx, sy, sz. Returns the part count.
// Allocation-free: the per-frame path calls this with a reused buffer.
export function writeBoxParts(
  out: Float32Array, offset: number, building: Building, archetype: Archetype, height: number,
): number {
  const visible = isVisible(building, height)
  const h = visible ? height : 0
  const w = visible ? building.width : 0
  const d = visible ? building.depth : 0
  const { x, z } = building
  if (archetype === 'slab') {
    writePart(out, offset, PART_KIND_BODY, x, BASE_Y + h / 2, z, w, h, d)
    return 1
  }
  if (archetype === 'setback') {
    const lower = h * SETBACK_SPLIT
    const upper = h - lower
    writePart(out, offset, PART_KIND_BODY, x, BASE_Y + lower / 2, z, w, lower, d)
    writePart(out, offset + PART_STRIDE, PART_KIND_BODY, x, BASE_Y + lower + upper / 2, z,
      w * SETBACK_UPPER_FOOTPRINT, upper, d * SETBACK_UPPER_FOOTPRINT)
    return 2
  }
  const block = visible ? BLOCK_HEIGHT : 0
  writePart(out, offset, PART_KIND_BODY, x, BASE_Y + h / 2, z, w, h, d)
  writePart(out, offset + PART_STRIDE, PART_KIND_EQUIPMENT, x, BASE_Y + h + block / 2, z,
    w * BLOCK_FOOTPRINT, block, d * BLOCK_FOOTPRINT)
  return 2
}

// The spire cone has its bottom on top of the rooftop block. The cone geometry
// is centered on its origin, so the center sits half a length above the block.
export function writeSpirePart(
  out: Float32Array, offset: number, building: Building, height: number, length: number,
): void {
  const visible = isVisible(building, height)
  const blockTop = BASE_Y + height + BLOCK_HEIGHT
  writePart(out, offset, PART_KIND_EQUIPMENT, building.x, blockTop + length / 2, building.z,
    visible ? SPIRE_WIDTH : 0, visible ? length : 0, visible ? SPIRE_WIDTH : 0)
}

// The beacon is a unit sphere scaled to BEACON_RADIUS, centered on the spire tip.
export function writeBeaconPart(
  out: Float32Array, offset: number, building: Building, height: number, length: number, on: boolean,
): void {
  const scale = on && isVisible(building, height) ? BEACON_RADIUS : 0
  writePart(out, offset, PART_KIND_EQUIPMENT, building.x, BASE_Y + height + BLOCK_HEIGHT + length, building.z,
    scale, scale, scale)
}

// Test helper: the same numbers as `writeBoxParts`, as objects.
export function boxPartsFor(building: Building, archetype: Archetype, height: number): PartTransform[] {
  const out = new Float32Array(PART_STRIDE * 2)
  const count = writeBoxParts(out, 0, building, archetype, height)
  return Array.from({ length: count }, (_, p) => {
    const o = p * PART_STRIDE
    return {
      kind: out[o] === PART_KIND_BODY ? 'body' : 'equipment',
      x: out[o + 1] ?? 0, y: out[o + 2] ?? 0, z: out[o + 3] ?? 0,
      sx: out[o + 4] ?? 0, sy: out[o + 5] ?? 0, sz: out[o + 6] ?? 0,
    }
  })
}

// On for BEACON_ON_TIME out of every BEACON_PERIOD seconds, shifted by the
// building's phase in [0, 1). `steady` (reduced motion) keeps it on.
export function beaconIsOn(phase: number, time: number, steady: boolean): boolean {
  if (steady) return true
  const cycle = (((time / BEACON_PERIOD + phase) % 1) + 1) % 1
  return cycle * BEACON_PERIOD < BEACON_ON_TIME
}

const EQUIPMENT_COLOR = 0x2a2a30
const LOW_POWER_SCALE = 0.6
const MAX_BOX_PARTS = 2
const HEIGHT_EPSILON = 1e-4
const HIDDEN_Y = -100
const LAYER_NAMES = ['journey-building-near', 'journey-building-mid', 'journey-building-far'] as const

export interface BuildingLayer {
  readonly boxMesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
  readonly spireMesh: THREE.InstancedMesh<THREE.ConeGeometry, THREE.MeshStandardMaterial> | null
  readonly beaconMesh: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null
  readonly buildings: readonly Building[]
  readonly partRanges: readonly PartRange[]
  readonly spireBuildingIndices: readonly number[]
  readonly scratch: Float32Array
  // Mutable per-frame cursors for the dirty check (render-loop exception to the immutability rule).
  lastHeightScale: number
  lastActiveCount: number
  lastBeaconMask: number
}

export interface BuildingLayerOptions {
  lowPower: boolean
  facade: FacadeUniforms
}

function createInstancedMesh<G extends THREE.BufferGeometry, M extends THREE.Material>(
  geometry: G, material: M, count: number, name: string,
): THREE.InstancedMesh<G, M> {
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.name = name
  // r186 caches the instanced bounding sphere at first render, and setMatrixAt does not invalidate it.
  mesh.frustumCulled = false
  return mesh
}

export function createBuildingLayer(layerIndex: number, options: BuildingLayerOptions): BuildingLayer {
  const config = LAYERS[layerIndex]
  if (!config) throw new Error(`unknown building layer ${layerIndex}`)
  const { lowPower, facade } = options
  const count = lowPower ? Math.round(config.count * LOW_POWER_SCALE) : config.count
  const buildings = createBuildings(layerIndex, count, lowPower ? 0 : (SPIRE_COUNTS[layerIndex] ?? 0))
  const { ranges, total } = partRangesFor(buildings)
  const name = LAYER_NAMES[layerIndex] ?? `journey-building-${layerIndex}`

  const scratch = new Float32Array(PART_STRIDE * MAX_BOX_PARTS)
  const seeds = new Float32Array(total)
  const windowed = new Float32Array(total)
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))
  geometry.setAttribute('aWindowed', new THREE.InstancedBufferAttribute(windowed, 1))
  const material = createFacadeMaterial({ color: 0xffffff, uniforms: facade, variant: lowPower ? 'lite' : 'full' })
  const boxMesh = createInstancedMesh(geometry, material, total, name)
  boxMesh.userData.buildingCount = count

  const baseColor = new THREE.Color(config.color)
  const equipmentColor = new THREE.Color(EQUIPMENT_COLOR)
  const tint = new THREE.Color()
  const seedBase = layerIndex * 1000
  for (let i = 0; i < buildings.length; i++) {
    const building = buildings[i]
    const range = ranges[i]
    if (!building || !range) continue
    const parts = writeBoxParts(scratch, 0, building, building.archetype, 1)
    const bodyTint = 0.92 + 0.16 * seeded(seedBase + i + 800)
    for (let p = 0; p < parts; p++) {
      const isBody = scratch[p * PART_STRIDE] === PART_KIND_BODY
      seeds[range.start + p] = seeded(seedBase + i)
      windowed[range.start + p] = isBody ? 1 : 0
      boxMesh.setColorAt(range.start + p, isBody ? tint.copy(baseColor).multiplyScalar(bodyTint) : equipmentColor)
    }
  }
  if (boxMesh.instanceColor) boxMesh.instanceColor.needsUpdate = true

  const spireBuildingIndices = buildings.flatMap((building, i) => (building.archetype === 'spire' ? [i] : []))
  const spireMesh = spireBuildingIndices.length === 0 ? null : createInstancedMesh(
    new THREE.ConeGeometry(0.5, 1, 5),
    new THREE.MeshStandardMaterial({ color: EQUIPMENT_COLOR, roughness: 0.7 }),
    spireBuildingIndices.length, `${name}-spire`)
  let beaconMesh: BuildingLayer['beaconMesh'] = null
  if (spireBuildingIndices.length > 0) {
    const beaconMaterial = new THREE.MeshBasicMaterial({ color: POST_EMISSIVES.beacon.hex })
    beaconMaterial.name = 'journey-beacon'
    beaconMaterial.color.multiplyScalar(POST_EMISSIVES.beacon.gain)
    beaconMesh = createInstancedMesh(new THREE.SphereGeometry(1, 8, 6), beaconMaterial,
      spireBuildingIndices.length, `${name}-beacon`)
  }

  return {
    boxMesh, spireMesh, beaconMesh, buildings, partRanges: ranges, spireBuildingIndices, scratch,
    lastHeightScale: Number.POSITIVE_INFINITY, lastActiveCount: -1, lastBeaconMask: -1,
  }
}

export function layerMeshes(layer: BuildingLayer): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [layer.boxMesh]
  if (layer.spireMesh) meshes.push(layer.spireMesh)
  if (layer.beaconMesh) meshes.push(layer.beaconMesh)
  return meshes
}

// Module-level scratch objects: the per-frame update allocates nothing.
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const noRotation = new THREE.Quaternion()

function read(array: Float32Array, index: number): number {
  return array[index] ?? 0
}

function setPartMatrix(mesh: THREE.InstancedMesh, index: number, scratch: Float32Array, base: number): void {
  position.set(read(scratch, base + 1), read(scratch, base + 2), read(scratch, base + 3))
  scale.set(read(scratch, base + 4), read(scratch, base + 5), read(scratch, base + 6))
  matrix.compose(position, noRotation, scale)
  mesh.setMatrixAt(index, matrix)
}

function setHiddenMatrix(mesh: THREE.InstancedMesh, index: number, building: Building): void {
  position.set(building.x, HIDDEN_Y, building.z)
  scale.set(0, 0, 0)
  matrix.compose(position, noRotation, scale)
  mesh.setMatrixAt(index, matrix)
}

export function isActive(building: Building, index: number, activeCount: number): boolean {
  return index < activeCount && building.width > 0
}

function writeBodies(layer: BuildingLayer, heightScale: number, activeCount: number): void {
  const { buildings, partRanges, scratch, boxMesh, spireMesh, spireBuildingIndices } = layer
  for (let i = 0; i < buildings.length; i++) {
    const building = buildings[i]
    const range = partRanges[i]
    if (!building || !range) continue
    if (isActive(building, i, activeCount)) {
      const written = writeBoxParts(scratch, 0, building, building.archetype, building.baseHeight * heightScale)
      for (let p = 0; p < written; p++) setPartMatrix(boxMesh, range.start + p, scratch, p * PART_STRIDE)
    } else {
      for (let p = 0; p < range.count; p++) setHiddenMatrix(boxMesh, range.start + p, building)
    }
  }
  boxMesh.instanceMatrix.needsUpdate = true
  if (!spireMesh) return
  for (let k = 0; k < spireBuildingIndices.length; k++) {
    const index = spireBuildingIndices[k] ?? 0
    const building = buildings[index]
    if (!building) continue
    if (isActive(building, index, activeCount)) {
      writeSpirePart(scratch, 0, building, building.baseHeight * heightScale, building.spireLength)
      setPartMatrix(spireMesh, k, scratch, 0)
    } else {
      setHiddenMatrix(spireMesh, k, building)
    }
  }
  spireMesh.instanceMatrix.needsUpdate = true
}

// Bit k is set when the k-th beacon is shown: its building is active and its blink is on.
function beaconMask(layer: BuildingLayer, activeCount: number, time: number, steady: boolean): number {
  let mask = 0
  for (let k = 0; k < layer.spireBuildingIndices.length; k++) {
    const index = layer.spireBuildingIndices[k] ?? 0
    const building = layer.buildings[index]
    if (building && isActive(building, index, activeCount) && beaconIsOn(building.blinkPhase, time, steady)) {
      mask |= 1 << k
    }
  }
  return mask
}

function writeBeacons(layer: BuildingLayer, heightScale: number, mask: number): void {
  const { beaconMesh, buildings, scratch, spireBuildingIndices } = layer
  if (!beaconMesh) return
  for (let k = 0; k < spireBuildingIndices.length; k++) {
    const building = buildings[spireBuildingIndices[k] ?? 0]
    if (!building) continue
    writeBeaconPart(scratch, 0, building, building.baseHeight * heightScale, building.spireLength, (mask & (1 << k)) !== 0)
    setPartMatrix(beaconMesh, k, scratch, 0)
  }
  beaconMesh.instanceMatrix.needsUpdate = true
}

// Scales each building's height by `heightScale` and hides buildings beyond
// `density * count`, so a rising density reads as the skyline filling in rather
// than buildings fading to transparent. A building with `width === 0` (no clear
// spot found for it) always stays hidden. Matrices are rewritten only when the
// height moved by 1e-4 or more or the integer active count changed; beacons also
// rewrite when their on/off state changes. `dampState` converges asymptotically,
// so once a chapter settles this is a no-op. Returns true when it rewrote the body
// matrices, so callers can refresh data derived from them (contact shadows).
export function applyBuildingState(
  layer: BuildingLayer, heightScale: number, density: number, time: number, steadyBeacon: boolean,
): boolean {
  const total = layer.buildings.length
  const activeCount = Math.min(total, Math.max(0, Math.round(density * total)))
  const moved = !(Math.abs(heightScale - layer.lastHeightScale) < HEIGHT_EPSILON)
    || activeCount !== layer.lastActiveCount
  if (moved) {
    writeBodies(layer, heightScale, activeCount)
    layer.lastHeightScale = heightScale
    layer.lastActiveCount = activeCount
  }
  const mask = beaconMask(layer, activeCount, time, steadyBeacon)
  if (moved || mask !== layer.lastBeaconMask) {
    writeBeacons(layer, layer.lastHeightScale, mask)
    layer.lastBeaconMask = mask
  }
  return moved
}
