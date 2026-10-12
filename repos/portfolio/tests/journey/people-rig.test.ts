// tests/journey/people-rig.test.ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  buildPersonTemplate, collectSkinnedMeshes, disposePersonTemplate, mergeSkinnedParts,
} from '../../app/journey/people-rig'
import { CLIP_NAMES, PEOPLE_CLIPS, PERSON_HEIGHT } from '../../app/journey/people-specs'
import { fakeClips, fakeRigScene } from './support/fake-rig'

describe('mergeSkinnedParts', () => {
  it('merges the parts into one geometry and remaps bones by name', () => {
    const scene = fakeRigScene()
    const parts = collectSkinnedMeshes(scene)
    expect(parts).toHaveLength(2)
    const { geometry, map } = mergeSkinnedParts(parts)
    const reference = parts[0]!.skeleton.bones.map(bone => bone.name)
    const index = geometry.getAttribute('skinIndex')
    const weight = geometry.getAttribute('skinWeight')
    const total = geometry.getAttribute('position').count
    expect(total).toBe(parts.reduce((sum, part) => sum + part.geometry.toNonIndexed().getAttribute('position').count, 0))
    for (let i = 0; i < total; i++) {
      // Every vertex is fully weighted to Hips, the same bone by name in both parts, whichever order they list it.
      expect(weight.getComponent(i, 0)).toBe(1)
      expect(reference[index.getComponent(i, 0)]).toBe('Hips')
    }
    expect(geometry.getAttribute('color')).toBeDefined()
    expect(map).toBeNull()
  })

  it('bakes each part material color into vertex colors', () => {
    const { geometry } = mergeSkinnedParts(collectSkinnedMeshes(fakeRigScene()))
    const colors = new Set<string>()
    const color = geometry.getAttribute('color')
    for (let i = 0; i < color.count; i++) colors.add([color.getX(i), color.getY(i), color.getZ(i)].map(v => v.toFixed(3)).join(','))
    expect(colors.size).toBe(2)
  })

  it('throws when a part uses a bone the reference skeleton lacks', () => {
    const parts = collectSkinnedMeshes(fakeRigScene())
    // Bone objects are shared between skeletons, so swap in a new bone instead of renaming one.
    const stranger = new THREE.Bone()
    stranger.name = 'Stranger'
    parts[1]!.skeleton.bones[1] = stranger
    expect(() => mergeSkinnedParts(parts)).toThrow(/Stranger/)
  })

  it('throws when the parts use different textures', () => {
    const parts = collectSkinnedMeshes(fakeRigScene())
    ;(parts[0]!.material as THREE.MeshStandardMaterial).map = new THREE.Texture()
    expect(() => mergeSkinnedParts(parts)).toThrow(/textures/)
  })

  it('throws when there are no parts', () => {
    expect(() => mergeSkinnedParts([])).toThrow(/no skinned meshes/)
  })
})

function bodyBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true)
  const body = root.getObjectByName('person-body') as THREE.SkinnedMesh
  body.computeBoundingBox()
  return body.boundingBox!.clone().applyMatrix4(body.matrixWorld)
}

describe('buildPersonTemplate', () => {
  it('leaves one skinned mesh, scales to PERSON_HEIGHT, and stands the feet on y = 0', () => {
    const template = buildPersonTemplate(fakeRigScene(), fakeClips())
    expect(collectSkinnedMeshes(template.root)).toHaveLength(1)
    const box = bodyBox(template.root)
    expect(box.max.y - box.min.y).toBeCloseTo(PERSON_HEIGHT, 4)
    expect(box.min.y).toBeCloseTo(0, 4)
    disposePersonTemplate(template)
  })

  it('turns a +Z-facing model to face -Z', () => {
    const scene = fakeRigScene()
    const template = buildPersonTemplate(scene, fakeClips())
    template.root.updateMatrixWorld(true)
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(scene.getWorldQuaternion(new THREE.Quaternion()))
    expect(forward.z).toBeLessThan(-0.99)
    disposePersonTemplate(template)
  })

  it('returns the clips by role and shares one for talk and idle when they are the same', () => {
    const template = buildPersonTemplate(fakeRigScene(), fakeClips())
    for (const name of CLIP_NAMES) expect(template.clips[name].name).toBe(PEOPLE_CLIPS[name])
    if (PEOPLE_CLIPS.talk === PEOPLE_CLIPS.idle) expect(template.clips.talk).toBe(template.clips.idle)
    disposePersonTemplate(template)
  })

  it('names the missing clip and the ones it has', () => {
    const clips = fakeClips().filter(clip => clip.name !== PEOPLE_CLIPS.walk)
    expect(() => buildPersonTemplate(fakeRigScene(), clips)).toThrow(new RegExp(`"${PEOPLE_CLIPS.walk}"`))
  })

  it('does not scale by the source height: a taller rig ends up the same height', () => {
    const scene = fakeRigScene()
    scene.scale.setScalar(2)
    const template = buildPersonTemplate(scene, fakeClips())
    const box = bodyBox(template.root)
    expect(box.max.y - box.min.y).toBeCloseTo(PERSON_HEIGHT, 4)
    disposePersonTemplate(template)
  })
})

describe('vendored GLBs', () => {
  it.each(['casual', 'business', 'hoodie'])('normalizes %s with every material primitive preserved', async name => {
    const { readFileSync } = await import('node:fs')
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js')
    const bytes = readFileSync(new URL(`../../public/models/people/${name}.glb`, import.meta.url))
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
    const parts = collectSkinnedMeshes(gltf.scene)
    const expectedColors = new Set(parts.flatMap(part => (Array.isArray(part.material) ? part.material : [part.material]).map(material => (material as THREE.MeshStandardMaterial).color.getHexString())))
    const template = buildPersonTemplate(gltf.scene, gltf.animations)
    expect(collectSkinnedMeshes(template.root)).toHaveLength(1)
    const box = bodyBox(template.root)
    expect(box.max.y - box.min.y).toBeCloseTo(PERSON_HEIGHT, 4)
    expect(box.min.y).toBeCloseTo(0, 4)
    const color = template.geometry.getAttribute('color')
    const colors = new Set(Array.from({ length: color.count }, (_, i) => new THREE.Color(color.getX(i), color.getY(i), color.getZ(i)).getHexString()))
    expect(colors).toEqual(expectedColors)
    const model = template.root.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh
    const mixer = new THREE.AnimationMixer(template.root)
    mixer.clipAction(template.clips.walk).play()
    mixer.update(0.4)
    expect(model.skeleton.bones.some(bone => bone.quaternion.w !== 1)).toBe(true)
    mixer.stopAllAction()
    mixer.uncacheRoot(template.root)
    disposePersonTemplate(template)
  })
})

describe('quantized bind frames', () => {
  it.each(['casual', 'business', 'hoodie'])('preserves %s vertex poses before and during a walk', async name => {
    const { readFileSync } = await import('node:fs')
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js')
    const bytes = readFileSync(new URL(`../../public/models/people/${name}.glb`, import.meta.url))
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
    gltf.scene.updateMatrixWorld(true)
    const parts = collectSkinnedMeshes(gltf.scene)
    const reference = parts[0]!
    const { geometry } = mergeSkinnedParts(parts)
    const merged = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial())
    reference.matrix.decompose(merged.position, merged.quaternion, merged.scale)
    reference.parent!.add(merged)
    merged.bind(reference.skeleton, reference.bindMatrix)
    const mixer = new THREE.AnimationMixer(gltf.scene)
    mixer.clipAction(gltf.animations.find(clip => clip.name === PEOPLE_CLIPS.walk)!).play()
    for (const step of [0, 0.4]) {
      mixer.update(step)
      gltf.scene.updateMatrixWorld(true)
      let offset = 0
      for (const part of parts) {
        const count = part.geometry.index?.count ?? part.geometry.getAttribute('position').count
        for (const index of [0, Math.floor(count / 2), count - 1]) {
          const vertex = part.geometry.index?.getX(index) ?? index
          const source = new THREE.Vector3().fromBufferAttribute(part.geometry.getAttribute('position'), vertex)
          part.applyBoneTransform(vertex, source).applyMatrix4(part.matrixWorld)
          const actual = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), offset + index)
          merged.applyBoneTransform(offset + index, actual).applyMatrix4(merged.matrixWorld)
          expect(actual.distanceTo(source), `${part.name} vertex ${index} at ${step}`).toBeLessThan(1e-5)
        }
        offset += count
      }
    }
    mixer.stopAllAction()
    mixer.uncacheRoot(gltf.scene)
    geometry.dispose()
    ;(merged.material as THREE.Material).dispose()
  })
})
