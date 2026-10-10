import { useState } from '#imports'
import { markRaw, onBeforeUnmount, onMounted, readonly, ref, type Ref, watch } from 'vue'
import { siteConfig } from '../../site.config'
import type { Track } from '../../types/site'
import type { MusicPlayer, MusicStatus } from '../music/player'
import { INITIAL_POSITIONS, type Theme } from '../music/playlist'

export type JourneyMusicStatus = MusicStatus | 'armed'

type Choice = 'on' | 'off'

const STORAGE_KEY = 'music'
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const
const CONTROL_SELECTOR = '[data-music-control]'

function readChoice(): Choice | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'on' || value === 'off' ? value : null
  } catch {
    return null
  }
}

function writeChoice(choice: Choice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Storage can be blocked (private mode); the choice lasts for this visit only.
  }
}

// The theme lives in the `dark` class on <html>. `isDark` is false until after
// mount, so reading it here could start the wrong playlist (see useDarkMode).
function themeFromDocument(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function isInsideControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CONTROL_SELECTOR) !== null
}

function audioSupported(): boolean {
  return 'AudioContext' in window || 'webkitAudioContext' in window
}

type EngineModule = typeof import('../music/player')

let enginePromise: Promise<EngineModule> | null = null

function loadEngine(): Promise<EngineModule> {
  enginePromise ??= import('../music/player').catch((error: unknown) => {
    enginePromise = null
    throw error
  })
  return enginePromise
}

export function useJourneyMusic(isDark: Ref<boolean>) {
  // The player outlives the page: leaving `/` pauses it, coming back resumes it.
  const shared = useState<{ player: MusicPlayer | null }>('journeyMusic', () => ({ player: null }))
  const status = ref<JourneyMusicStatus>('idle')
  const current = ref<Track | null>(null)
  const supported = ref(true)
  let choice: Choice | null = null
  let armed = false
  let expectPause = false
  let resumeOnShow = false
  let starting = false
  let bound: MusicPlayer | null = null
  let unsubscribe: (() => void) | null = null

  function saveChoice(next: Choice): void {
    choice = next
    writeChoice(next)
  }

  function sync(player: MusicPlayer): void {
    current.value = player.current
    const interrupted = player.status === 'paused' && !expectPause && choice === 'on'
    const refused = player.status === 'idle' && choice === 'on' && !starting
    if (interrupted || refused) {
      arm()
      return
    }
    status.value = player.status
  }

  function bind(player: MusicPlayer): void {
    if (bound === player) return
    unsubscribe?.()
    bound = player
    unsubscribe = player.onChange(() => sync(player))
    sync(player)
  }

  async function ensurePlayer(): Promise<MusicPlayer> {
    const existing = shared.value.player
    if (existing) {
      bind(existing)
      return existing
    }
    const { createMusicPlayer } = await loadEngine()
    const raced = shared.value.player
    if (raced) {
      bind(raced)
      return raced
    }
    const created = markRaw(createMusicPlayer(siteConfig.music, themeFromDocument(), INITIAL_POSITIONS))
    shared.value = { player: created }
    bind(created)
    return created
  }

  // Not `{ once: true }`: the first pointerdown may land on the music button
  // itself, and that one must not use up the listener or start the music.
  function onGesture(event: Event): void {
    if (isInsideControl(event.target)) return
    void start()
  }

  function arm(): void {
    status.value = 'armed'
    if (armed) return
    armed = true
    for (const type of GESTURES) window.addEventListener(type, onGesture, { capture: true })
  }

  function disarm(): void {
    if (!armed) return
    armed = false
    for (const type of GESTURES) window.removeEventListener(type, onGesture, { capture: true })
  }

  async function start(): Promise<void> {
    disarm()
    // While starting, an idle player is not a refusal yet; the sync after play() decides.
    starting = true
    try {
      const player = await ensurePlayer()
      await player.play()
      starting = false
      sync(player)
    } catch (error) {
      starting = false
      console.warn('[music] could not start playback:', error)
      status.value = 'error'
    }
  }

  async function pausePlayer(): Promise<void> {
    const player = shared.value.player
    if (!player) return
    expectPause = true
    try {
      await player.pause()
    } finally {
      expectPause = false
    }
  }

  async function toggle(): Promise<void> {
    resumeOnShow = false
    if (status.value === 'error') return
    if (status.value === 'playing') {
      saveChoice('off')
      await pausePlayer()
      return
    }
    if (status.value === 'armed') {
      saveChoice('off')
      disarm()
      status.value = 'idle'
      return
    }
    saveChoice('on')
    await start()
  }

  async function next(): Promise<void> {
    try {
      await shared.value.player?.next()
    } catch (error) {
      console.warn('[music] could not skip to the next track:', error)
    }
  }

  function onVisibilityChange(): void {
    const player = shared.value.player
    if (!player) return
    if (document.hidden) {
      if (player.status === 'playing') {
        resumeOnShow = true
        void pausePlayer()
      }
      return
    }
    if (resumeOnShow) {
      resumeOnShow = false
      void start()
    }
  }

  watch(isDark, (dark) => {
    shared.value.player?.setTheme(dark ? 'dark' : 'light')
  })

  onMounted(() => {
    supported.value = audioSupported()
    if (!supported.value) return
    choice = readChoice()
    document.addEventListener('visibilitychange', onVisibilityChange)
    // Load the engine chunk now so it is ready inside the visitor's first gesture.
    // This fetches code only; no audio file downloads before playback starts.
    loadEngine().catch((error: unknown) => console.warn('[music] could not load the audio engine:', error))
    if (choice !== 'on') return
    if (shared.value.player) void start()
    else arm()
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    disarm()
    unsubscribe?.()
    const player = shared.value.player
    if (player?.status === 'playing') {
      expectPause = true
      void player.pause()
    }
  })

  return { status: readonly(status), current: readonly(current), supported: readonly(supported), toggle, next }
}
