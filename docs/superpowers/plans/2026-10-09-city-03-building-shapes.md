# City 03: Building Shapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 96 identical cube buildings with four archetypes (slab, setback, crowned, spire), non-square footprints, blinking beacons, and a dirty-checked, allocation-free per-frame update.

**Architecture:** Move `seeded`, footprints, and building code out of `scene.ts` into `random.ts`, `footprints.ts`, and `buildings.ts`. Each layer owns one box `InstancedMesh` (all box parts of all archetypes), plus a cone mesh for spires and a sphere mesh for beacons when the layer has spires. Part geometry comes from pure writer functions that fill a `Float32Array`, so the tests read numbers instead of meshes. The facade shader gets an `aWindowed` gate so rooftop blocks show no windows.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Three.js r186, Vitest 5, Playwright GPU harness (`tests/gpu/`).

**Spec:** `docs/superpowers/specs/2026-10-09-city-03-building-shapes-design.md`. Read `docs/superpowers/specs/2026-10-09-city-00-shared-conventions.md` first.

**Research:** `docs/superpowers/research/2026-10-09-portfolio-overview-research.md` (written at commit `5b1a51c`). Its building and scene references were checked against `HEAD` while writing this plan: `scene.ts` still holds the building code the spec describes, and `facade-material.ts`, `shader-utils.ts`, and the GPU harness exist now.

## Global Constraints

- Base of every building is world `y = -1` (`BASE_Y`).
- Archetype weights in percent (slab / setback / crowned): near `33 / 33 / 34`, mid `55 / 30 / 15`, far `70 / 25 / 5`.
- `SPIRE_COUNT`: 2 in the near layer, 2 in the mid layer, 0 in the far layer, and 0 when `lowPower`. Spires go to the tallest placed buildings by `baseHeight`, never to a building with `width === 0`.
- Setback: lower body 62% of height at full footprint, upper body 38% of height at 70% footprint. Rooftop block: 40% of footprint, constant `0.12` tall. Spire length 0.5 to 0.9, constant. `BEACON_RADIUS = 0.04`.
- Depth: `depth = width * (0.7 + 0.6 * seeded(seedBase + 300))`. Buildings stay axis-aligned.
- Candidate generation stays exactly as today (`minClear = ROAD_CLEARANCE + width / 2`, same seeds). Only the acceptance test gets stricter: `halfExtent = max(width, depth) / 2` for `clearsPath`, `clearsFootprints`, and the new `clearsCornerBlocks`.
- Beacon: red, linear luminance at least 2.0, on 0.2 s out of every 1.6 s with a per-building phase from `seeded`. On `tier === 'reduced'` it is always on. Hidden or inactive buildings never show a beacon.
- Instance color: layer color times `0.92 + 0.16 * seeded(...)`; equipment parts use `0x2a2a30`; the material color stays white.
- Every `InstancedMesh` sets `frustumCulled = false`.
- Counts key on `lowPower`, not on `tier === 'lite'`: `lowPower ? Math.round(count * 0.6) : count`.
- Building draw calls: at most 7 on `full`, 3 on `lowPower`.
- Dirty check: rewrite matrices only if `|heightScale - lastHeightScale| >= 1e-4` or `activeCount !== lastActiveCount`, where `activeCount = Math.round(density * buildings.length)`.
- `applyBuildingState` allocates nothing after creation (module-level `Matrix4`, `Vector3`, `Quaternion`, one `Float32Array` per layer).
- Code style: immutable data except the per-frame render-loop exception in `.claude/rules/common/coding-style.md`; files under 800 lines; functions under 50 lines; TDD for everything except Three.js visual output.

## Review Focus

1. **Density outside `[0, 1]` or on a rounding boundary.** `dampState` and `lerpPath` can overshoot by a hair. Expect no crash, no out-of-range `activeCount`, and no stale rows. Task 3 clamps `activeCount` and tests density `-1`, `1.5`, and a 2e-6 step across a rounding boundary.
2. **Height scale 0, hidden, or unplaced buildings.** Expect every part at scale 0 with finite matrix elements, and no spire or beacon on them. Tasks 2 and 3 test height 0, `width === 0`, and density 0.
3. **Fewer placed buildings than `SPIRE_COUNT`.** A small `lowPower` prefix or a crowded layer may place fewer than two. Expect fewer spires, not an exception. Task 2 tests `assignSpires` with 0 and 1 placed buildings.
4. **Non-square buildings beside the rotated set-pieces and the corner blocks.** Expect the whole rectangle clear of every footprint at all four headings and both corner blocks. Task 1 tests every footprint edge; Task 2 samples 25 points per accepted building across 500 seeds per layer.
5. **Context restore and reduced motion.** Expect identical pixels after `loseContext()` and `restoreContext()`, and identical frames for `reduced` at different times (static beacon). Tasks 3 and 5 test both.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `app/journey/random.ts` (new) | `seeded`. |
| `app/journey/footprints.ts` (new) | `FOOTPRINTS`, `CORNER_BLOCKS`, `clearsFootprints`, `clearsCornerBlocks`. |
| `app/journey/path.ts` (modify) | Exports `ROAD_HALF_WIDTH`. |
| `app/journey/buildings.ts` (new) | Archetypes, placement, part writers, layer creation, per-frame update. |
| `app/journey/post.ts` (modify) | `POST_EMISSIVES.beacon`. |
| `app/journey/facade-material.ts` (modify) | `aWindowed` gate. |
| `app/journey/scene.ts` (modify) | Remove moved code, wire layers. |
| `tests/journey/fixtures/building-positions.json` (new) | Golden positions from today's `placeBuilding`. |
| `tests/journey/random.test.ts`, `footprints.test.ts`, `buildings.test.ts`, `building-layer.test.ts` (new) | Unit tests. |
| `tests/journey/facade-material.test.ts` (modify) | `aWindowed` and culling-source assertions. |
| `tests/gpu/buildings-probe.ts`, `tests/gpu/buildings.spec.ts` (new) | Draw-call and restore checks. |
| `tests/gpu/harness.ts`, `facade-probe.ts`, `windows-probe.ts`, `facade.spec.ts` (modify) | Register the probe, add `aWindowed`, new counts. |

`scene.ts` identifiers below are named, not numbered, because step 3 (sky dome) edits the same file before this plan runs. Find each by name.

Working directory for every command: `repos/portfolio`.

---

### Task 1: Golden fixture, `random.ts`, `footprints.ts`

**Files:**
- Create: `tests/journey/fixtures/building-positions.json`, `app/journey/random.ts`, `app/journey/footprints.ts`
- Create: `tests/journey/random.test.ts`, `tests/journey/footprints.test.ts`
- Modify: `app/journey/path.ts`, `app/journey/scene.ts`

**Interfaces:**
- Produces: `seeded(index: number): number`; `ROAD_HALF_WIDTH: 3` (from `path.ts`); `FOOTPRINTS: readonly Footprint[]`; `CORNER_BLOCKS`; `clearsFootprints(x, z, halfExtent = 0): boolean`; `clearsCornerBlocks(x, z, halfExtent = 0): boolean`.

- [ ] **Step 1: Capture golden positions from today's `placeBuilding`**

Confirm `scene.ts` is clean, then temporarily export the two symbols the capture needs.

```bash
git status --short app/journey/scene.ts   # expect no output
sed -i '' 's/^const LAYERS = \[/export const LAYERS = [/; s/^function placeBuilding(/export function placeBuilding(/' app/journey/scene.ts
mkdir -p tests/journey/fixtures
```

Create `tests/journey/capture-golden.tmp.test.ts`:

```ts
import { writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { LAYERS, placeBuilding } from '../../app/journey/scene'

it('captures golden building positions', () => {
  const layers = LAYERS.map((config, layer) => ({
    layer,
    buildings: Array.from({ length: config.count }, (_, i) => {
      const placed = placeBuilding(layer * 1000 + i, config.sideSpread)
      return placed && { x: placed.x, z: placed.z, width: placed.width }
    }),
  }))
  writeFileSync('tests/journey/fixtures/building-positions.json', JSON.stringify({ layers }, null, 1))
})
```

- [ ] **Step 2: Run the capture, then undo the temporary edits**

Run: `npx vitest run tests/journey/capture-golden.tmp.test.ts`
Expected: PASS, and `tests/journey/fixtures/building-positions.json` exists with 3 layers of 24, 32, and 40 entries.

```bash
rm tests/journey/capture-golden.tmp.test.ts
git checkout -- app/journey/scene.ts
git status --short   # expect only the new fixture (plus the pre-existing unrelated entries)
```

- [ ] **Step 3: Write the failing tests**

`tests/journey/random.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { seeded } from '../../app/journey/random'

describe('seeded', () => {
  it('returns values in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const value = seeded(i)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('is deterministic and varies by index', () => {
    expect(seeded(7)).toBe(seeded(7))
    expect(seeded(7)).not.toBe(seeded(8))
    expect(seeded(0)).toBe(0)
  })
})
```

`tests/journey/footprints.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CORNER_BLOCKS, clearsCornerBlocks, clearsFootprints, FOOTPRINTS, type Footprint } from '../../app/journey/footprints'

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
```

- [ ] **Step 4: Run to verify they fail**

Run: `npx vitest run tests/journey/random.test.ts tests/journey/footprints.test.ts`
Expected: FAIL, "Failed to resolve import" for `random` and `footprints`.

- [ ] **Step 5: Implement the modules**

`app/journey/random.ts`:

```ts
// Deterministic pseudo-random in [0, 1), seeded by index so layout is stable across renders.
export function seeded(index: number): number {
  const x = Math.sin(index * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
```

`app/journey/footprints.ts`:

```ts
import { headingFor, PATH_SEGMENTS, type PathSegment, PLACES } from './path'

// Axis-aligned-in-its-own-frame footprint for a set-piece: keeps generic
// background buildings (and corner-blocking props) from landing inside it.
// `heading` must match the rotation the piece was placed with.
export interface Footprint {
  x: number
  z: number
  heading: number
  halfX: number
  halfZ: number
}

function segmentAt(index: number): PathSegment {
  const segment = PATH_SEGMENTS[index]
  if (!segment) throw new Error(`expected path segment ${index}`)
  return segment
}

const seg1 = segmentAt(0)
const seg2 = segmentAt(1)
const seg3 = segmentAt(2)

export const FOOTPRINTS: readonly Footprint[] = [
  { x: PLACES.entrance.x, z: PLACES.entrance.z, heading: headingFor(seg1.dirX, seg1.dirZ), halfX: 4, halfZ: 1.2 },
  // halfZ covers HALL_MAX_LENGTH / 2 + margin, not just the base length, so
  // background scenery stays clear even when the hall grows for more projects.
  { x: PLACES.hall.x, z: PLACES.hall.z, heading: headingFor(seg1.dirX, seg1.dirZ), halfX: 4.5, halfZ: 10.5 },
  { x: PLACES.market.x, z: PLACES.market.z, heading: headingFor(seg2.dirX, seg2.dirZ), halfX: 7.5, halfZ: 6.5 },
  { x: PLACES.courtyard.x, z: PLACES.courtyard.z, heading: headingFor(seg3.dirX, seg3.dirZ), halfX: 4.5, halfZ: 5 },
]

// `halfExtent` grows each footprint on both local axes, so a building whose
// center passes also keeps its whole axis-aligned rectangle clear. Footprint
// headings are multiples of 90 degrees, so this is exact, not just conservative.
export function clearsFootprints(x: number, z: number, halfExtent = 0): boolean {
  for (const fp of FOOTPRINTS) {
    const dx = x - fp.x
    const dz = z - fp.z
    const cos = Math.cos(fp.heading)
    const sin = Math.sin(fp.heading)
    const lx = dx * cos - dz * sin
    const lz = dx * sin + dz * cos
    if (Math.abs(lx) <= fp.halfX + halfExtent && Math.abs(lz) <= fp.halfZ + halfExtent) return false
  }
  return true
}

// Two tall solid blocks, one tucked into each turn's inside corner, so the
// wide-open sightline from the entrance can't see straight through both
// turns to the market and courtyard. Always present, not tied to density.
export const CORNER_BLOCKS = [
  { x: -4.2, z: -22, width: 3, depth: 3, height: 5 },
  { x: -22, z: -30, width: 3, depth: 3, height: 5 },
] as const

export function clearsCornerBlocks(x: number, z: number, halfExtent = 0): boolean {
  return CORNER_BLOCKS.every(block =>
    Math.abs(x - block.x) > block.width / 2 + halfExtent || Math.abs(z - block.z) > block.depth / 2 + halfExtent)
}
```

In `app/journey/path.ts`, add above `PLACES`:

```ts
export const ROAD_HALF_WIDTH = 3
```

- [ ] **Step 6: Point `scene.ts` at the moved code**

In `scene.ts`:
1. Import `{ seeded } from './random'`, `{ CORNER_BLOCKS } from './footprints'`, and add `ROAD_HALF_WIDTH` to the existing `./path` import.
2. Delete the local `const ROAD_HALF_WIDTH = 3` line.
3. Delete the `interface Footprint` block (with its comment), the `FOOTPRINTS` array, `clearsFootprints`, the `CORNER_BLOCKS` constant (with its comment), and `seeded`.
4. Keep `seg1`, `seg2`, `seg3` (placeOnPath still uses them) and `ROAD_CLEARANCE`, `LAYERS`, `placeBuilding` (Task 4 removes those).
5. `placeBuilding` still calls `clearsFootprints(x, z)`; add `import { clearsFootprints } from './footprints'` so it compiles.

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test`
Expected: PASS (all existing tests plus the new ones).

- [ ] **Step 8: Commit**

```bash
git add tests/journey app/journey/random.ts app/journey/footprints.ts app/journey/path.ts app/journey/scene.ts
git commit -m "refactor: extract seeded and footprints from journey scene"
```

---

### Task 2: Archetypes, placement, and part writers (pure)

**Files:**
- Create: `app/journey/buildings.ts` (pure half), `tests/journey/buildings.test.ts`
- Modify: none

**Interfaces:**
- Consumes: `seeded`, `clearsFootprints`, `clearsCornerBlocks`, `clearsPath`, `pathPointAt`, `PATH_TOTAL_LENGTH`, `ROAD_HALF_WIDTH`.
- Produces (all exported from `app/journey/buildings.ts`):
  - Constants: `ROAD_CLEARANCE`, `BASE_Y = -1`, `PLACEMENT_ATTEMPTS = 6`, `LAYERS`, `SPIRE_COUNTS`, `BLOCK_HEIGHT = 0.12`, `SPIRE_WIDTH = 0.1`, `BEACON_RADIUS = 0.04`, `BEACON_PERIOD = 1.6`, `BEACON_ON_TIME = 0.2`, `PART_STRIDE = 7`, `PART_KIND_BODY = 0`, `PART_KIND_EQUIPMENT = 1`.
  - Types: `Archetype`, `Building`, `Placement`, `PartRange`, `PartTransform`.
  - `HIDDEN_BUILDING: Building`.
  - `rollArchetype(seed: number, layerIndex: number): Exclude<Archetype, 'spire'>`.
  - `placeBuilding(seedBase: number, sideSpread: number): Placement | null`.
  - `assignSpires(buildings: readonly Building[], spireCount: number): Building[]`.
  - `createBuildings(layerIndex: number, count: number, spireCount: number): Building[]`.
  - `partRangesFor(buildings: readonly Building[]): { ranges: PartRange[], total: number }`.
  - `writeBoxParts(out: Float32Array, offset: number, building: Building, archetype: Archetype, height: number): number`.
  - `writeSpirePart(out, offset, building, height, length): void`; `writeBeaconPart(out, offset, building, height, length, on: boolean): void`.
  - `boxPartsFor(building, archetype, height): PartTransform[]`.
  - `beaconIsOn(phase: number, time: number, steady: boolean): boolean`.

- [ ] **Step 1: Write the failing tests**

`tests/journey/buildings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/journey/buildings.test.ts`
Expected: FAIL, "Failed to resolve import ../../app/journey/buildings".

- [ ] **Step 3: Implement the pure half of `buildings.ts`**

Create `app/journey/buildings.ts`:

```ts
import { clearsCornerBlocks, clearsFootprints } from './footprints'
import { clearsPath, PATH_TOTAL_LENGTH, pathPointAt, ROAD_HALF_WIDTH } from './path'
import { seeded } from './random'

export const ROAD_CLEARANCE = ROAD_HALF_WIDTH + 0.3
export const BASE_Y = -1
export const PLACEMENT_ATTEMPTS = 6

// Generic background skyline, spread across the whole path as fill between the
// set-pieces rather than clustered at one depth. Each band has its own base
// clearance from the path so near/mid/far read as layered, not piled at the curb.
// `buildingDensity` scales how many of each band's baked instances are visible.
export const LAYERS = [
  { count: 24, sideSpread: 9, baseHeight: 1.4, color: 0x1f2438 },
  { count: 32, sideSpread: 13, baseHeight: 2.2, color: 0x2a2f4a },
  { count: 40, sideSpread: 18, baseHeight: 3.2, color: 0x353b5c },
] as const

export const SPIRE_COUNTS = [2, 2, 0] as const

const SETBACK_SPLIT = 0.62
const SETBACK_UPPER_FOOTPRINT = 0.7
const BLOCK_FOOTPRINT = 0.4
export const BLOCK_HEIGHT = 0.12
export const SPIRE_WIDTH = 0.1
export const BEACON_RADIUS = 0.04
export const BEACON_PERIOD = 1.6
export const BEACON_ON_TIME = 0.2
export const PART_STRIDE = 7
export const PART_KIND_BODY = 0
export const PART_KIND_EQUIPMENT = 1

export type Archetype = 'slab' | 'setback' | 'crowned' | 'spire'
type RolledArchetype = Exclude<Archetype, 'spire'>

const NEAR_WEIGHTS = [33, 33, 34] as const
const MID_WEIGHTS = [55, 30, 15] as const
const FAR_WEIGHTS = [70, 25, 5] as const
const ARCHETYPE_WEIGHTS = [NEAR_WEIGHTS, MID_WEIGHTS, FAR_WEIGHTS] as const

export interface Building {
  readonly x: number
  readonly z: number
  readonly width: number
  readonly depth: number
  readonly baseHeight: number
  readonly archetype: Archetype
  readonly spireLength: number
  readonly blinkPhase: number
}

export interface Placement {
  x: number
  z: number
  width: number
  depth: number
}

export interface PartRange {
  start: number
  count: number
}

export interface PartTransform {
  kind: 'body' | 'equipment'
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
}

// A building with no clear spot stays hidden for good (`width === 0`).
export const HIDDEN_BUILDING: Building = {
  x: 0, z: 0, width: 0, depth: 0, baseHeight: 0, archetype: 'slab', spireLength: 0, blinkPhase: 0,
}

const BOX_PART_COUNT: Record<Archetype, number> = { slab: 1, setback: 2, crowned: 2, spire: 2 }

export function rollArchetype(seed: number, layerIndex: number): RolledArchetype {
  const weights = ARCHETYPE_WEIGHTS[layerIndex] ?? FAR_WEIGHTS
  const roll = seeded(seed) * 100
  if (roll < weights[0]) return 'slab'
  if (roll < weights[0] + weights[1]) return 'setback'
  return 'crowned'
}

// Picks a point off to one side of the path that is clear of every road
// segment, set-piece footprint, and corner block for the building's whole
// axis-aligned rectangle. Candidates are generated exactly as before the
// footprint change; only the acceptance test is stricter. Tries a handful of
// seeded candidates and gives up (returns null, hidden off-scene) if none clear.
export function placeBuilding(seedBase: number, sideSpread: number): Placement | null {
  const width = 0.5 + seeded(seedBase + 100) * 0.6
  const depth = width * (0.7 + 0.6 * seeded(seedBase + 300))
  const minClear = ROAD_CLEARANCE + width / 2
  const halfExtent = Math.max(width, depth) / 2
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const s = seedBase + attempt * 977
    const distance = seeded(s + 400) * PATH_TOTAL_LENGTH
    const point = pathPointAt(distance)
    const half = Math.max(sideSpread / 2, minClear + 1)
    const side = seeded(s) < 0.5 ? -1 : 1
    const offset = side * (minClear + seeded(s + 1000) * (half - minClear))
    const x = point.x + point.rightX * offset
    const z = point.z + point.rightZ * offset
    if (clearsPath(x, z, ROAD_CLEARANCE + halfExtent) && clearsFootprints(x, z, halfExtent)
      && clearsCornerBlocks(x, z, halfExtent)) {
      return { x, z, width, depth }
    }
  }
  return null
}

// The `spireCount` tallest placed buildings become spires, so they read as
// landmarks in every seed. Ties go to the lower index.
export function assignSpires(buildings: readonly Building[], spireCount: number): Building[] {
  const chosen = new Set(
    buildings
      .map((building, index) => ({ building, index }))
      .filter(({ building }) => building.width > 0)
      .sort((a, b) => b.building.baseHeight - a.building.baseHeight || a.index - b.index)
      .slice(0, spireCount)
      .map(({ index }) => index),
  )
  return buildings.map((building, index): Building => (chosen.has(index) ? { ...building, archetype: 'spire' } : building))
}

export function createBuildings(layerIndex: number, count: number, spireCount: number): Building[] {
  const config = LAYERS[layerIndex]
  if (!config) throw new Error(`unknown building layer ${layerIndex}`)
  const seedBase = layerIndex * 1000
  const rolled = Array.from({ length: count }, (_, i): Building => {
    const placement = placeBuilding(seedBase + i, config.sideSpread)
    if (!placement) return HIDDEN_BUILDING
    return {
      ...placement,
      baseHeight: config.baseHeight * (0.5 + seeded(seedBase + i + 200)),
      archetype: rollArchetype(seedBase + i + 500, layerIndex),
      spireLength: 0.5 + 0.4 * seeded(seedBase + i + 600),
      blinkPhase: seeded(seedBase + i + 700),
    }
  })
  return assignSpires(rolled, spireCount)
}

export function partRangesFor(buildings: readonly Building[]): { ranges: PartRange[], total: number } {
  let total = 0
  const ranges = buildings.map((building): PartRange => {
    const count = BOX_PART_COUNT[building.archetype]
    const range = { start: total, count }
    total += count
    return range
  })
  return { ranges, total }
}

function writePart(
  out: Float32Array, offset: number, kind: number,
  x: number, y: number, z: number, sx: number, sy: number, sz: number,
): void {
  out[offset] = kind
  out[offset + 1] = x
  out[offset + 2] = y
  out[offset + 3] = z
  out[offset + 4] = sx
  out[offset + 5] = sy
  out[offset + 6] = sz
}

// A part is hidden (scale 0) when the building has no height or was never placed.
function isVisible(building: Building, height: number): boolean {
  return height > 0 && building.width > 0
}

// Writes the box parts (bodies and rooftop block) of one building as
// `PART_STRIDE` floats each: kind, x, y, z, sx, sy, sz. Returns the part count.
// Allocation-free: the per-frame path calls this with a reused buffer.
export function writeBoxParts(
  out: Float32Array, offset: number, building: Building, archetype: Archetype, height: number,
): number {
  const visible = isVisible(building, height)
  const h = visible ? height : 0
  const w = visible ? building.width : 0
  const d = visible ? building.depth : 0
  const { x, z } = building
  if (archetype === 'slab') {
    writePart(out, offset, PART_KIND_BODY, x, BASE_Y + h / 2, z, w, h, d)
    return 1
  }
  if (archetype === 'setback') {
    const lower = h * SETBACK_SPLIT
    const upper = h - lower
    writePart(out, offset, PART_KIND_BODY, x, BASE_Y + lower / 2, z, w, lower, d)
    writePart(out, offset + PART_STRIDE, PART_KIND_BODY, x, BASE_Y + lower + upper / 2, z,
      w * SETBACK_UPPER_FOOTPRINT, upper, d * SETBACK_UPPER_FOOTPRINT)
    return 2
  }
  const block = visible ? BLOCK_HEIGHT : 0
  writePart(out, offset, PART_KIND_BODY, x, BASE_Y + h / 2, z, w, h, d)
  writePart(out, offset + PART_STRIDE, PART_KIND_EQUIPMENT, x, BASE_Y + h + block / 2, z,
    w * BLOCK_FOOTPRINT, block, d * BLOCK_FOOTPRINT)
  return 2
}

// The spire cone has its bottom on top of the rooftop block. The cone geometry
// is centered on its origin, so the center sits half a length above the block.
export function writeSpirePart(
  out: Float32Array, offset: number, building: Building, height: number, length: number,
): void {
  const visible = isVisible(building, height)
  const blockTop = BASE_Y + height + BLOCK_HEIGHT
  writePart(out, offset, PART_KIND_EQUIPMENT, building.x, blockTop + length / 2, building.z,
    visible ? SPIRE_WIDTH : 0, visible ? length : 0, visible ? SPIRE_WIDTH : 0)
}

// The beacon is a unit sphere scaled to BEACON_RADIUS, centered on the spire tip.
export function writeBeaconPart(
  out: Float32Array, offset: number, building: Building, height: number, length: number, on: boolean,
): void {
  const scale = on && isVisible(building, height) ? BEACON_RADIUS : 0
  writePart(out, offset, PART_KIND_EQUIPMENT, building.x, BASE_Y + height + BLOCK_HEIGHT + length, building.z,
    scale, scale, scale)
}

// Test helper: the same numbers as `writeBoxParts`, as objects.
export function boxPartsFor(building: Building, archetype: Archetype, height: number): PartTransform[] {
  const out = new Float32Array(PART_STRIDE * 2)
  const count = writeBoxParts(out, 0, building, archetype, height)
  return Array.from({ length: count }, (_, p) => {
    const o = p * PART_STRIDE
    return {
      kind: out[o] === PART_KIND_BODY ? 'body' : 'equipment',
      x: out[o + 1] ?? 0, y: out[o + 2] ?? 0, z: out[o + 3] ?? 0,
      sx: out[o + 4] ?? 0, sy: out[o + 5] ?? 0, sz: out[o + 6] ?? 0,
    }
  })
}

// On for BEACON_ON_TIME out of every BEACON_PERIOD seconds, shifted by the
// building's phase in [0, 1). `steady` (reduced motion) keeps it on.
export function beaconIsOn(phase: number, time: number, steady: boolean): boolean {
  if (steady) return true
  const cycle = (((time / BEACON_PERIOD + phase) % 1) + 1) % 1
  return cycle * BEACON_PERIOD < BEACON_ON_TIME
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/journey/buildings.test.ts`
Expected: PASS.

If `layer N: 500 seeds ...` fails only on `hidden / 500`, raise `PLACEMENT_ATTEMPTS` to 8 (spec, Risks section) and rerun. The golden test still holds because extra attempts only help buildings that failed all of the first six. If it fails on `violations`, the acceptance test has a bug; fix it, do not loosen the test.

- [ ] **Step 5: Commit**

```bash
git add app/journey/buildings.ts tests/journey/buildings.test.ts
git commit -m "feat: building archetypes, strict placement, and part writers"
```

---

### Task 3: Layer creation and the dirty-checked update

**Files:**
- Modify: `app/journey/buildings.ts` (add the Three.js half), `app/journey/post.ts`
- Create: `tests/journey/building-layer.test.ts`

**Interfaces:**
- Consumes: everything from Task 2; `createFacadeMaterial`, `FacadeUniforms` (`facade-material.ts`); `POST_EMISSIVES` (`post.ts`).
- Produces:
  - `POST_EMISSIVES.beacon = { hex: 0xff2a20, gain: 9.2 }`.
  - `interface BuildingLayer { boxMesh; spireMesh | null; beaconMesh | null; buildings; partRanges; spireBuildingIndices; scratch; lastHeightScale; lastActiveCount; lastBeaconMask }`.
  - `createBuildingLayer(layerIndex: number, options: { lowPower: boolean, facade: FacadeUniforms }): BuildingLayer`.
  - `applyBuildingState(layer: BuildingLayer, heightScale: number, density: number, time: number, steadyBeacon: boolean): void`.
  - `layerMeshes(layer: BuildingLayer): THREE.InstancedMesh[]`.
  - `boxMesh.userData.buildingCount: number` (building count, not part count).

- [ ] **Step 1: Write the failing tests**

`tests/journey/building-layer.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  applyBuildingState, BEACON_PERIOD, BEACON_RADIUS, type BuildingLayer, createBuildingLayer, layerMeshes, LAYERS,
} from '../../app/journey/buildings'
import type { FacadeUniforms } from '../../app/journey/facade-material'

const facade = (): FacadeUniforms => ({
  uLit: { value: 0 }, uSkyTint: { value: new THREE.Color() }, uTime: { value: 0 },
  uFlicker: { value: 0 }, uEmissiveScale: { value: 1 },
})
const layerFor = (index: number, lowPower = false): BuildingLayer =>
  createBuildingLayer(index, { lowPower, facade: facade() })
const run = (layer: BuildingLayer, o: { height?: number, density?: number, time?: number, steady?: boolean } = {}) =>
  applyBuildingState(layer, o.height ?? 1, o.density ?? 1, o.time ?? 0, o.steady ?? false)

const matrix = new THREE.Matrix4()
function scaleAt(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixScale(matrix)
}
// A time at which a building with `phase` sits at `cycle` of its 1.6 s blink cycle.
const timeAtCycle = (phase: number, cycle: number) => ((((cycle - phase) % 1) + 1) % 1) * BEACON_PERIOD

describe('createBuildingLayer', () => {
  it('builds the part-instanced box mesh with per-part attributes', () => {
    const layer = layerFor(0)
    const { boxMesh } = layer
    const total = layer.partRanges.reduce((sum, r) => sum + r.count, 0)
    expect(boxMesh.count).toBe(total)
    expect(boxMesh.userData.buildingCount).toBe(LAYERS[0].count)
    expect(boxMesh.frustumCulled).toBe(false)
    expect(boxMesh.name).toBe('journey-building-near')
    expect(boxMesh.geometry.getAttribute('aSeed').count).toBe(total)
    expect(boxMesh.geometry.getAttribute('aWindowed').count).toBe(total)
    expect((boxMesh.material as THREE.Material).name).toBe('journey-facade-full')
  })

  it('marks bodies windowed and rooftop blocks not, and shares one seed per building', () => {
    const layer = layerFor(1)
    const windowed = layer.boxMesh.geometry.getAttribute('aWindowed')
    const seeds = layer.boxMesh.geometry.getAttribute('aSeed')
    layer.buildings.forEach((building, i) => {
      const { start, count } = layer.partRanges[i]!
      const equipment = building.archetype === 'crowned' || building.archetype === 'spire'
      for (let p = 0; p < count; p++) {
        expect(windowed.getX(start + p)).toBe(equipment && p === 1 ? 0 : 1)
        expect(seeds.getX(start + p)).toBe(seeds.getX(start))
      }
    })
  })

  it('tints bodies within 8% of the layer color and equipment dark gray', () => {
    const layer = layerFor(0)
    const base = new THREE.Color(LAYERS[0].color)
    const equipment = new THREE.Color(0x2a2a30)
    const color = new THREE.Color()
    let sawEquipment = false
    layer.buildings.forEach((building, i) => {
      const { start, count } = layer.partRanges[i]!
      for (let p = 0; p < count; p++) {
        layer.boxMesh.getColorAt(start + p, color)
        const isEquipment = (building.archetype === 'crowned' || building.archetype === 'spire') && p === 1
        if (isEquipment) {
          sawEquipment = true
          expect(color.r).toBeCloseTo(equipment.r, 5)
        } else {
          expect(color.r / base.r).toBeGreaterThanOrEqual(0.92 - 1e-4)
          expect(color.r / base.r).toBeLessThanOrEqual(1.08 + 1e-4)
        }
      }
    })
    expect(sawEquipment).toBe(true)
    expect((layer.boxMesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xffffff)
  })

  it('creates spire and beacon meshes only where the layer has spires', () => {
    const [near, mid, far] = [0, 1, 2].map(i => layerFor(i))
    for (const layer of [near!, mid!]) {
      expect(layer.spireBuildingIndices).toHaveLength(2)
      expect(layer.spireMesh?.count).toBe(2)
      expect(layer.beaconMesh?.count).toBe(2)
      expect(layer.spireMesh?.frustumCulled).toBe(false)
      expect(layer.beaconMesh?.frustumCulled).toBe(false)
    }
    expect(far!.spireMesh).toBeNull()
    expect(far!.beaconMesh).toBeNull()
    expect(layerMeshes(near!)).toHaveLength(3)
    expect(layerMeshes(far!)).toHaveLength(1)
  })

  it('uses 60% counts and no spires on lowPower', () => {
    LAYERS.forEach((config, index) => {
      const layer = layerFor(index, true)
      expect(layer.buildings).toHaveLength(Math.round(config.count * 0.6))
      expect(layer.spireMesh).toBeNull()
      expect(layer.beaconMesh).toBeNull()
      expect(layer.buildings.some(b => b.archetype === 'spire')).toBe(false)
      expect((layer.boxMesh.material as THREE.Material).name).toBe('journey-facade-lite')
    })
  })

  it('makes the beacon material emissive above the bloom threshold', () => {
    const material = layerFor(0).beaconMesh!.material
    expect(0.2126 * material.color.r + 0.7152 * material.color.g + 0.0722 * material.color.b).toBeGreaterThanOrEqual(2)
  })
})

describe('applyBuildingState', () => {
  it('rewrites matrices once for an unchanged state', () => {
    const layer = layerFor(0)
    run(layer, { density: 0.5 })
    const version = layer.boxMesh.instanceMatrix.version
    run(layer, { density: 0.5 })
    run(layer, { density: 0.5 })
    expect(layer.boxMesh.instanceMatrix.version).toBe(version)
  })

  it('rewrites when activeCount crosses a rounding boundary by less than 1e-4 in density', () => {
    const layer = layerFor(0)
    const boundary = 12.5 / layer.buildings.length
    run(layer, { density: boundary - 1e-6 })
    const version = layer.boxMesh.instanceMatrix.version
    run(layer, { density: boundary + 1e-6 })
    expect(layer.boxMesh.instanceMatrix.version).toBeGreaterThan(version)
  })

  it('skips a height change under 1e-4 with the same count and rewrites at 1e-4 or more', () => {
    const layer = layerFor(0)
    run(layer, { height: 1 })
    const version = layer.boxMesh.instanceMatrix.version
    run(layer, { height: 1 + 5e-5 })
    expect(layer.boxMesh.instanceMatrix.version).toBe(version)
    run(layer, { height: 1 + 2e-4 })
    expect(layer.boxMesh.instanceMatrix.version).toBeGreaterThan(version)
  })

  it('clamps density outside [0, 1]', () => {
    const layer = layerFor(0)
    run(layer, { density: 1.5 })
    expect(layer.lastActiveCount).toBe(layer.buildings.length)
    run(layer, { density: -1 })
    expect(layer.lastActiveCount).toBe(0)
    for (let i = 0; i < layer.boxMesh.count; i++) expect(scaleAt(layer.boxMesh, i).length()).toBe(0)
  })

  it('writes finite zero-scale matrices at height 0', () => {
    const layer = layerFor(0)
    run(layer, { height: 0 })
    for (const mesh of layerMeshes(layer)) {
      expect(Array.from(mesh.instanceMatrix.array).every(Number.isFinite)).toBe(true)
      for (let i = 0; i < mesh.count; i++) expect(scaleAt(mesh, i).length()).toBe(0)
    }
  })

  it('shows only active, placed buildings and hides the rest', () => {
    const layer = layerFor(0)
    const density = 0.5
    run(layer, { density })
    const active = Math.round(density * layer.buildings.length)
    layer.buildings.forEach((building, i) => {
      const { start, count } = layer.partRanges[i]!
      const shown = i < active && building.width > 0
      for (let p = 0; p < count; p++) {
        expect(scaleAt(layer.boxMesh, start + p).length() > 0).toBe(shown)
      }
    })
  })

  it('keeps rooftop equipment at constant size while height animates', () => {
    const layer = layerFor(0)
    const index = layer.buildings.findIndex(b => b.archetype === 'crowned' && b.width > 0)
    expect(index).toBeGreaterThanOrEqual(0)
    const blockIndex = layer.partRanges[index]!.start + 1
    run(layer, { height: 0.6 })
    const small = scaleAt(layer.boxMesh, blockIndex)
    run(layer, { height: 1.2 })
    const tall = scaleAt(layer.boxMesh, blockIndex)
    expect(tall.toArray()).toEqual(small.toArray())
  })

  describe('beacons', () => {
    const beaconScale = (layer: BuildingLayer, k: number) => scaleAt(layer.beaconMesh!, k).x

    it('is zero for an inactive building in both blink phases', () => {
      const layer = layerFor(0)
      const bi = layer.spireBuildingIndices[0]!
      const phase = layer.buildings[bi]!.blinkPhase
      const density = bi / layer.buildings.length
      for (const time of [timeAtCycle(phase, 0.05), timeAtCycle(phase, 0.5)]) {
        run(layer, { density, time })
        expect(beaconScale(layer, 0)).toBe(0)
      }
    })

    it('is BEACON_RADIUS or 0 by blink phase for an active building', () => {
      const layer = layerFor(0)
      const phase = layer.buildings[layer.spireBuildingIndices[0]!]!.blinkPhase
      run(layer, { time: timeAtCycle(phase, 0.05) })
      expect(beaconScale(layer, 0)).toBeCloseTo(BEACON_RADIUS, 6)
      run(layer, { time: timeAtCycle(phase, 0.5) })
      expect(beaconScale(layer, 0)).toBe(0)
    })

    it('follows the roof while height animates', () => {
      const layer = layerFor(0)
      run(layer, { height: 0.6, steady: true })
      layer.beaconMesh!.getMatrixAt(0, matrix)
      const low = new THREE.Vector3().setFromMatrixPosition(matrix).y
      run(layer, { height: 1.2, steady: true })
      layer.beaconMesh!.getMatrixAt(0, matrix)
      expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeGreaterThan(low)
    })

    it('writes the beacon mesh only when the on/off state changes', () => {
      const layer = layerFor(0)
      const phase = layer.buildings[layer.spireBuildingIndices[0]!]!.blinkPhase
      run(layer, { time: timeAtCycle(phase, 0.05) })
      const version = layer.beaconMesh!.instanceMatrix.version
      run(layer, { time: timeAtCycle(phase, 0.06) })
      expect(layer.beaconMesh!.instanceMatrix.version).toBe(version)
    })

    it('ignores time when steady (reduced motion)', () => {
      const layer = layerFor(0)
      run(layer, { time: 0, steady: true })
      const versions = layerMeshes(layer).map(mesh => mesh.instanceMatrix.version)
      run(layer, { time: 0.9, steady: true })
      run(layer, { time: 33.3, steady: true })
      expect(layerMeshes(layer).map(mesh => mesh.instanceMatrix.version)).toEqual(versions)
      expect(beaconScale(layer, 0)).toBeCloseTo(BEACON_RADIUS, 6)
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/journey/building-layer.test.ts`
Expected: FAIL, `createBuildingLayer` is not exported.

- [ ] **Step 3: Add the beacon emissive**

In `app/journey/post.ts`, extend `POST_EMISSIVES`:

```ts
export const POST_EMISSIVES = {
  lamp: { hex: 0xffdca8, gain: 2.8 },
  courtyard: { hex: 0xffe1a8, gain: 2.7 },
  // Linear luminance of 0xff2a20 is 0.230, so gain 9.2 gives 2.12 before fog.
  beacon: { hex: 0xff2a20, gain: 9.2 },
} as const
```

`tests/journey/post.test.ts` already loops over `Object.values(POST_EMISSIVES)` and asserts luminance of at least 2, so it covers the new entry. Do not add the beacon to `ownedLuminance` in `tests/gpu/post-probe.ts`; `post.spec.ts` asserts that list has length 2.

- [ ] **Step 4: Implement the Three.js half of `buildings.ts`**

Add at the top of `app/journey/buildings.ts`:

```ts
import * as THREE from 'three'
import { createFacadeMaterial, type FacadeUniforms } from './facade-material'
import { POST_EMISSIVES } from './post'
```

Append to `app/journey/buildings.ts`:

```ts
const EQUIPMENT_COLOR = 0x2a2a30
const LOW_POWER_SCALE = 0.6
const MAX_BOX_PARTS = 2
const HEIGHT_EPSILON = 1e-4
const HIDDEN_Y = -100
const LAYER_NAMES = ['journey-building-near', 'journey-building-mid', 'journey-building-far'] as const

export interface BuildingLayer {
  readonly boxMesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
  readonly spireMesh: THREE.InstancedMesh<THREE.ConeGeometry, THREE.MeshStandardMaterial> | null
  readonly beaconMesh: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null
  readonly buildings: readonly Building[]
  readonly partRanges: readonly PartRange[]
  readonly spireBuildingIndices: readonly number[]
  readonly scratch: Float32Array
  // Mutable per-frame cursors for the dirty check (render-loop exception to the immutability rule).
  lastHeightScale: number
  lastActiveCount: number
  lastBeaconMask: number
}

export interface BuildingLayerOptions {
  lowPower: boolean
  facade: FacadeUniforms
}

function createInstancedMesh<G extends THREE.BufferGeometry, M extends THREE.Material>(
  geometry: G, material: M, count: number, name: string,
): THREE.InstancedMesh<G, M> {
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.name = name
  // r186 caches the instanced bounding sphere at first render, and setMatrixAt does not invalidate it.
  mesh.frustumCulled = false
  return mesh
}

export function createBuildingLayer(layerIndex: number, options: BuildingLayerOptions): BuildingLayer {
  const config = LAYERS[layerIndex]
  if (!config) throw new Error(`unknown building layer ${layerIndex}`)
  const { lowPower, facade } = options
  const count = lowPower ? Math.round(config.count * LOW_POWER_SCALE) : config.count
  const buildings = createBuildings(layerIndex, count, lowPower ? 0 : (SPIRE_COUNTS[layerIndex] ?? 0))
  const { ranges, total } = partRangesFor(buildings)
  const name = LAYER_NAMES[layerIndex] ?? `journey-building-${layerIndex}`

  const scratch = new Float32Array(PART_STRIDE * MAX_BOX_PARTS)
  const seeds = new Float32Array(total)
  const windowed = new Float32Array(total)
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))
  geometry.setAttribute('aWindowed', new THREE.InstancedBufferAttribute(windowed, 1))
  const material = createFacadeMaterial({ color: 0xffffff, uniforms: facade, variant: lowPower ? 'lite' : 'full' })
  const boxMesh = createInstancedMesh(geometry, material, total, name)
  boxMesh.userData.buildingCount = count

  const baseColor = new THREE.Color(config.color)
  const equipmentColor = new THREE.Color(EQUIPMENT_COLOR)
  const tint = new THREE.Color()
  const seedBase = layerIndex * 1000
  for (let i = 0; i < buildings.length; i++) {
    const building = buildings[i]
    const range = ranges[i]
    if (!building || !range) continue
    const parts = writeBoxParts(scratch, 0, building, building.archetype, 1)
    const bodyTint = 0.92 + 0.16 * seeded(seedBase + i + 800)
    for (let p = 0; p < parts; p++) {
      const isBody = scratch[p * PART_STRIDE] === PART_KIND_BODY
      seeds[range.start + p] = seeded(seedBase + i)
      windowed[range.start + p] = isBody ? 1 : 0
      boxMesh.setColorAt(range.start + p, isBody ? tint.copy(baseColor).multiplyScalar(bodyTint) : equipmentColor)
    }
  }
  if (boxMesh.instanceColor) boxMesh.instanceColor.needsUpdate = true

  const spireBuildingIndices = buildings.flatMap((building, i) => (building.archetype === 'spire' ? [i] : []))
  const spireMesh = spireBuildingIndices.length === 0 ? null : createInstancedMesh(
    new THREE.ConeGeometry(0.5, 1, 5),
    new THREE.MeshStandardMaterial({ color: EQUIPMENT_COLOR, roughness: 0.7 }),
    spireBuildingIndices.length, `${name}-spire`)
  let beaconMesh: BuildingLayer['beaconMesh'] = null
  if (spireBuildingIndices.length > 0) {
    const beaconMaterial = new THREE.MeshBasicMaterial({ color: POST_EMISSIVES.beacon.hex })
    beaconMaterial.name = 'journey-beacon'
    beaconMaterial.color.multiplyScalar(POST_EMISSIVES.beacon.gain)
    beaconMesh = createInstancedMesh(new THREE.SphereGeometry(1, 8, 6), beaconMaterial,
      spireBuildingIndices.length, `${name}-beacon`)
  }

  return {
    boxMesh, spireMesh, beaconMesh, buildings, partRanges: ranges, spireBuildingIndices, scratch,
    lastHeightScale: Number.POSITIVE_INFINITY, lastActiveCount: -1, lastBeaconMask: -1,
  }
}

export function layerMeshes(layer: BuildingLayer): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [layer.boxMesh]
  if (layer.spireMesh) meshes.push(layer.spireMesh)
  if (layer.beaconMesh) meshes.push(layer.beaconMesh)
  return meshes
}

// Module-level scratch objects: the per-frame update allocates nothing.
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const noRotation = new THREE.Quaternion()

function read(array: Float32Array, index: number): number {
  return array[index] ?? 0
}

function setPartMatrix(mesh: THREE.InstancedMesh, index: number, scratch: Float32Array, base: number): void {
  position.set(read(scratch, base + 1), read(scratch, base + 2), read(scratch, base + 3))
  scale.set(read(scratch, base + 4), read(scratch, base + 5), read(scratch, base + 6))
  matrix.compose(position, noRotation, scale)
  mesh.setMatrixAt(index, matrix)
}

function setHiddenMatrix(mesh: THREE.InstancedMesh, index: number, building: Building): void {
  position.set(building.x, HIDDEN_Y, building.z)
  scale.set(0, 0, 0)
  matrix.compose(position, noRotation, scale)
  mesh.setMatrixAt(index, matrix)
}

function isActive(building: Building, index: number, activeCount: number): boolean {
  return index < activeCount && building.width > 0
}

function writeBodies(layer: BuildingLayer, heightScale: number, activeCount: number): void {
  const { buildings, partRanges, scratch, boxMesh, spireMesh, spireBuildingIndices } = layer
  for (let i = 0; i < buildings.length; i++) {
    const building = buildings[i]
    const range = partRanges[i]
    if (!building || !range) continue
    if (isActive(building, i, activeCount)) {
      const written = writeBoxParts(scratch, 0, building, building.archetype, building.baseHeight * heightScale)
      for (let p = 0; p < written; p++) setPartMatrix(boxMesh, range.start + p, scratch, p * PART_STRIDE)
    } else {
      for (let p = 0; p < range.count; p++) setHiddenMatrix(boxMesh, range.start + p, building)
    }
  }
  boxMesh.instanceMatrix.needsUpdate = true
  if (!spireMesh) return
  for (let k = 0; k < spireBuildingIndices.length; k++) {
    const index = spireBuildingIndices[k] ?? 0
    const building = buildings[index]
    if (!building) continue
    if (isActive(building, index, activeCount)) {
      writeSpirePart(scratch, 0, building, building.baseHeight * heightScale, building.spireLength)
      setPartMatrix(spireMesh, k, scratch, 0)
    } else {
      setHiddenMatrix(spireMesh, k, building)
    }
  }
  spireMesh.instanceMatrix.needsUpdate = true
}

// Bit k is set when the k-th beacon is shown: its building is active and its blink is on.
function beaconMask(layer: BuildingLayer, activeCount: number, time: number, steady: boolean): number {
  let mask = 0
  for (let k = 0; k < layer.spireBuildingIndices.length; k++) {
    const index = layer.spireBuildingIndices[k] ?? 0
    const building = layer.buildings[index]
    if (building && isActive(building, index, activeCount) && beaconIsOn(building.blinkPhase, time, steady)) {
      mask |= 1 << k
    }
  }
  return mask
}

function writeBeacons(layer: BuildingLayer, heightScale: number, mask: number): void {
  const { beaconMesh, buildings, scratch, spireBuildingIndices } = layer
  if (!beaconMesh) return
  for (let k = 0; k < spireBuildingIndices.length; k++) {
    const building = buildings[spireBuildingIndices[k] ?? 0]
    if (!building) continue
    writeBeaconPart(scratch, 0, building, building.baseHeight * heightScale, building.spireLength, (mask & (1 << k)) !== 0)
    setPartMatrix(beaconMesh, k, scratch, 0)
  }
  beaconMesh.instanceMatrix.needsUpdate = true
}

// Scales each building's height by `heightScale` and hides buildings beyond
// `density * count`, so a rising density reads as the skyline filling in rather
// than buildings fading to transparent. A building with `width === 0` (no clear
// spot found for it) always stays hidden. Matrices are rewritten only when the
// height moved by 1e-4 or more or the integer active count changed; beacons also
// rewrite when their on/off state changes. `dampState` converges asymptotically,
// so once a chapter settles this is a no-op.
export function applyBuildingState(
  layer: BuildingLayer, heightScale: number, density: number, time: number, steadyBeacon: boolean,
): void {
  const total = layer.buildings.length
  const activeCount = Math.min(total, Math.max(0, Math.round(density * total)))
  const moved = !(Math.abs(heightScale - layer.lastHeightScale) < HEIGHT_EPSILON)
    || activeCount !== layer.lastActiveCount
  if (moved) {
    writeBodies(layer, heightScale, activeCount)
    layer.lastHeightScale = heightScale
    layer.lastActiveCount = activeCount
  }
  const mask = beaconMask(layer, activeCount, time, steadyBeacon)
  if (moved || mask !== layer.lastBeaconMask) {
    writeBeacons(layer, layer.lastHeightScale, mask)
    layer.lastBeaconMask = mask
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/journey/building-layer.test.ts tests/journey/buildings.test.ts tests/journey/post.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/journey/buildings.ts app/journey/post.ts tests/journey/building-layer.test.ts
git commit -m "feat: building layers with dirty-checked update and blinking beacons"
```

---

### Task 4: Facade `aWindowed` gate and scene wiring

This task changes the shader and the scene together. Gating windows on `aWindowed` while the old cube mesh still lacks the attribute would turn every window off, so the old mesh must go in the same commit.

**Files:**
- Modify: `app/journey/facade-material.ts`, `app/journey/scene.ts`
- Modify: `tests/journey/facade-material.test.ts`, `tests/gpu/facade-probe.ts`, `tests/gpu/windows-probe.ts`, `tests/gpu/harness.ts`, `tests/gpu/facade.spec.ts`

**Interfaces:**
- Consumes: `createBuildingLayer`, `applyBuildingState`, `layerMeshes`, `LAYERS`, `BuildingLayer` (Task 3).
- Produces: `facade-material.ts` reads `attribute float aWindowed` (1 = draw windows). `window.cityGpu.journeyLayers()` returns `buildings` (building count) next to `count` (part count). `probeFacade` accepts `windowed?: boolean` (default `true`).

- [ ] **Step 1: Write the failing unit tests**

In `tests/journey/facade-material.test.ts`:

1. Replace the body of `it('removes obsolete skyline window mesh and opts changing matrices out of culling', ...)` with:

```ts
it('removes obsolete skyline window mesh and opts changing matrices out of culling', () => {
  const scene = readFileSync(new URL('../../app/journey/scene.ts', import.meta.url), 'utf8')
  for (const oldName of ['createWindows', 'applyWindowState', 'windowsMesh', 'interface WindowLight']) {
    expect(scene).not.toContain(oldName)
  }
  const buildings = readFileSync(new URL('../../app/journey/buildings.ts', import.meta.url), 'utf8')
  expect(buildings).toContain('mesh.frustumCulled = false')
})
```

2. Append:

```ts
it.each(['full', 'lite'] as const)('%s: gates window drawing on the aWindowed attribute', variant => {
  const { shader } = patched(variant)
  expect(shader.vertexShader).toContain('attribute float aWindowed;')
  expect(shader.vertexShader).toContain('vWindowed = aWindowed;')
  expect(shader.fragmentShader).toContain('varying float vWindowed;')
  expect(shader.fragmentShader).toContain('abs(vFaceNormal.y) < 0.5 && vWindowed > 0.5')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/journey/facade-material.test.ts`
Expected: FAIL on the two new `aWindowed` cases (`full` and `lite`). The culling-source test already passes, because `scene.ts` still contains the old mesh code until Step 5.

- [ ] **Step 3: Add the gate to the facade shader**

In `app/journey/facade-material.ts`:

1. `vertexDeclarations`: add `attribute float aWindowed;` and `varying float vWindowed;` after the existing `attribute float aSeed;` and `varying float vSeed;` lines.
2. `fragmentDeclarations`: add `varying float vWindowed;` after `varying float vSeed;`.
3. In the `begin_vertex` replacement, add `vWindowed = aWindowed;` on the line after `vSeed = aSeed;`.
4. In `facadeColorPatch`, change the condition `if (abs(vFaceNormal.y) < 0.5) {` to `if (abs(vFaceNormal.y) < 0.5 && vWindowed > 0.5) {`.

- [ ] **Step 4: Keep the GPU probes working**

A missing instanced attribute reads as 0 in GLSL, which would turn windows off in both probes. Give both an `aWindowed` of 1.

`tests/gpu/facade-probe.ts`: add `windowed?: boolean` to the options type, and after the existing `aSeed` line add:

```ts
  geometry.setAttribute('aWindowed', new THREE.InstancedBufferAttribute(new Float32Array([options.windowed === false ? 0 : 1]), 1))
```

`tests/gpu/windows-probe.ts`: after the existing `geometry.setAttribute('aSeed', ...)` line add:

```ts
  geometry.setAttribute('aWindowed',new THREE.InstancedBufferAttribute(new Float32Array([1]),1))
```

- [ ] **Step 5: Wire `scene.ts`**

Find each item by name.

1. Imports: remove `createFacadeMaterial` from the `./facade-material` import (keep `type FacadeUniforms`); remove `clearsPath` from the `./path` import; remove `import { clearsFootprints } from './footprints'` (added in Task 1). Add:

```ts
import { applyBuildingState, type BuildingLayer, createBuildingLayer, LAYERS, layerMeshes } from './buildings'
```

2. Delete: `const ROAD_CLEARANCE = ...`; the `LAYERS` constant with its comment; `interface Building`; `interface BuildingLayer`; `const PLACEMENT_ATTEMPTS`; `placeBuilding`; `createBuildingLayer`; `applyBuildingState`. Keep `BUILDING_CLEARANCE` (the market uses it), `seg1` to `seg3`, `STAR_COUNT`, and `DAMPING`.

3. In `createJourneyScene`, replace the layer loop:

```ts
  const layers: BuildingLayer[] = []
  for (const [i] of LAYERS.entries()) {
    const layer = createBuildingLayer(i, { lowPower, facade })
    layers.push(layer)
    scene.add(...layerMeshes(layer))
  }
```

4. In `apply`, replace the `applyBuildingState` line with (positional arguments, so no per-frame object):

```ts
    for (const layer of layers) applyBuildingState(layer, state.buildingHeight, state.buildingDensity, lastTime, tier === 'reduced')
```

`lastTime` is already assigned in `update` before `apply`, and `setTheme` sets it before its own `apply`.

- [ ] **Step 6: Update the harness and `facade.spec.ts`**

`tests/gpu/harness.ts`, in `journeyLayers()`, add a field to the mapped object:

```ts
        buildings: mesh.userData.buildingCount as number,
```

`tests/gpu/facade.spec.ts`, in the `chapters, mid-transition and restore` test:

1. Replace `expect(result.layers.map(layer => layer.count)).toEqual(lowPower ? [14, 19, 24] : [24, 32, 40])` with:

```ts
    expect(result.layers.map(layer => layer.buildings)).toEqual(lowPower ? [14, 19, 24] : [24, 32, 40])
```

2. Directly under the `import` line add:

```ts
// Near and mid layers each add a spire mesh and a beacon mesh on non-lowPower devices (spec 03).
const LANDMARK_DRAW_CALLS = 4
```

3. Change the `expectedCalls` line so the landmark calls are added to whatever base numbers the line holds now (earlier steps may have changed them; do not rewrite the base numbers):

```ts
    const expectedCalls = (lowPower ? [56, 24, 13] : [57, 25, 14]).map(calls => calls + (lowPower ? 0 : LANDMARK_DRAW_CALLS))
```

If the base array differs from `[56, 24, 13] : [57, 25, 14]`, keep the existing arrays and add only the `.map(...)`.

- [ ] **Step 7: Run unit tests, typecheck, and the GPU suite**

Run: `npm test && npm run typecheck`
Expected: PASS.

Run: `npm run test:gpu`
Expected: PASS. Watch two places: `tests/gpu/post-probe-checks.ts` `findLitWindow` raycasts against the near building mesh by instance and now meets rooftop-block instances, which have no windows and are skipped by `isObservedLitWindow`; and `windows.spec.ts` and `facade.spec.ts` probes depend on the `aWindowed` attribute added in Step 4. If a GPU test fails for any other reason, report the failure and stop; do not edit the test to pass.

- [ ] **Step 8: Commit**

```bash
git add app/journey tests
git commit -m "feat: wire building layers into the journey scene and gate windows on aWindowed"
```

---

### Task 5: GPU checks for draw calls, equipment windows, and context restore

**Files:**
- Create: `tests/gpu/buildings-probe.ts`, `tests/gpu/buildings.spec.ts`
- Modify: `tests/gpu/harness.ts`

**Interfaces:**
- Consumes: `window.cityGpu.getJourneyContext()`, `mountJourney`, `renderJourney`, `loseAndRestore`, `readFrame`, `probeFacade` (with `windowed`).
- Produces: `window.cityGpu.buildingDrawCalls(): { calls: number, shaderError: string | null, glError: number, meshNames: string[] }`.

- [ ] **Step 1: Write the probe**

`tests/gpu/buildings-probe.ts`:

```ts
import type * as THREE from 'three'
import { diagnostics } from './gpu-utils'

const BUILDING_PREFIX = 'journey-building-'

// With a composer, renderer.info resets on every pass, so a count taken after
// composer.render() can reflect only the output pass. Measure on the direct
// path instead: hide everything except the building meshes, render once with
// autoReset off, and read the call count.
export function buildingDrawCalls() {
  const { scene, camera, renderer } = window.cityGpu.getJourneyContext()
  const hidden: THREE.Object3D[] = []
  for (const child of scene.children) {
    if (child.name.startsWith(BUILDING_PREFIX) || !child.visible) continue
    child.visible = false
    hidden.push(child)
  }
  const autoReset = renderer.info.autoReset
  try {
    renderer.setRenderTarget(null)
    renderer.info.autoReset = false
    renderer.info.reset()
    renderer.render(scene, camera)
    const base = diagnostics(renderer)
    return {
      calls: renderer.info.render.calls,
      shaderError: base.shaderError,
      glError: base.glError,
      meshNames: scene.children.filter(child => child.name.startsWith(BUILDING_PREFIX)).map(child => child.name),
    }
  } finally {
    renderer.info.autoReset = autoReset
    for (const object of hidden) object.visible = true
  }
}
```

In `tests/gpu/harness.ts`, add `import { buildingDrawCalls } from './buildings-probe'` with the other imports and add `buildingDrawCalls,` to the `cityGpu` object next to `probeWindows,`.

- [ ] **Step 2: Write the tests**

`tests/gpu/buildings.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

const ABOUT = 3

for (const [tier, lowPower] of [
  ['full', false], ['reduced', false], ['lite', true], ['reduced', true],
] as const) {
  test(`${tier} lowPower=${lowPower}: building draw calls, landmarks, and restore`, async ({ page }) => {
    await page.goto('/tests/gpu/harness.html')
    await page.waitForFunction(() => Boolean(window.cityGpu))
    const result = await page.evaluate(async ({ tier, lowPower, chapter }) => {
      window.cityGpu.mountJourney({ tier, lowPower })
      window.cityGpu.renderJourney({ chapter })
      const measured = window.cityGpu.buildingDrawCalls()
      window.cityGpu.renderJourney({ chapter })
      const before = window.cityGpu.readFrame()
      const restore = await window.cityGpu.loseAndRestore()
      const after = window.cityGpu.readFrame()
      window.cityGpu.dispose()
      return { measured, before, after, restore }
    }, { tier, lowPower, chapter: ABOUT })
    expect(result.measured.shaderError).toBeNull()
    expect(result.measured.glError).toBe(0)
    expect(result.measured.calls).toBeLessThanOrEqual(7)
    expect(result.measured.calls).toBe(lowPower ? 3 : 7)
    expect(result.measured.meshNames.some(name => name.endsWith('-spire'))).toBe(!lowPower)
    expect(result.measured.meshNames.some(name => name.endsWith('-beacon'))).toBe(!lowPower)
    expect(result.restore.shaderError).toBeNull()
    expect(result.restore.glError).toBe(0)
    const difference = result.before.reduce((sum, byte, index) => sum + Math.abs(byte - result.after[index]!), 0)
      / result.before.length
    expect(difference).toBeLessThan(1)
  })
}

for (const variant of ['full', 'lite'] as const) {
  test(`${variant}: an unwindowed part shows no windows even when fully lit`, async ({ page }) => {
    await page.goto('/tests/gpu/harness.html')
    await page.waitForFunction(() => Boolean(window.cityGpu))
    const result = await page.evaluate(variant => {
      const lit = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 1.4, windowed: false })
      const dark = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 0, windowed: false })
      const windowedLit = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 1.4 })
      const windowedDark = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 0 })
      return {
        same: lit.pixels.every((byte, index) => byte === dark.pixels[index]),
        windowedDiffers: windowedLit.pixels.some((byte, index) => byte !== windowedDark.pixels[index]),
        errors: [lit, dark, windowedLit, windowedDark].map(value => value.diagnostics),
      }
    }, variant)
    expect(result.same).toBe(true)
    expect(result.windowedDiffers).toBe(true)
    for (const frame of result.errors) { expect(frame.shaderError).toBeNull(); expect(frame.glError).toBe(0) }
  })
}

test('reduced keeps the building frame identical across time', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
  const same = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: false })
    window.cityGpu.renderJourney({ chapter: 3, time: 0 })
    const a = window.cityGpu.readFrame()
    window.cityGpu.renderJourney({ chapter: 3, time: 0.9 })
    const b = window.cityGpu.readFrame()
    window.cityGpu.dispose()
    return a.every((value, index) => value === b[index])
  })
  expect(same).toBe(true)
})
```

- [ ] **Step 3: Run**

Run: `npx playwright test --config playwright.config.ts tests/gpu/buildings.spec.ts`
Expected: PASS. If `calls` is not 7 on `full`, read `meshNames`: a layer with no placed spire has no spire mesh, so the count would be lower; investigate placement rather than relaxing the `toBe`. If it is higher, a mesh outside the buildings is visible; fix the probe's hiding, not the count.

- [ ] **Step 4: Commit**

```bash
git add tests/gpu
git commit -m "test: gpu draw-call, equipment-window, and restore checks for building shapes"
```

---

### Task 6: Acceptance

**Files:** none changed unless a check fails.

- [ ] **Step 1: Confirm `scene.ts` shrank**

Run: `wc -l app/journey/scene.ts app/journey/buildings.ts app/journey/footprints.ts`
Expected: `scene.ts` about 130 to 150 lines shorter than before Task 1; every file under 800 lines.

- [ ] **Step 2: Run the final acceptance checks**

**Automated verification (agent runs; all must pass):**

- [ ] `npm test`
- [ ] `npm run test:gpu`
- [ ] `npm run typecheck`
- [ ] `npm run build`

If `npm run build` fails, bisect against the commit before Task 1 before changing code; an earlier session saw prerender errors on an older base commit, so a failure there is not caused by this plan.

**Manual verification (a person does these; do not mark them done until the user confirms):**

- [ ] Entrance view at chapter `about` (desktop, both themes): at least four distinct silhouette types are visible (slab, setback, crowned, spire).
- [ ] Mid-transition frame between `intro` and `projects`: setback upper bodies and rooftop blocks stay attached to their buildings while heights change. No gaps, no stretching.
- [ ] Spire beacons blink about once every 1.6 s on desktop, stay on with reduced motion, and are absent on a phone (`lowPower`).
- [ ] No building intersects the market, hall, courtyard, gate, or either corner block. Walk the camera past each.
- [ ] Rooftop blocks show no windows; setback tiers show separate floor grids (accepted, per spec Risks).
- [ ] iPhone 14 Pro Max emulation: lower counts, no spires, no beacons. Then on a physical iPhone, confirm no render-cost increase (shared conventions section 8, commit before and after, three runs each).
- [ ] Lose and restore the WebGL context on a physical phone: the skyline returns with the same colors and shapes.
- [ ] Mid-theme-blend frame (`themeMix` 0.5) shows buildings without flicker.

- [ ] **Step 3: Record the result**

After the user confirms the manual checks, tick row 4 in `docs/superpowers/specs/2026-10-09-city-polish-index.md` (Build order table, Done column) and commit:

```bash
git add docs/superpowers/specs/2026-10-09-city-polish-index.md
git commit -m "docs: mark city polish step 4 done"
```

---

## Self-review notes

- **Spec coverage:** archetypes and weights (Task 2); spire rule and `lowPower` zero (Tasks 2, 3); footprint `depth` and stricter acceptance with `halfExtent`, `clearsCornerBlocks` (Tasks 1, 2); golden stability (Tasks 1, 2); box, spire, beacon meshes and draw-call budget (Tasks 3, 5); pure writers and allocation-free update (Tasks 2, 3); dirty check (Task 3); beacon blink, reduced steady, inactive hidden (Tasks 2, 3, 5); color variation (Task 3); `aWindowed` and `aSeed` per part, shader read (Tasks 3, 4, 5); `frustumCulled = false` (Task 3); module split (Tasks 1, 4); tier behavior (Tasks 3, 4); GPU tests 8 and 9 (Task 5). Unit tests 1 to 7 map to Tasks 2 and 3.
- **Deviation 1:** the spec shares one beacon mesh across layers (worst case 7 calls). This plan gives each layer with spires its own beacon mesh. The worst case is still 7 (near 3, mid 3, far 1), so the budget and test 8 hold, and each layer's update stays independent.
- **Deviation 2:** test 4 checks the road surface (`ROAD_HALF_WIDTH`) for the rectangle corners, not `ROAD_CLEARANCE`. At the outer corner of a turn a rectangle corner can sit up to 0.23 closer than the center test guarantees, which still clears the 3-unit road. Beside straight legs the full `ROAD_CLEARANCE` holds.
- **Type consistency:** `applyBuildingState(layer, heightScale, density, time, steadyBeacon)` is positional in Tasks 3 and 4. `writeBoxParts(out, offset, building, archetype, height)` matches in Tasks 2 and 3. `BuildingLayer` fields used by tests (`partRanges`, `spireBuildingIndices`, `lastActiveCount`) are defined in Task 3.
