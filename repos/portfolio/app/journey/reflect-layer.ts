import type * as THREE from 'three'

// The reflection camera renders only this layer. Objects stay on layer 0 for the main camera.
export const REFLECT_LAYER = 1

// The one place that decides what puddles reflect. r186 filters lights by the rendering camera's layers too,
// so lights belong in this list: a lit material in the reflection is black without them.
export function reflectInPuddles(...objects: THREE.Object3D[]): void {
  for (const object of objects) object.traverse(child => child.layers.enable(REFLECT_LAYER))
}
