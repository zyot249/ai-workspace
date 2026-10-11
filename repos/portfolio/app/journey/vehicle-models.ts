import * as THREE from 'three'
import { mergeVehicleParts, type VehiclePart } from './vehicle-geometry'
import { VEHICLE_SCALE, VEHICLE_SPECS, VEHICLE_TYPES, type VehicleType, vehicleBounds } from './vehicle-specs'

// Absolute path: it assumes the site is deployed at the domain root (no Nuxt `app.baseURL`).
export const VEHICLE_MODEL_DIR = '/models/vehicles/'
// How far a merged model may drift from its measured bounds, in scene units, before the load is rejected.
export const VEHICLE_BOUNDS_TOLERANCE = 0.05

export interface VehicleModels {
  readonly geometries: Readonly<Record<VehicleType, THREE.BufferGeometry>>
  // The palette texture every Kenney model shares. All three GLBs embed the same image; the first one is kept.
  readonly map: THREE.Texture
}

export type GltfSource = (url: string) => Promise<{ scene: THREE.Object3D }>

async function loadGltf(url: string): Promise<{ scene: THREE.Object3D }> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  return new GLTFLoader().loadAsync(url)
}

function collectParts(root: THREE.Object3D): { parts: VehiclePart[]; map: THREE.Texture | null } {
  root.updateWorldMatrix(true, true)
  const parts: VehiclePart[] = []
  let map: THREE.Texture | null = null
  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    parts.push({ geometry: mesh.geometry, matrix: mesh.matrixWorld.clone() })
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    map ??= (material as THREE.MeshStandardMaterial | undefined)?.map ?? null
  })
  return { parts, map }
}

function assertMatchesSpec(type: VehicleType, geometry: THREE.BufferGeometry): void {
  const box = geometry.boundingBox
  const expected = vehicleBounds(type)
  const measured = box
    ? { minZ: box.min.z, maxZ: box.max.z, minY: box.min.y, maxY: box.max.y }
    : null
  const matches = measured !== null
    && Math.abs(measured.minZ - expected.minZ) <= VEHICLE_BOUNDS_TOLERANCE
    && Math.abs(measured.maxZ - expected.maxZ) <= VEHICLE_BOUNDS_TOLERANCE
    && Math.abs(measured.minY - expected.minY) <= VEHICLE_BOUNDS_TOLERANCE
    && Math.abs(measured.maxY - expected.maxY) <= VEHICLE_BOUNDS_TOLERANCE
  if (!matches) {
    throw new Error(
      `The ${type} model does not match its spec. Measured ${JSON.stringify(measured)}, expected ${JSON.stringify({
        minZ: expected.minZ, maxZ: expected.maxZ, minY: expected.minY, maxY: expected.maxY,
      })}`,
    )
  }
}

export async function loadVehicleModels(source: GltfSource = loadGltf): Promise<VehicleModels> {
  const loaded = await Promise.all(VEHICLE_TYPES.map(async type => ({
    type,
    gltf: await source(VEHICLE_MODEL_DIR + VEHICLE_SPECS[type].file),
  })))
  const geometries: Partial<Record<VehicleType, THREE.BufferGeometry>> = {}
  let map: THREE.Texture | null = null
  const spareMaps: THREE.Texture[] = []
  try {
    for (const { type, gltf } of loaded) {
      const collected = collectParts(gltf.scene)
      if (!collected.map) throw new Error(`The ${type} model has no textured material`)
      if (map === null) map = collected.map
      else if (collected.map !== map) spareMaps.push(collected.map)
      const geometry = mergeVehicleParts(collected.parts, VEHICLE_SCALE)
      // Registered before the check so the catch block disposes it if the check throws.
      geometries[type] = geometry
      assertMatchesSpec(type, geometry)
    }
  } catch (error) {
    for (const geometry of Object.values(geometries)) geometry.dispose()
    for (const texture of [map, ...spareMaps]) texture?.dispose()
    throw error
  }
  // The other two palette copies are never drawn.
  for (const texture of spareMaps) texture.dispose()
  if (map === null) throw new Error('No vehicle model has a texture')
  return { geometries: geometries as Record<VehicleType, THREE.BufferGeometry>, map }
}

export function disposeVehicleModels(models: VehicleModels): void {
  for (const type of VEHICLE_TYPES) models.geometries[type].dispose()
  models.map.dispose()
}

// The part of `Traffic` the swap drives. Kept structural so tests can pass fakes without WebGL.
export interface VehicleModelTarget {
  stageModels(models: VehicleModels): void
  showModels(): void
  discardModels(): void
}

export interface AttachVehicleModelsOptions {
  traffic: VehicleModelTarget
  load: () => Promise<VehicleModels>
  isDisposed: () => boolean
  // Runs after the model meshes are staged (hidden) and before they show. The scene compiles their shaders here.
  warm?: () => Promise<void>
  onReady?: () => void
  // Called at most once, and never after the scene is disposed.
  onError?: (error: unknown) => void
}

// Never rejects. A failed load, a rejected stage, or a failed warmup leaves the box cars. After the scene
// is disposed it reports nothing and shows nothing.
export async function attachVehicleModels(options: AttachVehicleModelsOptions): Promise<void> {
  const { traffic, load, isDisposed, warm, onReady, onError } = options
  const report = (error: unknown) => { if (!isDisposed()) onError?.(error) }
  let models: VehicleModels
  try {
    models = await load()
  } catch (error) {
    report(error)
    return
  }
  if (isDisposed()) {
    disposeVehicleModels(models)
    return
  }
  try {
    traffic.stageModels(models)
  } catch (error) {
    disposeVehicleModels(models)
    report(error)
    return
  }
  // From here traffic owns the models: `discardModels` disposes them.
  try {
    await warm?.()
    if (isDisposed()) {
      traffic.discardModels()
      return
    }
    traffic.showModels()
  } catch (error) {
    traffic.discardModels()
    report(error)
    return
  }
  onReady?.()
}
