import { describe, expect, it } from 'vitest'
import { CHAPTER_IDS, LOOKS, PATH_STOPS } from '../../app/journey/stops'
import { clamp01, damp, dampState, easeInOut, lerp, lerpAngle, lerpLook, lerpPath } from '../../app/journey/interpolate'

describe('clamp01', () => {
  it('clamps below 0 and above 1', () => {
    expect(clamp01(-2)).toBe(0)
    expect(clamp01(0.3)).toBe(0.3)
    expect(clamp01(5)).toBe(1)
  })
})

describe('easeInOut', () => {
  it('maps endpoints and midpoint exactly', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(0.5)).toBe(0.5)
    expect(easeInOut(1)).toBe(1)
  })

  it('starts slow and clamps out-of-range input', () => {
    expect(easeInOut(0.25)).toBeLessThan(0.25)
    expect(easeInOut(-1)).toBe(0)
    expect(easeInOut(2)).toBe(1)
  })
})

describe('lerp', () => {
  it('interpolates linearly', () => {
    expect(lerp(0, 10, 0.3)).toBeCloseTo(3)
  })
})

describe('damp', () => {
  it('moves a fraction of the way to the target', () => {
    expect(damp(0, 10, 0.5)).toBe(5)
  })

  it('converges on the target after repeated steps', () => {
    let value = 0
    for (let i = 0; i < 100; i++) value = damp(value, 10, 0.08)
    expect(value).toBeCloseTo(10, 2)
  })
})

it('interpolates every named path and look field', () => {
  for (let i = 0; i < CHAPTER_IDS.length - 1; i++) {
    const aId = CHAPTER_IDS[i]!, bId = CHAPTER_IDS[i + 1]!
    for (const theme of ['light', 'dark'] as const) for (const p of [0, .5, 1]) {
      const a = LOOKS[theme][aId], b = LOOKS[theme][bId]
      const out = lerpLook(a, b, p)
      expect(Object.keys(out).sort()).toEqual(Object.keys(a).sort())
      for (const key of Object.keys(a) as (keyof typeof a)[]) {
        const av = a[key], bv = b[key], actual = out[key]
        if (Array.isArray(av)) {
          expect(actual).toEqual(av.map((v, j) => v * (1 - p) + (bv as readonly number[])[j]! * p))
        } else expect(actual).toBeCloseTo(key === 'sunAzimuth'
          ? lerpAngle(av as number, bv as number, p) : (av as number) * (1 - p) + (bv as number) * p, 12)
      }
      if (p === 0) expect(out).toEqual(a)
      if (p === 1) expect(out).toEqual(b)
      const pa = PATH_STOPS[aId], pb = PATH_STOPS[bId], path = lerpPath(pa, pb, p)
      expect(Object.keys(path).sort()).toEqual(Object.keys(pa).sort())
      for (const key of Object.keys(pa) as (keyof typeof pa)[])
        expect(path[key]).toBeCloseTo(pa[key] * (1 - p) + pb[key] * p, 12)
      if (p === 0) expect(path).toEqual(pa)
      if (p === 1) expect(path).toEqual(pb)
      const sa = { ...pa, ...a }, sb = { ...pb, ...b }
      expect(dampState(sa, sb, 1)).toEqual(sb)
    }
  }
})
it('takes the shortest angle and normalizes it', () => {
  expect(lerpAngle(170, -170, .5)).toBe(-180)
  expect(lerpAngle(-60, 30, .5)).toBe(-15)
  for (const a of [-540, -180, 170, 540]) for (const b of [-540, -170, 180, 540])
    for (const p of [0, .25, .5, .75, 1]) {
      const angle = lerpAngle(a, b, p)
      expect(angle).toBeGreaterThanOrEqual(-180); expect(angle).toBeLessThan(180)
    }
})

it('interpolates wetness at p = 0, 0.5 and 1', () => {
  const a = LOOKS.dark.skills, b = LOOKS.dark.about
  expect(lerpLook(a, b, 0).wetness).toBe(.4)
  expect(lerpLook(a, b, .5).wetness).toBeCloseTo(.55, 12)
  expect(lerpLook(a, b, 1).wetness).toBe(.7)
})
