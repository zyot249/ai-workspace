// tests/journey/support/fake-rig.ts
import * as THREE from 'three'
import { buildPersonTemplate, type PersonTemplate } from '../../../app/journey/people-rig'
import { CLIP_NAMES, PEOPLE_CLIPS } from '../../../app/journey/people-specs'

export const RIG_HEIGHT = 1.8
const HIPS_HEIGHT = 0.9

function skinned(skeleton: THREE.Skeleton, boneIndex: number, box: THREE.BoxGeometry, color: number): THREE.SkinnedMesh {
  const count = box.getAttribute('position').count
  box.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? boneIndex : 0)), 4))
  box.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4))
  const mesh = new THREE.SkinnedMesh(box, new THREE.MeshStandardMaterial({ color }))
  mesh.skeleton = skeleton
  return mesh
}

// A stand-in character: legs and a torso as two skinned parts with different skeleton bone orders, so the
// merge must remap bones by name. Feet at y = 0, head top at RIG_HEIGHT, facing +Z like a glTF character.
export function fakeRigScene(): THREE.Group {
  const hips = new THREE.Bone()
  hips.name = 'Hips'
  hips.position.y = HIPS_HEIGHT
  const head = new THREE.Bone()
  head.name = 'Head'
  head.position.y = HIPS_HEIGHT
  hips.add(head)
  const scene = new THREE.Group()
  scene.add(hips)
  scene.updateMatrixWorld(true)

  const legs = skinned(new THREE.Skeleton([hips, head]), 0, new THREE.BoxGeometry(0.3, HIPS_HEIGHT, 0.2), 0x3355aa)
  legs.geometry.translate(0, HIPS_HEIGHT / 2, 0)
  const torso = skinned(new THREE.Skeleton([head, hips]), 1, new THREE.BoxGeometry(0.4, HIPS_HEIGHT, 0.2), 0xaa3333)
  torso.geometry.translate(0, HIPS_HEIGHT * 1.5, 0)
  scene.add(legs, torso)
  scene.updateMatrixWorld(true)
  legs.bind(legs.skeleton)
  torso.bind(torso.skeleton)
  return scene
}

// One clip per distinct name, so a model whose talk clip is its idle clip works too.
export function fakeClips(): THREE.AnimationClip[] {
  return [...new Set(CLIP_NAMES.map(name => PEOPLE_CLIPS[name]))].map(name =>
    new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack('Hips.position[y]', [0, 1], [HIPS_HEIGHT, HIPS_HEIGHT + 0.05])]))
}

export function fakeTemplate(): PersonTemplate {
  return buildPersonTemplate(fakeRigScene(), fakeClips())
}
