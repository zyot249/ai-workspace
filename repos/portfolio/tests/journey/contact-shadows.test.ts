import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createContactShadowField, radialFalloffPixels, ROAD_MARKING_RENDER_ORDER, SHADOW_NAME, SHADOW_OPACITY,
  SHADOW_RENDER_ORDER, SHADOW_TEXTURE_SIZE, SHADOW_Y, shadowTransform,
} from '../../app/journey/contact-shadows'

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

describe('radialFalloffPixels', () => {
  const size = SHADOW_TEXTURE_SIZE
  const pixels = radialFalloffPixels(size)
  const at = (x: number, y: number) => Array.from(pixels.subarray(4 * (y * size + x), 4 * (y * size + x) + 4))

  it('is opaque grayscale: R = G = B, A = 255', () => {
    expect(pixels).toHaveLength(size * size * 4)
    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(pixels[i + 1])
      expect(pixels[i]).toBe(pixels[i + 2])
      expect(pixels[i + 3]).toBe(255)
    }
  })

  it('is white at the center and black at the corner', () => {
    expect(at(size / 2, size / 2)).toEqual([255, 255, 255, 255])
    expect(at(0, 0)).toEqual([0, 0, 0, 255])
    expect(at(size - 1, size - 1)).toEqual([0, 0, 0, 255])
  })

  it('falls monotonically from the center to the edge and is intermediate halfway', () => {
    let previous = 256
    for (let x = size / 2; x < size; x++) {
      const green = at(x, size / 2)[1]!
      expect(green).toBeLessThanOrEqual(previous)
      previous = green
    }
    const half = at(size / 2 + size / 4, size / 2)[1]!
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(255)
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
