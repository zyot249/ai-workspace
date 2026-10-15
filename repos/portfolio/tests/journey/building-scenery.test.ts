// tests/journey/building-scenery.test.ts
import { describe, expect, it, vi } from 'vitest'
import { SET_PIECE_ROLES } from '../../app/journey/building-specs'
import * as models from '../../app/journey/building-models'
import { createBuildingScenery, type SceneryPart } from '../../app/journey/building-scenery'

const fakeModels = { setPieces: Object.fromEntries(SET_PIECE_ROLES.map(role => [role, { parts: [], size: [1, 1, 1] }])), near: [] } as unknown as models.BuildingModels

function part(overrides: Partial<SceneryPart> = {}): SceneryPart & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    stage: () => { calls.push('stage'); overrides.stage?.(fakeModels) },
    show: () => calls.push('show'),
    release: () => calls.push('release'),
  }
}

describe('createBuildingScenery', () => {
  it('stages, shows, and releases every part in order', () => {
    const a = part()
    const b = part()
    const scenery = createBuildingScenery([a, b])
    scenery.stageModels(fakeModels)
    scenery.showModels()
    expect(a.calls).toEqual(['stage', 'show'])
    expect(b.calls).toEqual(['stage', 'show'])
  })

  it('releases the parts already staged when a later part throws while staging', () => {
    const a = part()
    const b = part({ stage: () => { throw new Error('stage') } })
    const scenery = createBuildingScenery([a, b])
    expect(() => scenery.stageModels(fakeModels)).toThrow('stage')
    expect(a.calls).toEqual(['stage', 'release'])
  })

  it('discard releases the parts and disposes the models once', () => {
    const dispose = vi.spyOn(models, 'disposeBuildingModels').mockImplementation(() => {})
    const a = part()
    const scenery = createBuildingScenery([a])
    scenery.stageModels(fakeModels)
    scenery.discardModels()
    scenery.discardModels()
    expect(a.calls).toEqual(['stage', 'release'])
    expect(dispose).toHaveBeenCalledTimes(1)
    dispose.mockRestore()
  })

  it('dispose releases the parts and disposes the models, and does nothing twice', () => {
    const dispose = vi.spyOn(models, 'disposeBuildingModels').mockImplementation(() => {})
    const a = part()
    const scenery = createBuildingScenery([a])
    scenery.stageModels(fakeModels)
    scenery.showModels()
    scenery.dispose()
    scenery.dispose()
    expect(a.calls).toEqual(['stage', 'show', 'release'])
    expect(dispose).toHaveBeenCalledTimes(1)
    dispose.mockRestore()
  })

  it('ignores staging after dispose and ignores a second stage', () => {
    const a = part()
    const scenery = createBuildingScenery([a])
    scenery.stageModels(fakeModels)
    scenery.stageModels(fakeModels)
    scenery.dispose()
    scenery.stageModels(fakeModels)
    expect(a.calls.filter(call => call === 'stage')).toHaveLength(1)
  })

  it('does nothing on show or discard before staging', () => {
    const a = part()
    const scenery = createBuildingScenery([a])
    scenery.showModels()
    scenery.discardModels()
    expect(a.calls).toEqual([])
  })

  it('update passes the lit ratio to the glow only once the models are staged', async () => {
    const glow = await import('../../app/journey/building-glow')
    const apply = vi.spyOn(glow, 'applyBuildingGlow').mockImplementation(() => {})
    const scenery = createBuildingScenery([part()])
    scenery.update(0.5)
    expect(apply).not.toHaveBeenCalled()
    scenery.stageModels(fakeModels)
    scenery.update(0.5)
    expect(apply).toHaveBeenCalledWith(fakeModels, 0.5)
    apply.mockRestore()
  })
})

it('releases the failing part too when stage partially allocates', () => {
  const broken = part({ stage: () => { throw new Error('partial') } })
  const scenery = createBuildingScenery([broken])
  expect(() => scenery.stageModels(fakeModels)).toThrow('partial')
  expect(broken.calls).toEqual(['stage', 'release'])
})
