import { describe, expect, it } from 'vitest'
import { BASE_FOV, fovForAspect, MAX_FOV, MIN_HORIZONTAL_FOV } from '../../app/journey/camera'

function horizontalFov(fov: number, aspect: number): number {
  const deg = Math.PI / 180
  return 2 * Math.atan(Math.tan((fov * deg) / 2) * aspect) / deg
}

describe('fovForAspect', () => {
  it('keeps the base FOV on landscape screens', () => {
    expect(fovForAspect(16 / 9)).toBe(BASE_FOV)
    expect(fovForAspect(1440 / 900)).toBe(BASE_FOV)
  })

  it('widens the vertical FOV on a portrait tablet to keep the minimum horizontal FOV', () => {
    const aspect = 820 / 1180
    const fov = fovForAspect(aspect)
    expect(fov).toBeGreaterThan(BASE_FOV)
    expect(horizontalFov(fov, aspect)).toBeCloseTo(MIN_HORIZONTAL_FOV, 0)
  })

  it('caps the vertical FOV on very tall screens', () => {
    expect(fovForAspect(0.3)).toBe(MAX_FOV)
  })

  it('never shrinks as the screen gets narrower', () => {
    const aspects = [2, 1.5, 1, 0.8, 0.6, 0.45, 0.3]
    const fovs = aspects.map(fovForAspect)
    for (let i = 1; i < fovs.length; i++) expect(fovs[i]).toBeGreaterThanOrEqual(fovs[i - 1]!)
  })
})
