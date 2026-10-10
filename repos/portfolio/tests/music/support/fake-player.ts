import { vi } from 'vitest'
import type { MusicStatus } from '../../../app/music/player'
import type { Track } from '../../../types/site'
import { track } from './fakes'

export interface FakePlayer {
  readonly status: MusicStatus
  readonly current: Track | null
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  next: ReturnType<typeof vi.fn>
  setTheme: ReturnType<typeof vi.fn>
  onChange(listener: () => void): () => void
  dispose: ReturnType<typeof vi.fn>
  /** What the next `play()` leaves the status as. */
  playOutcome: 'playing' | 'idle' | 'error'
  /** Change the status from outside, like an interruption would. */
  force(next: MusicStatus): void
}

export function createFakePlayer(): FakePlayer {
  let status: MusicStatus = 'idle'
  let current: Track | null = null
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  const player: FakePlayer = {
    get status() {
      return status
    },
    get current() {
      return current
    },
    play: vi.fn(async () => {
      status = player.playOutcome
      current = status === 'playing' ? track('a') : null
      emit()
    }),
    pause: vi.fn(async () => {
      status = 'paused'
      emit()
    }),
    next: vi.fn(async () => {}),
    setTheme: vi.fn(),
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: vi.fn(),
    playOutcome: 'playing',
    force(next) {
      status = next
      emit()
    },
  }
  return player
}
