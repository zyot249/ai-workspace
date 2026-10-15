// app/journey/building-geometry.ts
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { PieceSpec } from './building-specs'
import type { Vec3 } from './stops'

export interface BakedPart {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

export interface NormalizedPiece {
  parts: readonly BakedPart[]
  size: Vec3
}

// Bakes every mesh of a model into one frame: world transform, uniform scale, facing turn about Y, then the
// pivot moved to the center of the base (min y = 0, x and z centered). Source geometry is cloned, not changed.
export function normalizePiece(root: THREE.Object3D, spec: Pick<PieceSpec, 'scale' | 'facingY'>): NormalizedPiece {
  root.updateWorldMatrix(true, true)
  const toScene = new THREE.Matrix4().makeRotationY(spec.facingY).multiply(new THREE.Matrix4().makeScale(spec.scale, spec.scale, spec.scale))
  const baked: BakedPart[] = []
  try {
    root.traverse(object => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      if (Array.isArray(mesh.material)) throw new Error('A building model has a multi-material mesh, which is not supported')
      const geometry = mesh.geometry.clone()
      // GLTFLoader retains KHR_mesh_quantization integer attributes. Matrix baking must
      // write floats: integer attributes would clamp/overflow transformed positions.
      for (const name of Object.keys(geometry.attributes)) {
        const source = geometry.getAttribute(name)
        const values = new Float32Array(source.count * source.itemSize)
        for (let i = 0; i < source.count; i++) {
          for (let c = 0; c < source.itemSize; c++) values[i * source.itemSize + c] = source.getComponent(i, c)
        }
        geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, source.itemSize))
      }
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toScene, mesh.matrixWorld))
      baked.push({ geometry, material: mesh.material })
    })
  } catch (error) {
    for (const part of baked) part.geometry.dispose()
    throw error
  }
  if (baked.length === 0) throw new Error('A building model has no meshes')
  const bounds = new THREE.Box3()
  for (const part of baked) {
    part.geometry.computeBoundingBox()
    bounds.union(part.geometry.boundingBox as THREE.Box3)
  }
  const center = bounds.getCenter(new THREE.Vector3())
  const pivot = new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z)
  for (const part of baked) {
    part.geometry.applyMatrix4(pivot)
    part.geometry.computeBoundingBox()
  }
  const size = bounds.getSize(new THREE.Vector3())
  return { parts: baked, size: [size.x, size.y, size.z] }
}

// Points every vertex at one color of the palette texture, so the geometry draws as one flat color.
export function setUniformUv(geometry: THREE.BufferGeometry, uv: readonly [number, number]): void {
  const count = geometry.getAttribute('position').count
  const values = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    values[i * 2] = uv[0]
    values[i * 2 + 1] = uv[1]
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(values, 2))
}

// One geometry per material name. The first material instance seen for a name is the one kept.
export function mergeByMaterial(parts: readonly BakedPart[]): BakedPart[] {
  const groups = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>()
  for (const part of parts) {
    const group = groups.get(part.material.name) ?? { material: part.material, geometries: [] }
    group.geometries.push(part.geometry)
    groups.set(part.material.name, group)
  }
  const merged: BakedPart[] = []
  try {
    for (const { material, geometries } of groups.values()) {
      const geometry = mergeGeometries(geometries, false)
      if (!geometry) throw new Error('Building model parts have incompatible attributes')
      merged.push({ geometry, material })
    }
    return merged
  } catch (error) {
    for (const part of merged) part.geometry.dispose()
    throw error
  }
}
