import { describe, expect, it } from 'vitest'
import { BASE_Y } from '../../app/journey/buildings'
import {
  AO_HEIGHT, AO_MIN, aoEffective, aoFactor, BOUNCE_HEIGHT, bounceAmount, facadeLookFor,
  GRADIENT_GROUND_Y, RIM_DEPTH, rimAmount,
} from '../../app/journey/facade-gradient'
import { sunDirectionFor, sunVisibilityFor } from '../../app/journey/sky-mirror'
import { CHAPTER_IDS, LOOKS, type Theme } from '../../app/journey/stops'

const THEMES: readonly Theme[] = ['light', 'dark']

describe('aoFactor', () => {
  it('starts at AO_MIN on the ground and reaches 1 at AO_HEIGHT', () => {
    expect(GRADIENT_GROUND_Y).toBe(BASE_Y)
    expect(aoFactor(0)).toBeCloseTo(AO_MIN, 12)
    expect(aoFactor(AO_HEIGHT)).toBeCloseTo(1, 12)
    expect(aoFactor(AO_HEIGHT * 3)).toBe(1)
    expect(aoFactor(-0.5)).toBeCloseTo(AO_MIN, 12)
  })

  it('rises monotonically in between', () => {
    let previous = aoFactor(0)
    for (let h = 0.01; h <= AO_HEIGHT; h += 0.01) {
      const value = aoFactor(h)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe('aoEffective', () => {
  it('is 1 at strength 0 and equals aoFactor at strength 1', () => {
    expect(aoEffective(0.1, 0)).toBe(1)
    expect(aoEffective(0.1, 1)).toBeCloseTo(aoFactor(0.1), 12)
  })

  it('keeps luminance 0.2 above the base at most 70% of luminance 1.5 above, at every stop', () => {
    for (const theme of THEMES) {
      for (const chapter of CHAPTER_IDS) {
        const strength = facadeLookFor(LOOKS[theme][chapter], 1).uAoStrength
        const ratio = aoEffective(0.2, strength) / aoEffective(1.5, strength)
        expect(ratio, `${theme} ${chapter}`).toBeLessThanOrEqual(0.7)
      }
    }
  })
})

describe('rimAmount', () => {
  it('is zero below the rim band and full at the roof edge', () => {
    expect(rimAmount(2 - RIM_DEPTH - 0.01, 2, 1)).toBe(0)
    expect(rimAmount(2, 2, 0.8)).toBeCloseTo(0.8, 12)
  })

  it('ignores walls that face away from the sun', () => {
    expect(rimAmount(2, 2, -0.7)).toBe(0)
  })

  it('moves with the roof, not with a fixed height', () => {
    expect(rimAmount(4 - 0.1, 4, 1)).toBeCloseTo(rimAmount(2 - 0.1, 2, 1), 12)
  })
})

describe('bounceAmount', () => {
  it('is 1 at the ground and 0 from BOUNCE_HEIGHT up', () => {
    expect(bounceAmount(0)).toBe(1)
    expect(bounceAmount(BOUNCE_HEIGHT)).toBe(0)
    expect(bounceAmount(3)).toBe(0)
  })
})

describe('facadeLookFor', () => {
  it('maps windowLitRatio to AO relief and bounce', () => {
    for (const theme of THEMES) {
      for (const chapter of CHAPTER_IDS) {
        const look = LOOKS[theme][chapter]
        const mapped = facadeLookFor(look, 1)
        expect(mapped.uAoStrength).toBeCloseTo(1 - 0.25 * look.windowLitRatio, 12)
        expect(mapped.uBounce).toBeCloseTo(0.06 * look.windowLitRatio, 12)
      }
    }
  })

  it('scales the rim by sun visibility and clamps it to [0, 1]', () => {
    const look = LOOKS.light.intro
    expect(facadeLookFor(look, 1).uRimStrength).toBeCloseTo(0.35, 12)
    expect(facadeLookFor(look, 0.5).uRimStrength).toBeCloseTo(0.175, 12)
    expect(facadeLookFor(look, 0).uRimStrength).toBe(0)
    expect(facadeLookFor(look, 2).uRimStrength).toBeCloseTo(0.35, 12)
    expect(facadeLookFor(look, -1).uRimStrength).toBe(0)
  })

  it('turns the rim off at night and keeps it at sunset', () => {
    const rimFor = (theme: Theme, chapter: (typeof CHAPTER_IDS)[number]) => {
      const look = LOOKS[theme][chapter]
      const [, y] = sunDirectionFor(look.sunElevation, look.sunAzimuth)
      return facadeLookFor(look, sunVisibilityFor(y)).uRimStrength
    }
    expect(rimFor('dark', 'about')).toBe(0)
    expect(rimFor('dark', 'projects')).toBeGreaterThan(0.3)
    for (const chapter of CHAPTER_IDS) expect(rimFor('light', chapter)).toBeCloseTo(0.35, 12)
  })

  it('clamps an out-of-range windowLitRatio', () => {
    expect(facadeLookFor({ windowLitRatio: 2 }, 1).uAoStrength).toBeCloseTo(0.75, 12)
    expect(facadeLookFor({ windowLitRatio: -1 }, 1).uBounce).toBe(0)
  })
})
