// tests/journey/arch-geometry.test.ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { type ArchSpec, archStation, parabolicArchGeometry } from '../../app/journey/arch-geometry'

// Positions are stored as Float32, so comparisons need a Float32-sized tolerance.
const FLOAT32_EPSILON = 1e-5
const SPEC: ArchSpec = { span: 7.2, rise: 5.5, thickness: 0.55, footWidth: 0.9, depth: 1, segments: 16, uv: [0.25, 0.75] }
const INNER_HALF = SPEC.span / 2
const OUTER_HALF = INNER_HALF + SPEC.footWidth

function positions(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const attribute = geometry.getAttribute('position')
  return Array.from({ length: attribute.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(attribute, i))
}

const near = (a: number, b: number) => Math.abs(a - b) < FLOAT32_EPSILON

describe('parabolicArchGeometry', () => {
  it('springs from the ground and fills the span, foot width, rise, thickness, and depth', () => {
    const geometry = parabolicArchGeometry(SPEC)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox as THREE.Box3
    expect(box.min.x).toBeCloseTo(-OUTER_HALF, 5)
    expect(box.max.x).toBeCloseTo(OUTER_HALF, 5)
    expect(box.min.y).toBeCloseTo(0, 5)
    expect(box.max.y).toBeCloseTo(SPEC.rise + SPEC.thickness, 5)
    expect(box.min.z).toBeCloseTo(-SPEC.depth / 2, 5)
    expect(box.max.z).toBeCloseTo(SPEC.depth / 2, 5)
  })

  it('has a parabolic underside that meets the ground at the inner feet and peaks at the middle', () => {
    const points = positions(parabolicArchGeometry(SPEC))
    const underside = points.filter(p => near(p.y, SPEC.rise * (1 - (p.x / INNER_HALF) ** 2)) && Math.abs(p.x) <= INNER_HALF + FLOAT32_EPSILON)
    expect(underside.some(p => near(p.x, 0) && near(p.y, SPEC.rise))).toBe(true)
    for (const end of [-INNER_HALF, INNER_HALF]) expect(underside.some(p => near(p.x, end) && near(p.y, 0))).toBe(true)
    expect(new Set(underside.map(p => p.x.toFixed(5))).size).toBe(SPEC.segments + 1)
  })

  it('has a parabolic top that meets the ground at the outer feet and peaks thickness above the underside', () => {
    const points = positions(parabolicArchGeometry(SPEC))
    const height = SPEC.rise + SPEC.thickness
    const top = points.filter(p => near(p.y, height * (1 - (p.x / OUTER_HALF) ** 2)) && p.y > 0.01)
    expect(top.some(p => near(p.x, 0) && near(p.y, height))).toBe(true)
    for (const end of [-OUTER_HALF, OUTER_HALF]) {
      expect(points.some(p => near(p.x, end) && near(p.y, 0))).toBe(true)
    }
    expect(new Set(top.map(p => p.x.toFixed(5))).size).toBeGreaterThanOrEqual(SPEC.segments - 1)
  })

  it('has flat feet on y = 0 and nothing below the ground', () => {
    const points = positions(parabolicArchGeometry(SPEC))
    expect(points.every(p => p.y >= -FLOAT32_EPSILON)).toBe(true)
    const feet = points.filter(p => near(p.y, 0))
    for (const side of [-1, 1]) {
      const xs = feet.filter(p => Math.sign(p.x) === side).map(p => Math.abs(p.x))
      expect(Math.min(...xs)).toBeCloseTo(INNER_HALF, 5)
      expect(Math.max(...xs)).toBeCloseTo(OUTER_HALF, 5)
    }
  })

  it('is mirror symmetric about x = 0', () => {
    const points = positions(parabolicArchGeometry(SPEC))
    const key = (p: THREE.Vector3, sign: number) => `${(p.x * sign).toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`
    const original = new Set(points.map(p => key(p, 1)))
    for (const p of points) expect(original.has(key(p, -1))).toBe(true)
  })

  it('has position, normal, and uv like the beam model, with unit normals and the given uv', () => {
    const geometry = parabolicArchGeometry(SPEC)
    expect(Object.keys(geometry.attributes).sort()).toEqual(['normal', 'position', 'uv'])
    const normals = geometry.getAttribute('normal')
    for (let i = 0; i < normals.count; i++) {
      expect(new THREE.Vector3().fromBufferAttribute(normals, i).length()).toBeCloseTo(1, 5)
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

  it('winds every triangle so its face normal agrees with its vertex normals', () => {
    const geometry = parabolicArchGeometry({ ...SPEC, segments: 8 })
    const index = geometry.getIndex()!
    const normals = geometry.getAttribute('normal')
    const points = positions(geometry)
    for (let i = 0; i < index.count; i += 3) {
      const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)] as const
      const face = new THREE.Vector3().subVectors(points[b]!, points[a]!).cross(new THREE.Vector3().subVectors(points[c]!, points[a]!))
      if (face.lengthSq() < 1e-12) continue
      const vertexNormal = new THREE.Vector3().fromBufferAttribute(normals, a)
      expect(face.dot(vertexNormal)).toBeGreaterThan(0)
    }
  })

  it('faces the top normals up and the underside normals down at the middle', () => {
    const geometry = parabolicArchGeometry({ ...SPEC, segments: 4 })
    const points = positions(geometry)
    const normals = geometry.getAttribute('normal')
    const apexTop = points.findIndex(p => near(p.x, 0) && near(p.y, SPEC.rise + SPEC.thickness))
    const apexBottom = points.findIndex(p => near(p.x, 0) && near(p.y, SPEC.rise))
    expect(normals.getY(apexTop)).toBeGreaterThan(0.99)
    expect(normals.getY(apexBottom)).toBeLessThan(-0.99)
  })

  it('adds vertices when segments grow', () => {
    const coarse = parabolicArchGeometry({ ...SPEC, segments: 4 }).getAttribute('position').count
    const fine = parabolicArchGeometry({ ...SPEC, segments: 16 }).getAttribute('position').count
    expect(fine).toBeGreaterThan(coarse)
  })

  it('rejects a spec that cannot make a solid arch', () => {
    for (const bad of [{ span: 0 }, { rise: 0 }, { thickness: 0 }, { footWidth: 0 }, { depth: -1 }, { segments: 1 }, { segments: 2.5 }]) {
      expect(() => parabolicArchGeometry({ ...SPEC, ...bad })).toThrow()
    }
  })
})

describe('archStation', () => {
  it('runs from the inner and outer foot on one side to the other, peaking at the middle', () => {
    const start = archStation(SPEC, 0)
    expect(start.inner.x).toBeCloseTo(-INNER_HALF, 9)
    expect(start.outer.x).toBeCloseTo(-OUTER_HALF, 9)
    expect(start.inner.y).toBeCloseTo(0, 9)
    expect(start.outer.y).toBeCloseTo(0, 9)
    const middle = archStation(SPEC, 0.5)
    expect(middle.inner.x).toBeCloseTo(0, 9)
    expect(middle.inner.y).toBeCloseTo(SPEC.rise, 9)
    expect(middle.outer.y).toBeCloseTo(SPEC.rise + SPEC.thickness, 9)
    const end = archStation(SPEC, 1)
    expect(end.inner.x).toBeCloseTo(INNER_HALF, 9)
    expect(end.outer.x).toBeCloseTo(OUTER_HALF, 9)
  })

  it('has a unit tangent that is flat at the middle and steep at the feet, pointing along +x', () => {
    const middle = archStation(SPEC, 0.5).tangent
    expect(Math.hypot(middle.x, middle.y)).toBeCloseTo(1, 9)
    expect(middle.x).toBeCloseTo(1, 9)
    expect(middle.y).toBeCloseTo(0, 9)
    const foot = archStation(SPEC, 0.02).tangent
    expect(foot.x).toBeGreaterThan(0)
    expect(foot.y).toBeGreaterThan(foot.x)
  })

  it('matches the vertices the geometry builds at the same stations', () => {
    const points = positions(parabolicArchGeometry({ ...SPEC, segments: 4 }))
    for (const u of [0.25, 0.5, 0.75]) {
      const { inner, outer } = archStation(SPEC, u)
      expect(points.some(p => near(p.x, inner.x) && near(p.y, inner.y))).toBe(true)
      expect(points.some(p => near(p.x, outer.x) && near(p.y, outer.y))).toBe(true)
    }
  })
})
