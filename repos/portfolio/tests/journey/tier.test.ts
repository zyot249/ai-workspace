import { describe, expect, it } from 'vitest'
import { LITE_MAX_WIDTH, lowPowerFor, pickTier, type TierInput } from '../../app/journey/tier'

const desktop: TierInput = { webgl: true, reducedMotion: false, coarsePointer: false, width: 1440 }

describe('pickTier', () => {
  it('returns full on a capable desktop', () => {
    expect(pickTier(desktop)).toBe('full')
  })

  it('returns none without WebGL, regardless of other flags', () => {
    expect(pickTier({ webgl: false, reducedMotion: true, coarsePointer: true, width: 320 })).toBe('none')
  })

  it('returns reduced when reduced motion is set, even on a small touch device', () => {
    expect(pickTier({ ...desktop, reducedMotion: true, coarsePointer: true, width: 320 })).toBe('reduced')
  })

  it('returns lite for a coarse pointer on a wide screen', () => {
    expect(pickTier({ ...desktop, coarsePointer: true })).toBe('lite')
  })

  it('returns lite just below the width threshold', () => {
    expect(pickTier({ ...desktop, width: LITE_MAX_WIDTH - 1 })).toBe('lite')
  })

  it('returns full exactly at the width threshold', () => {
    expect(pickTier({ ...desktop, width: LITE_MAX_WIDTH })).toBe('full')
  })
})

describe('device cost independent of motion preference', () => {
  it.each([
    [767, false, true], [768, false, false], [1440, true, true],
  ] as const)('width=%i coarse=%s has lowPower=%s', (width, coarsePointer, expected) => {
    for (const reducedMotion of [false, true]) {
      expect(lowPowerFor({ webgl: true, reducedMotion, width, coarsePointer })).toBe(expected)
    }
  })
})
