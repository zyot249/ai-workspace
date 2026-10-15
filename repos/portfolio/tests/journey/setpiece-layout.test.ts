// tests/journey/setpiece-layout.test.ts
import { describe, expect, it } from 'vitest'
import { SET_PIECE_SPECS, type SetPieceRole } from '../../app/journey/building-specs'
import { HALL_LENGTH, HALL_PILLAR_X, HALL_WALL_X, hallPillarZs } from '../../app/journey/hall'
import { COURTYARD_DEPTH, ROAD_HALF_WIDTH, SIDEWALK_OUTER } from '../../app/journey/path'
import { gateArch, HOUSE_CENTER_Z, HOUSE_FRONT_Z, type PiecePlacement, setPieceLayout } from '../../app/journey/setpiece-layout'

// A placed piece's final extent along its model axes.
function extent(p: PiecePlacement, role: SetPieceRole): [number, number, number] {
  const size = SET_PIECE_SPECS[role].size
  return [p.sx * size[0], p.sy * size[1], p.sz * size[2]]
}

describe('setPieceLayout', () => {
  const layout = setPieceLayout()

  it('is deterministic', () => {
    expect(setPieceLayout()).toEqual(layout)
  })

  it('puts a pillar at each side of the road, 0.4 beyond its edge, and no flat beam', () => {
    const pillars = layout.gate.filter(p => p.role === 'gatePillar')
    expect(pillars.map(p => p.x).sort((a, b) => a - b)).toEqual([-(ROAD_HALF_WIDTH + 0.4), ROAD_HALF_WIDTH + 0.4])
    for (const pillar of pillars) expect(extent(pillar, 'gatePillar')[1]).toBeCloseTo(3.4, 5)
    expect(layout.gate.some(p => p.role === 'beam')).toBe(false)
  })

  it('spans a parabolic arch between the outer pillar edges with no gap above the pillar tops', () => {
    const arch = gateArch()
    const pillars = layout.gate.filter(p => p.role === 'gatePillar')
    const pillarWidth = extent(pillars[0]!, 'gatePillar')[0]
    const pillarX = Math.max(...pillars.map(p => p.x))
    const pillarTop = Math.max(...pillars.map(p => p.y + extent(p, 'gatePillar')[1]))
    const half = arch.span / 2
    const underside = (x: number) => arch.baseY + arch.rise * (1 - (x / half) ** 2)
    expect(half).toBeCloseTo(pillarX + pillarWidth / 2, 5)
    // The underside meets the pillar top at the pillar's inner edge and sinks into the pillar beyond it.
    expect(underside(pillarX - pillarWidth / 2)).toBeCloseTo(pillarTop, 5)
    expect(underside(half)).toBeLessThan(pillarTop)
    expect(arch.rise).toBeGreaterThan(0)
    expect(arch.segments).toBeGreaterThanOrEqual(2)
    expect(arch.depth).toBeCloseTo(extent(pillars[0]!, 'gatePillar')[2], 5)
  })

  it('stands hall columns on the hall pillar positions', () => {
    const columns = layout.hall.filter(p => p.role === 'hallColumn')
    const zs = hallPillarZs()
    expect(columns).toHaveLength(zs.length * 2)
    for (const side of [-1, 1]) {
      const placed = columns.filter(p => Math.sign(p.x) === side)
      expect(placed.every(p => p.x === side * HALL_PILLAR_X)).toBe(true)
      expect(placed.map(p => p.z).sort((a, b) => a - b)).toEqual([...zs].sort((a, b) => a - b))
    }
  })

  it('covers the whole hall length with wall segments 0.15 thick, facing the road', () => {
    for (const side of [-1, 1]) {
      const walls = layout.hall.filter(p => p.role === 'hallWall' && Math.sign(p.x) === side)
      const total = walls.reduce((sum, p) => sum + extent(p, 'hallWall')[0], 0)
      expect(total).toBeCloseTo(HALL_LENGTH, 5)
      for (const wall of walls) {
        expect(wall.x).toBe(side * HALL_WALL_X)
        expect(wall.rotY).toBeCloseTo(side * Math.PI / 2, 5)
        expect(extent(wall, 'hallWall')[2]).toBeCloseTo(0.15, 5)
        expect(extent(wall, 'hallWall')[1]).toBeCloseTo(2.4, 5)
      }
    }
  })

  it('spans the hall length with one beam per side', () => {
    const beams = layout.hall.filter(p => p.role === 'beam')
    expect(beams).toHaveLength(2)
    for (const beam of beams) expect(extent(beam, 'beam')[0]).toBeCloseTo(HALL_LENGTH, 5)
  })

  it('places six stalls clear of the sidewalk, facing the road', () => {
    expect(layout.market).toHaveLength(6)
    for (const stall of layout.market) {
      expect(Math.abs(stall.x) - 0.6).toBeGreaterThanOrEqual(SIDEWALK_OUTER)
      expect(stall.rotY).toBeCloseTo(Math.sign(stall.x) * Math.PI / 2, 5)
      expect(extent(stall, 'stall')[0]).toBeCloseTo(1.2, 5)
    }
  })

  it('places one house at the back of the courtyard facing +Z', () => {
    expect(layout.house).toHaveLength(1)
    const house = layout.house[0]!
    expect(house.z).toBe(HOUSE_CENTER_Z)
    expect(HOUSE_CENTER_Z).toBeCloseTo(-COURTYARD_DEPTH / 2 + 1.8, 5)
    expect(HOUSE_FRONT_Z).toBeCloseTo(HOUSE_CENTER_Z + 1.5, 5)
    expect(house.rotY).toBeCloseTo(Math.PI, 5)
  })

  it('stands every piece on the ground at y = -1', () => {
    for (const p of [...layout.gate, ...layout.hall, ...layout.market, ...layout.house]) {
      if (p.role === 'beam') continue
      expect(p.y).toBe(-1)
    }
  })
})
