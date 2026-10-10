import { describe, expect, it } from 'vitest'
import {
  INITIAL_POSITIONS,
  listFor,
  musicEnabled,
  nextIndex,
  positionFor,
  savePosition,
} from '../../app/music/playlist'
import type { MusicConfig, Track } from '../../types/site'

function track(name: string): Track {
  return { src: `/audio/${name}.mp3`, title: name, artist: 'Artist', credit: 'CC0' }
}

function config(light: string[], dark: string[]): MusicConfig {
  return { volume: 0.4, fadeSeconds: 1.5, themeCrossfadeSeconds: 1.2, light: light.map(track), dark: dark.map(track) }
}

describe('musicEnabled', () => {
  it('is false when both lists are empty', () => {
    expect(musicEnabled(config([], []))).toBe(false)
  })
  it('is true when either list has a track', () => {
    expect(musicEnabled(config(['a'], []))).toBe(true)
    expect(musicEnabled(config([], ['a']))).toBe(true)
  })
})

describe('listFor', () => {
  it('returns the list for the theme', () => {
    const c = config(['l1'], ['d1'])
    expect(listFor(c, 'light')).toBe(c.light)
    expect(listFor(c, 'dark')).toBe(c.dark)
  })
  it('falls back to the other list when one is empty', () => {
    const onlyLight = config(['l1'], [])
    expect(listFor(onlyLight, 'dark')).toBe(onlyLight.light)
    const onlyDark = config([], ['d1'])
    expect(listFor(onlyDark, 'light')).toBe(onlyDark.dark)
  })
})

describe('nextIndex', () => {
  it('advances and wraps at the end of the list', () => {
    const list = config(['a', 'b', 'c'], []).light
    expect(nextIndex(list, 0)).toBe(1)
    expect(nextIndex(list, 2)).toBe(0)
  })
  it('stays on a one-track list and returns 0 for an empty one', () => {
    expect(nextIndex(config(['a'], []).light, 0)).toBe(0)
    expect(nextIndex([], 3)).toBe(0)
  })
})

describe('positions', () => {
  it('defaults to the start of the first track', () => {
    expect(positionFor(INITIAL_POSITIONS, 'light')).toEqual({ index: 0, time: 0 })
    expect(positionFor(INITIAL_POSITIONS, 'dark')).toEqual({ index: 0, time: 0 })
  })
  it('savePosition returns a new record and leaves the input unchanged', () => {
    const before = INITIAL_POSITIONS
    const after = savePosition(before, 'dark', { index: 2, time: 31.5 })
    expect(after).not.toBe(before)
    expect(positionFor(after, 'dark')).toEqual({ index: 2, time: 31.5 })
    expect(positionFor(after, 'light')).toEqual({ index: 0, time: 0 })
    expect(positionFor(before, 'dark')).toEqual({ index: 0, time: 0 })
  })
  it('positionFor falls back to the start when a theme is missing', () => {
    const partial = { light: { index: 1, time: 5 } } as unknown as typeof INITIAL_POSITIONS
    expect(positionFor(partial, 'dark')).toEqual({ index: 0, time: 0 })
  })
})
