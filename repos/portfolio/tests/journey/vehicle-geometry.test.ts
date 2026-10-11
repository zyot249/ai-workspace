import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { mergeVehicleParts } from '../../app/journey/vehicle-geometry'

function box(width: number, height: number, depth: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(width, height, depth)
}

function translate(x: number, y: number, z: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(x, y, z)
}

describe('mergeVehicleParts', () => {
  it('bakes each part matrix, then scales and flips the model so the +Z front faces -Z', () => {
    const body = box(1, 1, 2)
    // A "headlight" block on the +Z (front) end of the model.
    const front = box(0.2, 0.2, 0.2)
    const merged = mergeVehicleParts([
      { geometry: body, matrix: translate(0, 0.5, 0) },
      { geometry: front, matrix: translate(0, 0.5, 1.1) },
    ], 0.5)
    const frontBlockCenterZ = (() => {
      const probe = mergeVehicleParts([{ geometry: front, matrix: translate(0, 0.5, 1.1) }], 0.5)
      probe.computeBoundingBox()
      return probe.boundingBox!.getCenter(new THREE.Vector3()).z
    })()
    expect(frontBlockCenterZ).toBeCloseTo(-0.55, 6)
    merged.computeBoundingBox()
    expect(merged.boundingBox!.min.z).toBeCloseTo(-0.6 * 1, 6)
    expect(merged.boundingBox!.max.z).toBeCloseTo(0.5, 6)
  })

  it('scales the bounds and keeps wheel-bottom parts on y = 0', () => {
    const merged = mergeVehicleParts([{ geometry: box(1, 1, 2), matrix: translate(0, 0.5, 0) }], 0.36)
    expect(merged.boundingBox!.min.y).toBeCloseTo(0, 6)
    expect(merged.boundingBox!.max.y).toBeCloseTo(0.36, 6)
    expect(merged.boundingBox!.max.z - merged.boundingBox!.min.z).toBeCloseTo(0.72, 6)
  })

  it('sums the vertices of every part and keeps position, normal and uv', () => {
    const a = box(1, 1, 1)
    const b = box(1, 1, 1)
    const merged = mergeVehicleParts([
      { geometry: a, matrix: new THREE.Matrix4() },
      { geometry: b, matrix: translate(2, 0, 0) },
    ], 1)
    expect(merged.getAttribute('position').count).toBe(a.getAttribute('position').count * 2)
    expect(merged.getAttribute('normal')).toBeDefined()
    expect(merged.getAttribute('uv')).toBeDefined()
  })

  it('does not modify or dispose the input geometries', () => {
    const body = box(1, 1, 2)
    const before = Array.from(body.getAttribute('position').array)
    let disposed = false
    body.addEventListener('dispose', () => { disposed = true })
    mergeVehicleParts([{ geometry: body, matrix: translate(0, 0.5, 0) }], 0.5)
    expect(Array.from(body.getAttribute('position').array)).toEqual(before)
    expect(disposed).toBe(false)
  })

  it('throws a clear error for a model with no meshes', () => {
    expect(() => mergeVehicleParts([], 1)).toThrow('no meshes')
  })

  it('throws a clear error when parts have different attributes', () => {
    const plain = box(1, 1, 1)
    const noUv = box(1, 1, 1)
    noUv.deleteAttribute('uv')
    expect(() => mergeVehicleParts([
      { geometry: plain, matrix: new THREE.Matrix4() },
      { geometry: noUv, matrix: new THREE.Matrix4() },
    ], 1)).toThrow('incompatible')
  })
})
