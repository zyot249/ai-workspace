import { expect } from 'vitest'
import type {
  AudioContextLike,
  AudioElementLike,
  GainNodeLike,
  MediaSourceLike,
  PlayerEnv,
} from '../../../app/music/player'
import type { MusicConfig, Track } from '../../../types/site'

export interface ParamCall {
  readonly type: 'cancel' | 'set' | 'ramp'
  readonly value: number
  readonly time: number
}

export class FakeParam {
  readonly calls: ParamCall[] = []
  cancelScheduledValues(time: number): void {
    this.calls.push({ type: 'cancel', value: 0, time })
  }
  setValueAtTime(value: number, time: number): void {
    this.calls.push({ type: 'set', value, time })
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.calls.push({ type: 'ramp', value, time })
  }
  get sets(): ParamCall[] {
    return this.calls.filter(call => call.type === 'set')
  }
  get lastRamp(): ParamCall | undefined {
    return this.calls.filter(call => call.type === 'ramp').at(-1)
  }
}

export class FakeGain implements GainNodeLike {
  readonly gain = new FakeParam()
  disconnected = false
  connect(): void {}
  disconnect(): void {
    this.disconnected = true
  }
}

export class FakeSource implements MediaSourceLike {
  connect(): void {}
  disconnect(): void {}
}

export class FakeContext implements AudioContextLike {
  currentTime = 0
  state = 'suspended'
  readonly destination = {}
  readonly gains: FakeGain[] = []
  resumeCalls = 0
  suspendCalls = 0
  closed = false
  private readonly listeners = new Set<() => void>()

  resume(): Promise<void> {
    this.resumeCalls += 1
    this.state = 'running'
    return Promise.resolve()
  }
  suspend(): Promise<void> {
    this.suspendCalls += 1
    this.setState('suspended')
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.closed = true
    this.state = 'closed'
    return Promise.resolve()
  }
  createGain(): FakeGain {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }
  createMediaElementSource(): FakeSource {
    return new FakeSource()
  }
  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.add(listener)
  }
  removeEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.delete(listener)
  }
  /** Change the state and fire `statechange`, like the browser does. */
  setState(state: string): void {
    this.state = state
    for (const listener of [...this.listeners]) listener()
  }
}

export interface PlayRules {
  /** Sources whose `play()` rejects with `NotSupportedError`. */
  readonly failing: Set<string>
  /** When true, every `play()` rejects with `NotAllowedError`. */
  blocked: boolean
  /** When true, `play()` stays pending until `pause()` rejects it with `AbortError`, like a browser. */
  deferPlay: boolean
}

function domError(name: string): Error {
  return Object.assign(new Error(name), { name })
}

export class FakeAudio implements AudioElementLike {
  src = ''
  preload = ''
  currentTime = 0
  paused = true
  playCalls = 0
  pauseCalls = 0
  private abortPending: (() => void) | null = null
  private succeedPending: (() => void) | null = null
  private readonly rules: PlayRules
  private readonly listeners: Record<'ended' | 'error', Set<() => void>> = { ended: new Set(), error: new Set() }

  constructor(rules: PlayRules) {
    this.rules = rules
  }

  play(): Promise<void> {
    this.playCalls += 1
    if (this.rules.deferPlay) {
      return new Promise<void>((resolve, reject) => {
        this.abortPending = () => reject(domError('AbortError'))
        this.succeedPending = () => {
          this.paused = false
          resolve()
        }
      })
    }
    if (this.rules.blocked) return Promise.reject(domError('NotAllowedError'))
    if (this.rules.failing.has(this.src)) return Promise.reject(domError('NotSupportedError'))
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.pauseCalls += 1
    this.paused = true
    const abort = this.abortPending
    this.abortPending = null
    this.succeedPending = null
    abort?.()
  }
  /** Resolve a deferred `play()` as success, like a browser whose load finished. */
  resolvePending(): void {
    const succeed = this.succeedPending
    this.abortPending = null
    this.succeedPending = null
    succeed?.()
  }
  addEventListener(type: 'ended' | 'error', listener: () => void): void {
    this.listeners[type].add(listener)
  }
  removeEventListener(type: 'ended' | 'error', listener: () => void): void {
    this.listeners[type].delete(listener)
  }
  emit(type: 'ended' | 'error'): void {
    for (const listener of [...this.listeners[type]]) listener()
  }
}

export interface FakeEnv {
  readonly env: PlayerEnv
  readonly ctx: FakeContext
  readonly audios: FakeAudio[]
  readonly warnings: unknown[][]
  readonly rules: PlayRules
}

export function createFakeEnv(options: { audioSession?: { type: string } } = {}): FakeEnv {
  const ctx = new FakeContext()
  const audios: FakeAudio[] = []
  const warnings: unknown[][] = []
  const rules: PlayRules = { failing: new Set(), blocked: false, deferPlay: false }
  const env: PlayerEnv = {
    createContext: () => ctx,
    createAudio: () => {
      const audio = new FakeAudio(rules)
      audios.push(audio)
      return audio
    },
    audioSession: options.audioSession,
    warn: (...args) => {
      warnings.push(args)
    },
  }
  return { env, ctx, audios, warnings, rules }
}

export function track(name: string): Track {
  return { src: `/audio/${name}.mp3`, title: name, artist: 'Artist', credit: 'CC0' }
}

export function makeConfig(light: string[], dark: string[]): MusicConfig {
  return { volume: 0.4, fadeSeconds: 1.5, themeCrossfadeSeconds: 1.2, light: light.map(track), dark: dark.map(track) }
}

export function expectRamp(call: ParamCall | undefined, value: number, time: number): void {
  expect(call?.type).toBe('ramp')
  expect(call?.value).toBeCloseTo(value, 5)
  expect(call?.time).toBeCloseTo(time, 5)
}
