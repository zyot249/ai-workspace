// app/journey/near-buildings.ts
import * as THREE from 'three'
import { type BakedPart, mergeByMaterial } from './building-geometry'
import type { BuildingModels } from './building-models'
import type { SceneryPart } from './building-scenery'
import { NEAR_MESH_PREFIX } from './building-specs'
import { BASE_Y, type BuildingLayer, isActive } from './buildings'
import { nearFootprintScale, nearVariantFor, nearYaw, nearYScale } from './near-layout'
import { reflectInPuddles } from './reflect-layer'

export interface NearBuildings extends SceneryPart {
  readonly group: THREE.Group
  // Rewrites every instance matrix from the layer's stored height scale and active count. Call it after
  // `applyBuildingState` returns true. Does nothing before staging or before the layer's first apply.
  write(): void
}

interface VariantMeshes {
  // The index into `layer.buildings` of each instance slot.
  buildingIndices: readonly number[]
  meshes: readonly THREE.InstancedMesh[]
  parts: readonly BakedPart[]
}

// Module-level scratch objects: the per-frame update allocates nothing.
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const axisY = new THREE.Vector3(0, 1, 0)
const HIDDEN_Y = -100

export function createNearBuildings(layer: BuildingLayer, fallbacks: readonly THREE.Object3D[]): NearBuildings {
  const group = new THREE.Group()
  group.name = `${NEAR_MESH_PREFIX}group`
  let variants: VariantMeshes[] = []
  let sizes: BuildingModels['near'] = []
  let yaws: number[] = []
  let staged = false

  function release(): void {
    for (const variant of variants) {
      for (const mesh of variant.meshes) {
        group.remove(mesh)
        mesh.geometry.dispose()
        mesh.dispose()
      }
    }
    variants = []
    sizes = []
    yaws = []
    for (const fallback of fallbacks) fallback.visible = true
    staged = false
  }

  function write(): void {
    if (!staged || layer.lastActiveCount < 0) return
    const yScale = nearYScale(layer.lastHeightScale)
    variants.forEach((variant, v) => {
      const size = sizes[v]?.size
      if (!size) return
      variant.buildingIndices.forEach((buildingIndex, slot) => {
        const building = layer.buildings[buildingIndex]
        if (!building) return
        if (building.width > 0 && isActive(building, buildingIndex, layer.lastActiveCount)) {
          const yaw = yaws[buildingIndex] ?? 0
          const fit = nearFootprintScale(size, yaw, building.width, building.depth)
          matrix.compose(position.set(building.x, BASE_Y, building.z), rotation.setFromAxisAngle(axisY, yaw),
            scale.set(fit, fit * yScale, fit))
        } else {
          matrix.compose(position.set(building?.x ?? 0, HIDDEN_Y, building?.z ?? 0), rotation.identity(), scale.set(0, 0, 0))
        }
        for (const mesh of variant.meshes) mesh.setMatrixAt(slot, matrix)
      })
      for (const mesh of variant.meshes) mesh.instanceMatrix.needsUpdate = true
    })
  }

  return {
    group,
    stage(models) {
      if (staged) return
      staged = true
      sizes = models.near
      yaws = layer.buildings.map(building => nearYaw(building.x, building.z))
      const count = models.near.length
      try {
        models.near.forEach((piece, v) => {
          const buildingIndices = layer.buildings.flatMap((_, i) => (nearVariantFor(i, count) === v ? [i] : []))
          const parts = mergeByMaterial(piece.parts)
          const meshes = parts.map((part, p) => {
            const mesh = new THREE.InstancedMesh(part.geometry, part.material, buildingIndices.length)
            mesh.name = `${NEAR_MESH_PREFIX}${v}-${p}`
            // r186 caches the instanced bounding sphere at first render, and setMatrixAt does not invalidate it.
            mesh.frustumCulled = false
            group.add(mesh)
            return mesh
          })
          variants.push({ buildingIndices, meshes, parts })
        })
      } catch (error) {
        release()
        throw error
      }
      reflectInPuddles(group)
      group.visible = false
    },
    show() {
      if (!staged) return
      group.visible = true
      for (const fallback of fallbacks) fallback.visible = false
      write()
    },
    release,
    write,
  }
}
