import { describe, expect, it } from 'vitest'
import { hallFrameSlots, hallPillarZs } from '../../app/journey/scene'

const PILLAR_HALF = 0.26
const FRAME_HALF_Z = 0.775 // border BoxGeometry depth 1.55 / 2

describe('hallFrameSlots', () => {
  it('clears every pillar along the z axis', () => {
    const pillarZs = hallPillarZs()
    for (const slot of hallFrameSlots(8)) {
      for (const pillarZ of pillarZs) {
        const gap = Math.abs(slot.z - pillarZ)
        expect(gap).toBeGreaterThan(FRAME_HALF_Z + PILLAR_HALF)
      }
    }
  })

  it('stays within the hall length', () => {
    const half = 8 // HALL_LENGTH / 2
    for (const slot of hallFrameSlots(8)) {
      expect(Math.abs(slot.z)).toBeLessThan(half)
    }
  })

  it('fills the left wall before the right wall', () => {
    const slots = hallFrameSlots(3)
    expect(slots.every(s => s.side === -1)).toBe(true)
  })

  it('spills onto the right wall only once the left wall is full', () => {
    const bayCount = hallPillarZs().length - 1
    const slots = hallFrameSlots(bayCount + 1)
    expect(slots.slice(0, bayCount).every(s => s.side === -1)).toBe(true)
    expect(slots[bayCount]?.side).toBe(1)
  })

  it('caps at the number of available bays', () => {
    const bayCount = hallPillarZs().length - 1
    expect(hallFrameSlots(999)).toHaveLength(bayCount * 2)
  })
})
