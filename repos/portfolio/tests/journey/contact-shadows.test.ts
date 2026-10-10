import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyBuildingState, createBuildingLayer, isActive, LAYERS } from '../../app/journey/buildings'
import {
  createContactShadowField, ROAD_MARKING_RENDER_ORDER, SHADOW_NAME, SHADOW_OPACITY,
  SHADOW_RENDER_ORDER, SHADOW_TEXTURE_SIZE, SHADOW_Y, shadowTransform, writeLayerShadows,
} from '../../app/journey/contact-shadows'
import { createFacadeUniforms } from '../../app/journey/facade-material'

const building = { x: 3, z: -4, width: 1, depth: 0.8 }
const matrix = new THREE.Matrix4()

function scaleOf(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixScale(matrix)
}

describe('shadowTransform', () => {
  it('sits at SHADOW_Y under the building and sizes from the footprint and height', () => {
    const t = shadowTransform(building, 1, true)
    expect(t).toEqual({ x: 3, y: SHADOW_Y, z: -4, sx: 1 * 1.5 + 0.2 + 0.12, sz: 0.8 * 1.5 + 0.2 + 0.12 })
  })

  it('grows with height up to the 2.5 clamp', () => {
    const small = shadowTransform(building, 0.5, true)
    const tall = shadowTransform(building, 2.5, true)
    const taller = shadowTransform(building, 9, true)
    expect(tall.sx).toBeGreaterThan(small.sx)
    expect(taller.sx).toBe(tall.sx)
    expect(taller.sz).toBe(tall.sz)
  })

  it('is zero-size for an inactive building and for width 0, never NaN', () => {
    for (const t of [
      shadowTransform(building, 1, false),
      shadowTransform({ ...building, width: 0, depth: 0 }, 1, true),
      shadowTransform({ ...building, width: 0, depth: 0 }, 0, false),
    ]) {
      expect(t.sx).toBe(0)
      expect(t.sz).toBe(0)
      expect(Number.isNaN(t.x + t.y + t.z)).toBe(false)
    }
  })

  it('keeps a zero-height active building a valid quad', () => {
    const t = shadowTransform(building, 0, true)
    expect(t.sx).toBeCloseTo(1.7, 12)
    expect(Number.isFinite(t.sz)).toBe(true)
  })
})

describe('createContactShadowField', () => {
  it('allocates one instance per building in one flat, transparent mesh', () => {
    const field = createContactShadowField(96)
    const { mesh } = field
    expect(mesh.count).toBe(96)
    expect(mesh.name).toBe(SHADOW_NAME)
    expect(mesh.frustumCulled).toBe(false)
    expect(mesh.renderOrder).toBe(SHADOW_RENDER_ORDER)
    expect(SHADOW_RENDER_ORDER).toBeLessThan(ROAD_MARKING_RENDER_ORDER)
    const normal = mesh.geometry.getAttribute('normal')
    expect(normal.getY(0)).toBeCloseTo(1, 6)
    expect(mesh.geometry.getAttribute('position').getY(0)).toBeCloseTo(0, 6)
    const material = mesh.material
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.opacity).toBe(SHADOW_OPACITY)
    expect(material.polygonOffset).toBe(true)
    expect(material.polygonOffsetFactor).toBe(-1)
    expect(material.polygonOffsetUnits).toBe(-1)
    expect(material.fog).toBe(true)
    field.dispose()
  })

  it('builds a linear, mipmap-free, non-color-managed RGBA alpha map', () => {
    const field = createContactShadowField(1)
    const map = field.mesh.material.alphaMap!
    expect(map.colorSpace).toBe(THREE.NoColorSpace)
    expect(map.minFilter).toBe(THREE.LinearFilter)
    expect(map.magFilter).toBe(THREE.LinearFilter)
    expect(map.generateMipmaps).toBe(false)
    expect(map.image.width).toBe(SHADOW_TEXTURE_SIZE)
    expect(map.image.height).toBe(SHADOW_TEXTURE_SIZE)
    field.dispose()
  })

  it('starts with every instance hidden', () => {
    const field = createContactShadowField(3)
    for (let i = 0; i < 3; i++) expect(scaleOf(field.mesh, i).x).toBe(0)
    field.dispose()
  })

  it('writes a flat quad scaled to the footprint and hides an inactive one', () => {
    const field = createContactShadowField(2)
    field.write(0, building, 1, true)
    field.write(1, building, 1, false)
    const t = shadowTransform(building, 1, true)
    expect(scaleOf(field.mesh, 0).toArray()).toEqual([expect.closeTo(t.sx, 5), 1, expect.closeTo(t.sz, 5)])
    field.mesh.getMatrixAt(0, matrix)
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([3, expect.closeTo(SHADOW_Y, 5), -4])
    expect(scaleOf(field.mesh, 1).x).toBe(0)
    field.dispose()
  })

  it('rejects an index outside the field', () => {
    const field = createContactShadowField(2)
    expect(() => field.write(2, building, 1, true)).toThrow(RangeError)
    expect(() => field.write(-1, building, 1, true)).toThrow(RangeError)
    field.dispose()
  })

  it('flags the matrix buffer for upload only after a write', () => {
    const field = createContactShadowField(2)
    field.commit()
    const version = field.mesh.instanceMatrix.version
    field.commit()
    expect(field.mesh.instanceMatrix.version).toBe(version)
    field.write(0, building, 1, true)
    field.commit()
    expect(field.mesh.instanceMatrix.version).toBe(version + 1)
    field.commit()
    expect(field.mesh.instanceMatrix.version).toBe(version + 1)
    field.dispose()
  })

  it('disposes geometry, material, and the alpha map', () => {
    const field = createContactShadowField(1)
    const disposed: string[] = []
    field.mesh.geometry.addEventListener('dispose', () => disposed.push('geometry'))
    field.mesh.material.addEventListener('dispose', () => disposed.push('material'))
    field.mesh.material.alphaMap!.addEventListener('dispose', () => disposed.push('alphaMap'))
    field.dispose()
    expect(disposed.sort()).toEqual(['alphaMap', 'geometry', 'material'])
  })
})

describe('writeLayerShadows', () => {
  // Fresh layers per test: applyBuildingState skips unchanged state, so shared layers would couple the tests.
  function setup() {
    const layers = [0, 1].map(i => createBuildingLayer(i, { lowPower: false, facade: createFacadeUniforms() }))
    const offsets = [0, layers[0]!.buildings.length]
    const total = layers.reduce((sum, layer) => sum + layer.buildings.length, 0)
    const field = createContactShadowField(total)
    const sync = (density: number, height = 1) => {
      layers.forEach((layer, i) => {
        if (applyBuildingState(layer, height, density, 0, true)) writeLayerShadows(field, offsets[i]!, layer)
      })
      field.commit()
    }
    const visibleCount = () =>
      Array.from({ length: total }, (_, i) => scaleOf(field.mesh, i).x).filter(x => x > 0).length
    return { layers, offsets, field, sync, visibleCount }
  }

  it('gives every active building a shadow and no inactive building one', () => {
    const { layers, offsets, field, sync, visibleCount } = setup()
    sync(0.35)
    let expected = 0
    layers.forEach((layer, l) => layer.buildings.forEach((building, i) => {
      const active = isActive(building, i, layer.lastActiveCount)
      expected += active ? 1 : 0
      expect(scaleOf(field.mesh, offsets[l]! + i).x > 0, `layer ${l} building ${i}`).toBe(active)
    }))
    expect(expected).toBeGreaterThan(0)
    expect(visibleCount()).toBe(expected)
    field.dispose()
  })

  it('hides every shadow at density 0 and shows them again as density rises', () => {
    const { field, sync, visibleCount } = setup()
    sync(1)
    const full = visibleCount()
    expect(full).toBeGreaterThan(0)
    sync(0)
    expect(visibleCount()).toBe(0)
    sync(1)
    expect(visibleCount()).toBe(full)
    field.dispose()
  })

  it('places each quad under its building and grows it with the height scale', () => {
    const { layers, field, sync } = setup()
    sync(1, 0.5)
    const index = layers[0]!.buildings.findIndex(b => b.width > 0)
    const building = layers[0]!.buildings[index]!
    const before = scaleOf(field.mesh, index).x
    field.mesh.getMatrixAt(index, matrix)
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).x).toBeCloseTo(building.x, 5)
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).z).toBeCloseTo(building.z, 5)
    sync(1, 1.5)
    expect(scaleOf(field.mesh, index).x).toBeGreaterThan(before)
    field.dispose()
  })

  it('does not rewrite shadows on an unchanged state', () => {
    const { field, sync } = setup()
    sync(0.6)
    const version = field.mesh.instanceMatrix.version
    sync(0.6)
    expect(field.mesh.instanceMatrix.version).toBe(version)
    field.dispose()
  })

  it('writes nothing for a layer that has not been applied yet', () => {
    const { field, visibleCount } = setup()
    const fresh = createBuildingLayer(2, { lowPower: false, facade: createFacadeUniforms() })
    writeLayerShadows(field, 0, fresh)
    expect(visibleCount()).toBe(0)
    expect(fresh.buildings).toHaveLength(LAYERS[2].count)
    field.dispose()
  })
})
