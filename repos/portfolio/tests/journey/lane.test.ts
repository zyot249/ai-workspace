import { describe, expect, it } from 'vitest'
import { CORNER_RADIUS, createLane, type LaneSample } from '../../app/journey/lane'
import { PATH_SEGMENTS, pathPointAt } from '../../app/journey/path'

const ROUTE_END = 70
const OFFSETS = [1.5, -1.5] as const

const sampleAt = (lane: ReturnType<typeof createLane>, w: number): LaneSample => ({ ...lane.sample(w) })

describe('createLane', () => {
  it('starts and ends on the lane offset from the path, facing along the path', () => {
    for (const offset of OFFSETS) {
      const lane = createLane(offset, ROUTE_END)
      const start = lane.sample(0)
      const startPoint = pathPointAt(0)
      expect(start.x).toBeCloseTo(startPoint.x + startPoint.rightX * offset, 9)
      expect(start.z).toBeCloseTo(startPoint.z + startPoint.rightZ * offset, 9)
      expect(start.dirX).toBeCloseTo(startPoint.dirX, 9)
      expect(start.dirZ).toBeCloseTo(startPoint.dirZ, 9)
      const end = lane.sample(lane.length)
      const endPoint = pathPointAt(ROUTE_END)
      expect(end.x).toBeCloseTo(endPoint.x + endPoint.rightX * offset, 9)
      expect(end.z).toBeCloseTo(endPoint.z + endPoint.rightZ * offset, 9)
      expect(end.dirX).toBeCloseTo(endPoint.dirX, 9)
      expect(end.dirZ).toBeCloseTo(endPoint.dirZ, 9)
    }
  })

  it('stays on the straight offset line away from the corners', () => {
    for (const offset of OFFSETS) {
      const lane = createLane(offset, ROUTE_END)
      const first = PATH_SEGMENTS[0]!
      const sample = lane.sample(10)
      const point = pathPointAt(10)
      expect(sample.x).toBeCloseTo(point.x + first.rightX * offset, 9)
      expect(sample.z).toBeCloseTo(point.z + first.rightZ * offset, 9)
    }
  })

  it('has no jump in position or heading anywhere along its length', () => {
    const step = 0.01
    for (const offset of OFFSETS) {
      const lane = createLane(offset, ROUTE_END)
      let previous = sampleAt(lane, 0)
      for (let w = step; w <= lane.length; w += step) {
        const sample = sampleAt(lane, w)
        expect(Math.hypot(sample.x - previous.x, sample.z - previous.z), `offset ${offset} w ${w}`).toBeLessThanOrEqual(step * 1.001)
        expect(Math.hypot(sample.dirX - previous.dirX, sample.dirZ - previous.dirZ), `offset ${offset} w ${w}`)
          .toBeLessThanOrEqual(step / (CORNER_RADIUS - 1.5) * 1.01)
        previous = sample
      }
    }
  })

  it('returns unit-length headings', () => {
    const lane = createLane(1.5, ROUTE_END)
    for (let w = 0; w <= lane.length; w += 0.7) {
      const sample = lane.sample(w)
      expect(Math.hypot(sample.dirX, sample.dirZ), `w ${w}`).toBeCloseTo(1, 9)
    }
  })

  it('has the same length in both lanes, since each takes one outside and one inside arc', () => {
    // The path turns left, then right. Arc radius is CORNER_RADIUS plus or minus the lane offset.
    const straights = (PATH_SEGMENTS[0]!.length - CORNER_RADIUS)
      + (PATH_SEGMENTS[1]!.length - 2 * CORNER_RADIUS)
      + (ROUTE_END - PATH_SEGMENTS[2]!.cumStart - CORNER_RADIUS)
    const arcs = (Math.PI / 2) * ((CORNER_RADIUS + 1.5) + (CORNER_RADIUS - 1.5))
    for (const offset of OFFSETS) expect(createLane(offset, ROUTE_END).length).toBeCloseTo(straights + arcs, 9)
  })

  it('clamps a sample past either end to the end', () => {
    const lane = createLane(1.5, ROUTE_END)
    expect(lane.sample(-5)).toEqual(lane.sample(0))
    expect(lane.sample(lane.length + 5)).toEqual(lane.sample(lane.length))
  })

  it('writes into the provided sample and returns it', () => {
    const out: LaneSample = { x: 0, z: 0, dirX: 0, dirZ: 0 }
    expect(createLane(1.5, ROUTE_END).sample(5, out)).toBe(out)
  })

  it('throws when the route end is not on the last leg', () => {
    expect(() => createLane(1.5, 5)).toThrow()
  })
})
