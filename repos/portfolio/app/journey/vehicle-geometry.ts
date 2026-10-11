import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface VehiclePart {
  geometry: THREE.BufferGeometry
  // The part's transform relative to the model root, with the node hierarchy already applied.
  matrix: THREE.Matrix4
}

// Kenney models face +Z. Traffic authors cars facing -Z, so every model turns 180 degrees about Y.
const FACE_NEGATIVE_Z = new THREE.Matrix4().makeRotationY(Math.PI)

export function mergeVehicleParts(parts: readonly VehiclePart[], scale: number): THREE.BufferGeometry {
  if (parts.length === 0) throw new Error('A vehicle model has no meshes')
  const normalize = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(FACE_NEGATIVE_Z)
  const baked = parts.map(({ geometry, matrix }) =>
    geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(normalize, matrix)))
  const merged = mergeGeometries(baked, false)
  for (const geometry of baked) geometry.dispose()
  if (!merged) throw new Error('Vehicle model parts have incompatible attributes')
  merged.computeBoundingBox()
  return merged
}
