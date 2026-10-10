import * as THREE from 'three'
import { type Building, type BuildingLayer, isActive } from './buildings'
import { createFalloffTexture, FALLOFF_TEXTURE_SIZE } from './falloff-texture'

// Above the road (-1) and the ground (-1.01), below the road center line (-0.99).
export const SHADOW_Y = -0.995
export const SHADOW_OPACITY = 0.45
export const SHADOW_TEXTURE_SIZE = FALLOFF_TEXTURE_SIZE
export const SHADOW_NAME = 'journey-contact-shadows'
// Three sorts transparent objects by renderOrder first, so shadows always draw before the center line.
export const SHADOW_RENDER_ORDER = 1
export const ROAD_MARKING_RENDER_ORDER = 2

const FOOTPRINT_SCALE = 1.5
const FOOTPRINT_PAD = 0.2
const HEIGHT_GROWTH = 0.12
const HEIGHT_GROWTH_CAP = 2.5

export type ShadowSource = Pick<Building, 'x' | 'z' | 'width' | 'depth'>

export interface ShadowTransform {
  x: number
  y: number
  z: number
  sx: number
  sz: number
}

// An inactive or unplaced (`width === 0`) building gets scale 0.
export function shadowTransform(building: ShadowSource, height: number, active: boolean): ShadowTransform {
  const visible = active && building.width > 0
  const growth = HEIGHT_GROWTH * Math.min(Math.max(height, 0), HEIGHT_GROWTH_CAP)
  return {
    x: building.x,
    y: SHADOW_Y,
    z: building.z,
    sx: visible ? building.width * FOOTPRINT_SCALE + FOOTPRINT_PAD + growth : 0,
    sz: visible ? building.depth * FOOTPRINT_SCALE + FOOTPRINT_PAD + growth : 0,
  }
}

export interface ContactShadowField {
  readonly mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  write(index: number, building: ShadowSource, height: number, active: boolean): void
  // Flags the matrix buffer for upload if anything was written since the last commit.
  commit(): void
  dispose(): void
}

// Module-level scratch objects: the per-frame update allocates nothing.
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const noRotation = new THREE.Quaternion()

export function createContactShadowField(totalBuildings: number): ContactShadowField {
  const geometry = new THREE.PlaneGeometry(1, 1)
  geometry.rotateX(-Math.PI / 2)
  const alphaMap = createFalloffTexture(SHADOW_TEXTURE_SIZE)
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: SHADOW_OPACITY, alphaMap, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  })
  material.name = 'journey-contact-shadow'
  const mesh = new THREE.InstancedMesh(geometry, material, totalBuildings)
  mesh.name = SHADOW_NAME
  mesh.frustumCulled = false
  mesh.renderOrder = SHADOW_RENDER_ORDER
  matrix.makeScale(0, 0, 0)
  for (let i = 0; i < totalBuildings; i++) mesh.setMatrixAt(i, matrix)
  let dirty = true

  return {
    mesh,
    write(index, building, height, active) {
      if (!(index >= 0 && index < totalBuildings)) throw new RangeError(`shadow index ${index} outside [0, ${totalBuildings})`)
      const t = shadowTransform(building, height, active)
      position.set(t.x, t.y, t.z)
      scale.set(t.sx, 1, t.sz)
      matrix.compose(position, noRotation, scale)
      mesh.setMatrixAt(index, matrix)
      dirty = true
    },
    commit() {
      if (!dirty) return
      mesh.instanceMatrix.needsUpdate = true
      dirty = false
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      alphaMap.dispose()
    },
  }
}

// Rewrites one layer's shadow quads from the state `applyBuildingState` just stored on the layer.
// Call it only when `applyBuildingState` returned true. Does nothing before the layer's first apply.
export function writeLayerShadows(
  field: Pick<ContactShadowField, 'write'>, offset: number,
  layer: Pick<BuildingLayer, 'buildings' | 'lastHeightScale' | 'lastActiveCount'>,
): void {
  if (layer.lastActiveCount < 0) return
  layer.buildings.forEach((building, i) => {
    field.write(offset + i, building, building.baseHeight * layer.lastHeightScale,
      isActive(building, i, layer.lastActiveCount))
  })
}
