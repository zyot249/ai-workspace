import { describe, expect, it } from 'vitest'
import golden from './fixtures/building-positions.json'
import {
  assignSpires, BASE_Y, BEACON_PERIOD, BEACON_RADIUS, beaconIsOn, BLOCK_HEIGHT, boxPartsFor, type Archetype,
  type Building, createBuildings, HIDDEN_BUILDING, LAYERS, PART_STRIDE, partRangesFor, PLACEMENT_ATTEMPTS,
  placeBuilding, ROAD_CLEARANCE, rollArchetype, SPIRE_COUNTS, SPIRE_WIDTH, writeBeaconPart, writeBoxParts,
  writeSpirePart,
} from '../../app/journey/buildings'
import { clearsCornerBlocks, clearsFootprints } from '../../app/journey/footprints'
import { clearsPath, ROAD_HALF_WIDTH } from '../../app/journey/path'
import { seeded } from '../../app/journey/random'

const WEIGHTS = [[33, 33, 34], [55, 30, 15], [70, 25, 5]] as const
const NAMES = ['slab', 'setback', 'crowned'] as const
const HEIGHTS = [0.5, 1, 2]
const ARCHETYPES: Archetype[] = ['slab', 'setback', 'crowned', 'spire']

const building: Building = {
  x: 2, z: -3, width: 0.8, depth: 0.6, baseHeight: 1, archetype: 'slab', spireLength: 0.7, blinkPhase: 0.3,
}

describe('rollArchetype', () => {
  it('is deterministic for a seed', () => {
    expect(rollArchetype(17, 0)).toBe(rollArchetype(17, 0))
  })

  it.each([0, 1, 2])('layer %i matches the weight table within 5 points over 2000 seeds', layer => {
    const counts = { slab: 0, setback: 0, crowned: 0 }
    for (let seed = 0; seed < 2000; seed++) counts[rollArchetype(seed, layer)]++
    NAMES.forEach((name, k) => {
      expect(Math.abs(counts[name] / 20 - WEIGHTS[layer]![k]!)).toBeLessThan(5)
    })
  })
})

describe('spire assignment', () => {
  const full = LAYERS.map((config, layer) => createBuildings(layer, config.count, SPIRE_COUNTS[layer]!))

  it('gives 2 near, 2 mid, 0 far spires to the tallest placed buildings', () => {
    full.forEach((buildings, layer) => {
      const spires = buildings.filter(b => b.archetype === 'spire')
      expect(spires).toHaveLength(SPIRE_COUNTS[layer]!)
      const tallest = buildings.filter(b => b.width > 0).map(b => b.baseHeight).sort((a, b) => b - a)
        .slice(0, SPIRE_COUNTS[layer]!)
      expect(spires.map(b => b.baseHeight).sort((a, b) => b - a)).toEqual(tallest)
      expect(buildings.filter(b => b.width === 0).every(b => b.archetype !== 'spire')).toBe(true)
    })
  })

  it('assigns no spire when the spire count is 0 (lowPower)', () => {
    LAYERS.forEach((config, layer) => {
      const buildings = createBuildings(layer, Math.round(config.count * 0.6), 0)
      expect(buildings.some(b => b.archetype === 'spire')).toBe(false)
    })
  })

  it('assigns fewer spires than requested when fewer buildings are placed', () => {
    const tall = { ...building, baseHeight: 3 }
    expect(assignSpires([HIDDEN_BUILDING, tall], 2).filter(b => b.archetype === 'spire')).toHaveLength(1)
    expect(assignSpires([HIDDEN_BUILDING], 2).filter(b => b.archetype === 'spire')).toHaveLength(0)
    expect(assignSpires([], 2)).toEqual([])
  })

  it('returns new objects and leaves the input unchanged', () => {
    const input = [Object.freeze({ ...building, baseHeight: 3 })]
    const output = assignSpires(input, 1)
    expect(output[0]!.archetype).toBe('spire')
    expect(input[0]!.archetype).toBe('slab')
  })
})

describe('part counts', () => {
  it('counts 1 / 2 / 2 / 2 box parts per archetype', () => {
    const buildings = ARCHETYPES.map(archetype => ({ ...building, archetype }))
    const { ranges, total } = partRangesFor(buildings)
    expect(ranges.map(r => r.count)).toEqual([1, 2, 2, 2])
    expect(ranges.map(r => r.start)).toEqual([0, 1, 3, 5])
    expect(total).toBe(7)
  })
})

describe('writeBoxParts', () => {
  const bottom = (p: { y: number, sy: number }) => p.y - p.sy / 2
  const top = (p: { y: number, sy: number }) => p.y + p.sy / 2

  it.each(ARCHETYPES)('%s: lowest body sits on the ground at every height', archetype => {
    for (const height of HEIGHTS) {
      expect(bottom(boxPartsFor(building, archetype, height)[0]!)).toBeCloseTo(BASE_Y, 5)
    }
  })

  it('setback: upper body bottom equals lower body top, at 70% footprint and 38% height', () => {
    for (const height of HEIGHTS) {
      const [lower, upper] = boxPartsFor(building, 'setback', height)
      expect(bottom(upper!)).toBeCloseTo(top(lower!), 5)
      expect(lower!.sy).toBeCloseTo(height * 0.62, 5)
      expect(upper!.sy).toBeCloseTo(height * 0.38, 5)
      expect(upper!.sx).toBeCloseTo(building.width * 0.7, 5)
      expect(upper!.sz).toBeCloseTo(building.depth * 0.7, 5)
    }
  })

  it.each(['crowned', 'spire'] as const)('%s: rooftop block sits on the body and never stretches', archetype => {
    const heights = HEIGHTS.map(height => boxPartsFor(building, archetype, height))
    heights.forEach(([body, block], index) => {
      expect(block!.kind).toBe('equipment')
      expect(bottom(block!)).toBeCloseTo(top(body!), 5)
      expect(block!.sy).toBeCloseTo(BLOCK_HEIGHT, 5)
      expect(block!.sx).toBeCloseTo(heights[0]![1]!.sx, 5)
      expect(top(body!)).toBeCloseTo(BASE_Y + HEIGHTS[index]!, 5)
    })
  })

  it.each(ARCHETYPES)('%s: every part has zero scale at height 0 and for a hidden building', archetype => {
    for (const parts of [boxPartsFor(building, archetype, 0), boxPartsFor(HIDDEN_BUILDING, archetype, 1)]) {
      for (const part of parts) expect([part.sx, part.sy, part.sz]).toEqual([0, 0, 0])
    }
  })

  it('writes at the requested float offset and returns the part count', () => {
    const out = new Float32Array(PART_STRIDE * 4)
    expect(writeBoxParts(out, PART_STRIDE, building, 'crowned', 1)).toBe(2)
    expect(out.slice(0, PART_STRIDE).every(v => v === 0)).toBe(true)
    expect(out[PART_STRIDE + 4]).toBeCloseTo(building.width, 5)
  })
})

describe('spire and beacon parts', () => {
  const read = (out: Float32Array) => ({ y: out[2]!, sx: out[4]!, sy: out[5]!, sz: out[6]! })

  it('stacks block, spire, and beacon with no gaps and constant size', () => {
    for (const height of HEIGHTS) {
      const spire = new Float32Array(PART_STRIDE)
      const beacon = new Float32Array(PART_STRIDE)
      writeSpirePart(spire, 0, building, height, building.spireLength)
      writeBeaconPart(beacon, 0, building, height, building.spireLength, true)
      const s = read(spire)
      const b = read(beacon)
      expect(s.y - s.sy / 2).toBeCloseTo(BASE_Y + height + BLOCK_HEIGHT, 5)
      expect(b.y).toBeCloseTo(s.y + s.sy / 2, 5)
      expect([s.sx, s.sy, s.sz]).toEqual([
        Math.fround(SPIRE_WIDTH), Math.fround(building.spireLength), Math.fround(SPIRE_WIDTH)])
      expect(b.sx).toBeCloseTo(BEACON_RADIUS, 6)
    }
  })

  it('scales to zero at height 0, when off, and for a hidden building', () => {
    const out = new Float32Array(PART_STRIDE)
    writeSpirePart(out, 0, building, 0, 0.7)
    expect(read(out)).toMatchObject({ sx: 0, sy: 0, sz: 0 })
    writeBeaconPart(out, 0, building, 0, 0.7, true)
    expect(read(out)).toMatchObject({ sx: 0, sy: 0, sz: 0 })
    writeBeaconPart(out, 0, building, 1, 0.7, false)
    expect(read(out)).toMatchObject({ sx: 0, sy: 0, sz: 0 })
    writeBeaconPart(out, 0, HIDDEN_BUILDING, 1, 0.7, true)
    expect(read(out)).toMatchObject({ sx: 0, sy: 0, sz: 0 })
  })
})

describe('beaconIsOn', () => {
  it('is on for 0.2 s of every 1.6 s', () => {
    let on = 0
    const steps = 1600
    for (let i = 0; i < steps; i++) if (beaconIsOn(0.3, (i / steps) * BEACON_PERIOD, false)) on++
    expect(on / steps).toBeCloseTo(0.2 / 1.6, 2)
  })

  it('shifts with the per-building phase', () => {
    const states = [0, 0.25, 0.5, 0.75].map(phase => beaconIsOn(phase, 0, false))
    expect(new Set(states).size).toBe(2)
  })

  it('stays on when steady, for any time including negative', () => {
    for (const t of [-3.2, 0, 0.9, 1000.5]) expect(beaconIsOn(0.6, t, true)).toBe(true)
  })

  it('returns a boolean for negative time when blinking', () => {
    expect(typeof beaconIsOn(0.1, -2.7, false)).toBe('boolean')
  })
})

describe('placeBuilding', () => {
  const GRID = [-1, -0.5, 0, 0.5, 1]

  it.each(LAYERS.map((config, layer) => [layer, config.sideSpread] as const))(
    'layer %i: 500 seeds keep the whole rectangle off road, set-pieces, and corner blocks',
    (layer, sideSpread) => {
      const violations: string[] = []
      let hidden = 0
      for (let i = 0; i < 500; i++) {
        const placed = placeBuilding(layer * 1000 + i, sideSpread)
        if (!placed) { hidden++; continue }
        for (const gx of GRID) for (const gz of GRID) {
          const x = placed.x + gx * placed.width / 2
          const z = placed.z + gz * placed.depth / 2
          // The road surface is ROAD_HALF_WIDTH wide. Beside straight legs the center test keeps the
          // full ROAD_CLEARANCE; at the outer corner of a turn a rectangle corner may come up to 0.23
          // closer than the center test guarantees, which still clears the surface.
          if (!clearsPath(x, z, ROAD_HALF_WIDTH)) violations.push(`road ${layer}:${i}`)
          if (!clearsFootprints(x, z)) violations.push(`footprint ${layer}:${i}`)
          if (!clearsCornerBlocks(x, z)) violations.push(`corner ${layer}:${i}`)
        }
      }
      expect(violations).toEqual([])
      expect(hidden / 500).toBeLessThanOrEqual(0.05)
    },
  )

  it('is identical across two runs', () => {
    const run = () => LAYERS.map((config, layer) =>
      Array.from({ length: config.count }, (_, i) => placeBuilding(layer * 1000 + i, config.sideSpread)))
    expect(run()).toEqual(run())
  })

  it('gives non-square footprints: depth is 0.7 to 1.3 times width', () => {
    for (let i = 0; i < 100; i++) {
      const placed = placeBuilding(i, 13)
      if (!placed) continue
      expect(placed.depth / placed.width).toBeGreaterThanOrEqual(0.7 - 1e-9)
      expect(placed.depth / placed.width).toBeLessThanOrEqual(1.3 + 1e-9)
    }
  })

  it('keeps every position from today\'s city that also passes the stricter check', () => {
    expect(PLACEMENT_ATTEMPTS).toBeGreaterThanOrEqual(6)
    let checked = 0
    let total = 0
    for (const { layer, buildings } of golden.layers) {
      const config = LAYERS[layer]!
      buildings.forEach((old, i) => {
        total++
        if (!old) return
        const seedBase = layer * 1000 + i
        const depth = old.width * (0.7 + 0.6 * seeded(seedBase + 300))
        const halfExtent = Math.max(old.width, depth) / 2
        const passes = clearsPath(old.x, old.z, ROAD_CLEARANCE + halfExtent)
          && clearsFootprints(old.x, old.z, halfExtent) && clearsCornerBlocks(old.x, old.z, halfExtent)
        if (!passes) return
        const now = placeBuilding(seedBase, config.sideSpread)
        expect(now?.x).toBeCloseTo(old.x, 9)
        expect(now?.z).toBeCloseTo(old.z, 9)
        checked++
      })
    }
    expect(checked).toBeGreaterThan(total * 0.5)
  })
})
