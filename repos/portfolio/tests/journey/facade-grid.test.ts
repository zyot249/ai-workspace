import { expect, it } from 'vitest'
import { facadeBaseY, facadeCellAtWorldY, floorWorldY } from '../../app/journey/facade-grid'

it('keeps physical rows anchored as the building grows', () => {
  for (const row of [0, 1, 2]) {
    const worldY = floorWorldY(row)
    for (const height of [0.6, 1.0]) {
      const localY = (worldY + 1) / height - 0.5
      expect(facadeBaseY(localY, height)).toBeCloseTo(row * 0.22, 12)
      expect(facadeCellAtWorldY(worldY + 1e-8).row).toBe(row)
    }
  }
  expect(facadeBaseY(-0.5, 0.6)).toBe(0)
})
