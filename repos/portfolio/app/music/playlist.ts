import type { MusicConfig, Track } from '../../types/site'
import type { Theme } from '../journey/stops'

export type { Theme }

export interface Position {
  readonly index: number
  readonly time: number
}

export type Positions = Readonly<Record<Theme, Position>>

const START: Position = { index: 0, time: 0 }

export const INITIAL_POSITIONS: Positions = { light: START, dark: START }

export function musicEnabled(config: MusicConfig): boolean {
  return config.light.length > 0 || config.dark.length > 0
}

/** The list a theme plays. A theme with no tracks plays the other theme's list. */
export function listFor(config: MusicConfig, theme: Theme): readonly Track[] {
  const own = config[theme]
  if (own.length > 0) return own
  return config[theme === 'light' ? 'dark' : 'light']
}

export function nextIndex(list: readonly Track[], index: number): number {
  return list.length === 0 ? 0 : (index + 1) % list.length
}

export function savePosition(positions: Positions, theme: Theme, position: Position): Positions {
  return { ...positions, [theme]: position }
}

export function positionFor(positions: Positions, theme: Theme): Position {
  return positions[theme] ?? START
}
