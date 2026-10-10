import { describe, expect, it } from 'vitest'
import { fadePlan, gainAt, MIN_FADE_SECONDS } from '../../app/music/fade'

describe('fadePlan', () => {
  it('starts at the current gain and ends at the target after the given seconds', () => {
    expect(fadePlan(0.1, 0.4, 1.5, 10)).toEqual({ startValue: 0.1, endValue: 0.4, startTime: 10, endTime: 11.5 })
  })
  it('clamps very short and non-positive lengths to the minimum', () => {
    expect(fadePlan(0, 1, 0, 2).endTime).toBeCloseTo(2 + MIN_FADE_SECONDS)
    expect(fadePlan(0, 1, -3, 2).endTime).toBeCloseTo(2 + MIN_FADE_SECONDS)
    expect(fadePlan(0, 1, 0.01, 2).endTime).toBeCloseTo(2 + MIN_FADE_SECONDS)
  })
  it('treats a non-finite length as the minimum', () => {
    expect(fadePlan(0, 1, Number.NaN, 2).endTime).toBeCloseTo(2 + MIN_FADE_SECONDS)
  })
})

describe('gainAt', () => {
  const plan = fadePlan(0.4, 0, 2, 10)
  it('interpolates linearly inside the ramp', () => {
    expect(gainAt(plan, 11)).toBeCloseTo(0.2)
  })
  it('holds the start value before the ramp and the end value after it', () => {
    expect(gainAt(plan, 5)).toBe(0.4)
    expect(gainAt(plan, 12)).toBe(0)
    expect(gainAt(plan, 99)).toBe(0)
  })
  it('returns the end value for a flat plan with no duration', () => {
    expect(gainAt({ startValue: 0, endValue: 0, startTime: 0, endTime: 0 }, 5)).toBe(0)
  })
})
