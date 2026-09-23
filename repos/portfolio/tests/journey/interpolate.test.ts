import { describe, expect, it } from 'vitest'
import { CHAPTER_IDS, STOPS, hexToRgb, type StopState } from '../../app/journey/stops'
import { clamp01, damp, dampState, easeInOut, lerp, lerpStop } from '../../app/journey/interpolate'

function state(stop: StopState): StopState {
  const { cameraDistance, cameraHeight, lookAheadDistance, lookHeight, skyColor, fogColor, fogDensity, buildingDensity, buildingHeight, windowLitRatio } = stop
  return { cameraDistance, cameraHeight, lookAheadDistance, lookHeight, skyColor, fogColor, fogDensity, buildingDensity, buildingHeight, windowLitRatio }
}

const [intro, projects] = STOPS
if (!intro || !projects) throw new Error('STOPS must have at least two entries')

describe('STOPS', () => {
  it('has one stop per chapter, in chapter order', () => {
    expect(STOPS.map(s => s.id)).toEqual([...CHAPTER_IDS])
    expect(STOPS).toHaveLength(4)
  })

  it('uses color components between 0 and 1 and non-negative motion values', () => {
    for (const stop of STOPS) {
      for (const c of [...stop.skyColor, ...stop.fogColor]) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
      }
      expect(stop.fogDensity).toBeGreaterThanOrEqual(0)
      expect(stop.buildingDensity).toBeGreaterThanOrEqual(0)
      expect(stop.buildingDensity).toBeLessThanOrEqual(1)
      expect(stop.buildingHeight).toBeGreaterThan(0)
      expect(stop.windowLitRatio).toBeGreaterThanOrEqual(0)
      expect(stop.windowLitRatio).toBeLessThanOrEqual(1)
    }
  })

  it('progresses from day to night across the chapters', () => {
    const [introStop, , , aboutStop] = STOPS
    if (!introStop || !aboutStop) throw new Error('STOPS must have intro and about entries')
    expect(aboutStop.windowLitRatio).toBeGreaterThan(introStop.windowLitRatio)
    expect(aboutStop.fogDensity).toBeGreaterThan(introStop.fogDensity)
  })
})

describe('hexToRgb', () => {
  it('converts a hex color to 0..1 components', () => {
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0])
  })
})

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

describe('lerpStop', () => {
  it('returns the first stop at 0 and the second at 1', () => {
    expect(lerpStop(intro, projects, 0)).toEqual(state(intro))
    expect(lerpStop(intro, projects, 1)).toEqual(state(projects))
  })

  it('returns midpoints at 0.5', () => {
    const mid = lerpStop(intro, projects, 0.5)
    expect(mid.cameraDistance).toBeCloseTo((intro.cameraDistance + projects.cameraDistance) / 2)
    expect(mid.buildingDensity).toBeCloseTo((intro.buildingDensity + projects.buildingDensity) / 2)
    expect(mid.fogColor[2]).toBeCloseTo((intro.fogColor[2] + projects.fogColor[2]) / 2)
  })

  it('does not include the chapter id', () => {
    expect(lerpStop(intro, projects, 0.5)).not.toHaveProperty('id')
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

describe('dampState', () => {
  it('reaches the target with factor 1', () => {
    expect(dampState(state(intro), state(projects), 1)).toEqual(state(projects))
  })
})
