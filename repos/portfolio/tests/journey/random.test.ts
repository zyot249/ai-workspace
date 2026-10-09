import { describe, expect, it } from 'vitest'
import { seeded } from '../../app/journey/random'

describe('seeded', () => {
  it('returns values in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const value = seeded(i)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('is deterministic and varies by index', () => {
    expect(seeded(7)).toBe(seeded(7))
    expect(seeded(7)).not.toBe(seeded(8))
    expect(seeded(0)).toBe(0)
  })
})
