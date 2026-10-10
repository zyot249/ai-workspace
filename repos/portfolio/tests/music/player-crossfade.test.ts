import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMusicPlayer } from '../../app/music/player'
import { INITIAL_POSITIONS } from '../../app/music/playlist'
import { createFakeEnv, expectRamp, type FakeEnv, makeConfig } from './support/fakes'

const flush = () => vi.advanceTimersByTimeAsync(0)

async function advance(fake: FakeEnv, seconds: number): Promise<void> {
  fake.ctx.currentTime += seconds
  await vi.advanceTimersByTimeAsync(seconds * 1000)
}

function setup(light: string[], dark: string[] = []) {
  const fake = createFakeEnv()
  const player = createMusicPlayer(makeConfig(light, dark), 'light', INITIAL_POSITIONS, fake.env)
  return { ...fake, player, fake }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('setTheme while playing', () => {
  it('crossfades to the other list over the theme crossfade length', async () => {
    const { player, audios, ctx, fake } = setup(['l1', 'l2'], ['d1'])
    await player.play()
    await advance(fake, 2)
    player.setTheme('dark')
    await flush()
    expect(audios[1].src).toBe('/audio/d1.mp3')
    expect(audios[1].preload).toBe('auto')
    expectRamp(ctx.gains[1].gain.lastRamp, 0.4, 3.2)
    expectRamp(ctx.gains[0].gain.lastRamp, 0, 3.2)
    expect(player.current?.title).toBe('d1')
    expect(audios[0].paused).toBe(false)
    await advance(fake, 1.2)
    expect(audios[0].paused).toBe(true)
    expect(audios[1].paused).toBe(false)
  })

  it('resumes each list at the track and time where it was left', async () => {
    const { player, audios, fake } = setup(['l1', 'l2'], ['d1'])
    await player.play()
    audios[0].currentTime = 30
    await advance(fake, 2)
    player.setTheme('dark')
    await flush()
    await advance(fake, 1.2)
    audios[0].currentTime = 0
    audios[1].currentTime = 50
    player.setTheme('light')
    await flush()
    expect(audios[0].src).toBe('/audio/l1.mp3')
    expect(audios[0].currentTime).toBe(30)
  })

  it('a second toggle during a crossfade starts from the current gains with no jump', async () => {
    const { player, audios, ctx, fake } = setup(['l1'], ['d1'])
    await player.play()
    await advance(fake, 2)
    player.setTheme('dark')
    await flush()
    await advance(fake, 0.6)
    player.setTheme('light')
    await flush()
    const incoming = ctx.gains[0].gain
    const outgoing = ctx.gains[1].gain
    expect(incoming.sets.at(-1)?.value).toBeCloseTo(0.2, 5)
    expect(incoming.sets.at(-1)?.time).toBeCloseTo(2.6, 5)
    expectRamp(incoming.lastRamp, 0.4, 3.8)
    expect(outgoing.sets.at(-1)?.value).toBeCloseTo(0.2, 5)
    expectRamp(outgoing.lastRamp, 0, 3.8)
    expect(audios[0].playCalls).toBe(1)
    await advance(fake, 1.2)
    expect(audios[1].paused).toBe(true)
    expect(audios[0].paused).toBe(false)
  })

  it('does not crossfade when both themes share one list', async () => {
    const { player, audios, ctx, fake } = setup(['l1'], [])
    await player.play()
    await advance(fake, 2)
    const rampsBefore = ctx.gains[0].gain.calls.length
    player.setTheme('dark')
    await flush()
    expect(audios[1].src).toBe('')
    expect(audios[1].playCalls).toBe(0)
    expect(ctx.gains[0].gain.calls).toHaveLength(rampsBefore)
    expect(player.status).toBe('playing')
  })

  it('keeps playing the current list when the other list fails entirely', async () => {
    const { player, audios, rules, warnings, fake } = setup(['l1'], ['d1'])
    rules.failing.add('/audio/d1.mp3')
    await player.play()
    await advance(fake, 2)
    player.setTheme('dark')
    await flush()
    expect(player.status).toBe('playing')
    expect(player.current?.title).toBe('l1')
    expect(audios[0].paused).toBe(false)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('tries the other list after a toggle when the first list failed entirely', async () => {
    const { player, audios, rules } = setup(['l1'], ['d1'])
    rules.failing.add('/audio/l1.mp3')
    await player.play()
    expect(player.status).toBe('error')
    player.setTheme('dark')
    await flush()
    expect(player.status).toBe('playing')
    expect(audios[0].src).toBe('/audio/d1.mp3')
  })
})

describe('pause and play during fades', () => {
  it('pause during a crossfade silences and pauses both decks', async () => {
    const { player, audios, ctx, fake } = setup(['l1'], ['d1'])
    await player.play()
    await advance(fake, 2)
    player.setTheme('dark')
    await flush()
    await advance(fake, 0.5)
    const paused = player.pause()
    expectRamp(ctx.gains[0].gain.lastRamp, 0, 4)
    expectRamp(ctx.gains[1].gain.lastRamp, 0, 4)
    await advance(fake, 1.5)
    await paused
    expect(audios[0].paused).toBe(true)
    expect(audios[1].paused).toBe(true)
    expect(player.status).toBe('paused')
  })

  it('play during a pause fade-out ramps up from the current gain and the pending pause never runs', async () => {
    const { player, audios, ctx, fake } = setup(['a'])
    await player.play()
    await advance(fake, 2)
    const paused = player.pause()
    await advance(fake, 0.5)
    await player.play()
    const last = ctx.gains[0].gain.sets.at(-1)
    expect(last?.value).toBeCloseTo(0.4 * (1 - 0.5 / 1.5), 5)
    expect(last?.time).toBeCloseTo(2.5, 5)
    expectRamp(ctx.gains[0].gain.lastRamp, 0.4, 4)
    await advance(fake, 2)
    await paused
    expect(audios[0].pauseCalls).toBe(0)
    expect(player.status).toBe('playing')
  })
})

describe('next', () => {
  it('crossfades to the next track in the current list over the fade length', async () => {
    const { player, audios, ctx, fake } = setup(['a', 'b', 'c'])
    await player.play()
    await advance(fake, 2)
    const done = player.next()
    await flush()
    expect(audios[1].src).toBe('/audio/b.mp3')
    expect(player.current?.title).toBe('b')
    expectRamp(ctx.gains[1].gain.lastRamp, 0.4, 3.5)
    expectRamp(ctx.gains[0].gain.lastRamp, 0, 3.5)
    await advance(fake, 1.5)
    await done
    expect(audios[0].paused).toBe(true)
  })

  it('next with one track plays that track again on the other deck without throwing', async () => {
    const { player, audios, fake } = setup(['only'])
    await player.play()
    await advance(fake, 2)
    const done = player.next()
    await flush()
    await advance(fake, 1.5)
    await expect(done).resolves.toBeUndefined()
    expect(audios[1].src).toBe('/audio/only.mp3')
    expect(player.status).toBe('playing')
  })

  it('does nothing when not playing', async () => {
    const { player, audios } = setup(['a', 'b'])
    await player.next()
    expect(audios).toHaveLength(0)
  })
})

describe('takeover while a crossfade is still loading', () => {
  it('pause stops the incoming deck even when its play() succeeds after the pause began', async () => {
    const { player, audios, rules, fake } = setup(['l1'], ['d1'])
    await player.play()
    await advance(fake, 2)
    rules.deferPlay = true
    player.setTheme('dark')
    await flush()
    rules.deferPlay = false
    const paused = player.pause()
    audios[1].resolvePending()
    await flush()
    await advance(fake, 1.5)
    await paused
    expect(audios[0].paused).toBe(true)
    expect(audios[1].paused).toBe(true)
    expect(player.status).toBe('paused')
  })

  it('play after a pause stops a deck that started sounding during the pause', async () => {
    const { player, audios, rules, fake } = setup(['l1'], ['d1'])
    await player.play()
    await advance(fake, 2)
    rules.deferPlay = true
    player.setTheme('dark')
    await flush()
    rules.deferPlay = false
    void player.pause()
    await advance(fake, 0.5)
    audios[1].resolvePending()
    await flush()
    await player.play()
    expect(player.status).toBe('playing')
    expect(audios[1].paused).toBe(true)
    expect(audios[0].paused).toBe(false)
  })
})

describe('pause during next', () => {
  it('resumes the new track, not the one fading out', async () => {
    const { player, audios, fake } = setup(['a', 'b', 'c'])
    await player.play()
    await advance(fake, 2)
    const first = player.next()
    await flush()
    await advance(fake, 1.5)
    await first
    const second = player.next()
    await flush()
    await advance(fake, 0.5)
    const paused = player.pause()
    await advance(fake, 1.5)
    await paused
    await player.play()
    expect(player.current?.title).toBe('c')
    expect(audios[0].src).toBe('/audio/c.mp3')
    expect(audios[0].paused).toBe(false)
    await second
  })
})
