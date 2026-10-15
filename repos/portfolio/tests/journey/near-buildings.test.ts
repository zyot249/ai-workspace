// tests/journey/near-buildings.test.ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyBuildingState, createBuildingLayer } from '../../app/journey/buildings'
import type { BuildingModels } from '../../app/journey/building-models'
import { createFacadeUniforms } from '../../app/journey/facade-material'
import { createNearBuildings } from '../../app/journey/near-buildings'
import { MAX_NEAR_MESHES, NEAR_MESH_PREFIX, NEAR_VARIANT_SPECS } from '../../app/journey/building-specs'
import { REFLECT_LAYER } from '../../app/journey/reflect-layer'

function fakeModels(): BuildingModels {
  const wall = new THREE.MeshStandardMaterial({ name: 'wall' })
  const glass = new THREE.MeshStandardMaterial({ name: 'glass' })
  const near = NEAR_VARIANT_SPECS.map(spec => {
    const box = () => { const g = new THREE.BoxGeometry(...spec.size); g.translate(0, spec.size[1] / 2, 0); return g }
    return { parts: [{ geometry: box(), material: wall }, { geometry: box(), material: glass }], size: spec.size }
  })
  return { setPieces: {} as BuildingModels['setPieces'], near }
}

function setup(lowPower = false) {
  const layer = createBuildingLayer(0, { lowPower, facade: createFacadeUniforms() })
  const fallbacks = [layer.boxMesh, ...(layer.spireMesh ? [layer.spireMesh] : []), ...(layer.beaconMesh ? [layer.beaconMesh] : [])]
  const near = createNearBuildings(layer, fallbacks)
  return { layer, near, fallbacks }
}

function instanceMatrices(near: ReturnType<typeof createNearBuildings>): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = []
  near.group.traverse(object => {
    const mesh = object as THREE.InstancedMesh
    if (!mesh.isInstancedMesh) return
    for (let i = 0; i < mesh.count; i++) out.push(new THREE.Matrix4().fromArray(mesh.instanceMatrix.array, i * 16))
  })
  return out
}

describe('createNearBuildings', () => {
  it('stages nothing visible and builds no mesh before models arrive', () => {
    const { near } = setup()
    expect(near.group.children).toHaveLength(0)
  })

  it('stages two meshes per variant (one per material) within the near-mesh cap, all hidden and named', () => {
    const { near } = setup()
    near.stage(fakeModels())
    const meshes = near.group.children as THREE.InstancedMesh[]
    expect(meshes.length).toBeLessThanOrEqual(MAX_NEAR_MESHES)
    expect(near.group.visible).toBe(false)
    for (const mesh of meshes) expect(mesh.name.startsWith(NEAR_MESH_PREFIX)).toBe(true)
  })

  it('instance counts sum to the layer size, for full and lite', () => {
    for (const lowPower of [false, true]) {
      const { layer, near } = setup(lowPower)
      near.stage(fakeModels())
      const meshes = near.group.children as THREE.InstancedMesh[]
      // Two materials per variant: every building is counted once per material.
      expect(meshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(layer.buildings.length * 2)
      near.release()
    }
  })

  it('reflects in puddles', () => {
    const { near } = setup()
    near.stage(fakeModels())
    for (const mesh of near.group.children) expect(mesh.layers.isEnabled(REFLECT_LAYER)).toBe(true)
  })

  it('show hides every fallback mesh and shows the group', () => {
    const { near, fallbacks } = setup()
    near.stage(fakeModels())
    near.show()
    expect(near.group.visible).toBe(true)
    expect(fallbacks.every(mesh => !mesh.visible)).toBe(true)
  })

  it('does nothing on show before staging', () => {
    const { near, fallbacks } = setup()
    near.show()
    expect(fallbacks.every(mesh => mesh.visible)).toBe(true)
  })

  it('writes a matrix at each active building, scaled inside its rectangle, on the base', () => {
    const { layer, near } = setup()
    near.stage(fakeModels())
    applyBuildingState(layer, 1, 1, 0, true)
    near.show()
    const active = layer.buildings.filter(building => building.width > 0)
    const placed = instanceMatrices(near).filter(matrix => matrix.determinant() !== 0)
    expect(placed.length).toBe(active.length * 2)
    for (const matrix of placed) {
      const position = new THREE.Vector3().setFromMatrixPosition(matrix)
      expect(position.y).toBeCloseTo(-1, 5)
    }
  })

  it('hidden and inactive buildings get a zero matrix', () => {
    const { layer, near } = setup()
    near.stage(fakeModels())
    applyBuildingState(layer, 1, 0.5, 0, true)
    near.show()
    const activeCount = layer.lastActiveCount
    const expectedVisible = layer.buildings.filter((building, i) => i < activeCount && building.width > 0).length
    const nonZero = instanceMatrices(near).filter(matrix => matrix.determinant() !== 0)
    expect(nonZero.length).toBe(expectedVisible * 2)
  })

  it('rewrites matrices when the density changes', () => {
    const { layer, near } = setup()
    near.stage(fakeModels())
    applyBuildingState(layer, 1, 0, 0, true)
    near.show()
    expect(instanceMatrices(near).every(matrix => matrix.determinant() === 0)).toBe(true)
    applyBuildingState(layer, 1, 1, 0, true)
    near.write()
    expect(instanceMatrices(near).some(matrix => matrix.determinant() !== 0)).toBe(true)
  })

  it('clamps the height scale so the Y scale stays within the near range', () => {
    const { layer, near } = setup()
    near.stage(fakeModels())
    applyBuildingState(layer, 0.6, 1, 0, true)
    near.show()
    const low = instanceMatrices(near).filter(matrix => matrix.determinant() !== 0)[0]!
    applyBuildingState(layer, 1.15, 1, 0, true)
    near.write()
    const high = instanceMatrices(near).filter(matrix => matrix.determinant() !== 0)[0]!
    const ratio = (matrix: THREE.Matrix4) => new THREE.Vector3().setFromMatrixScale(matrix).y / new THREE.Vector3().setFromMatrixScale(matrix).x
    expect(ratio(high) / ratio(low)).toBeCloseTo(1.15 / 0.85, 3)
  })

  it('release removes and disposes the meshes and leaves the fallbacks visible', () => {
    const { near, fallbacks } = setup()
    near.stage(fakeModels())
    near.release()
    expect(near.group.children).toHaveLength(0)
    expect(fallbacks.every(mesh => mesh.visible)).toBe(true)
    near.release()
  })

  it('ignores a second stage', () => {
    const { near } = setup()
    near.stage(fakeModels())
    const count = near.group.children.length
    near.stage(fakeModels())
    expect(near.group.children).toHaveLength(count)
  })
})

it('cleans the first variant if a later variant cannot merge', () => {
  const { near, fallbacks } = setup()
  const models = fakeModels()
  const broken = new THREE.BufferGeometry()
  broken.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  const second = models.near[1]!
  const badModels = { ...models, near: [models.near[0]!, { ...second, parts: [...second.parts, { geometry: broken, material: second.parts[0]!.material }] }] }
  expect(() => near.stage(badModels)).toThrow('incompatible attributes')
  expect(near.group.children).toHaveLength(0)
  expect(fallbacks.every(mesh => mesh.visible)).toBe(true)
})
