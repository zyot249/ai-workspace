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

describe('before the first play', () => {
  it('creates no audio element and no context', () => {
    const { audios, ctx, player } = setup(['a'])
    expect(audios).toHaveLength(0)
    expect(ctx.resumeCalls).toBe(0)
    expect(player.status).toBe('idle')
    expect(player.current).toBeNull()
  })
})

describe('play', () => {
  it('resumes the context, loads the first track, and fades from 0 to the volume', async () => {
    const { player, ctx, audios } = setup(['a', 'b'])
    ctx.currentTime = 10
    await player.play()
    expect(ctx.resumeCalls).toBe(1)
    expect(audios[0].src).toBe('/audio/a.mp3')
    expect(audios[0].playCalls).toBe(1)
    expectRamp(ctx.gains[0].gain.lastRamp, 0.4, 11.5)
    expect(player.status).toBe('playing')
    expect(player.current?.title).toBe('a')
  })

  it('keeps the idle deck empty and preloads only the active deck', async () => {
    const { player, audios } = setup(['a'])
    await player.play()
    expect(audios).toHaveLength(2)
    expect(audios[0].preload).toBe('auto')
    expect(audios[1].preload).toBe('none')
    expect(audios[1].src).toBe('')
  })

  it('two quick play calls start one playback', async () => {
    const { player, audios } = setup(['a'])
    await Promise.all([player.play(), player.play()])
    expect(audios).toHaveLength(2)
    expect(audios[0].playCalls).toBe(1)
    expect(player.status).toBe('playing')
  })

  it('sets the iOS audio session to playback when it exists', async () => {
    const session = { type: 'auto' }
    const fake = createFakeEnv({ audioSession: session })
    const player = createMusicPlayer(makeConfig(['a'], []), 'light', INITIAL_POSITIONS, fake.env)
    await player.play()
    expect(session.type).toBe('playback')
  })

  it('works when the audio session does not exist', async () => {
    const { player } = setup(['a'])
    await expect(player.play()).resolves.toBeUndefined()
  })

  it('notifies listeners until they unsubscribe', async () => {
    const { player, fake } = setup(['a'])
    const listener = vi.fn()
    const off = player.onChange(listener)
    await player.play()
    expect(listener).toHaveBeenCalled()
    off()
    listener.mockClear()
    const paused = player.pause()
    await advance(fake, 1.5)
    await paused
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('pause', () => {
  it('ramps the gain to 0, then pauses the audio and suspends the context', async () => {
    const fake = setup(['a'])
    const { player, ctx, audios } = fake
    await player.play()
    await advance(fake.fake, 2)
    const paused = player.pause()
    expect(player.status).toBe('paused')
    expectRamp(ctx.gains[0].gain.lastRamp, 0, 3.5)
    expect(audios[0].paused).toBe(false)
    await advance(fake.fake, 1.5)
    await paused
    expect(audios[0].paused).toBe(true)
    expect(ctx.suspendCalls).toBe(1)
  })

  it('resumes the saved time on the next play', async () => {
    const { player, audios, fake } = setup(['a'])
    await player.play()
    audios[0].currentTime = 42
    const paused = player.pause()
    await advance(fake, 1.5)
    await paused
    audios[0].currentTime = 0
    await player.play()
    expect(audios[0].currentTime).toBe(42)
    expect(player.status).toBe('playing')
  })

  it('does nothing when not playing', async () => {
    const { player, ctx } = setup(['a'])
    await player.pause()
    expect(ctx.suspendCalls).toBe(0)
    expect(player.status).toBe('idle')
  })
})

describe('track end', () => {
  it('starts the next track at full volume, with no new ramp, and loops at the end', async () => {
    const { player, audios, ctx } = setup(['a', 'b'])
    await player.play()
    const rampsBefore = ctx.gains[0].gain.calls.filter(call => call.type === 'ramp').length
    audios[0].emit('ended')
    await flush()
    expect(audios[0].src).toBe('/audio/b.mp3')
    expect(player.current?.title).toBe('b')
    audios[0].emit('ended')
    await flush()
    expect(audios[0].src).toBe('/audio/a.mp3')
    expect(ctx.gains[0].gain.calls.filter(call => call.type === 'ramp')).toHaveLength(rampsBefore)
  })

  it('loops a one-track list', async () => {
    const { player, audios } = setup(['only'])
    await player.play()
    audios[0].currentTime = 99
    audios[0].emit('ended')
    await flush()
    expect(audios[0].playCalls).toBe(2)
    expect(audios[0].currentTime).toBe(0)
    expect(player.status).toBe('playing')
    expect(player.current?.title).toBe('only')
  })
})

describe('errors', () => {
  it('skips a track that fails to play, warns, and plays the next one', async () => {
    const { player, audios, warnings, rules } = setup(['a', 'b'])
    rules.failing.add('/audio/a.mp3')
    await player.play()
    expect(audios[0].src).toBe('/audio/b.mp3')
    expect(player.status).toBe('playing')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('/audio/a.mp3')
  })

  it('skips a track whose media element reports an error during playback', async () => {
    const { player, audios, warnings } = setup(['a', 'b'])
    await player.play()
    audios[0].emit('error')
    await flush()
    expect(audios[0].src).toBe('/audio/b.mp3')
    expect(warnings).toHaveLength(1)
    expect(player.status).toBe('playing')
  })

  it('sets status to error when every track fails', async () => {
    const { player, rules } = setup(['a', 'b'])
    rules.failing.add('/audio/a.mp3')
    rules.failing.add('/audio/b.mp3')
    await player.play()
    expect(player.status).toBe('error')
    expect(player.current).toBeNull()
  })

  it('sets status to idle on NotAllowedError and does not mark the track failed', async () => {
    const { player, audios, warnings, rules } = setup(['a'])
    rules.blocked = true
    await player.play()
    expect(player.status).toBe('idle')
    expect(warnings).toHaveLength(0)
    rules.blocked = false
    await player.play()
    expect(player.status).toBe('playing')
    expect(audios[0].src).toBe('/audio/a.mp3')
  })
})

describe('interruption', () => {
  it('pauses when the context is interrupted and plays again on request', async () => {
    const { player, ctx, audios } = setup(['a'])
    await player.play()
    ctx.setState('interrupted')
    expect(player.status).toBe('paused')
    expect(audios[0].paused).toBe(true)
    await player.play()
    expect(ctx.state).toBe('running')
    expect(player.status).toBe('playing')
  })
})

describe('setTheme while not playing', () => {
  it('switches the list the next play uses and starts no audio', async () => {
    const { player, audios } = setup(['l1'], ['d1'])
    player.setTheme('dark')
    await flush()
    expect(audios).toHaveLength(0)
    await player.play()
    expect(audios[0].src).toBe('/audio/d1.mp3')
  })
})

describe('dispose', () => {
  it('silences and closes everything', async () => {
    const { player, ctx, audios } = setup(['a'])
    await player.play()
    player.dispose()
    expect(ctx.closed).toBe(true)
    expect(ctx.gains.every(gain => gain.disconnected)).toBe(true)
    expect(audios.every(audio => audio.paused)).toBe(true)
  })
})
