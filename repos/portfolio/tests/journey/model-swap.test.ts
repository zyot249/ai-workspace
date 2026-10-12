// tests/journey/model-swap.test.ts
import { describe, expect, it, vi } from 'vitest'
import { attachModels, type ModelSwapTarget } from '../../app/journey/model-swap'

interface Models { id: string }
const models: Models = { id: 'm' }

function setup(overrides: Partial<{ stage: () => void; load: () => Promise<Models>; warm: () => Promise<void>; disposed: () => boolean }> = {}) {
  const calls: string[] = []
  const target: ModelSwapTarget<Models> = {
    stageModels: () => { calls.push('stage'); overrides.stage?.() },
    showModels: () => calls.push('show'),
    discardModels: () => calls.push('discard'),
  }
  const options = {
    target,
    load: overrides.load ?? (async () => models),
    disposeModels: () => calls.push('dispose'),
    isDisposed: overrides.disposed ?? (() => false),
    warm: overrides.warm ?? (async () => { calls.push('warm') }),
    onReady: vi.fn(() => calls.push('ready')),
    onError: vi.fn(),
  }
  return { calls, options }
}

describe('attachModels', () => {
  it('stages, warms, shows, then reports ready', async () => {
    const { calls, options } = setup()
    await attachModels(options)
    expect(calls).toEqual(['stage', 'warm', 'show', 'ready'])
    expect(options.onError).not.toHaveBeenCalled()
  })

  it('reports a failed load once and stages nothing', async () => {
    const { calls, options } = setup({ load: async () => { throw new Error('404') } })
    await attachModels(options)
    expect(calls).toEqual([])
    expect(options.onError).toHaveBeenCalledTimes(1)
  })

  it('disposes the models when the scene is disposed during the load, and reports nothing', async () => {
    const { calls, options } = setup({ disposed: () => true })
    await attachModels(options)
    expect(calls).toEqual(['dispose'])
    expect(options.onError).not.toHaveBeenCalled()
  })

  it('disposes the models and reports when staging throws', async () => {
    const { calls, options } = setup({ stage: () => { throw new Error('stage') } })
    await attachModels(options)
    expect(calls).toEqual(['stage', 'dispose'])
    expect(options.onError).toHaveBeenCalledTimes(1)
  })

  it('discards and reports when the warmup fails', async () => {
    const { calls, options } = setup({ warm: async () => { throw new Error('compile') } })
    await attachModels(options)
    expect(calls).toEqual(['stage', 'discard'])
    expect(options.onError).toHaveBeenCalledTimes(1)
  })

  it('discards without reporting when the scene is disposed during the warmup', async () => {
    let disposed = false
    const { calls, options } = setup({ disposed: () => disposed, warm: async () => { disposed = true } })
    await attachModels(options)
    expect(calls).toEqual(['stage', 'discard'])
    expect(options.onError).not.toHaveBeenCalled()
    expect(options.onReady).not.toHaveBeenCalled()
  })
})
