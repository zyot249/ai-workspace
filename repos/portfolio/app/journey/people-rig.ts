import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { type ClipName, MODEL_FACING_Y, PEOPLE_CLIPS, PERSON_HEIGHT } from './people-specs'

export interface PersonTemplate {
  // Group holding the normalized model: facing -Z, PERSON_HEIGHT tall, feet on y = 0. Clone it per person.
  readonly root: THREE.Group
  readonly clips: Readonly<Record<ClipName, THREE.AnimationClip>>
  readonly material: THREE.MeshStandardMaterial
  readonly geometry: THREE.BufferGeometry
  readonly map: THREE.Texture | null
}

const KEPT_ATTRIBUTES = new Set(['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'color'])
const MATRIX_TOLERANCE = 1e-5
const SKIN_COMPONENTS = 4
export const BODY_NAME = 'person-body'

export function collectSkinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = []
  root.traverse(object => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh)
  })
  return meshes
}

function sameMatrix(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  return a.elements.every((value, i) => Math.abs(value - (b.elements[i] ?? Number.NaN)) <= MATRIX_TOLERANCE)
}

function materialOf(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  const standard = material as THREE.MeshStandardMaterial | undefined
  if (!standard?.color) throw new Error('A person part has no color material')
  return standard
}

// Rewrites the part's bone indices so they point into the reference skeleton's bone list, by bone name.
function remapSkinIndices(geometry: THREE.BufferGeometry, from: readonly THREE.Bone[], to: ReadonlyMap<string, number>): void {
  const indices = geometry.getAttribute('skinIndex')
  const weights = geometry.getAttribute('skinWeight')
  for (let i = 0; i < indices.count; i++) {
    for (let c = 0; c < SKIN_COMPONENTS; c++) {
      if (weights.getComponent(i, c) === 0) {
        indices.setComponent(i, c, 0)
        continue
      }
      const local = indices.getComponent(i, c)
      const name = from[local]?.name
      const target = name === undefined ? undefined : to.get(name)
      if (target === undefined) throw new Error(`Bone "${name ?? local}" is not in the reference skeleton`)
      indices.setComponent(i, c, target)
    }
  }
}

function bakeColor(geometry: THREE.BufferGeometry, color: THREE.Color): void {
  const count = geometry.getAttribute('position').count
  const data = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    data[i * 3] = color.r
    data[i * 3 + 1] = color.g
    data[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(data, 3))
}

// Merges the modular parts of one character into a single geometry that skins against the first part's
// skeleton. The parts must share a frame and a texture (or have none); their flat material colors become
// vertex colors, so one material draws the whole person.
export function mergeSkinnedParts(meshes: readonly THREE.SkinnedMesh[]): { geometry: THREE.BufferGeometry; map: THREE.Texture | null } {
  const reference = meshes[0]
  if (!reference) throw new Error('The person model has no skinned meshes')
  const indexByName = new Map<string, number>()
  reference.skeleton.bones.forEach((bone, i) => {
    if (indexByName.has(bone.name)) throw new Error(`The skeleton has two bones named "${bone.name}"`)
    indexByName.set(bone.name, i)
  })
  const map = materialOf(reference).map ?? null
  const prepared: THREE.BufferGeometry[] = []
  try {
    for (const mesh of meshes) {
      // Attached skinning cancels the mesh world transform; bind frames and bone inverses define the pose.
      if (!sameMatrix(mesh.bindMatrix, reference.bindMatrix) || mesh.skeleton.bones.some((bone, i) => {
        const target = indexByName.get(bone.name)
        return target !== undefined && !sameMatrix(mesh.skeleton.boneInverses[i]!, reference.skeleton.boneInverses[target]!)
      })) {
        throw new Error('The person parts do not share one frame')
      }
      const material = materialOf(mesh)
      if ((material.map ?? null) !== map) throw new Error('The person parts use different textures')
      const copy = mesh.geometry.clone()
      for (const name of Object.keys(copy.attributes)) if (!KEPT_ATTRIBUTES.has(name)) copy.deleteAttribute(name)
      remapSkinIndices(copy, mesh.skeleton.bones, indexByName)
      bakeColor(copy, material.color)
      // mergeGeometries needs every part indexed or none; flattening keeps it simple at these polygon counts.
      const flat = copy.index ? copy.toNonIndexed() : copy
      if (flat !== copy) copy.dispose()
      prepared.push(flat)
    }
    const merged = mergeGeometries(prepared, false)
    if (!merged) throw new Error('The person parts have incompatible attributes')
    return { geometry: merged, map }
  } finally {
    for (const geometry of prepared) geometry.dispose()
  }
}

export function createPersonMaterial(map: THREE.Texture | null): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map, vertexColors: true, roughness: 0.85, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0,
  })
  material.name = 'journey-street-person'
  return material
}

function pickClips(animations: readonly THREE.AnimationClip[]): Record<ClipName, THREE.AnimationClip> {
  const byName = new Map(animations.map(clip => [clip.name, clip] as const))
  function pick(role: ClipName): THREE.AnimationClip {
    const clip = byName.get(PEOPLE_CLIPS[role])
    if (!clip) throw new Error(`The person model has no "${PEOPLE_CLIPS[role]}" clip for ${role}. It has: ${[...byName.keys()].join(', ')}`)
    return clip
  }
  return { walk: pick('walk'), idle: pick('idle'), talk: pick('talk') }
}

// Turns a loaded character into a template: one skinned mesh, facing -Z, PERSON_HEIGHT tall, feet on y = 0.
// Takes ownership of `scene`: it removes the original parts and disposes their geometries and materials.
export function buildPersonTemplate(scene: THREE.Object3D, animations: readonly THREE.AnimationClip[]): PersonTemplate {
  const clips = pickClips(animations)
  const parts = collectSkinnedMeshes(scene)
  const reference = parts[0]
  const parent = reference?.parent
  if (!reference || !parent) throw new Error('The person model has no skinned meshes')
  scene.updateWorldMatrix(true, true)
  const { geometry, map } = mergeSkinnedParts(parts)
  const material = createPersonMaterial(map)
  try {
    const body = new THREE.SkinnedMesh(geometry, material)
    body.name = BODY_NAME
    body.frustumCulled = false
    reference.matrix.decompose(body.position, body.quaternion, body.scale)
    parent.add(body)
    body.bind(reference.skeleton, reference.bindMatrix)
    for (const part of parts) {
      part.parent?.remove(part)
      part.geometry.dispose()
      materialOf(part).dispose()
    }

    const root = new THREE.Group()
    root.name = 'person'
    root.add(scene)
    scene.position.set(0, 0, 0)
    scene.scale.setScalar(1)
    scene.rotateY(MODEL_FACING_Y)
    root.updateMatrixWorld(true)
    body.computeBoundingBox()
    const box = (body.boundingBox ?? new THREE.Box3()).clone().applyMatrix4(body.matrixWorld)
    const height = box.max.y - box.min.y
    if (!(height > 0) || !Number.isFinite(height)) throw new Error(`The person model has no usable height (${height})`)
    const scale = PERSON_HEIGHT / height
    scene.scale.setScalar(scale)
    scene.position.y = -box.min.y * scale
    return { root, clips, material, geometry, map }
  } catch (error) {
    geometry.dispose()
    material.dispose()
    throw error
  }
}

export function disposePersonTemplate(template: PersonTemplate): void {
  template.geometry.dispose()
  template.material.dispose()
  template.map?.dispose()
}
