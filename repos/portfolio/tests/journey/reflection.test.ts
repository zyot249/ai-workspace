import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { REFLECT_LAYER } from '../../app/journey/reflect-layer'
import { REFLECT_PLANE_Y, reflectedCamera, updateReflectionCamera } from '../../app/journey/reflection'

describe('reflectedCamera', () => {
  it('mirrors the position and look-at across the plane and flips the up vector', () => {
    const mirrored = reflectedCamera([1, 0.5, -3], [1, 0.2, -10], [0, 1, 0], REFLECT_PLANE_Y)
    expect(mirrored.position).toEqual([1, 2 * REFLECT_PLANE_Y - 0.5, -3])
    expect(mirrored.target).toEqual([1, 2 * REFLECT_PLANE_Y - 0.2, -10])
    expect(mirrored.up).toEqual([0, -1, 0])
  })

  it('returns the original when applied twice', () => {
    const once = reflectedCamera([2, 1.25, -7], [3, -0.4, -9], [0.1, 0.9, 0.2], REFLECT_PLANE_Y)
    const twice = reflectedCamera(once.position, once.target, once.up, REFLECT_PLANE_Y)
    expect(twice.position[0]).toBeCloseTo(2, 12)
    expect(twice.position[1]).toBeCloseTo(1.25, 12)
    expect(twice.position[2]).toBeCloseTo(-7, 12)
    expect(twice.target[1]).toBeCloseTo(-0.4, 12)
    expect(twice.up).toEqual([0.1, 0.9, 0.2])
  })

  it('leaves points on the plane where they are', () => {
    expect(reflectedCamera([0, REFLECT_PLANE_Y, 0], [4, REFLECT_PLANE_Y, 4], [0, 1, 0], REFLECT_PLANE_Y).position[1])
      .toBeCloseTo(REFLECT_PLANE_Y, 12)
  })
})

describe('updateReflectionCamera', () => {
  function rig() {
    const source = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 260)
    source.position.set(1, 0.5, -3)
    source.lookAt(1, 0.2, -10)
    source.updateMatrixWorld()
    const virtual = new THREE.PerspectiveCamera()
    updateReflectionCamera(virtual, source)
    return { source, virtual }
  }

  it('sits under the plane, mirrored from the source camera', () => {
    const { virtual } = rig()
    expect(virtual.position.x).toBeCloseTo(1, 9)
    expect(virtual.position.y).toBeCloseTo(2 * REFLECT_PLANE_Y - 0.5, 9)
    expect(virtual.position.z).toBeCloseTo(-3, 9)
    expect(virtual.far).toBe(260)
  })

  it('keeps the horizontal projection rows and replaces the depth row with the clip plane', () => {
    const { source, virtual } = rig()
    for (const i of [0, 5, 8, 9, 11]) expect(virtual.projectionMatrix.elements[i]).toBe(source.projectionMatrix.elements[i])
    expect(virtual.projectionMatrix.elements[10]).not.toBe(source.projectionMatrix.elements[10])
  })

  it('maps points on the plane to the near plane and clips points below it', () => {
    const { virtual } = rig()
    const ndcZ = (y: number) => {
      const clip = new THREE.Vector4(1.5, y, -8, 1).applyMatrix4(virtual.matrixWorldInverse).applyMatrix4(virtual.projectionMatrix)
      return clip.z / clip.w
    }
    expect(ndcZ(REFLECT_PLANE_Y)).toBeCloseTo(-1, 5)
    expect(ndcZ(0.5)).toBeGreaterThan(-1)
    expect(ndcZ(-3)).toBeLessThan(-1)
  })

  it('can be called every frame without drifting', () => {
    const { source, virtual } = rig()
    const first = virtual.projectionMatrix.clone()
    for (let i = 0; i < 5; i++) updateReflectionCamera(virtual, source)
    expect(virtual.projectionMatrix.equals(first)).toBe(true)
    virtual.layers.set(REFLECT_LAYER)
    expect(virtual.layers.mask).toBe(1 << REFLECT_LAYER)
  })
})
