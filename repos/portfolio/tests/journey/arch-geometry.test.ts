// tests/journey/arch-geometry.test.ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { type ArchSpec, parabolicArchGeometry } from '../../app/journey/arch-geometry'

// Positions are stored as Float32, so comparisons need a Float32-sized tolerance.
const FLOAT32_EPSILON = 1e-5
const SPEC: ArchSpec = { span: 7.2, rise: 0.9, thickness: 0.35, depth: 0.6, segments: 12, uv: [0.25, 0.75] }

function positions(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const attribute = geometry.getAttribute('position')
  return Array.from({ length: attribute.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(attribute, i))
}

describe('parabolicArchGeometry', () => {
  it('fills the span, rise, thickness, and depth, standing on y = 0', () => {
    const geometry = parabolicArchGeometry(SPEC)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox as THREE.Box3
    expect(box.min.x).toBeCloseTo(-SPEC.span / 2, 6)
    expect(box.max.x).toBeCloseTo(SPEC.span / 2, 6)
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(SPEC.rise + SPEC.thickness, 6)
    expect(box.min.z).toBeCloseTo(-SPEC.depth / 2, 6)
    expect(box.max.z).toBeCloseTo(SPEC.depth / 2, 6)
  })

  it('has a parabolic underside that meets the base at both ends and peaks at the middle', () => {
    const half = SPEC.span / 2
    const points = positions(parabolicArchGeometry(SPEC))
    const underside = points.filter(p => Math.abs(p.y - SPEC.rise * (1 - (p.x / half) ** 2)) < FLOAT32_EPSILON)
    expect(underside.some(p => Math.abs(p.x) < FLOAT32_EPSILON && Math.abs(p.y - SPEC.rise) < FLOAT32_EPSILON)).toBe(true)
    for (const end of [-half, half]) expect(underside.some(p => Math.abs(p.x - end) < FLOAT32_EPSILON && Math.abs(p.y) < FLOAT32_EPSILON)).toBe(true)
    // Every segment station has an underside vertex on each face.
    expect(new Set(underside.map(p => p.x.toFixed(6))).size).toBe(SPEC.segments + 1)
  })

  it('is mirror symmetric about x = 0', () => {
    const points = positions(parabolicArchGeometry(SPEC))
    const key = (p: THREE.Vector3, sign: number) => `${(p.x * sign).toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`
    const original = new Set(points.map(p => key(p, 1)))
    for (const p of points) expect(original.has(key(p, -1))).toBe(true)
  })

  it('has position, normal, and uv like the beam model, with unit normals and the given uv', () => {
    const geometry = parabolicArchGeometry(SPEC)
    expect(Object.keys(geometry.attributes).sort()).toEqual(['normal', 'position', 'uv'])
    const normals = geometry.getAttribute('normal')
    for (let i = 0; i < normals.count; i++) {
      expect(new THREE.Vector3().fromBufferAttribute(normals, i).length()).toBeCloseTo(1, 6)
    }
    const uv = geometry.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeCloseTo(0.25, 6)
      expect(uv.getY(i)).toBeCloseTo(0.75, 6)
    }
  })

  it('indexes only existing vertices, in whole triangles', () => {
    const geometry = parabolicArchGeometry(SPEC)
    const index = geometry.getIndex()
    expect(index).not.toBeNull()
    expect(index!.count % 3).toBe(0)
    const count = geometry.getAttribute('position').count
    for (let i = 0; i < index!.count; i++) expect(index!.getX(i)).toBeLessThan(count)
  })

  it('faces the top normals up and the underside normals down', () => {
    const geometry = parabolicArchGeometry({ ...SPEC, segments: 4 })
    const points = positions(geometry)
    const normals = geometry.getAttribute('normal')
    const apexTop = points.findIndex(p => Math.abs(p.x) < FLOAT32_EPSILON && Math.abs(p.y - (SPEC.rise + SPEC.thickness)) < FLOAT32_EPSILON)
    const apexBottom = points.findIndex(p => Math.abs(p.x) < FLOAT32_EPSILON && Math.abs(p.y - SPEC.rise) < FLOAT32_EPSILON)
    expect(normals.getY(apexTop)).toBeGreaterThan(0.99)
    expect(normals.getY(apexBottom)).toBeLessThan(-0.99)
  })

  it('adds vertices when segments grow', () => {
    const coarse = parabolicArchGeometry({ ...SPEC, segments: 4 }).getAttribute('position').count
    const fine = parabolicArchGeometry({ ...SPEC, segments: 16 }).getAttribute('position').count
    expect(fine).toBeGreaterThan(coarse)
  })

  it('rejects a spec that cannot make a solid arch', () => {
    for (const bad of [{ span: 0 }, { rise: 0 }, { thickness: 0 }, { depth: -1 }, { segments: 1 }, { segments: 2.5 }]) {
      expect(() => parabolicArchGeometry({ ...SPEC, ...bad })).toThrow()
    }
  })
})
