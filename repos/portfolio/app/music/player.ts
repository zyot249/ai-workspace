// The playback engine. It keeps mutable audio state (decks, gain plans, status)
// because Web Audio nodes are mutable objects. Pure list and ramp math lives in
// playlist.ts and fade.ts and returns new objects.
import type { MusicConfig, Track } from '../../types/site'
import { type FadePlan, fadePlan, gainAt } from './fade'
import { listFor, nextIndex, positionFor, type Positions, savePosition, type Theme } from './playlist'

export type MusicStatus = 'idle' | 'playing' | 'paused' | 'error'

export interface MusicPlayer {
  readonly status: MusicStatus
  readonly current: Track | null
  play(): Promise<void> // must be called inside a gesture the first time
  pause(): Promise<void> // fades out, then pauses
  next(): Promise<void> // fades to the next track in the current list
  setTheme(theme: Theme): void // crossfades to the other list if playing
  onChange(listener: () => void): () => void
  dispose(): void
}

// Structural types: the parts of the browser audio objects the engine uses.
// Tests pass fakes that match them.
export interface GainParamLike {
  cancelScheduledValues(time: number): void
  setValueAtTime(value: number, time: number): void
  linearRampToValueAtTime(value: number, time: number): void
}
export interface GainNodeLike {
  readonly gain: GainParamLike
  connect(destination: unknown): void
  disconnect(): void
}
export interface MediaSourceLike {
  connect(destination: unknown): void
  disconnect(): void
}
export interface AudioContextLike {
  readonly currentTime: number
  readonly state: string
  readonly destination: unknown
  resume(): Promise<void>
  suspend(): Promise<void>
  close(): Promise<void>
  createGain(): GainNodeLike
  createMediaElementSource(element: AudioElementLike): MediaSourceLike
  addEventListener(type: 'statechange', listener: () => void): void
  removeEventListener(type: 'statechange', listener: () => void): void
}
export interface AudioElementLike {
  src: string
  preload: string
  currentTime: number
  play(): Promise<void>
  pause(): void
  addEventListener(type: 'ended' | 'error', listener: () => void): void
  removeEventListener(type: 'ended' | 'error', listener: () => void): void
}
export interface PlayerEnv {
  createContext(): AudioContextLike
  createAudio(): AudioElementLike
  audioSession?: { type: string }
  warn(...args: unknown[]): void
}

/** How long to wait for a context to resume before treating the gesture as missing. */
const RESUME_TIMEOUT_MS = 1000

const SILENT: FadePlan = { startValue: 0, endValue: 0, startTime: 0, endTime: 0 }

type StartResult = 'started' | 'blocked' | 'failed'

interface Deck {
  readonly audio: AudioElementLike
  readonly source: MediaSourceLike
  readonly gain: GainNodeLike
  readonly handlers: { readonly ended: () => void; readonly error: () => void }
  plan: FadePlan
  src: string | null
  theme: Theme
  trackIndex: number
  playing: boolean
  starting: boolean
}

export function browserEnv(): PlayerEnv {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  return {
    createContext: () => new Context() as unknown as AudioContextLike,
    createAudio: () => new Audio() as unknown as AudioElementLike,
    audioSession: session,
    warn: (...args) => console.warn(...args),
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : ''
}

function notAllowed(): Error {
  return Object.assign(new Error('The audio context did not resume without a user gesture'), { name: 'NotAllowedError' })
}

function delay(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000)
  })
}

export function createMusicPlayer(
  config: MusicConfig,
  initialTheme: Theme,
  initialPositions: Positions,
  env: PlayerEnv = browserEnv(),
): MusicPlayer {
  const listeners = new Set<() => void>()
  const failed = new Set<string>()
  let theme = initialTheme
  let positions = initialPositions
  let status: MusicStatus = 'idle'
  let current: Track | null = null
  let context: AudioContextLike | null = null
  let decks: readonly Deck[] = []
  let active = 0
  // Bumped by every operation that takes over the decks. A timer or await that
  // resumes with an older value belongs to a cancelled operation and stops.
  let generation = 0
  let suspendInFlight: Promise<void> | null = null
  let disposed = false

  function notify(): void {
    for (const listener of [...listeners]) listener()
  }

  function setStatus(next: MusicStatus): void {
    if (status === next) return
    status = next
    notify()
  }

  function setCurrent(track: Track | null): void {
    if (current === track) return
    current = track
    notify()
  }

  function run(task: Promise<void>): void {
    task.catch((error: unknown) => env.warn('[music] playback failed:', error))
  }

  function trackOf(deck: Deck): Track | null {
    return listFor(config, deck.theme)[deck.trackIndex] ?? null
  }

  function snapshot(deck: Deck): void {
    positions = savePosition(positions, deck.theme, { index: deck.trackIndex, time: deck.audio.currentTime })
  }

  /** Ramp a deck to `target` from wherever its gain is now. Returns the ramp length in seconds. */
  function ramp(deck: Deck, target: number, seconds: number): number {
    if (!context) return seconds
    const now = context.currentTime
    const plan = fadePlan(gainAt(deck.plan, now), target, seconds, now)
    const param = deck.gain.gain
    param.cancelScheduledValues(now)
    param.setValueAtTime(plan.startValue, plan.startTime)
    param.linearRampToValueAtTime(plan.endValue, plan.endTime)
    deck.plan = plan
    return plan.endTime - plan.startTime
  }

  function setLevel(deck: Deck, level: number): void {
    if (!context) return
    const now = context.currentTime
    deck.gain.gain.cancelScheduledValues(now)
    deck.gain.gain.setValueAtTime(level, now)
    deck.plan = { startValue: level, endValue: level, startTime: now, endTime: now }
  }

  function stopDeck(deck: Deck): void {
    deck.audio.pause()
    deck.playing = false
    setLevel(deck, 0)
  }

  function stopOthers(keep: Deck): void {
    for (const deck of decks) {
      if (deck !== keep && deck.playing) stopDeck(deck)
    }
  }

  function markFailed(track: Track, error: unknown): void {
    if (failed.has(track.src)) return
    failed.add(track.src)
    env.warn('[music] track failed:', track.src, error)
  }

  function load(deck: Deck, trackTheme: Theme, index: number, track: Track, time: number): void {
    if (deck.src !== track.src) {
      deck.audio.src = track.src
      deck.src = track.src
    }
    deck.audio.currentTime = time
    deck.theme = trackTheme
    deck.trackIndex = index
  }

  /** Load and play the first playable track at or after `fromIndex`. */
  async function startTrack(deck: Deck, trackTheme: Theme, fromIndex: number, time: number): Promise<StartResult> {
    const list = listFor(config, trackTheme)
    deck.starting = true
    try {
      for (let step = 0; step < list.length; step += 1) {
        const index = (fromIndex + step) % list.length
        const track = list[index]
        if (!track || failed.has(track.src)) continue
        load(deck, trackTheme, index, track, step === 0 ? time : 0)
        try {
          await deck.audio.play()
          deck.playing = true
          return 'started'
        } catch (error) {
          if (errorName(error) === 'NotAllowedError') return 'blocked'
          markFailed(track, error)
        }
      }
      return 'failed'
    } finally {
      deck.starting = false
    }
  }

  function settle(deck: Deck, result: StartResult): void {
    if (result === 'started') {
      positions = savePosition(positions, deck.theme, { index: deck.trackIndex, time: deck.audio.currentTime })
      setCurrent(trackOf(deck))
      setStatus('playing')
      return
    }
    deck.playing = false
    if (result === 'failed') setCurrent(null)
    setStatus(result === 'blocked' ? 'idle' : 'error')
  }

  /** Start `index` on a deck that is already playing, at the deck's current gain. */
  async function continueOn(deck: Deck, index: number): Promise<void> {
    const token = generation
    const result = await startTrack(deck, deck.theme, index, 0)
    if (token !== generation) return
    settle(deck, result)
  }

  function handleEnded(deck: Deck): void {
    if (deck !== decks[active] || status !== 'playing' || deck.starting) return
    run(continueOn(deck, nextIndex(listFor(config, deck.theme), deck.trackIndex)))
  }

  function handleError(deck: Deck): void {
    const track = trackOf(deck)
    if (track) markFailed(track, new Error('The media element reported an error'))
    if (deck !== decks[active] || status !== 'playing' || deck.starting) return
    run(continueOn(deck, nextIndex(listFor(config, deck.theme), deck.trackIndex)))
  }

  function createDeck(audioContext: AudioContextLike): Deck {
    const audio = env.createAudio()
    audio.preload = 'auto'
    const source = audioContext.createMediaElementSource(audio)
    const gain = audioContext.createGain()
    gain.gain.setValueAtTime(0, audioContext.currentTime)
    source.connect(gain)
    gain.connect(audioContext.destination)
    const deck: Deck = {
      audio,
      source,
      gain,
      handlers: { ended: () => handleEnded(deck), error: () => handleError(deck) },
      plan: SILENT,
      src: null,
      theme: initialTheme,
      trackIndex: 0,
      playing: false,
      starting: false,
    }
    audio.addEventListener('ended', deck.handlers.ended)
    audio.addEventListener('error', deck.handlers.error)
    return deck
  }

  function onContextState(): void {
    if (!context || context.state === 'running' || status !== 'playing') return
    generation += 1
    for (const deck of decks) {
      if (!deck.playing) continue
      snapshot(deck)
      stopDeck(deck)
    }
    setStatus('paused')
  }

  async function resumeContext(audioContext: AudioContextLike): Promise<void> {
    if (audioContext.state === 'running') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, RESUME_TIMEOUT_MS)
    })
    try {
      await Promise.race([audioContext.resume(), timeout])
    } finally {
      clearTimeout(timer)
    }
    if (audioContext.state !== 'running') throw notAllowed()
  }

  async function ensureReady(): Promise<void> {
    if (!context) {
      const created = env.createContext()
      if (env.audioSession) env.audioSession.type = 'playback'
      const first = createDeck(created)
      const second = createDeck(created)
      second.audio.preload = 'none'
      decks = [first, second]
      created.addEventListener('statechange', onContextState)
      context = created
    }
    if (suspendInFlight) await suspendInFlight
    await resumeContext(context)
  }

  async function suspendContext(token: number): Promise<void> {
    if (!context || token !== generation) return
    try {
      await context.suspend()
    } catch (error) {
      env.warn('[music] could not suspend the audio context:', error)
    }
  }

  async function play(): Promise<void> {
    if (disposed || status === 'playing') return
    const token = ++generation
    try {
      await ensureReady()
    } catch (error) {
      if (token !== generation) return
      if (errorName(error) === 'NotAllowedError') {
        setStatus('idle')
        return
      }
      env.warn('[music] the audio engine could not start:', error)
      setStatus('error')
      return
    }
    if (token !== generation) return
    const deck = decks[active]
    if (!deck) return
    stopOthers(deck)
    const position = positionFor(positions, theme)
    const result = await startTrack(deck, theme, position.index, position.time)
    if (token !== generation) return
    settle(deck, result)
    if (result === 'started') ramp(deck, config.volume, config.fadeSeconds)
  }

  async function pause(): Promise<void> {
    if (status !== 'playing') return
    const token = ++generation
    setStatus('paused')
    const audible = decks.filter(deck => deck.playing)
    let seconds = config.fadeSeconds
    for (const deck of audible) {
      snapshot(deck)
      seconds = ramp(deck, 0, config.fadeSeconds)
    }
    await delay(seconds)
    if (token !== generation) return
    for (const deck of audible) {
      snapshot(deck)
      stopDeck(deck)
    }
    suspendInFlight = suspendContext(token)
    await suspendInFlight
    suspendInFlight = null
  }

  // Replaced in Task 5 with the crossfade versions.
  function setTheme(nextTheme: Theme): void {
    theme = nextTheme
  }

  async function next(): Promise<void> {
    if (status !== 'playing') return
  }

  function onChange(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    generation += 1
    for (const deck of decks) {
      setLevel(deck, 0)
      deck.audio.pause()
      deck.playing = false
      deck.audio.removeEventListener('ended', deck.handlers.ended)
      deck.audio.removeEventListener('error', deck.handlers.error)
      deck.source.disconnect()
      deck.gain.disconnect()
    }
    if (context) {
      context.removeEventListener('statechange', onContextState)
      void context.close()
    }
    listeners.clear()
  }

  return {
    get status() {
      return status
    },
    get current() {
      return current
    },
    play,
    pause,
    next,
    setTheme,
    onChange,
    dispose,
  }
}
