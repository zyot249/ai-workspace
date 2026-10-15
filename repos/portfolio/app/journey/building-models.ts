// app/journey/building-models.ts
import * as THREE from 'three'
import { type BakedPart, normalizePiece } from './building-geometry'
import {
  BUILDING_BOUNDS_TOLERANCE, BUILDING_MODEL_DIR, NEAR_VARIANT_SPECS, type PieceSpec, SET_PIECE_ROLES,
  SET_PIECE_SPECS, type SetPieceRole,
} from './building-specs'
import { attachModels, type ModelSwapTarget } from './model-swap'
import type { Vec3 } from './stops'

export interface PieceModel {
  readonly parts: readonly BakedPart[]
  readonly size: Vec3
}

export interface BuildingModels {
  readonly setPieces: Readonly<Record<SetPieceRole, PieceModel>>
  readonly near: readonly PieceModel[]
}

export type BuildingGltfSource = (url: string) => Promise<{ scene: THREE.Object3D }>

async function loadGltf(url: string): Promise<{ scene: THREE.Object3D }> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js')
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url)
}

function assertMatchesSpec(spec: PieceSpec, size: Vec3): void {
  const matches = size.every((value, i) => Math.abs(value - (spec.size[i] ?? 0)) <= BUILDING_BOUNDS_TOLERANCE)
  if (!matches) {
    throw new Error(`The ${spec.file} model does not match its spec. Measured ${JSON.stringify(size)}, expected ${JSON.stringify(spec.size)}`)
  }
}

function textureValues(material: THREE.Material): THREE.Texture[] {
  return Object.values(material).filter((value): value is THREE.Texture => value instanceof THREE.Texture)
}

// All pieces share one material instance per material name. The spare copies (and their textures) are never drawn.
function unifyMaterials(pieces: readonly PieceModel[]): PieceModel[] {
  const canonical = new Map<string, THREE.Material>()
  const spares = new Set<THREE.Material>()
  const unified = pieces.map((piece): PieceModel => ({
    size: piece.size,
    parts: piece.parts.map(part => {
      const kept = canonical.get(part.material.name) ?? part.material
      canonical.set(part.material.name, kept)
      if (kept !== part.material) spares.add(part.material)
      return { geometry: part.geometry, material: kept }
    }),
  }))
  const retained = new Set([...canonical.values()].flatMap(textureValues))
  const released = new Set<THREE.Texture>()
  for (const spare of spares) {
    for (const texture of textureValues(spare)) {
      if (!retained.has(texture) && !released.has(texture)) { texture.dispose(); released.add(texture) }
    }
    spare.dispose()
  }
  return unified
}

function disposePieces(pieces: readonly PieceModel[]): void {
  const materials = new Set<THREE.Material>()
  const geometries = new Set<THREE.BufferGeometry>()
  const textures = new Set<THREE.Texture>()
  for (const piece of pieces) {
    for (const part of piece.parts) {
      geometries.add(part.geometry)
      materials.add(part.material)
    }
  }
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) {
    for (const texture of textureValues(material)) textures.add(texture)
    material.dispose()
  }
  for (const texture of textures) texture.dispose()
}

export async function loadBuildingModels(source: BuildingGltfSource = loadGltf): Promise<BuildingModels> {
  const specs: readonly PieceSpec[] = [...SET_PIECE_ROLES.map(role => SET_PIECE_SPECS[role]), ...NEAR_VARIANT_SPECS]
  const files = [...new Set(specs.map(spec => spec.file))]
  const results = await Promise.allSettled(files.map(async file => [file, (await source(BUILDING_MODEL_DIR + file)).scene] as const))
  const scenes = new Map(results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []))
  const originals: PieceModel[] = [...scenes.values()].map(scene => {
    const parts: BakedPart[] = []
    scene.traverse(object => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        parts.push({ geometry: mesh.geometry, material })
      }
    })
    return { parts, size: [0, 0, 0] }
  })
  const rejected = results.find(result => result.status === 'rejected')
  if (rejected?.status === 'rejected') { disposePieces(originals); throw rejected.reason }
  const built: PieceModel[] = []
  try {
    for (const spec of specs) {
      const scene = scenes.get(spec.file)
      if (!scene) throw new Error(`The ${spec.file} model did not load`)
      const piece = normalizePiece(scene, spec)
      built.push(piece)
      assertMatchesSpec(spec, piece.size)
    }
  } catch (error) {
    disposePieces([...built, ...originals])
    throw error
  }
  // Geometry is baked; materials transfer to the normalized pieces.
  for (const geometry of new Set(originals.flatMap(piece => piece.parts.map(part => part.geometry)))) geometry.dispose()
  const unified = unifyMaterials(built)
  const setPieceModels = unified.slice(0, SET_PIECE_ROLES.length)
  const setPieces = Object.fromEntries(SET_PIECE_ROLES.map((role, i) => [role, setPieceModels[i]])) as Record<SetPieceRole, PieceModel>
  return { setPieces, near: unified.slice(SET_PIECE_ROLES.length) }
}

export function disposeBuildingModels(models: BuildingModels): void {
  disposePieces([...SET_PIECE_ROLES.map(role => models.setPieces[role]), ...models.near])
}

export type BuildingModelTarget = ModelSwapTarget<BuildingModels>

export interface AttachBuildingModelsOptions {
  target: BuildingModelTarget
  load: () => Promise<BuildingModels>
  isDisposed: () => boolean
  // Runs after the models are staged (hidden) and before they show. The scene compiles their shaders here.
  warm?: () => Promise<void>
  onReady?: () => void
  // Called at most once, and never after the scene is disposed.
  onError?: (error: unknown) => void
}

// Never rejects. A failed load, a rejected stage, or a failed warmup keeps the current look.
export async function attachBuildingModels(options: AttachBuildingModelsOptions): Promise<void> {
  const { target, load, isDisposed, warm, onReady, onError } = options
  return attachModels({ target, load, disposeModels: disposeBuildingModels, isDisposed, warm, onReady, onError })
}
