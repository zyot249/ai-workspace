import { describe, expect, it } from 'vitest'
import { CORNER_BLOCKS, clearsCornerBlocks, clearsFootprints, FOOTPRINTS, type Footprint } from '../../app/journey/footprints'
import { BUILDING_CLEARANCE } from '../../app/journey/path'
import { GATE_FOOTPRINT_HALF_X, GATE_FOOTPRINT_HALF_Z } from '../../app/journey/setpiece-layout'

// Inverse of the rotation used in clearsFootprints: footprint-local (lx, lz) to world.
function worldPoint(fp: Footprint, lx: number, lz: number): { x: number, z: number } {
  const cos = Math.cos(fp.heading)
  const sin = Math.sin(fp.heading)
  return { x: fp.x + lx * cos + lz * sin, z: fp.z - lx * sin + lz * cos }
}

describe('clearsFootprints', () => {
  it('rejects the center of every footprint and accepts a far point', () => {
    for (const fp of FOOTPRINTS) expect(clearsFootprints(fp.x, fp.z)).toBe(false)
    expect(clearsFootprints(100, 100)).toBe(true)
  })

  it.each(FOOTPRINTS.map((fp, index) => [index, fp] as const))(
    'footprint %i: halfExtent enlarges both local axes',
    (_index, fp) => {
      const outsideX = worldPoint(fp, fp.halfX + 0.3, 0)
      const outsideZ = worldPoint(fp, 0, fp.halfZ + 0.3)
      for (const p of [outsideX, outsideZ]) {
        expect(clearsFootprints(p.x, p.z)).toBe(true)
        expect(clearsFootprints(p.x, p.z, 0.2)).toBe(true)
        expect(clearsFootprints(p.x, p.z, 0.5)).toBe(false)
      }
    },
  )
})

it('sizes the entrance footprint to the gate, canopies included', () => {
  const entrance = FOOTPRINTS[0]!
  expect(entrance.halfX).toBe(GATE_FOOTPRINT_HALF_X)
  expect(entrance.halfZ).toBe(GATE_FOOTPRINT_HALF_Z)
})

it('keeps the market stalls inside the market footprint', () => {
  const market = FOOTPRINTS[2]!
  expect(market.halfX).toBeGreaterThanOrEqual(BUILDING_CLEARANCE + 0.5 + 3 + 0.6)
})

describe('clearsCornerBlocks', () => {
  it('rejects block centers and accepts a far point', () => {
    for (const block of CORNER_BLOCKS) expect(clearsCornerBlocks(block.x, block.z)).toBe(false)
    expect(clearsCornerBlocks(100, 100)).toBe(true)
  })

  it.each(CORNER_BLOCKS.map((block, index) => [index, block] as const))(
    'block %i: halfExtent enlarges both axes',
    (_index, block) => {
      const outsideX = { x: block.x + block.width / 2 + 0.3, z: block.z }
      const outsideZ = { x: block.x, z: block.z + block.depth / 2 + 0.3 }
      for (const p of [outsideX, outsideZ]) {
        expect(clearsCornerBlocks(p.x, p.z)).toBe(true)
        expect(clearsCornerBlocks(p.x, p.z, 0.2)).toBe(true)
        expect(clearsCornerBlocks(p.x, p.z, 0.5)).toBe(false)
      }
    },
  )
})
