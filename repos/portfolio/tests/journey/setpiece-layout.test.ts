// tests/journey/setpiece-layout.test.ts
import { describe, expect, it } from 'vitest'
import { SET_PIECE_SPECS, type SetPieceRole } from '../../app/journey/building-specs'
import { HALL_LENGTH, HALL_PILLAR_X, HALL_WALL_X, hallPillarZs } from '../../app/journey/hall'
import { COURTYARD_DEPTH, ROAD_HALF_WIDTH, SIDEWALK_OUTER } from '../../app/journey/path'
import { GATE_FOOTPRINT_HALF_X, GATE_FOOTPRINT_HALF_Z, type GateBox, gateLayout, HOUSE_CENTER_Z, HOUSE_FRONT_Z, type PiecePlacement, setPieceLayout } from '../../app/journey/setpiece-layout'

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

  const gate = gateLayout()

  // Per side the gate has two boxes: the pier, nearest the road, and the canopy beyond it.
  function gateSide(side: number): { pier: GateBox; canopy: GateBox } {
    const boxes = gate.boxes.filter(box => Math.sign(box.x) === side).sort((a, b) => Math.abs(a.x) - Math.abs(b.x))
    return { pier: boxes[0]!, canopy: boxes[1]! }
  }

  it('lays out the gate deterministically', () => {
    expect(gateLayout()).toEqual(gate)
  })

  it('stands a pier outside each road edge, with a canopy slab reaching outward from its top', () => {
    expect(gate.boxes).toHaveLength(4)
    for (const side of [-1, 1]) {
      const { pier, canopy } = gateSide(side)
      const pierInner = Math.abs(pier.x) - pier.width / 2
      const pierOuter = Math.abs(pier.x) + pier.width / 2
      const canopyInner = Math.abs(canopy.x) - canopy.width / 2
      expect(pierInner).toBeGreaterThanOrEqual(ROAD_HALF_WIDTH)
      expect(canopyInner).toBeCloseTo(pierOuter, 5)
      // The canopy top is flush with the pier top, and both stand on the ground.
      expect(canopy.y + canopy.height).toBeCloseTo(pier.y + pier.height, 5)
      expect(pier.y).toBe(gate.arch.baseY)
      expect(pier.height).toBeGreaterThan(canopy.height)
    }
  })

  it('springs a tall parabolic arch from the ground inside the piers, above the canopies', () => {
    const { arch } = gate
    const { pier } = gateSide(1)
    expect(arch.span / 2).toBeCloseTo(pier.x - pier.width / 2, 5)
    // Both feet stand inside the pier, which is deeper than the arch so their faces do not coincide.
    expect(arch.footWidth).toBeLessThanOrEqual(pier.width)
    expect(arch.depth).toBeLessThan(pier.depth)
    expect(arch.rise).toBeGreaterThan(pier.height)
    expect(arch.thickness).toBeGreaterThan(0)
    expect(arch.segments).toBeGreaterThanOrEqual(2)
  })

  it('keeps the road clear: the opening is at least as wide as the road', () => {
    expect(gate.arch.span / 2).toBeGreaterThanOrEqual(ROAD_HALF_WIDTH)
  })

  it('reserves a footprint that covers the whole gate, canopies included', () => {
    for (const { canopy } of [gateSide(-1), gateSide(1)]) {
      expect(Math.abs(canopy.x) + canopy.width / 2).toBeLessThanOrEqual(GATE_FOOTPRINT_HALF_X)
      expect(canopy.depth / 2).toBeLessThanOrEqual(GATE_FOOTPRINT_HALF_Z)
    }
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
    for (const p of [...layout.hall, ...layout.market, ...layout.house]) {
      if (p.role === 'beam') continue
      expect(p.y).toBe(-1)
    }
  })
})
