import * as THREE from 'three'
import type { Vec3 } from './stops'

// 3 mm above the road (-1). The ground is at -1.01 and the shadow quads at -0.995.
export const REFLECT_PLANE_Y = -0.997

export interface ReflectedCamera {
  position: Vec3
  target: Vec3
  up: Vec3
}

// Mirror a camera across the horizontal plane y = planeY. Points mirror; the up direction only flips in y.
export function reflectedCamera(position: Vec3, target: Vec3, up: Vec3, planeY: number): ReflectedCamera {
  return {
    position: [position[0], 2 * planeY - position[1], position[2]],
    target: [target[0], 2 * planeY - target[1], target[2]],
    up: [up[0], -up[1], up[2]],
  }
}

const clipScratch = new THREE.Vector4()
const q = new THREE.Vector4()

// Lengyel's oblique near-plane clipping (the maths in three's Reflector), perspective cameras only. `plane` is in
// the camera's view space; geometry on its negative side is clipped. Rewrites the depth row of `projection`.
export function applyObliqueClip(projection: THREE.Matrix4, plane: THREE.Vector4, clipBias = 0): void {
  const e = projection.elements
  q.set(
    (Math.sign(plane.x) + e[8]!) / e[0]!,
    (Math.sign(plane.y) + e[9]!) / e[5]!,
    -1,
    (1 + e[10]!) / e[14]!,
  )
  clipScratch.copy(plane).multiplyScalar(2 / plane.dot(q))
  e[2] = clipScratch.x
  e[6] = clipScratch.y
  e[10] = clipScratch.z + 1 - clipBias
  e[14] = clipScratch.w
}

const sourcePosition = new THREE.Vector3()
const sourceForward = new THREE.Vector3()
const sourceUp = new THREE.Vector3()
const plane = new THREE.Plane()
const upAxis = new THREE.Vector3(0, 1, 0)

// Points `virtual` at the mirror image of `source`, copies its lens, and clips everything under the plane.
// The image is upside down by design (the up vector is mirrored); the overlay's texture matrix undoes that.
export function updateReflectionCamera(
  virtual: THREE.PerspectiveCamera, source: THREE.PerspectiveCamera, planeY = REFLECT_PLANE_Y,
): void {
  source.updateMatrixWorld()
  sourcePosition.setFromMatrixPosition(source.matrixWorld)
  sourceForward.set(0, 0, -1).transformDirection(source.matrixWorld)
  sourceUp.set(0, 1, 0).transformDirection(source.matrixWorld)
  const mirrored = reflectedCamera(
    [sourcePosition.x, sourcePosition.y, sourcePosition.z],
    [sourcePosition.x + sourceForward.x, sourcePosition.y + sourceForward.y, sourcePosition.z + sourceForward.z],
    [sourceUp.x, sourceUp.y, sourceUp.z],
    planeY,
  )
  virtual.position.set(...mirrored.position)
  virtual.up.set(...mirrored.up)
  virtual.lookAt(...mirrored.target)
  virtual.near = source.near
  virtual.far = source.far
  virtual.projectionMatrix.copy(source.projectionMatrix)
  virtual.projectionMatrixInverse.copy(source.projectionMatrixInverse)
  virtual.updateMatrixWorld()
  plane.set(upAxis, -planeY).applyMatrix4(virtual.matrixWorldInverse)
  clipScratch.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
  applyObliqueClip(virtual.projectionMatrix, clipScratch)
}
