import { describe, expect, it } from 'vitest'
import { clearsPath, headingFor, PATH_SEGMENTS, PATH_TOTAL_LENGTH, pathPointAt, WAYPOINTS } from '../../app/journey/path'

describe('PATH_SEGMENTS', () => {
  it('has one segment per waypoint gap, each with unit direction', () => {
    expect(PATH_SEGMENTS).toHaveLength(WAYPOINTS.length - 1)
    for (const segment of PATH_SEGMENTS) {
      expect(Math.hypot(segment.dirX, segment.dirZ)).toBeCloseTo(1)
    }
  })

  it('sums to PATH_TOTAL_LENGTH', () => {
    const sum = PATH_SEGMENTS.reduce((total, s) => total + s.length, 0)
    expect(sum).toBeCloseTo(PATH_TOTAL_LENGTH)
  })
})

describe('pathPointAt', () => {
  it('returns the start waypoint at distance 0', () => {
    const start = WAYPOINTS[0]
    if (!start) throw new Error('WAYPOINTS must have a first entry')
    const point = pathPointAt(0)
    expect(point.x).toBeCloseTo(start.x)
    expect(point.z).toBeCloseTo(start.z)
  })

  it('returns the end waypoint at the total path length', () => {
    const end = WAYPOINTS[WAYPOINTS.length - 1]
    if (!end) throw new Error('WAYPOINTS must have a last entry')
    const point = pathPointAt(PATH_TOTAL_LENGTH)
    expect(point.x).toBeCloseTo(end.x)
    expect(point.z).toBeCloseTo(end.z)
  })

  it('clamps distance outside [0, total length]', () => {
    const start = WAYPOINTS[0]
    const end = WAYPOINTS[WAYPOINTS.length - 1]
    if (!start || !end) throw new Error('WAYPOINTS must have first and last entries')
    expect(pathPointAt(-10)).toEqual(pathPointAt(0))
    expect(pathPointAt(PATH_TOTAL_LENGTH + 10)).toEqual(pathPointAt(PATH_TOTAL_LENGTH))
  })

  it('crosses a turn: heading changes between the first and second segment', () => {
    const first = PATH_SEGMENTS[0]
    if (!first) throw new Error('expected at least one segment')
    const before = pathPointAt(first.length - 1)
    const after = pathPointAt(first.length + 1)
    expect(before.dirX).not.toBeCloseTo(after.dirX)
  })
})

describe('headingFor', () => {
  it('is 0 for the default forward direction (0, -1)', () => {
    expect(headingFor(0, -1)).toBeCloseTo(0)
  })

  it('rotates a quarter turn for a perpendicular direction', () => {
    expect(Math.abs(headingFor(-1, 0))).toBeCloseTo(Math.PI / 2)
  })
})

describe('clearsPath', () => {
  it('is false for a point on the path centerline', () => {
    expect(clearsPath(0, 0, 3)).toBe(false)
  })

  it('is true for a point far off to the side', () => {
    expect(clearsPath(40, 0, 3)).toBe(true)
  })
})
