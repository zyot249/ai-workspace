// tests/journey/near-layout.test.ts
import { describe, expect, it } from 'vitest'
import { NEAR_Y_MAX, NEAR_Y_MIN } from '../../app/journey/building-specs'
import { nearFootprintScale, nearVariantFor, nearYaw, nearYScale } from '../../app/journey/near-layout'

describe('nearVariantFor', () => {
  it('is deterministic and stays inside the variant range', () => {
    for (let i = 0; i < 200; i++) {
      const v = nearVariantFor(i, 4)
      expect(v).toBe(nearVariantFor(i, 4))
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(4)
    }
  })

  it('uses every variant across a layer of buildings', () => {
    const used = new Set(Array.from({ length: 24 }, (_, i) => nearVariantFor(i, 3)))
    expect(used.size).toBe(3)
  })

  it('returns 0 for a single variant', () => {
    expect(nearVariantFor(5, 1)).toBe(0)
  })
})

describe('nearYaw', () => {
  it('faces a building right of the first leg back toward the road (-X)', () => {
    // A model facing -Z, turned by yaw about Y, faces (-sin yaw, -cos yaw).
    const yaw = nearYaw(6, -10)
    expect(-Math.sin(yaw)).toBeCloseTo(-1, 5)
    expect(-Math.cos(yaw)).toBeCloseTo(0, 5)
  })

  it('faces a building left of the first leg back toward the road (+X)', () => {
    const yaw = nearYaw(-6, -10)
    expect(-Math.sin(yaw)).toBeCloseTo(1, 5)
  })

  it('is always a multiple of a quarter turn', () => {
    for (const [x, z] of [[6, -10], [-6, -10], [-13, -30], [-30, -50], [3, 20]] as const) {
      const quarter = nearYaw(x, z) / (Math.PI / 2)
      expect(Math.abs(quarter - Math.round(quarter))).toBeLessThan(1e-9)
    }
  })
})

describe('nearFootprintScale', () => {
  it('fits the model inside the placed rectangle', () => {
    expect(nearFootprintScale([2, 3, 1], 0, 1, 1)).toBeCloseTo(0.5, 5)
    expect(nearFootprintScale([2, 3, 1], 0, 4, 0.5)).toBeCloseTo(0.5, 5)
  })

  it('swaps width and depth for a quarter-turn yaw', () => {
    // Turned 90 degrees, the model's x extent runs along world z.
    expect(nearFootprintScale([2, 3, 1], Math.PI / 2, 1, 4)).toBeCloseTo(1, 5)
  })
})

describe('nearYScale', () => {
  it('clamps the scroll height factor into the near range', () => {
    expect(nearYScale(0.6)).toBe(NEAR_Y_MIN)
    expect(nearYScale(1.15)).toBe(NEAR_Y_MAX)
    expect(nearYScale(1)).toBe(1)
    expect(nearYScale(5)).toBe(NEAR_Y_MAX)
  })
})
