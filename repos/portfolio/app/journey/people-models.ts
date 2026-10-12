import * as THREE from 'three'
import { attachModels, type ModelSwapTarget } from './model-swap'
import { buildPersonTemplate, disposePersonTemplate, type PersonTemplate } from './people-rig'
import { CHARACTER_SPECS, PEOPLE_MODEL_DIR } from './people-specs'

export interface PeopleModels {
  readonly templates: readonly PersonTemplate[]
}

export type PeopleGltfSource = (url: string) => Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>

async function loadGltf(url: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js')
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url)
}

export async function loadPeopleModels(source: PeopleGltfSource = loadGltf): Promise<PeopleModels> {
  const loaded = await Promise.all(CHARACTER_SPECS.map(spec => source(PEOPLE_MODEL_DIR + spec.file)))
  const templates: PersonTemplate[] = []
  try {
    for (const gltf of loaded) templates.push(buildPersonTemplate(gltf.scene, gltf.animations))
  } catch (error) {
    for (const template of templates) disposePersonTemplate(template)
    throw error
  }
  return { templates }
}

export function disposePeopleModels(models: PeopleModels): void {
  for (const template of models.templates) disposePersonTemplate(template)
}

export type PeopleModelTarget = ModelSwapTarget<PeopleModels>

export interface AttachPeopleModelsOptions {
  people: PeopleModelTarget
  load: () => Promise<PeopleModels>
  isDisposed: () => boolean
  warm?: () => Promise<void>
  onReady?: () => void
  onError?: (error: unknown) => void
}

export async function attachPeopleModels(options: AttachPeopleModelsOptions): Promise<void> {
  const { people, load, isDisposed, warm, onReady, onError } = options
  return attachModels({ target: people, load, disposeModels: disposePeopleModels, isDisposed, warm, onReady, onError })
}
