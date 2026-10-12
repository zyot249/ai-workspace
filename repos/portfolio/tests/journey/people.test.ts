// tests/journey/people.test.ts
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hallFrameSlots } from '../../app/journey/hall'
import { peopleLayout, walkerPoseAt } from '../../app/journey/people-layout'
import type { PeopleModels } from '../../app/journey/people-models'
import { createPeople } from '../../app/journey/people'
import {
  FEET_Y, MAX_FRAME_STEP, MAX_PEOPLE, PEOPLE_ANIMATE_DISTANCE, PEOPLE_COUNTS, PEOPLE_GROUP_NAME, PEOPLE_VISIBLE_DISTANCE,
  PERSON_NAME_PREFIX,
} from '../../app/journey/people-specs'
import { fakeTemplate } from './support/fake-rig'

const FULL = peopleLayout(PEOPLE_COUNTS.full, hallFrameSlots(8))
const FULL_COUNT = FULL.walkers.length + FULL.talkers.length + FULL.guides.length

function fakeModels(): PeopleModels {
  return { templates: [fakeTemplate(), fakeTemplate(), fakeTemplate()] }
}

afterEach(() => { vi.restoreAllMocks() })

describe('createPeople', () => {
  it('is empty and inert for an empty layout', () => {
    const people = createPeople({ walkers: [], talkers: [], guides: [] })
    expect(people.group.name).toBe(PEOPLE_GROUP_NAME)
    people.stageModels(fakeModels())
    people.showModels()
    people.update(0.5, 3, 10)
    expect(people.group.children).toHaveLength(0)
    expect(people.objects).toHaveLength(0)
    people.dispose()
  })

  it('stages hidden people without listing them, and update before show does nothing', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    expect(people.group.children).toHaveLength(FULL_COUNT)
    expect(people.group.children.every(child => !child.visible)).toBe(true)
    expect(people.objects).toHaveLength(0)
    expect(() => people.update(0.5, 3, 10)).not.toThrow()
    expect(people.group.children.every(child => !child.visible)).toBe(true)
    people.dispose()
  })

  it('shows one skinned mesh per person, within the draw-call cap, and names them', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.showModels()
    expect(people.objects).toHaveLength(FULL_COUNT)
    expect(people.objects.length).toBeLessThanOrEqual(MAX_PEOPLE)
    people.group.children.forEach((child, i) => expect(child.name).toBe(`${PERSON_NAME_PREFIX}${i}`))
    people.dispose()
  })

  it('ignores a second stageModels, and ignores everything after dispose', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.stageModels(fakeModels())
    expect(people.group.children).toHaveLength(FULL_COUNT)
    people.dispose()
    people.dispose()
    people.stageModels(fakeModels())
    people.showModels()
    expect(people.group.children).toHaveLength(0)
    expect(people.objects).toHaveLength(0)
  })

  it('discards staged people and leaves the group empty', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.discardModels()
    expect(people.group.children).toHaveLength(0)
    people.showModels()
    expect(people.objects).toHaveLength(0)
    people.dispose()
  })

  it('stands standing people on the sidewalk and walkers on their poses', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.showModels()
    people.update(0.5, 7.5, 20)
    const first = people.group.children[0]!
    const pose = walkerPoseAt(FULL.walkers[0]!, 7.5)
    expect(first.position.x).toBeCloseTo(pose.x, 6)
    expect(first.position.z).toBeCloseTo(pose.z, 6)
    expect(first.position.y).toBeCloseTo(FEET_Y, 6)
    const talker = people.group.children[FULL.walkers.length]!
    expect(talker.position.x).toBeCloseTo(FULL.talkers[0]!.x, 6)
    expect(talker.position.z).toBeCloseTo(FULL.talkers[0]!.z, 6)
    people.dispose()
  })

  it('hides people beyond the visible distance and animates only those within the animate distance', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.showModels()
    const update = vi.spyOn(THREE.AnimationMixer.prototype, 'update')
    const cameraDistance = 30
    people.update(0.5, 1, cameraDistance)
    const distances = [...FULL.walkers.map(w => walkerPoseAt(w, 1).distance), ...FULL.talkers.map(t => t.distance), ...FULL.guides.map(g => g.distance)]
    distances.forEach((distance, i) => {
      expect(people.group.children[i]!.visible, `person ${i}`).toBe(Math.abs(distance - cameraDistance) <= PEOPLE_VISIBLE_DISTANCE)
    })
    const near = distances.filter(distance => Math.abs(distance - cameraDistance) <= PEOPLE_ANIMATE_DISTANCE).length
    expect(near).toBeGreaterThan(0)
    expect(near).toBeLessThan(FULL_COUNT)
    expect(update).toHaveBeenCalledTimes(near)
    people.dispose()
  })

  it('clamps the mixer step for a jump in time, and the first update does not advance', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.showModels()
    const update = vi.spyOn(THREE.AnimationMixer.prototype, 'update')
    people.update(0.5, 1e7, 30)
    expect(update.mock.calls.every(([step]) => step === 0)).toBe(true)
    update.mockClear()
    people.update(0.5, 1e7 + 5, 30)
    expect(update.mock.calls.every(([step]) => step === MAX_FRAME_STEP)).toBe(true)
    update.mockClear()
    people.update(0.5, 1e7 - 5, 30)
    expect(update.mock.calls.every(([step]) => step === 0)).toBe(true)
    people.dispose()
  })

  it('survives a camera at the path ends and far past them', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.showModels()
    for (const cameraDistance of [-10, 0, 100, 250]) expect(() => people.update(0.5, 2, cameraDistance)).not.toThrow()
    people.dispose()
  })

  it('ramps the night glow with the window-lit ratio', () => {
    const models = fakeModels()
    const people = createPeople(FULL)
    people.stageModels(models)
    people.showModels()
    people.update(0, 1, 30)
    expect(models.templates[0]!.material.emissiveIntensity).toBe(0)
    people.update(1, 1, 30)
    expect(models.templates[0]!.material.emissiveIntensity).toBeGreaterThan(0)
    people.dispose()
  })

  it('releases the models on dispose, staged or shown', () => {
    for (const show of [false, true]) {
      const models = fakeModels()
      const geometryDispose = vi.spyOn(models.templates[0]!.geometry, 'dispose')
      const people = createPeople(FULL)
      people.stageModels(models)
      if (show) people.showModels()
      people.dispose()
      expect(geometryDispose).toHaveBeenCalled()
      expect(people.group.children).toHaveLength(0)
    }
  })
})
