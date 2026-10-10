import { expect, it } from 'vitest'
import { roadRects } from '../../app/journey/path'
import { REFLECT_PLANE_Y } from '../../app/journey/reflection'
import { overlayPlacement } from '../../app/journey/wet-road'

it('centers the overlay on the road and covers every road rectangle with a 4 unit margin', () => {
  const { center, size } = overlayPlacement()
  expect(center).toEqual([-13, REFLECT_PLANE_Y, -29])
  expect(size).toEqual([40, 82])
  for (const [minX, minZ, maxX, maxZ] of roadRects()) {
    expect(center[0] - size[0] / 2).toBeLessThanOrEqual(minX - 4)
    expect(center[0] + size[0] / 2).toBeGreaterThanOrEqual(maxX + 4)
    expect(center[2] - size[1] / 2).toBeLessThanOrEqual(minZ - 4)
    expect(center[2] + size[1] / 2).toBeGreaterThanOrEqual(maxZ + 4)
  }
})
