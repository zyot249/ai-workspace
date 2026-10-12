import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { type PeopleLayout, type Walker, walkerPoseAt, type WalkerPose } from './people-layout'
import { disposePeopleModels, type PeopleModels } from './people-models'
import { collectSkinnedMeshes, type PersonTemplate } from './people-rig'
import {
  CLIP_FADE_SECONDS, type ClipName, FEET_Y, GLOW_END, GLOW_START, MAX_FRAME_STEP, NIGHT_GLOW, PEOPLE_ANIMATE_DISTANCE,
  PEOPLE_GROUP_NAME, PEOPLE_SEED, PEOPLE_VISIBLE_DISTANCE, PERSON_NAME_PREFIX, TALK_CYCLE_SECONDS, TALK_SECONDS,
} from './people-specs'
import { seeded } from './random'
import { smoothstep } from './sky-mirror'

export interface People {
  // Stable parent of the people. The scene adds it once.
  readonly group: THREE.Group
  // The skinned meshes that draw: one per person. Empty until `showModels`.
  readonly objects: readonly THREE.SkinnedMesh[]
  // Clones the templates once per person and adds them to the group hidden, so their shaders can compile
  // before they show. Ignored when the layout is empty, after dispose, or after the first call. People owns
  // the models from then on and disposes them in `discardModels` or `dispose`.
  stageModels(models: PeopleModels): void
  // Lets update() show people. Does nothing unless models are staged.
  showModels(): void
  // Removes the staged people and disposes the models. Does nothing unless models are staged.
  discardModels(): void
  update(windowLitRatio: number, t: number, cameraDistance: number): void
  dispose(): void
}

type Entry =
  | { kind: 'walker'; character: number; offset: number; walker: Walker }
  | { kind: 'fixed'; character: number; offset: number; x: number; z: number; yaw: number; distance: number }

interface Person {
  entry: Entry
  outer: THREE.Group
  model: THREE.Object3D
  mixer: THREE.AnimationMixer
  actions: Readonly<Record<ClipName, THREE.AnimationAction>>
  current: THREE.AnimationAction
  skinned: readonly THREE.SkinnedMesh[]
  distance: number
  moving: boolean
}

interface Staged {
  models: PeopleModels
  people: Person[]
}

const RATIO_QUANTUM = 1e-3
const OFFSET_SEED = PEOPLE_SEED + 200
const walkPose: WalkerPose = { x: 0, z: 0, yaw: 0, moving: true, distance: 0 }

function entriesFor(layout: PeopleLayout): Entry[] {
  const entries: Entry[] = []
  const offset = () => seeded(OFFSET_SEED + entries.length)
  for (const walker of layout.walkers) entries.push({ kind: 'walker', character: walker.character, offset: offset(), walker })
  for (const t of layout.talkers) {
    entries.push({ kind: 'fixed', character: t.character, offset: offset(), x: t.x, z: t.z, yaw: t.yaw, distance: t.distance })
  }
  for (const g of layout.guides) {
    entries.push({ kind: 'fixed', character: g.character, offset: offset(), x: g.x, z: g.z, yaw: g.yaw, distance: g.distance })
  }
  return entries
}

function createPerson(entry: Entry, template: PersonTemplate, index: number): Person {
  const model = clone(template.root)
  const outer = new THREE.Group()
  outer.name = `${PERSON_NAME_PREFIX}${index}`
  outer.add(model)
  outer.visible = false
  const mixer = new THREE.AnimationMixer(model)
  const actions = {
    walk: mixer.clipAction(template.clips.walk),
    idle: mixer.clipAction(template.clips.idle),
    talk: mixer.clipAction(template.clips.talk),
  }
  const current = entry.kind === 'walker' ? actions.walk : actions.talk
  current.play()
  current.time = entry.offset * current.getClip().duration
  const person: Person = {
    entry, outer, model, mixer, actions, current, skinned: collectSkinnedMeshes(model),
    distance: entry.kind === 'fixed' ? entry.distance : walkerPoseAt(entry.walker, 0, walkPose).distance,
    moving: entry.kind === 'walker',
  }
  if (entry.kind === 'fixed') {
    outer.position.set(entry.x, FEET_Y, entry.z)
    outer.rotation.y = entry.yaw
  }
  return person
}

function desiredClip(person: Person, t: number): ClipName {
  if (person.entry.kind === 'walker') return person.moving ? 'walk' : 'idle'
  const phase = (t + person.entry.offset * TALK_CYCLE_SECONDS) % TALK_CYCLE_SECONDS
  return (phase < 0 ? phase + TALK_CYCLE_SECONDS : phase) < TALK_SECONDS ? 'talk' : 'idle'
}

function switchClip(person: Person, name: ClipName): void {
  const next = person.actions[name]
  if (person.current === next) return
  next.reset().play()
  person.current.crossFadeTo(next, CLIP_FADE_SECONDS, false)
  person.current = next
}

function updatePerson(person: Person, t: number, step: number, cameraDistance: number): void {
  const { entry } = person
  if (entry.kind === 'walker') {
    walkerPoseAt(entry.walker, t, walkPose)
    person.outer.position.set(walkPose.x, FEET_Y, walkPose.z)
    person.outer.rotation.y = walkPose.yaw
    person.distance = walkPose.distance
    person.moving = walkPose.moving
  }
  const gap = Math.abs(person.distance - cameraDistance)
  person.outer.visible = gap <= PEOPLE_VISIBLE_DISTANCE
  if (gap > PEOPLE_ANIMATE_DISTANCE) return
  switchClip(person, desiredClip(person, t))
  person.mixer.update(step)
}

function createEmptyPeople(group: THREE.Group): People {
  return { group, objects: [], stageModels() {}, showModels() {}, discardModels() {}, update() {}, dispose() {} }
}

export function createPeople(layout: PeopleLayout): People {
  const group = new THREE.Group()
  group.name = PEOPLE_GROUP_NAME
  const entries = entriesFor(layout)
  if (entries.length === 0) return createEmptyPeople(group)

  let staged: Staged | null = null
  let shown: Staged | null = null
  let meshes: readonly THREE.SkinnedMesh[] = []
  let offered = false
  let disposed = false
  let lastTime: number | null = null
  let lastKey = -1

  function release(state: Staged) {
    for (const person of state.people) {
      person.mixer.stopAllAction()
      person.mixer.uncacheRoot(person.model)
      for (const mesh of person.skinned) mesh.skeleton.dispose()
      group.remove(person.outer)
    }
    disposePeopleModels(state.models)
  }

  return {
    group,
    get objects() { return meshes },
    stageModels(models) {
      if (disposed || offered) return
      offered = true
      const people = entries.map((entry, i) => {
        const template = models.templates[entry.character % models.templates.length]
        if (!template) throw new Error('There are no person templates to clone')
        return createPerson(entry, template, i)
      })
      group.add(...people.map(person => person.outer))
      staged = { models, people }
    },
    showModels() {
      if (disposed || !staged) return
      shown = staged
      staged = null
      meshes = shown.people.flatMap(person => person.skinned)
    },
    discardModels() {
      if (disposed || !staged) return
      release(staged)
      staged = null
    },
    update(windowLitRatio, t, cameraDistance) {
      if (!shown) return
      const step = lastTime === null ? 0 : Math.min(Math.max(t - lastTime, 0), MAX_FRAME_STEP)
      lastTime = t
      const key = Math.round(windowLitRatio / RATIO_QUANTUM)
      if (key !== lastKey) {
        lastKey = key
        const glow = NIGHT_GLOW * smoothstep(GLOW_START, GLOW_END, windowLitRatio)
        for (const template of shown.models.templates) template.material.emissiveIntensity = glow
      }
      for (const person of shown.people) updatePerson(person, t, step, cameraDistance)
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (staged) release(staged)
      if (shown) release(shown)
      staged = null
      shown = null
      meshes = []
    },
  }
}
