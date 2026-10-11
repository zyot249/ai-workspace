import { expect, it } from 'vitest'
import { CHAPTER_IDS, LOOKS, PATH_STOPS } from '../../app/journey/stops'
import { easeInOut, lerpLook, lerpPath } from '../../app/journey/interpolate'
import { chapterIdAt, stopFor, targetFor } from '../../app/journey/target'

it('selects each arc and interpolates scrolling before theme easing', () => {
  for (let c = 0; c < 4; c++) for (const p of [0, .25, .5, 1]) for (const reduced of [false, true]) {
    const a = CHAPTER_IDS[c]!, b = CHAPTER_IDS[Math.min(3, c + 1)]!
    const q = reduced ? 0 : easeInOut(p)
    const path = lerpPath(PATH_STOPS[a], PATH_STOPS[b], q)
    for (const mix of [0, .25, .5, .75, 1]) {
      const look = lerpLook(lerpLook(LOOKS.light[a], LOOKS.light[b], q),
        lerpLook(LOOKS.dark[a], LOOKS.dark[b], q), easeInOut(mix))
      expect(targetFor(c, p, mix, reduced)).toEqual({ ...path, ...look })
      for (const key of Object.keys(path) as (keyof typeof path)[])
        expect(targetFor(c, p, mix, reduced)[key]).toBe(path[key])
    }
    expect(targetFor(c, p, 0, reduced)).toEqual({ ...path, ...lerpLook(LOOKS.light[a], LOOKS.light[b], q) })
    expect(targetFor(c, p, 1, reduced)).toEqual({ ...path, ...lerpLook(LOOKS.dark[a], LOOKS.dark[b], q) })
  }
})
it('clamps chapter ends and terminal scrolling', () => {
  expect(chapterIdAt(-1)).toBe('intro'); expect(chapterIdAt(99)).toBe('about')
  expect(chapterIdAt(1.9)).toBe('projects'); expect(chapterIdAt(NaN)).toBe('intro')
  expect(targetFor(3, 1, 1, false)).toEqual(stopFor(3, 1))
  expect(targetFor(99, .5, 0, false)).toEqual(stopFor(3, 0))
  expect(targetFor(1, -1, 0, false)).toEqual(stopFor(1, 0))
  expect(targetFor(1, 2, 1, false)).toEqual(stopFor(2, 1))
})

it('returns the light and dark wetness at themeMix 0 and 1', () => {
  expect(targetFor(3, 0, 0, false).wetness).toBe(0)
  expect(targetFor(3, 0, 1, false).wetness).toBe(.7)
  expect(targetFor(1, 0, 1, false).wetness).toBe(.15)
})
