# Journey Buildings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the journey's primitive set-pieces (gate, hall, market stalls, home house) and its 24-building near skyline layer with stylized low-poly classic-European GLB models, with the current look as the fallback.

**Architecture:** One background GLB load (`loadBuildingModels`) feeds one swap target. The target stages two parts hidden: baked set-piece groups (pieces merged per material, placed from the existing layout constants) and instanced near-layer variants (fitted inside each building's already-placed rectangle). After shader warmup the parts show and the primitives and near boxes hide. Any failure keeps the current look. This mirrors vehicles and people (`model-swap.ts`).

**Tech Stack:** Three.js r186 (`GLTFLoader`, Meshopt decoder, `BufferGeometryUtils.mergeGeometries`, `InstancedMesh`), TypeScript, Vitest, Playwright GPU harness, glTF Transform 4.5.1 (asset prep only).

**Spec:** `docs/superpowers/specs/2026-10-15-journey-buildings-design.md`

**Research:** `docs/superpowers/research/2026-10-09-portfolio-overview-research.md` (commit `ef03e91`) describes the journey in general terms. It predates the vehicles and people work, so this plan relies on none of its line numbers. Every reference below was read from `HEAD` (`3b2000b`).

All paths are relative to `repos/portfolio` unless noted. Run commands from `repos/portfolio`.

## Spec adjustments found while planning

These refine the spec after reading the code. Task 8 writes them into the spec.

1. **Near-layer footprint.** The spec says width and depth come from each variant's bounds. Changing `placeBuilding` would move every seeded building and break its tests. Instead each GLB is scaled uniformly to fit inside the placed `width × depth` rectangle. Clearance holds by construction.
2. **Contact shadows need no adapter.** GLB instances keep the existing `Building` records, so `writeLayerShadows` already reads the right footprint and active state.
3. **Night windows.** No shader patch. If a kit has a separate window material, its emissive follows `windowLitRatio`. Otherwise every kit material gets a faint uniform glow, as people do.
4. **Courtyard windows.** The two always-lit window planes stay and move to slots measured on the chosen house model.

## Global Constraints

- Stylized low-poly classic European town GLBs only. CC0 or equivalent license, with a `LICENSE.txt` naming pack, author, and license (spec: Goal).
- Added download weight about 1.5 MB or less, Meshopt compressed (spec: Goal). Enforced as `BUILDING_ASSET_BUDGET_BYTES = 1_500_000`.
- Set-pieces add at most 12 draw calls. The near layer adds at most 6 instanced meshes (spec: Goal). Enforced as `MAX_SET_PIECE_DRAW_CALLS = 12` and `MAX_NEAR_MESHES = 6`.
- Mid and far skyline layers, hall picture frames, lamps, road, sky, people, and vehicles do not change (spec: Out of scope).
- Layout code is unchanged: `hall.ts` pillar spacing and frame slots, `footprints.ts`, people placement, lamp placement.
- The scene never waits for the models and never breaks if they fail. On failure the current look stays and the error is logged once.
- Reduced motion still loads the set-pieces and the near layer (both are static).
- Immutability: new objects, not mutation, except per-frame render-loop code (reused matrices, instanced buffers) and Three.js object state. Source files stay under 800 lines. Tests first (TDD) except Three.js visual output.
- Absolute model path `'/models/buildings/'`, same assumption as vehicles and people (site at domain root).

## Review Focus

Input classes the spec implies and no task's happy-path tests cover. Each has a test in the owning task.

1. A GLB that loads but is the wrong size or has no meshes: the load must reject and the fallback stays (Task 4, `rejects a model whose size drifts` and `rejects a model with no meshes`).
2. A building the layout never placed (`width === 0`) or one past the density cutoff: its instance must scale to zero, not float at the origin (Task 6, `hidden and inactive buildings get a zero matrix`).
3. `lite` has 14 near buildings, not 24: per-variant instance counts must sum to the layer's building count (Task 6, `instance counts sum to the layer size`; Task 7, GPU `lite`).
4. Scene disposed while models are staged or warming: nothing shows and no geometry leaks (Task 4, `releases the parts already staged when a later part throws while staging` and `dispose releases the parts and disposes the models, and does nothing twice`; Task 7, GPU `a scene disposed while the models are still loading shows nothing and throws nothing`).
5. Night: kit materials must glow at high `windowLitRatio` and stay neutral at day, and a kit with no window material must still work (Task 7, `glow ramps with windowLitRatio on window materials only` and `falls back to uniform glow without a window material`).

---

### Task 1: Source, inspect, and prepare the models

This is an asset task. It has no test-first loop. Its deliverables are checked by Task 2's tests.

**Files:**
- Create: `public/models/buildings/*.glb` (final set chosen in this task)
- Create: `public/models/buildings/LICENSE.txt`
- Scratch (not committed): `<scratchpad>/buildings/{downloads,extracted,tools,out}`

**Interfaces:**
- Produces: GLB files and a selection table. Task 2 pastes the table into `building-specs.ts`.
- Roles to fill (one GLB each): `gatePillar`, `beam`, `hallColumn`, `hallWall`, `stall`, `house`. Plus 2 to 6 near-layer variants (`near-*.glb`).

- [ ] **Step 1: Create the scratch layout and the inspection tools**

Downloaded archives are untrusted data. Each goes in its own new, empty directory. Scripts live in a different directory. Run Node with paths as arguments.

```bash
SCRATCH=/private/tmp/claude-501/-Users-nguyenducdung-Desktop-Zyot-ai-workspace/0a308e9c-1f81-4a5b-8414-0929b473db56/scratchpad/buildings
mkdir -p "$SCRATCH/downloads" "$SCRATCH/extracted" "$SCRATCH/tools" "$SCRATCH/out"
cd "$SCRATCH/tools"
npm init -y >/dev/null
npm i --save-exact @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 meshoptimizer
```

Write `$SCRATCH/tools/inspect.mjs`:

```js
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression } from '@gltf-transform/extensions'
import { getBounds } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [dir] = process.argv.slice(2)
if (!dir) { console.error('usage: node inspect.mjs <directory of .glb files>'); process.exit(1) }
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const fmt = v => v.map(n => Number(n.toFixed(3)))

for (const name of readdirSync(dir).filter(f => f.endsWith('.glb')).sort()) {
  const doc = await io.read(join(dir, name))
  const root = doc.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const { min, max } = getBounds(scene)
  const size = max.map((v, i) => v - min[i])
  const perMaterial = {}
  for (const node of root.listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const b = getBounds(node)
    for (const prim of mesh.listPrimitives()) {
      const key = prim.getMaterial()?.getName() ?? '(none)'
      const entry = perMaterial[key] ?? { min: b.min, max: b.max }
      perMaterial[key] = { min: entry.min.map((v, i) => Math.min(v, b.min[i])), max: entry.max.map((v, i) => Math.max(v, b.max[i])) }
    }
  }
  console.log(JSON.stringify({
    name, bytes: statSync(join(dir, name)).size, size: fmt(size), min: fmt(min),
    materials: Object.fromEntries(Object.entries(perMaterial).map(([k, v]) => [k, { min: fmt(v.min), max: fmt(v.max) }])),
    textures: root.listTextures().length, animations: root.listAnimations().length,
  }))
}
```

Write `$SCRATCH/tools/row.mjs`. It prints the `building-specs.ts` row for one file:

```js
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression } from '@gltf-transform/extensions'
import { getBounds } from '@gltf-transform/functions'
import { MeshoptDecoder } from 'meshoptimizer'

const [file, targetHeight, outName] = process.argv.slice(2)
if (!file || !targetHeight || !outName) { console.error('usage: node row.mjs <file.glb> <target height in scene units> <published file name>'); process.exit(1) }
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(file)
const root = doc.getRoot()
const { min, max } = getBounds(root.getDefaultScene() ?? root.listScenes()[0])
const raw = max.map((v, i) => v - min[i])
const scale = Number(targetHeight) / raw[1]
const size = raw.map(v => Number((v * scale).toFixed(3)))
console.log(`{ file: '${outName}', scale: ${Number(scale.toFixed(5))}, facingY: Math.PI, size: [${size.join(', ')}] },`)
```

- [ ] **Step 2: Download candidate packs, one directory each**

Candidates from the spec, all to be verified: Kenney Fantasy Town Kit, Kenney Castle Kit, Kenney City Kit (Suburban), Quaternius Medieval Village MegaKit (only if it ships GLB or converts cleanly). For each, open its page on `kenney.nl/assets/...` or `quaternius.com`, find the ZIP link, and download:

```bash
mkdir -p "$SCRATCH/downloads/<pack-slug>" "$SCRATCH/extracted/<pack-slug>"
curl -L -o "$SCRATCH/downloads/<pack-slug>/pack.zip" "<zip url from the pack page>"
unzip -q "$SCRATCH/downloads/<pack-slug>/pack.zip" -d "$SCRATCH/extracted/<pack-slug>"
find "$SCRATCH/extracted/<pack-slug>" -iname '*.glb' | head -50
```

Read each pack's `License.txt`. Drop any pack that is not CC0 or equivalent, or ships no GLB.

- [ ] **Step 3: Inspect candidates**

```bash
node "$SCRATCH/tools/inspect.mjs" "<directory containing .glb files>"
```

Pick the final set with these rules:

| Role | Needs |
|---|---|
| `gatePillar` | Square or round post or stone pier. Height at least 2.5 times its width. |
| `beam` | Lintel, arch beam, or long trim piece. Long on local X. |
| `hallColumn` | Round or square column with a base and capital. |
| `hallWall` | A flat-ish facade or wall piece. It is squashed to 0.15 deep so picture frames stay in front, so choose one without deep relief. |
| `stall` | Market stall or small shop with a roof. |
| `house` | Cottage or townhouse with visible front windows. Note its front face and the x/y of two windows. |
| near variants | 2 to 6 building models of varied footprint. Total meshes = variants × distinct materials, at most 6. Prefer a separate window material. |

Reject a model with animations, more than 2 textures, or geometry over about 8,000 triangles.

Total optimized weight of all chosen GLBs must be at most 1,500,000 bytes.

- [ ] **Step 4: Optimize the chosen files**

Copy each chosen file into `$SCRATCH/out/` under its published name (`gate-pillar.glb`, `beam.glb`, `hall-column.glb`, `hall-wall.glb`, `stall.glb`, `house.glb`, `near-1.glb` and so on). Then:

```bash
npx --yes @gltf-transform/cli@4.5.1 optimize --help | head -40   # confirm the flags below exist
for f in "$SCRATCH"/out/*.glb; do
  npx --yes @gltf-transform/cli@4.5.1 optimize "$f" "$f" --compress meshopt --simplify false --texture-compress false
done
ls -l "$SCRATCH/out"
```

If a flag name differs in the installed CLI, use its `--help` equivalent. The intent is Meshopt compression with no geometry simplification and the texture left as is.

- [ ] **Step 5: Print the selection table**

Target heights (scene units): `gatePillar` 3.4, `beam` 0.5, `hallColumn` 3, `hallWall` 2.4, `stall` 1.7, `house` 3.05. Near variants: choose each target height by eye so a building reads as 1 to 2 stories next to a 0.5-unit person (typically 0.9 to 1.6).

```bash
node "$SCRATCH/tools/row.mjs" "$SCRATCH/out/gate-pillar.glb" 3.4 gate-pillar.glb
# repeat for each role and each near variant
node "$SCRATCH/tools/inspect.mjs" "$SCRATCH/out"   # materials, window material name and bounds
```

Save the printed rows. Task 2 needs: all rows, the window material name (or "none"), and for `house` the x and y of two front windows relative to the house's front-face center and base (read them from the `house` window material bounds).

- [ ] **Step 6: Install the files and the license**

```bash
mkdir -p public/models/buildings
cp "$SCRATCH"/out/*.glb public/models/buildings/
```

Write `public/models/buildings/LICENSE.txt` in the style of `public/models/people/LICENSE.txt`: pack name, author, distribution site, license (with URL), source URLs of each used model, and a `Modified:` line (glTF Transform 4.5.1 Meshopt compression, no geometry simplification).

- [ ] **Step 7: Commit**

```bash
git add public/models/buildings
git commit -m "feat: add the classic-town building GLBs with license"
```

---

### Task 2: Building specs

**Files:**
- Create: `app/journey/building-specs.ts`
- Test: `tests/journey/building-specs.test.ts`

**Interfaces:**
- Consumes: Task 1's selection rows, window material name, house window slots.
- Produces (exact names later tasks import from `./building-specs`):
  - `BUILDING_MODEL_DIR: string`, `BUILDING_BOUNDS_TOLERANCE: number`, `BUILDING_ASSET_BUDGET_BYTES: number`
  - `MAX_SET_PIECE_DRAW_CALLS: number`, `MAX_NEAR_MESHES: number`
  - `SET_PIECE_ROLES`, `type SetPieceRole`
  - `interface PieceSpec { file: string; scale: number; facingY: number; size: Vec3 }`
  - `SET_PIECE_SPECS: Readonly<Record<SetPieceRole, PieceSpec>>`
  - `NEAR_VARIANT_SPECS: readonly PieceSpec[]`
  - `WINDOW_MATERIAL_NAMES: readonly string[]`
  - `HOUSE_WINDOW_SLOTS: readonly { x: number; y: number }[]`, `HOUSE_WINDOW_SIZE: { width: number; height: number }`
  - `NEAR_Y_MIN`, `NEAR_Y_MAX`, `NEAR_VARIANT_SEED`
  - `WINDOW_GLOW`, `UNIFORM_GLOW`, `GLOW_START`, `GLOW_END`
  - `SCENERY_GROUP_NAME`, `NEAR_MESH_PREFIX`

- [ ] **Step 1: Write the failing test**

```ts
// tests/journey/building-specs.test.ts
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUILDING_ASSET_BUDGET_BYTES, BUILDING_MODEL_DIR, HOUSE_WINDOW_SLOTS, MAX_NEAR_MESHES, NEAR_VARIANT_SPECS,
  SET_PIECE_ROLES, SET_PIECE_SPECS, WINDOW_MATERIAL_NAMES,
} from '../../app/journey/building-specs'

const MODEL_DIR = join(__dirname, '../../public', BUILDING_MODEL_DIR)
const allSpecs = [...SET_PIECE_ROLES.map(role => SET_PIECE_SPECS[role]), ...NEAR_VARIANT_SPECS]

describe('building specs', () => {
  it('has a positive scale and size for every piece', () => {
    for (const spec of allSpecs) {
      expect(spec.scale).toBeGreaterThan(0)
      expect(spec.size.every(value => value > 0)).toBe(true)
    }
  })

  it('names a .glb file that exists in public/models/buildings for every piece', () => {
    for (const spec of allSpecs) {
      expect(spec.file.endsWith('.glb')).toBe(true)
      expect(existsSync(join(MODEL_DIR, spec.file)), spec.file).toBe(true)
    }
  })

  it('ships no unused GLB and stays inside the download budget', () => {
    const published = readdirSync(MODEL_DIR).filter(name => name.endsWith('.glb')).sort()
    const used = [...new Set(allSpecs.map(spec => spec.file))].sort()
    expect(published).toEqual(used)
    const bytes = published.reduce((sum, name) => sum + statSync(join(MODEL_DIR, name)).size, 0)
    expect(bytes).toBeLessThanOrEqual(BUILDING_ASSET_BUDGET_BYTES)
  })

  it('has between 2 and 6 near variants and a license file', () => {
    expect(NEAR_VARIANT_SPECS.length).toBeGreaterThanOrEqual(2)
    expect(NEAR_VARIANT_SPECS.length).toBeLessThanOrEqual(MAX_NEAR_MESHES)
    expect(existsSync(join(MODEL_DIR, 'LICENSE.txt'))).toBe(true)
  })

  it('has exactly two courtyard window slots', () => {
    expect(HOUSE_WINDOW_SLOTS).toHaveLength(2)
  })

  it('has no duplicate window material names', () => {
    expect(new Set(WINDOW_MATERIAL_NAMES).size).toBe(WINDOW_MATERIAL_NAMES.length)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/journey/building-specs.test.ts`
Expected: FAIL, `Cannot find module '../../app/journey/building-specs'`.

- [ ] **Step 3: Write the specs file**

Paste Task 1's printed rows where marked. `WINDOW_MATERIAL_NAMES` is the window material name(s) from the inspection, or `[]` if the kit has none. `HOUSE_WINDOW_SLOTS` x and y are the measured window centers relative to the house's front-face center (x) and its base (y), in scene units after the `house` scale.

```ts
// app/journey/building-specs.ts
import type { Vec3 } from './stops'

// Absolute path: it assumes the site is deployed at the domain root, as vehicles and people do.
export const BUILDING_MODEL_DIR = '/models/buildings/'
// How far a normalized model may drift from its spec size, in scene units, before the load is rejected.
export const BUILDING_BOUNDS_TOLERANCE = 0.05
export const BUILDING_ASSET_BUDGET_BYTES = 1_500_000
export const MAX_SET_PIECE_DRAW_CALLS = 12
export const MAX_NEAR_MESHES = 6

export const SET_PIECE_ROLES = ['gatePillar', 'beam', 'hallColumn', 'hallWall', 'stall', 'house'] as const
export type SetPieceRole = (typeof SET_PIECE_ROLES)[number]

export interface PieceSpec {
  file: string
  // Uniform scale from the model's own units to scene units.
  scale: number
  // glTF models face +Z. The scene authors things facing -Z, so the default is half a circle.
  facingY: number
  // Expected size after the scale and the facing turn: x (width), y (height), z (depth).
  size: Vec3
}

// Rows printed by `row.mjs` in Task 1, one per role.
export const SET_PIECE_SPECS: Readonly<Record<SetPieceRole, PieceSpec>> = {
  gatePillar: /* row from Task 1 */,
  beam: /* row from Task 1 */,
  hallColumn: /* row from Task 1 */,
  hallWall: /* row from Task 1 */,
  stall: /* row from Task 1 */,
  house: /* row from Task 1 */,
}

// Near-layer variants, in the order the rows were printed.
export const NEAR_VARIANT_SPECS: readonly PieceSpec[] = [
  /* one row per near variant from Task 1 */
]

// Material names that are windows in the chosen kit. Empty when the kit bakes windows into its palette.
export const WINDOW_MATERIAL_NAMES: readonly string[] = [/* from Task 1 */]

// Centers of the two always-lit courtyard windows on the house front: x from the front-face center, y above the base.
export const HOUSE_WINDOW_SLOTS: readonly { x: number; y: number }[] = [/* two slots from Task 1 */]
export const HOUSE_WINDOW_SIZE = { width: 0.4, height: 0.5 } as const

// The near layer scales a building's height by the scroll height factor clamped to this range, so facades never stretch far.
export const NEAR_Y_MIN = 0.85
export const NEAR_Y_MAX = 1.15
export const NEAR_VARIANT_SEED = 7100

// Night glow. Window materials glow at WINDOW_GLOW. A kit without window materials gets UNIFORM_GLOW on every material.
export const WINDOW_GLOW = 0.9
export const UNIFORM_GLOW = 0.08
export const GLOW_START = 0.15
export const GLOW_END = 0.6

// `journey-building-` is reserved for the box layers (their GPU probes match that prefix).
export const SCENERY_GROUP_NAME = 'journey-scenery'
export const NEAR_MESH_PREFIX = 'journey-near-building-'
```

Replace every `/* ... */` marker with the real value before the next step. The file must contain no comment markers like that when committed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/journey/building-specs.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/journey/building-specs.ts tests/journey/building-specs.test.ts
git commit -m "feat: add the building model specs"
```

---

### Task 3: Set-piece layout and path helpers

**Files:**
- Modify: `app/journey/path.ts` (add `pathSegmentAt`, `closestPathPoint`)
- Modify: `app/journey/footprints.ts:1-20` (use `pathSegmentAt`)
- Create: `app/journey/setpiece-layout.ts`
- Test: `tests/journey/path.test.ts`, `tests/journey/setpiece-layout.test.ts`

**Interfaces:**
- Consumes: `SET_PIECE_SPECS`, `SetPieceRole` (Task 2); `hallPillarZs`, `HALL_LENGTH`, `HALL_PILLAR_SPACING`, `HALL_PILLAR_X`, `HALL_WALL_X` (`hall.ts`); `BUILDING_CLEARANCE`, `COURTYARD_DEPTH`, `ROAD_HALF_WIDTH` (`path.ts`); `seeded`.
- Produces:
  - `pathSegmentAt(index: number): PathSegment` (throws on a missing index)
  - `closestPathPoint(x: number, z: number): Vec2`
  - `type SetPieceGroupName = 'gate' | 'hall' | 'market' | 'house'`
  - `interface PiecePlacement { role: SetPieceRole; x: number; y: number; z: number; rotY: number; sx: number; sy: number; sz: number }`
  - `setPieceLayout(): Readonly<Record<SetPieceGroupName, readonly PiecePlacement[]>>`
  - `HOUSE_CENTER_Z: number`, `HOUSE_FRONT_Z: number` (front face z in the courtyard frame)

- [ ] **Step 1: Write the failing path tests**

Append to `tests/journey/path.test.ts` (keep its existing imports and add these):

```ts
import { closestPathPoint, pathSegmentAt, PATH_SEGMENTS } from '../../app/journey/path'

describe('pathSegmentAt', () => {
  it('returns the segment at an index and throws past the end', () => {
    expect(pathSegmentAt(0)).toBe(PATH_SEGMENTS[0])
    expect(() => pathSegmentAt(PATH_SEGMENTS.length)).toThrow('expected path segment')
  })
})

describe('closestPathPoint', () => {
  it('projects onto the nearest leg', () => {
    // First leg runs along x = 0 from z = 8 to z = -26.
    expect(closestPathPoint(5, -10)).toEqual({ x: 0, z: -10 })
  })

  it('clamps to a leg end', () => {
    expect(closestPathPoint(0, 20)).toEqual({ x: 0, z: 8 })
  })

  it('returns the point itself when it is on the path', () => {
    expect(closestPathPoint(-26, -40)).toEqual({ x: -26, z: -40 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/journey/path.test.ts`
Expected: FAIL, `pathSegmentAt` / `closestPathPoint` is not exported.

- [ ] **Step 3: Add the helpers to `path.ts`**

Add after `PATH_TOTAL_LENGTH` is defined (below its declaration):

```ts
export function pathSegmentAt(index: number): PathSegment {
  const segment = PATH_SEGMENTS[index]
  if (!segment) throw new Error(`expected path segment ${index}`)
  return segment
}

// The point on the path polyline nearest to (x, z).
export function closestPathPoint(x: number, z: number): Vec2 {
  let best: Vec2 = { x: PATH_SEGMENTS[0]?.fromX ?? 0, z: PATH_SEGMENTS[0]?.fromZ ?? 0 }
  let bestDistance = Number.POSITIVE_INFINITY
  for (const segment of PATH_SEGMENTS) {
    const along = Math.min(Math.max((x - segment.fromX) * segment.dirX + (z - segment.fromZ) * segment.dirZ, 0), segment.length)
    const px = segment.fromX + segment.dirX * along
    const pz = segment.fromZ + segment.dirZ * along
    const distance = Math.hypot(x - px, z - pz)
    if (distance < bestDistance) {
      bestDistance = distance
      best = { x: px, z: pz }
    }
  }
  return best
}
```

In `footprints.ts`, replace the local `segmentAt` function and the three lookups with the shared helper:

```ts
import { headingFor, pathSegmentAt, PLACES } from './path'
```

Remove `PATH_SEGMENTS` and `type PathSegment` from that import and delete the local `segmentAt`. Replace the three constants:

```ts
const seg1 = pathSegmentAt(0)
const seg2 = pathSegmentAt(1)
const seg3 = pathSegmentAt(2)
```

- [ ] **Step 4: Run path and footprint tests**

Run: `npx vitest run tests/journey/path.test.ts tests/journey/footprints.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing layout tests**

```ts
// tests/journey/setpiece-layout.test.ts
import { describe, expect, it } from 'vitest'
import { SET_PIECE_SPECS, type SetPieceRole } from '../../app/journey/building-specs'
import { HALL_LENGTH, HALL_PILLAR_X, HALL_WALL_X, hallPillarZs } from '../../app/journey/hall'
import { COURTYARD_DEPTH, ROAD_HALF_WIDTH, SIDEWALK_OUTER } from '../../app/journey/path'
import { HOUSE_CENTER_Z, HOUSE_FRONT_Z, type PiecePlacement, setPieceLayout } from '../../app/journey/setpiece-layout'

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

  it('puts a pillar at each side of the road, 0.4 beyond its edge, and a beam across them', () => {
    const pillars = layout.gate.filter(p => p.role === 'gatePillar')
    expect(pillars.map(p => p.x).sort((a, b) => a - b)).toEqual([-(ROAD_HALF_WIDTH + 0.4), ROAD_HALF_WIDTH + 0.4])
    for (const pillar of pillars) expect(extent(pillar, 'gatePillar')[1]).toBeCloseTo(3.4, 5)
    const beam = layout.gate.find(p => p.role === 'beam')
    expect(beam).toBeDefined()
    expect(extent(beam!, 'beam')[0]).toBeCloseTo((ROAD_HALF_WIDTH + 0.4) * 2 + 0.6, 5)
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
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run tests/journey/setpiece-layout.test.ts`
Expected: FAIL, `Cannot find module '../../app/journey/setpiece-layout'`.

- [ ] **Step 7: Write the layout**

```ts
// app/journey/setpiece-layout.ts
import { SET_PIECE_SPECS, type SetPieceRole } from './building-specs'
import { HALL_LENGTH, HALL_PILLAR_SPACING, HALL_PILLAR_X, HALL_WALL_X, hallPillarZs } from './hall'
import { BUILDING_CLEARANCE, COURTYARD_DEPTH, ROAD_HALF_WIDTH } from './path'
import { seeded } from './random'

export type SetPieceGroupName = 'gate' | 'hall' | 'market' | 'house'

export interface PiecePlacement {
  role: SetPieceRole
  x: number
  y: number
  z: number
  rotY: number
  sx: number
  sy: number
  sz: number
}

// Same ground level the procedural pieces stand on (`BASE_Y` in buildings.ts).
const GROUND_Y = -1
const STALL_COUNT = 6
const STALL_SEED = 7000
const HALF_TURN = Math.PI / 2

// Target dimensions in each piece's own model axes: [along x (width), y (height), along z (depth)].
const GATE_PILLAR: readonly [number, number, number] = [0.6, 3.4, 0.6]
const GATE_BEAM_BASE_Y = 1.9
const GATE_BEAM_HEIGHT = 0.5
const GATE_BEAM_DEPTH = 0.6
const HALL_COLUMN: readonly [number, number, number] = [0.52, 3, 0.52]
const HALL_BEAM_BASE_Y = 1.95
const HALL_BEAM_HEIGHT = 0.3
const HALL_BEAM_DEPTH = 0.5
const HALL_WALL_HEIGHT = 2.4
const HALL_WALL_THICKNESS = 0.15
const STALL: readonly [number, number, number] = [1.2, 1.7, 1.2]
const HOUSE: readonly [number, number, number] = [3, 3.05, 3]
const HOUSE_HALF_DEPTH = HOUSE[2] / 2
const HOUSE_BACK_GAP = 1.8

// The courtyard frame has its back wall at -COURTYARD_DEPTH / 2. The house stands HOUSE_BACK_GAP in front of it.
export const HOUSE_CENTER_Z = -COURTYARD_DEPTH / 2 + HOUSE_BACK_GAP
export const HOUSE_FRONT_Z = HOUSE_CENTER_Z + HOUSE_HALF_DEPTH

function place(
  role: SetPieceRole, x: number, y: number, z: number, rotY: number, target: readonly [number, number, number],
): PiecePlacement {
  const size = SET_PIECE_SPECS[role].size
  return { role, x, y, z, rotY, sx: target[0] / size[0], sy: target[1] / size[1], sz: target[2] / size[2] }
}

function gatePlacements(): PiecePlacement[] {
  const pillarX = ROAD_HALF_WIDTH + 0.4
  const placed = ([-1, 1] as const).map(side => place('gatePillar', side * pillarX, GROUND_Y, 0, 0, GATE_PILLAR))
  placed.push(place('beam', 0, GATE_BEAM_BASE_Y, 0, 0, [pillarX * 2 + 0.6, GATE_BEAM_HEIGHT, GATE_BEAM_DEPTH]))
  return placed
}

function hallPlacements(): PiecePlacement[] {
  const placed: PiecePlacement[] = []
  const segmentCount = Math.ceil(HALL_LENGTH / HALL_PILLAR_SPACING)
  const segmentLength = HALL_LENGTH / segmentCount
  for (const side of [-1, 1] as const) {
    for (const z of hallPillarZs()) placed.push(place('hallColumn', side * HALL_PILLAR_X, GROUND_Y, z, 0, HALL_COLUMN))
    placed.push(place('beam', side * HALL_PILLAR_X, HALL_BEAM_BASE_Y, 0, HALF_TURN, [HALL_LENGTH, HALL_BEAM_HEIGHT, HALL_BEAM_DEPTH]))
    for (let k = 0; k < segmentCount; k++) {
      const z = HALL_LENGTH / 2 - (k + 0.5) * segmentLength
      placed.push(place('hallWall', side * HALL_WALL_X, GROUND_Y, z, side * HALF_TURN,
        [segmentLength, HALL_WALL_HEIGHT, HALL_WALL_THICKNESS]))
    }
  }
  return placed
}

function marketPlacements(): PiecePlacement[] {
  return Array.from({ length: STALL_COUNT }, (_, i) => {
    const seed = STALL_SEED + i
    const side = i % 2 === 0 ? -1 : 1
    const x = side * (BUILDING_CLEARANCE + 0.5 + seeded(seed) * 3)
    const z = (seeded(seed + 1) - 0.5) * 12
    return place('stall', x, GROUND_Y, z, side * HALF_TURN, STALL)
  })
}

export function setPieceLayout(): Readonly<Record<SetPieceGroupName, readonly PiecePlacement[]>> {
  return {
    gate: gatePlacements(),
    hall: hallPlacements(),
    market: marketPlacements(),
    house: [place('house', 0, GROUND_Y, HOUSE_CENTER_Z, Math.PI, HOUSE)],
  }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run tests/journey/setpiece-layout.test.ts tests/journey/path.test.ts tests/journey/footprints.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/journey/path.ts app/journey/footprints.ts app/journey/setpiece-layout.ts tests/journey/path.test.ts tests/journey/setpiece-layout.test.ts
git commit -m "feat: add the set-piece layout and path helpers"
```

---

### Task 4: Model loading, geometry, and the swap target

**Files:**
- Create: `app/journey/building-geometry.ts`
- Create: `app/journey/building-models.ts`
- Create: `app/journey/building-scenery.ts`
- Test: `tests/journey/building-geometry.test.ts`, `tests/journey/building-models.test.ts`, `tests/journey/building-scenery.test.ts`

**Interfaces:**
- Consumes: `PieceSpec`, `SET_PIECE_ROLES`, `SET_PIECE_SPECS`, `NEAR_VARIANT_SPECS`, `BUILDING_MODEL_DIR`, `BUILDING_BOUNDS_TOLERANCE` (Task 2); `attachModels`, `ModelSwapTarget` (`model-swap.ts`).
- Produces:
  - `building-geometry.ts`: `interface BakedPart { geometry: THREE.BufferGeometry; material: THREE.Material }`; `interface NormalizedPiece { parts: readonly BakedPart[]; size: Vec3 }`; `normalizePiece(root: THREE.Object3D, spec: Pick<PieceSpec, 'scale' | 'facingY'>): NormalizedPiece`; `mergeByMaterial(parts: readonly BakedPart[]): BakedPart[]`
  - `building-models.ts`: `interface PieceModel { parts: readonly BakedPart[]; size: Vec3 }`; `interface BuildingModels { setPieces: Readonly<Record<SetPieceRole, PieceModel>>; near: readonly PieceModel[] }`; `type BuildingGltfSource = (url: string) => Promise<{ scene: THREE.Object3D }>`; `loadBuildingModels(source?: BuildingGltfSource): Promise<BuildingModels>`; `disposeBuildingModels(models: BuildingModels): void`; `attachBuildingModels(options: AttachBuildingModelsOptions): Promise<void>`
  - `building-scenery.ts`: `interface SceneryPart { stage(models: BuildingModels): void; show(): void; release(): void }`; `interface BuildingScenery extends ModelSwapTarget<BuildingModels> { dispose(): void }`; `createBuildingScenery(parts: readonly SceneryPart[]): BuildingScenery`

- [ ] **Step 1: Write the failing geometry tests**

```ts
// tests/journey/building-geometry.test.ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { mergeByMaterial, normalizePiece } from '../../app/journey/building-geometry'

function box(width: number, height: number, depth: number, material: THREE.Material, at: [number, number, number]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
  mesh.position.set(...at)
  return mesh
}

describe('normalizePiece', () => {
  it('scales, puts the pivot at the base center and reports the size', () => {
    const root = new THREE.Group()
    root.add(box(2, 4, 2, new THREE.MeshStandardMaterial(), [5, 10, 7]))
    const piece = normalizePiece(root, { scale: 0.5, facingY: 0 })
    expect(piece.size[0]).toBeCloseTo(1, 5)
    expect(piece.size[1]).toBeCloseTo(2, 5)
    expect(piece.size[2]).toBeCloseTo(1, 5)
    const bounds = new THREE.Box3()
    for (const part of piece.parts) { part.geometry.computeBoundingBox(); bounds.union(part.geometry.boundingBox!) }
    expect(bounds.min.y).toBeCloseTo(0, 5)
    expect((bounds.min.x + bounds.max.x) / 2).toBeCloseTo(0, 5)
    expect((bounds.min.z + bounds.max.z) / 2).toBeCloseTo(0, 5)
  })

  it('applies ancestor transforms', () => {
    const root = new THREE.Group()
    root.position.set(0, 3, 0)
    const child = new THREE.Group()
    child.position.set(0, 2, 0)
    child.add(box(1, 1, 1, new THREE.MeshStandardMaterial(), [0, 0, 0]))
    root.add(child)
    const piece = normalizePiece(root, { scale: 1, facingY: 0 })
    expect(piece.size).toEqual([1, 1, 1].map(v => expect.closeTo(v, 5)))
  })

  it('swaps width and depth for a quarter-turn facing', () => {
    const root = new THREE.Group()
    root.add(box(4, 1, 2, new THREE.MeshStandardMaterial(), [0, 0, 0]))
    const piece = normalizePiece(root, { scale: 1, facingY: Math.PI / 2 })
    expect(piece.size[0]).toBeCloseTo(2, 5)
    expect(piece.size[2]).toBeCloseTo(4, 5)
  })

  it('rejects a model with no meshes', () => {
    expect(() => normalizePiece(new THREE.Group(), { scale: 1, facingY: 0 })).toThrow('has no meshes')
  })

  it('does not change the source geometry', () => {
    const mesh = box(2, 2, 2, new THREE.MeshStandardMaterial(), [3, 3, 3])
    const before = mesh.geometry.getAttribute('position').array.slice()
    const root = new THREE.Group()
    root.add(mesh)
    normalizePiece(root, { scale: 2, facingY: Math.PI })
    expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(Array.from(before))
  })
})

describe('mergeByMaterial', () => {
  it('merges parts that share a material name into one geometry', () => {
    const wall = new THREE.MeshStandardMaterial({ name: 'wall' })
    const roof = new THREE.MeshStandardMaterial({ name: 'roof' })
    const parts = [
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: wall },
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: roof },
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: wall },
    ]
    const merged = mergeByMaterial(parts)
    expect(merged).toHaveLength(2)
    const wallPart = merged.find(part => part.material === wall)!
    expect(wallPart.geometry.getAttribute('position').count).toBe(2 * 24)
  })

  it('keeps the first material instance for a name', () => {
    const first = new THREE.MeshStandardMaterial({ name: 'wall' })
    const second = new THREE.MeshStandardMaterial({ name: 'wall' })
    const merged = mergeByMaterial([
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: first },
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: second },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.material).toBe(first)
  })

  it('throws a readable error for incompatible attributes', () => {
    const material = new THREE.MeshStandardMaterial({ name: 'm' })
    const plain = new THREE.BufferGeometry()
    plain.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
    expect(() => mergeByMaterial([{ geometry: new THREE.BoxGeometry(1, 1, 1), material }, { geometry: plain, material }]))
      .toThrow('incompatible attributes')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/journey/building-geometry.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the geometry module**

```ts
// app/journey/building-geometry.ts
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { PieceSpec } from './building-specs'
import type { Vec3 } from './stops'

export interface BakedPart {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

export interface NormalizedPiece {
  parts: readonly BakedPart[]
  size: Vec3
}

// Bakes every mesh of a model into one frame: world transform, uniform scale, facing turn about Y, then the
// pivot moved to the center of the base (min y = 0, x and z centered). Source geometry is cloned, not changed.
export function normalizePiece(root: THREE.Object3D, spec: Pick<PieceSpec, 'scale' | 'facingY'>): NormalizedPiece {
  root.updateWorldMatrix(true, true)
  const toScene = new THREE.Matrix4().makeRotationY(spec.facingY).multiply(new THREE.Matrix4().makeScale(spec.scale, spec.scale, spec.scale))
  const baked: BakedPart[] = []
  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    if (Array.isArray(mesh.material)) throw new Error('A building model has a multi-material mesh, which is not supported')
    const geometry = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toScene, mesh.matrixWorld))
    baked.push({ geometry, material: mesh.material })
  })
  if (baked.length === 0) throw new Error('A building model has no meshes')
  const bounds = new THREE.Box3()
  for (const part of baked) {
    part.geometry.computeBoundingBox()
    bounds.union(part.geometry.boundingBox as THREE.Box3)
  }
  const center = bounds.getCenter(new THREE.Vector3())
  const pivot = new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z)
  for (const part of baked) {
    part.geometry.applyMatrix4(pivot)
    part.geometry.computeBoundingBox()
  }
  const size = bounds.getSize(new THREE.Vector3())
  return { parts: baked, size: [size.x, size.y, size.z] }
}

// One geometry per material name. The first material instance seen for a name is the one kept.
export function mergeByMaterial(parts: readonly BakedPart[]): BakedPart[] {
  const groups = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>()
  for (const part of parts) {
    const group = groups.get(part.material.name) ?? { material: part.material, geometries: [] }
    group.geometries.push(part.geometry)
    groups.set(part.material.name, group)
  }
  return [...groups.values()].map(({ material, geometries }) => {
    const geometry = mergeGeometries(geometries, false)
    if (!geometry) throw new Error('Building model parts have incompatible attributes')
    return { geometry, material }
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/journey/building-geometry.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the failing loader tests**

```ts
// tests/journey/building-models.test.ts
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  BUILDING_MODEL_DIR, NEAR_VARIANT_SPECS, type PieceSpec, SET_PIECE_ROLES, SET_PIECE_SPECS,
} from '../../app/journey/building-specs'
import { attachBuildingModels, type BuildingGltfSource, disposeBuildingModels, loadBuildingModels } from '../../app/journey/building-models'

const allSpecs: readonly PieceSpec[] = [...SET_PIECE_ROLES.map(role => SET_PIECE_SPECS[role]), ...NEAR_VARIANT_SPECS]

// A stand-in GLB scene whose normalized size equals the spec. A quarter-turn facing swaps width and depth.
function fakeScene(spec: PieceSpec, materialName = 'palette', map = new THREE.Texture()): THREE.Group {
  const turned = Math.abs(Math.sin(spec.facingY)) > 0.5
  const [w, h, d] = spec.size.map(v => v / spec.scale) as [number, number, number]
  const material = new THREE.MeshStandardMaterial({ name: materialName, map })
  const group = new THREE.Group()
  group.add(new THREE.Mesh(new THREE.BoxGeometry(turned ? d : w, h, turned ? w : d), material))
  return group
}

function fakeSource(overrides: Record<string, () => THREE.Object3D> = {}): BuildingGltfSource {
  return async url => {
    const spec = allSpecs.find(candidate => url === BUILDING_MODEL_DIR + candidate.file)
    if (!spec) throw new Error(`Unexpected url ${url}`)
    return { scene: overrides[spec.file]?.() ?? fakeScene(spec) }
  }
}

describe('loadBuildingModels', () => {
  it('returns a normalized model for every role and every near variant', async () => {
    const models = await loadBuildingModels(fakeSource())
    for (const role of SET_PIECE_ROLES) {
      expect(models.setPieces[role].parts.length).toBeGreaterThan(0)
      for (const [i, value] of models.setPieces[role].size.entries()) expect(value).toBeCloseTo(SET_PIECE_SPECS[role].size[i] ?? 0, 2)
    }
    expect(models.near).toHaveLength(NEAR_VARIANT_SPECS.length)
    disposeBuildingModels(models)
  })

  it('fetches each file once even when two specs name it', async () => {
    const source = vi.fn(fakeSource())
    const models = await loadBuildingModels(source)
    const unique = new Set(allSpecs.map(spec => spec.file))
    expect(source).toHaveBeenCalledTimes(unique.size)
    disposeBuildingModels(models)
  })

  it('shares one material instance per material name and disposes the spares', async () => {
    const maps = allSpecs.map(() => new THREE.Texture())
    const spies = maps.map(texture => vi.spyOn(texture, 'dispose'))
    let index = 0
    const source: BuildingGltfSource = async url => {
      const spec = allSpecs.find(candidate => url === BUILDING_MODEL_DIR + candidate.file)!
      return { scene: fakeScene(spec, 'palette', maps[index++]) }
    }
    const models = await loadBuildingModels(source)
    const materials = new Set([...SET_PIECE_ROLES.flatMap(role => models.setPieces[role].parts), ...models.near.flatMap(piece => piece.parts)]
      .map(part => part.material))
    expect(materials.size).toBe(1)
    const kept = [...materials][0] as THREE.MeshStandardMaterial
    expect(spies.filter(spy => spy.mock.calls.length > 0)).toHaveLength(new Set(allSpecs.map(spec => spec.file)).size - 1)
    expect(kept.map).toBe(maps[0])
    disposeBuildingModels(models)
  })

  it('rejects a model whose size drifts, and disposes what it built', async () => {
    const first = allSpecs[0]!
    const drift = () => {
      const group = new THREE.Group()
      group.add(new THREE.Mesh(new THREE.BoxGeometry(...first.size.map(v => (v / first.scale) * 3) as [number, number, number]),
        new THREE.MeshStandardMaterial({ name: 'palette' })))
      return group
    }
    await expect(loadBuildingModels(fakeSource({ [first.file]: drift }))).rejects.toThrow('does not match its spec')
  })

  it('rejects a model with no meshes', async () => {
    const first = allSpecs[0]!
    await expect(loadBuildingModels(fakeSource({ [first.file]: () => new THREE.Group() }))).rejects.toThrow('has no meshes')
  })

  it('rejects when a download fails', async () => {
    const failing: BuildingGltfSource = async () => { throw new Error('404') }
    await expect(loadBuildingModels(failing)).rejects.toThrow('404')
  })
})

describe('disposeBuildingModels', () => {
  it('disposes every geometry and the shared material and its texture', async () => {
    const models = await loadBuildingModels(fakeSource())
    const parts = [...SET_PIECE_ROLES.flatMap(role => models.setPieces[role].parts), ...models.near.flatMap(piece => piece.parts)]
    const geometrySpies = parts.map(part => vi.spyOn(part.geometry, 'dispose'))
    const material = parts[0]!.material as THREE.MeshStandardMaterial
    const materialSpy = vi.spyOn(material, 'dispose')
    const textureSpy = vi.spyOn(material.map as THREE.Texture, 'dispose')
    disposeBuildingModels(models)
    expect(geometrySpies.every(spy => spy.mock.calls.length > 0)).toBe(true)
    expect(materialSpy).toHaveBeenCalled()
    expect(textureSpy).toHaveBeenCalled()
  })
})

describe('attachBuildingModels', () => {
  it('stages, warms, shows, then reports ready', async () => {
    const calls: string[] = []
    const models = await loadBuildingModels(fakeSource())
    await attachBuildingModels({
      target: { stageModels: () => calls.push('stage'), showModels: () => calls.push('show'), discardModels: () => calls.push('discard') },
      load: async () => models,
      isDisposed: () => false,
      warm: async () => { calls.push('warm') },
      onReady: () => calls.push('ready'),
    })
    expect(calls).toEqual(['stage', 'warm', 'show', 'ready'])
    disposeBuildingModels(models)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run tests/journey/building-models.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 7: Write the loader**

```ts
// app/journey/building-models.ts
import * as THREE from 'three'
import { type BakedPart, normalizePiece } from './building-geometry'
import {
  BUILDING_BOUNDS_TOLERANCE, BUILDING_MODEL_DIR, NEAR_VARIANT_SPECS, type PieceSpec, SET_PIECE_ROLES,
  SET_PIECE_SPECS, type SetPieceRole,
} from './building-specs'
import { attachModels, type ModelSwapTarget } from './model-swap'
import type { Vec3 } from './stops'

export interface PieceModel {
  readonly parts: readonly BakedPart[]
  readonly size: Vec3
}

export interface BuildingModels {
  readonly setPieces: Readonly<Record<SetPieceRole, PieceModel>>
  readonly near: readonly PieceModel[]
}

export type BuildingGltfSource = (url: string) => Promise<{ scene: THREE.Object3D }>

async function loadGltf(url: string): Promise<{ scene: THREE.Object3D }> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js')
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url)
}

function assertMatchesSpec(spec: PieceSpec, size: Vec3): void {
  const matches = size.every((value, i) => Math.abs(value - (spec.size[i] ?? 0)) <= BUILDING_BOUNDS_TOLERANCE)
  if (!matches) {
    throw new Error(`The ${spec.file} model does not match its spec. Measured ${JSON.stringify(size)}, expected ${JSON.stringify(spec.size)}`)
  }
}

function textureValues(material: THREE.Material): THREE.Texture[] {
  return Object.values(material).filter((value): value is THREE.Texture => value instanceof THREE.Texture)
}

// All pieces share one material instance per material name. The spare copies (and their textures) are never drawn.
function unifyMaterials(pieces: readonly PieceModel[]): PieceModel[] {
  const canonical = new Map<string, THREE.Material>()
  const spares = new Set<THREE.Material>()
  const unified = pieces.map((piece): PieceModel => ({
    size: piece.size,
    parts: piece.parts.map(part => {
      const kept = canonical.get(part.material.name) ?? part.material
      canonical.set(part.material.name, kept)
      if (kept !== part.material) spares.add(part.material)
      return { geometry: part.geometry, material: kept }
    }),
  }))
  for (const spare of spares) {
    for (const texture of textureValues(spare)) texture.dispose()
    spare.dispose()
  }
  return unified
}

function disposePieces(pieces: readonly PieceModel[]): void {
  const materials = new Set<THREE.Material>()
  for (const piece of pieces) {
    for (const part of piece.parts) {
      part.geometry.dispose()
      materials.add(part.material)
    }
  }
  for (const material of materials) {
    for (const texture of textureValues(material)) texture.dispose()
    material.dispose()
  }
}

export async function loadBuildingModels(source: BuildingGltfSource = loadGltf): Promise<BuildingModels> {
  const specs: readonly PieceSpec[] = [...SET_PIECE_ROLES.map(role => SET_PIECE_SPECS[role]), ...NEAR_VARIANT_SPECS]
  const files = [...new Set(specs.map(spec => spec.file))]
  const scenes = new Map(await Promise.all(files.map(async file => [file, (await source(BUILDING_MODEL_DIR + file)).scene] as const)))
  const built: PieceModel[] = []
  try {
    for (const spec of specs) {
      const scene = scenes.get(spec.file)
      if (!scene) throw new Error(`The ${spec.file} model did not load`)
      const piece = normalizePiece(scene, spec)
      built.push(piece)
      assertMatchesSpec(spec, piece.size)
    }
  } catch (error) {
    disposePieces(built)
    throw error
  }
  const unified = unifyMaterials(built)
  const setPieceModels = unified.slice(0, SET_PIECE_ROLES.length)
  const setPieces = Object.fromEntries(SET_PIECE_ROLES.map((role, i) => [role, setPieceModels[i]])) as Record<SetPieceRole, PieceModel>
  return { setPieces, near: unified.slice(SET_PIECE_ROLES.length) }
}

export function disposeBuildingModels(models: BuildingModels): void {
  disposePieces([...SET_PIECE_ROLES.map(role => models.setPieces[role]), ...models.near])
}

export type BuildingModelTarget = ModelSwapTarget<BuildingModels>

export interface AttachBuildingModelsOptions {
  target: BuildingModelTarget
  load: () => Promise<BuildingModels>
  isDisposed: () => boolean
  // Runs after the models are staged (hidden) and before they show. The scene compiles their shaders here.
  warm?: () => Promise<void>
  onReady?: () => void
  // Called at most once, and never after the scene is disposed.
  onError?: (error: unknown) => void
}

// Never rejects. A failed load, a rejected stage, or a failed warmup keeps the current look.
export async function attachBuildingModels(options: AttachBuildingModelsOptions): Promise<void> {
  const { target, load, isDisposed, warm, onReady, onError } = options
  return attachModels({ target, load, disposeModels: disposeBuildingModels, isDisposed, warm, onReady, onError })
}
```

A scene with materials that share a name across files is an assumption of the kit. If Task 1 found the kit names its materials differently per file, make the names match in Task 1's optimize step. Do not change this loader.

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run tests/journey/building-models.test.ts`
Expected: PASS (9 tests). If `rejects a model whose size drifts` fails because the first spec has `facingY` of a quarter turn, the fake scene already handles it. Re-check the box dimensions in the test.

- [ ] **Step 9: Write the failing scenery tests**

```ts
// tests/journey/building-scenery.test.ts
import { describe, expect, it, vi } from 'vitest'
import * as models from '../../app/journey/building-models'
import { createBuildingScenery, type SceneryPart } from '../../app/journey/building-scenery'

const fakeModels = { setPieces: {}, near: [] } as unknown as models.BuildingModels

function part(overrides: Partial<SceneryPart> = {}): SceneryPart & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    stage: () => { calls.push('stage'); overrides.stage?.(fakeModels) },
    show: () => calls.push('show'),
    release: () => calls.push('release'),
  }
}

describe('createBuildingScenery', () => {
  it('stages, shows, and releases every part in order', () => {
    const a = part()
    const b = part()
    const scenery = createBuildingScenery([a, b])
    scenery.stageModels(fakeModels)
    scenery.showModels()
    expect(a.calls).toEqual(['stage', 'show'])
    expect(b.calls).toEqual(['stage', 'show'])
  })

  it('releases the parts already staged when a later part throws while staging', () => {
    const a = part()
    const b = part({ stage: () => { throw new Error('stage') } })
    const scenery = createBuildingScenery([a, b])
    expect(() => scenery.stageModels(fakeModels)).toThrow('stage')
    expect(a.calls).toEqual(['stage', 'release'])
  })

  it('discard releases the parts and disposes the models once', () => {
    const dispose = vi.spyOn(models, 'disposeBuildingModels').mockImplementation(() => {})
    const a = part()
    const scenery = createBuildingScenery([a])
    scenery.stageModels(fakeModels)
    scenery.discardModels()
    scenery.discardModels()
    expect(a.calls).toEqual(['stage', 'release'])
    expect(dispose).toHaveBeenCalledTimes(1)
    dispose.mockRestore()
  })

  it('dispose releases the parts and disposes the models, and does nothing twice', () => {
    const dispose = vi.spyOn(models, 'disposeBuildingModels').mockImplementation(() => {})
    const a = part()
    const scenery = createBuildingScenery([a])
    scenery.stageModels(fakeModels)
    scenery.showModels()
    scenery.dispose()
    scenery.dispose()
    expect(a.calls).toEqual(['stage', 'show', 'release'])
    expect(dispose).toHaveBeenCalledTimes(1)
    dispose.mockRestore()
  })

  it('ignores staging after dispose and ignores a second stage', () => {
    const a = part()
    const scenery = createBuildingScenery([a])
    scenery.stageModels(fakeModels)
    scenery.stageModels(fakeModels)
    scenery.dispose()
    scenery.stageModels(fakeModels)
    expect(a.calls.filter(call => call === 'stage')).toHaveLength(1)
  })

  it('does nothing on show or discard before staging', () => {
    const a = part()
    const scenery = createBuildingScenery([a])
    scenery.showModels()
    scenery.discardModels()
    expect(a.calls).toEqual([])
  })
})
```

- [ ] **Step 10: Run to verify it fails**

Run: `npx vitest run tests/journey/building-scenery.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 11: Write the scenery composite**

The composite owns the models. Parts only own their own meshes and geometries.

```ts
// app/journey/building-scenery.ts
import { type BuildingModels, disposeBuildingModels } from './building-models'
import type { ModelSwapTarget } from './model-swap'

// One piece of the building scenery (the set-pieces, the near layer). It owns the meshes and geometry it
// builds, not the models it builds them from.
export interface SceneryPart {
  stage(models: BuildingModels): void
  show(): void
  // Removes and disposes what `stage` built. Safe to call before `stage` or twice.
  release(): void
}

export interface BuildingScenery extends ModelSwapTarget<BuildingModels> {
  dispose(): void
}

export function createBuildingScenery(parts: readonly SceneryPart[]): BuildingScenery {
  let owned: BuildingModels | null = null
  let offered = false
  let disposed = false

  function releaseAll(): void {
    for (const part of parts) part.release()
    if (owned) disposeBuildingModels(owned)
    owned = null
  }

  return {
    stageModels(models) {
      if (disposed || offered) return
      offered = true
      const staged: SceneryPart[] = []
      try {
        for (const part of parts) {
          part.stage(models)
          staged.push(part)
        }
      } catch (error) {
        // The caller disposes the models when staging throws, so release only the parts.
        for (const part of staged) part.release()
        throw error
      }
      owned = models
    },
    showModels() {
      if (disposed || !owned) return
      for (const part of parts) part.show()
    },
    discardModels() {
      if (disposed || !owned) return
      releaseAll()
    },
    dispose() {
      if (disposed) return
      disposed = true
      releaseAll()
    },
  }
}
```

- [ ] **Step 12: Run all three test files**

Run: `npx vitest run tests/journey/building-geometry.test.ts tests/journey/building-models.test.ts tests/journey/building-scenery.test.ts`
Expected: PASS. Note: the scenery test mocks `disposeBuildingModels` with `vi.spyOn` on the module namespace. If Vitest reports that the export is not configurable, replace the spy with `vi.mock('../../app/journey/building-models', async importOriginal => ({ ...(await importOriginal<typeof import('../../app/journey/building-models')>()), disposeBuildingModels: vi.fn() }))` and import the mocked function.

- [ ] **Step 13: Commit**

```bash
git add app/journey/building-geometry.ts app/journey/building-models.ts app/journey/building-scenery.ts tests/journey/building-geometry.test.ts tests/journey/building-models.test.ts tests/journey/building-scenery.test.ts
git commit -m "feat: load building models and compose the scenery swap target"
```

---

### Task 5: Set-pieces in the scene

**Files:**
- Create: `app/journey/setpieces.ts`
- Modify: `app/journey/scene.ts` (return shapes of the four `create*` functions, wiring, options, dispose)
- Modify: `tests/gpu/harness.ts` (`buildings` option, `waitForBuildings`, test seams)
- Test: `tests/journey/setpieces.test.ts`, `tests/gpu/buildings-models.spec.ts`

**Interfaces:**
- Consumes: `BuildingModels`, `BakedPart` (Task 4); `setPieceLayout`, `HOUSE_FRONT_Z`, `PiecePlacement` (Task 3); `mergeByMaterial` (Task 4); `HOUSE_WINDOW_SLOTS`, `SCENERY_GROUP_NAME` (Task 2); `SceneryPart`, `createBuildingScenery`, `attachBuildingModels`, `loadBuildingModels` (Task 4); `pathSegmentAt` (Task 3).
- Produces:
  - `setpieces.ts`: `interface SetPieceFallbacks { gate: THREE.Object3D; hall: THREE.Object3D; market: THREE.Object3D; house: THREE.Object3D; houseWindows: readonly THREE.Object3D[] }`; `interface SetPieces extends SceneryPart { readonly group: THREE.Group }`; `createSetPieces(fallbacks: SetPieceFallbacks): SetPieces`; `placeOnPath(group: THREE.Group, point: { x: number; z: number }, dirX: number, dirZ: number): THREE.Group` (moved from `scene.ts`)
  - `JourneySceneOptions`: `loadBuildingModels?: () => Promise<BuildingModels>`, `onBuildingsReady?: () => void`, `onBuildingsFailed?: (error: unknown) => void`
  - Harness: `cityGpu.waitForBuildings(): Promise<void>`; `mountJourney` option `buildings?: boolean`

- [ ] **Step 1: Write the failing set-piece tests**

```ts
// tests/journey/setpieces.test.ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { HOUSE_WINDOW_SLOTS, SCENERY_GROUP_NAME, SET_PIECE_ROLES, SET_PIECE_SPECS } from '../../app/journey/building-specs'
import type { BuildingModels } from '../../app/journey/building-models'
import { createSetPieces, placeOnPath } from '../../app/journey/setpieces'
import { HOUSE_FRONT_Z, setPieceLayout } from '../../app/journey/setpiece-layout'

function fakeModels(materialNames: readonly string[] = ['palette']): BuildingModels {
  const materials = materialNames.map(name => new THREE.MeshStandardMaterial({ name }))
  const setPieces = Object.fromEntries(SET_PIECE_ROLES.map(role => {
    const size = SET_PIECE_SPECS[role].size
    const parts = materials.map(material => {
      const geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
      geometry.translate(0, size[1] / 2, 0)
      return { geometry, material }
    })
    return [role, { parts, size }]
  })) as unknown as BuildingModels['setPieces']
  return { setPieces, near: [] }
}

function fallbacks() {
  return {
    gate: new THREE.Group(), hall: new THREE.Group(), market: new THREE.Group(), house: new THREE.Group(),
    houseWindows: [new THREE.Mesh(), new THREE.Mesh()],
  }
}

describe('placeOnPath', () => {
  it('moves the group to the point and rotates it to the heading', () => {
    const group = placeOnPath(new THREE.Group(), { x: 3, z: -4 }, 0, -1)
    expect(group.position.x).toBe(3)
    expect(group.position.z).toBe(-4)
    expect(group.rotation.y).toBeCloseTo(0, 5)
  })
})

describe('createSetPieces', () => {
  it('builds nothing visible before models arrive', () => {
    const setPieces = createSetPieces(fallbacks())
    expect(setPieces.group.name).toBe(SCENERY_GROUP_NAME + '-set-pieces')
    expect(setPieces.group.children).toHaveLength(0)
  })

  it('stages four hidden groups with one mesh per material, then shows them and hides the fallbacks', () => {
    const fb = fallbacks()
    const setPieces = createSetPieces(fb)
    setPieces.stage(fakeModels(['wall', 'roof']))
    expect(setPieces.group.children).toHaveLength(4)
    expect(setPieces.group.visible).toBe(false)
    for (const child of setPieces.group.children) {
      const meshes = child.children.filter(object => (object as THREE.Mesh).isMesh)
      expect(meshes).toHaveLength(2)
    }
    expect(fb.gate.visible).toBe(true)
    setPieces.show()
    expect(setPieces.group.visible).toBe(true)
    expect([fb.gate, fb.hall, fb.market, fb.house].map(object => object.visible)).toEqual([false, false, false, false])
  })

  it('bakes each placement into the merged geometry', () => {
    const setPieces = createSetPieces(fallbacks())
    setPieces.stage(fakeModels())
    const layout = setPieceLayout()
    const marketGroup = setPieces.group.children.find(child => child.name.endsWith('market'))!
    const mesh = marketGroup.children.find(object => (object as THREE.Mesh).isMesh) as THREE.Mesh
    // One box (24 vertices) per stall.
    expect(mesh.geometry.getAttribute('position').count).toBe(layout.market.length * 24)
  })

  it('moves the courtyard windows onto the house front', () => {
    const fb = fallbacks()
    const setPieces = createSetPieces(fb)
    setPieces.stage(fakeModels())
    setPieces.show()
    HOUSE_WINDOW_SLOTS.forEach((slot, i) => {
      const win = fb.houseWindows[i]!
      expect(win.position.x).toBeCloseTo(slot.x, 5)
      expect(win.position.y).toBeCloseTo(-1 + slot.y, 5)
      expect(win.position.z).toBeGreaterThan(HOUSE_FRONT_Z)
    })
  })

  it('release removes the groups, disposes their geometry, and leaves the fallbacks visible', () => {
    const fb = fallbacks()
    const setPieces = createSetPieces(fb)
    setPieces.stage(fakeModels())
    const geometries: THREE.BufferGeometry[] = []
    setPieces.group.traverse(object => { if ((object as THREE.Mesh).isMesh) geometries.push((object as THREE.Mesh).geometry) })
    const disposed = geometries.map(geometry => { let called = false; geometry.addEventListener('dispose', () => { called = true }); return () => called })
    setPieces.release()
    expect(setPieces.group.children).toHaveLength(0)
    expect(disposed.every(check => check())).toBe(true)
    expect(fb.gate.visible).toBe(true)
    setPieces.release()
  })

  it('ignores a second stage', () => {
    const setPieces = createSetPieces(fallbacks())
    setPieces.stage(fakeModels())
    setPieces.stage(fakeModels())
    expect(setPieces.group.children).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/journey/setpieces.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `setpieces.ts`**

```ts
// app/journey/setpieces.ts
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BuildingModels } from './building-models'
import type { SceneryPart } from './building-scenery'
import { HOUSE_WINDOW_SLOTS, SCENERY_GROUP_NAME } from './building-specs'
import { headingFor, pathSegmentAt, PLACES } from './path'
import { HOUSE_FRONT_Z, type PiecePlacement, type SetPieceGroupName, setPieceLayout } from './setpiece-layout'

// Where each set-piece group stands. The groups are authored facing world -Z, as the primitives are.
const GROUP_PLACES = {
  gate: { place: PLACES.entrance, segment: 0 },
  hall: { place: PLACES.hall, segment: 0 },
  market: { place: PLACES.market, segment: 1 },
  house: { place: PLACES.courtyard, segment: 2 },
} as const satisfies Record<SetPieceGroupName, { place: { x: number; z: number }; segment: number }>

const GROUP_ORDER: readonly SetPieceGroupName[] = ['gate', 'hall', 'market', 'house']
// The window planes sit just in front of the house wall so they do not z-fight with it.
const WINDOW_OFFSET_Z = 0.01
const GROUND_Y = -1

// Places a set-piece group, authored facing world -Z, at `point` and rotates it to face `dirX, dirZ`
// (the heading of the segment it belongs to).
export function placeOnPath(group: THREE.Group, point: { x: number; z: number }, dirX: number, dirZ: number): THREE.Group {
  group.position.set(point.x, 0, point.z)
  group.rotation.y = headingFor(dirX, dirZ)
  return group
}

export interface SetPieceFallbacks {
  // The primitive stand-ins that hide once the models show.
  gate: THREE.Object3D
  hall: THREE.Object3D
  market: THREE.Object3D
  house: THREE.Object3D
  // The always-lit window planes. They stay visible and move onto the model's front face.
  houseWindows: readonly THREE.Object3D[]
}

export interface SetPieces extends SceneryPart {
  readonly group: THREE.Group
}

const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const axisY = new THREE.Vector3(0, 1, 0)

// Bakes every placement of one group into one geometry per material, so a group costs one draw call per material.
function bakeGroup(name: SetPieceGroupName, placements: readonly PiecePlacement[], models: BuildingModels): THREE.Group {
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>()
  for (const placement of placements) {
    matrix.compose(position.set(placement.x, placement.y, placement.z), rotation.setFromAxisAngle(axisY, placement.rotY),
      scale.set(placement.sx, placement.sy, placement.sz))
    for (const part of models.setPieces[placement.role].parts) {
      const list = byMaterial.get(part.material) ?? []
      list.push(part.geometry.clone().applyMatrix4(matrix))
      byMaterial.set(part.material, list)
    }
  }
  const group = new THREE.Group()
  group.name = `${SCENERY_GROUP_NAME}-${name}`
  for (const [material, geometries] of byMaterial) {
    const merged = mergeGeometries(geometries, false)
    for (const geometry of geometries) geometry.dispose()
    if (!merged) throw new Error(`The ${name} set-piece parts have incompatible attributes`)
    const mesh = new THREE.Mesh(merged, material)
    mesh.name = `${SCENERY_GROUP_NAME}-${name}-mesh`
    group.add(mesh)
  }
  const { place, segment } = GROUP_PLACES[name]
  const direction = pathSegmentAt(segment)
  return placeOnPath(group, place, direction.dirX, direction.dirZ)
}

export function createSetPieces(fallbacks: SetPieceFallbacks): SetPieces {
  const group = new THREE.Group()
  group.name = `${SCENERY_GROUP_NAME}-set-pieces`
  let staged = false

  function release(): void {
    for (const child of [...group.children]) {
      child.traverse(object => { if ((object as THREE.Mesh).isMesh) (object as THREE.Mesh).geometry.dispose() })
      group.remove(child)
    }
    staged = false
  }

  return {
    group,
    stage(models) {
      if (staged) return
      staged = true
      const layout = setPieceLayout()
      try {
        for (const name of GROUP_ORDER) group.add(bakeGroup(name, layout[name], models))
      } catch (error) {
        release()
        throw error
      }
      group.visible = false
    },
    show() {
      if (!staged) return
      group.visible = true
      for (const fallback of [fallbacks.gate, fallbacks.hall, fallbacks.market, fallbacks.house]) fallback.visible = false
      fallbacks.houseWindows.forEach((window, i) => {
        const slot = HOUSE_WINDOW_SLOTS[i]
        if (!slot) { window.visible = false; return }
        window.position.set(slot.x, GROUND_Y + slot.y, HOUSE_FRONT_Z + WINDOW_OFFSET_Z)
      })
    },
    release,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/journey/setpieces.test.ts`
Expected: PASS. If `release removes the groups ...` fails because `BufferGeometry` fires no `dispose` event to a listener added before dispose, that is the standard Three.js behavior and the test should pass. If it fails for another reason, report it.

- [ ] **Step 5: Refactor the four builders in `scene.ts` to expose their fallbacks**

Edit `app/journey/scene.ts`. Delete the local `placeOnPath` function (lines 332-338) and import it from `./setpieces`. Then change each builder's return shape. Every change keeps the primitives identical.

`createGate` stays as is (the whole group is its own fallback). `createColonnade` wraps pillars, architraves, and walls in a child group so the picture frames stay visible:

```ts
interface Colonnade {
  group: THREE.Group
  // The pillars, architraves, and walls. Hidden when the models show; the picture frames stay.
  structure: THREE.Group
}

function createColonnade(projectItems: readonly ExhibitItem[]): Colonnade {
  const group = new THREE.Group()
  const structure = new THREE.Group()
  group.add(structure)
  // ... existing body, with `structure.add(...)` in place of `group.add(...)` for pillar, architrave and wall;
  // `group.add(...)` stays for border and picture.
  return { group, structure }
}
```

Apply the same idea to the market and the courtyard:

```ts
interface Market {
  group: THREE.Group
  // The box-and-pyramid stalls. Hidden when the models show; the lamp posts stay.
  stalls: THREE.Group
}
// createMarket(): add each stall base and roof to `stalls`; lamps stay on `group`.

interface Courtyard {
  group: THREE.Group
  // The box-and-cone house. Hidden when the model shows.
  house: THREE.Group
  // The two always-lit window planes. They stay and move onto the model's front face.
  windows: THREE.Mesh[]
}
// createCourtyard(): add the house box and roof to `house`; push each window plane to `windows` and `group`.
```

The existing wall meshes, picture frames, and lamps remain direct children of `group`. In `createJourneyScene`, replace the four `scene.add(placeOnPath(...))` lines:

```ts
  const gate = createGate()
  const colonnade = createColonnade(projectItems)
  const market = createMarket()
  const courtyard = createCourtyard()
  scene.add(placeOnPath(gate, PLACES.entrance, seg1.dirX, seg1.dirZ))
  scene.add(placeOnPath(colonnade.group, PLACES.hall, seg1.dirX, seg1.dirZ))
  scene.add(placeOnPath(market.group, PLACES.market, seg2.dirX, seg2.dirZ))
  scene.add(placeOnPath(courtyard.group, PLACES.courtyard, seg3.dirX, seg3.dirZ))
```

After deleting the local `placeOnPath`, `headingFor` is no longer used in `scene.ts`. Remove it from the `./path` import so typecheck stays clean.

- [ ] **Step 6: Wire the swap into `scene.ts`**

Add imports:

```ts
import { attachBuildingModels, type BuildingModels, loadBuildingModels } from './building-models'
import { type BuildingScenery, createBuildingScenery } from './building-scenery'
import { SCENERY_GROUP_NAME } from './building-specs'
import { createSetPieces, placeOnPath } from './setpieces'
```

Add to `JourneySceneOptions`:

```ts
  // Test seam: replaces the building GLB download. The default loads them from /models/buildings/.
  loadBuildingModels?: () => Promise<BuildingModels>
  // Called after the building models replace the primitives. Never called if the load fails or the scene is disposed first.
  onBuildingsReady?: () => void
  // Called once when the building load or swap fails. The primitives stay.
  onBuildingsFailed?: (error: unknown) => void
```

Add a `let scenery: BuildingScenery | null = null` beside `let people`, import its type, and add `scenery?.dispose()` in `dispose()` right after `people?.dispose()`.

After the four `scene.add(placeOnPath(...))` lines, add:

```ts
  // Building scenery: the GLB set-pieces (and, from Task 6, the near layer) arrive after the first frame.
  const setPieces = createSetPieces({
    gate, hall: colonnade.structure, market: market.stalls, house: courtyard.house, houseWindows: courtyard.windows,
  })
  const sceneryGroup = new THREE.Group()
  sceneryGroup.name = SCENERY_GROUP_NAME
  sceneryGroup.add(setPieces.group)
  scene.add(sceneryGroup)
  const buildingScenery = createBuildingScenery([setPieces])
  scenery = buildingScenery
  async function warmSceneryShaders(): Promise<void> {
    await preservingState(renderer, () => {
      renderer.setRenderTarget(post?.sceneTarget ?? null)
      return renderer.compileAsync(sceneryGroup, camera, scene)
    })
  }
  void attachBuildingModels({
    target: buildingScenery,
    load: options.loadBuildingModels ?? (() => loadBuildingModels()),
    isDisposed: () => disposed,
    warm: warmSceneryShaders,
    onReady: options.onBuildingsReady,
    onError(error) {
      console.warn('Journey buildings: the GLB models could not be used. Keeping the primitive buildings.', error)
      options.onBuildingsFailed?.(error)
    },
  })
```

Dispose ordering: `buildingScenery.dispose()` releases the set-piece groups. `scene.traverse` in `dispose()` also visits them if they are still in the graph. Both paths are safe because Three.js `dispose()` is idempotent. `scenery?.dispose()` goes before the scene sweep so a double dispose does no harm.

- [ ] **Step 7: Add the harness seams**

Edit `tests/gpu/harness.ts`:

```ts
let buildingsSettled: Promise<void> = Promise.resolve()
```

Add to `cityGpu`:

```ts
  waitForBuildings(): Promise<void> {
    return buildingsSettled
  },
```

Add `buildings?: boolean` to the `mountJourney` options type, and next to the vehicles and people setup:

```ts
    let settleBuildings: () => void = () => {}
    buildingsSettled = new Promise<void>(resolve => { settleBuildings = resolve })
    if (!options.buildings) settleBuildings()
```

(Unlike cars and people, buildings load on `reduced` too, so no tier exception.) In the `createJourneyScene` options:

```ts
        // Existing GPU tests pin the primitive buildings; opt in for the real GLBs.
        loadBuildingModels: options.buildings ? undefined : () => new Promise<never>(() => {}),
        onBuildingsReady: settleBuildings,
        onBuildingsFailed: settleBuildings,
```

In the `catch` block, add `settleBuildings()` beside the other settle calls.

- [ ] **Step 8: Write the GPU spec**

```ts
// tests/gpu/buildings-models.spec.ts
import { expect, test } from '@playwright/test'
import { MAX_SET_PIECE_DRAW_CALLS, SCENERY_GROUP_NAME } from '../../app/journey/building-specs'
import { PASS_DRAW_CALL_BUDGET, WET_ROAD_NAME } from '../../app/journey/wet-road'

const GPU_TEST_TIMEOUT_MS = 120_000

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

for (const [tier, lowPower] of [['full', false], ['lite', true], ['reduced', false]] as const) {
  test(`${tier}: the real GLBs load, show four set-piece groups within ${MAX_SET_PIECE_DRAW_CALLS} draw calls and build no new program`, async ({ page }) => {
    test.setTimeout(GPU_TEST_TIMEOUT_MS)
    const result = await page.evaluate(async ({ tier, lowPower, group, wetRoadName }) => {
      window.cityGpu.mountJourney({ tier, lowPower, buildings: true })
      await window.cityGpu.waitForBuildings()
      const scene = window.cityGpu.getJourneyContext().scene
      const programsBefore = window.cityGpu.journeyState().programs
      const frames = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter }))
      const programsAfter = window.cityGpu.journeyState().programs
      type Probe = { isMesh?: boolean; visible: boolean }
      const setPieceGroup = scene.getObjectByName(group + '-set-pieces')
      const meshes: Probe[] = []
      setPieceGroup?.traverse(object => { if ((object as unknown as Probe).isMesh) meshes.push(object as unknown as Probe) })
      const passes = (scene.getObjectByName(wetRoadName)?.userData.wetRoad as { stats: { passes: number; lastDrawCalls: number } } | undefined)?.stats
      window.cityGpu.dispose()
      return {
        frames, programsBefore, programsAfter, passes,
        groupVisible: setPieceGroup?.visible ?? false,
        childCount: setPieceGroup?.children.length ?? 0,
        meshCount: meshes.length,
      }
    }, { tier, lowPower, group: SCENERY_GROUP_NAME, wetRoadName: WET_ROAD_NAME })
    for (const frame of result.frames) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
    }
    expect(result.groupVisible).toBe(true)
    expect(result.childCount).toBe(4)
    expect(result.meshCount).toBeGreaterThan(0)
    expect(result.meshCount).toBeLessThanOrEqual(MAX_SET_PIECE_DRAW_CALLS)
    expect(result.programsAfter).toEqual(result.programsBefore)
    if (!lowPower && tier !== 'reduced') expect(result.passes!.lastDrawCalls).toBeLessThanOrEqual(PASS_DRAW_CALL_BUDGET)
  })
}

test('a missing set-piece model keeps the primitives and does not break the scene', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  await page.route('**/models/buildings/house.glb', route => route.fulfill({ status: 404, body: 'missing' }))
  const result = await page.evaluate(async ({ group }) => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, buildings: true })
    await window.cityGpu.waitForBuildings()
    const frame = window.cityGpu.renderJourney({ chapter: 1 })
    const scene = window.cityGpu.getJourneyContext().scene
    const setPieceGroup = scene.getObjectByName(group + '-set-pieces')
    const result = { frame, childCount: setPieceGroup?.children.length ?? -1 }
    window.cityGpu.dispose()
    return result
  }, { group: SCENERY_GROUP_NAME })
  expect(result.childCount).toBe(0)
  expect(result.frame.shaderError).toBeNull()
  expect(result.frame.glError).toBe(0)
})
```

- [ ] **Step 9: Run unit, typecheck, and the new GPU spec**

Run: `npm test && npm run typecheck`
Expected: PASS.

Run: `npx playwright test --config playwright.config.ts tests/gpu/buildings-models.spec.ts`
Expected: PASS (4 tests). The reflection-budget assertion in the `full` test is the first measurement of the 16-call cap (set-pieces are not reflected yet, so it checks nothing new). If the harness cannot serve `/models/buildings/`, check `vite.gpu.config.ts` for the static directory that already serves `/models/vehicles/` and `/models/people/`.

- [ ] **Step 10: Commit**

```bash
git add app/journey/setpieces.ts app/journey/scene.ts tests/journey/setpieces.test.ts tests/gpu/harness.ts tests/gpu/buildings-models.spec.ts
git commit -m "feat: show GLB set-pieces for the gate, hall, market, and house"
```

---

### Task 6: Near-layer GLB buildings

**Files:**
- Create: `app/journey/near-layout.ts`
- Create: `app/journey/near-buildings.ts`
- Modify: `app/journey/scene.ts` (near wiring in the layer loop)
- Test: `tests/journey/near-layout.test.ts`, `tests/journey/near-buildings.test.ts`, `tests/gpu/buildings-near.spec.ts`

**Interfaces:**
- Consumes: `BuildingLayer`, `Building`, `isActive`, `BASE_Y` (`buildings.ts`); `closestPathPoint` (Task 3); `NEAR_Y_MIN`, `NEAR_Y_MAX`, `NEAR_VARIANT_SEED`, `NEAR_MESH_PREFIX`, `MAX_NEAR_MESHES` (Task 2); `BuildingModels`, `mergeByMaterial`, `SceneryPart` (Task 4); `reflectInPuddles` (`reflect-layer.ts`).
- Produces:
  - `near-layout.ts`: `nearVariantFor(index: number, variantCount: number): number`; `nearYaw(x: number, z: number): number`; `nearFootprintScale(size: Vec3, yaw: number, width: number, depth: number): number`; `nearYScale(heightScale: number): number`
  - `near-buildings.ts`: `interface NearBuildings extends SceneryPart { readonly group: THREE.Group; write(): void }`; `createNearBuildings(layer: BuildingLayer, fallbacks: readonly THREE.Object3D[]): NearBuildings`
  - Scene: near `write()` runs whenever layer 0's `applyBuildingState` returns `true`.

- [ ] **Step 1: Write the failing layout tests**

```ts
// tests/journey/near-layout.test.ts
import { describe, expect, it } from 'vitest'
import { NEAR_Y_MAX, NEAR_Y_MIN } from '../../app/journey/building-specs'
import { nearFootprintScale, nearVariantFor, nearYaw, nearYScale } from '../../app/journey/near-layout'

describe('nearVariantFor', () => {
  it('is deterministic and stays inside the variant range', () => {
    for (let i = 0; i < 200; i++) {
      const v = nearVariantFor(i, 4)
      expect(v).toBe(nearVariantFor(i, 4))
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(4)
    }
  })

  it('uses every variant across a layer of buildings', () => {
    const used = new Set(Array.from({ length: 24 }, (_, i) => nearVariantFor(i, 3)))
    expect(used.size).toBe(3)
  })

  it('returns 0 for a single variant', () => {
    expect(nearVariantFor(5, 1)).toBe(0)
  })
})

describe('nearYaw', () => {
  it('faces a building right of the first leg back toward the road (-X)', () => {
    // A model facing -Z, turned by yaw about Y, faces (-sin yaw, -cos yaw).
    const yaw = nearYaw(6, -10)
    expect(-Math.sin(yaw)).toBeCloseTo(-1, 5)
    expect(-Math.cos(yaw)).toBeCloseTo(0, 5)
  })

  it('faces a building left of the first leg back toward the road (+X)', () => {
    const yaw = nearYaw(-6, -10)
    expect(-Math.sin(yaw)).toBeCloseTo(1, 5)
  })

  it('is always a multiple of a quarter turn', () => {
    for (const [x, z] of [[6, -10], [-6, -10], [-13, -30], [-30, -50], [3, 20]] as const) {
      const quarter = nearYaw(x, z) / (Math.PI / 2)
      expect(Math.abs(quarter - Math.round(quarter))).toBeLessThan(1e-9)
    }
  })
})

describe('nearFootprintScale', () => {
  it('fits the model inside the placed rectangle', () => {
    expect(nearFootprintScale([2, 3, 1], 0, 1, 1)).toBeCloseTo(0.5, 5)
    expect(nearFootprintScale([2, 3, 1], 0, 4, 0.5)).toBeCloseTo(0.5, 5)
  })

  it('swaps width and depth for a quarter-turn yaw', () => {
    // Turned 90 degrees, the model's x extent runs along world z.
    expect(nearFootprintScale([2, 3, 1], Math.PI / 2, 1, 4)).toBeCloseTo(1, 5)
  })
})

describe('nearYScale', () => {
  it('clamps the scroll height factor into the near range', () => {
    expect(nearYScale(0.6)).toBe(NEAR_Y_MIN)
    expect(nearYScale(1.15)).toBe(NEAR_Y_MAX)
    expect(nearYScale(1)).toBe(1)
    expect(nearYScale(5)).toBe(NEAR_Y_MAX)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/journey/near-layout.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `near-layout.ts`**

```ts
// app/journey/near-layout.ts
import { NEAR_VARIANT_SEED, NEAR_Y_MAX, NEAR_Y_MIN } from './building-specs'
import { closestPathPoint } from './path'
import { seeded } from './random'
import type { Vec3 } from './stops'

const QUARTER_TURN = Math.PI / 2

export function nearVariantFor(index: number, variantCount: number): number {
  return Math.min(variantCount - 1, Math.floor(seeded(NEAR_VARIANT_SEED + index) * variantCount))
}

// The yaw about Y that turns a model facing -Z so its front faces the closest road point, snapped to a quarter
// turn so the footprint stays axis aligned. A model turned by `yaw` faces (-sin yaw, -cos yaw).
export function nearYaw(x: number, z: number): number {
  const road = closestPathPoint(x, z)
  const yaw = Math.atan2(-(road.x - x), -(road.z - z))
  return Math.round(yaw / QUARTER_TURN) * QUARTER_TURN
}

// Uniform scale that fits the model inside the placed width x depth rectangle after turning by `yaw`.
export function nearFootprintScale(size: Vec3, yaw: number, width: number, depth: number): number {
  const turned = Math.abs(Math.sin(yaw)) > 0.5
  const footX = turned ? size[2] : size[0]
  const footZ = turned ? size[0] : size[2]
  return Math.min(width / footX, depth / footZ)
}

export function nearYScale(heightScale: number): number {
  return Math.min(Math.max(heightScale, NEAR_Y_MIN), NEAR_Y_MAX)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/journey/near-layout.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing near-buildings tests**

```ts
// tests/journey/near-buildings.test.ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyBuildingState, createBuildingLayer } from '../../app/journey/buildings'
import type { BuildingModels } from '../../app/journey/building-models'
import { createFacadeUniforms } from '../../app/journey/facade-material'
import { createNearBuildings } from '../../app/journey/near-buildings'
import { MAX_NEAR_MESHES, NEAR_MESH_PREFIX, NEAR_VARIANT_SPECS } from '../../app/journey/building-specs'
import { REFLECT_LAYER } from '../../app/journey/reflect-layer'

function fakeModels(): BuildingModels {
  const wall = new THREE.MeshStandardMaterial({ name: 'wall' })
  const glass = new THREE.MeshStandardMaterial({ name: 'glass' })
  const near = NEAR_VARIANT_SPECS.map(spec => {
    const box = () => { const g = new THREE.BoxGeometry(...spec.size); g.translate(0, spec.size[1] / 2, 0); return g }
    return { parts: [{ geometry: box(), material: wall }, { geometry: box(), material: glass }], size: spec.size }
  })
  return { setPieces: {} as BuildingModels['setPieces'], near }
}

function setup(lowPower = false) {
  const layer = createBuildingLayer(0, { lowPower, facade: createFacadeUniforms() })
  const fallbacks = [layer.boxMesh, ...(layer.spireMesh ? [layer.spireMesh] : []), ...(layer.beaconMesh ? [layer.beaconMesh] : [])]
  const near = createNearBuildings(layer, fallbacks)
  return { layer, near, fallbacks }
}

function instanceMatrices(near: ReturnType<typeof createNearBuildings>): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = []
  near.group.traverse(object => {
    const mesh = object as THREE.InstancedMesh
    if (!mesh.isInstancedMesh) return
    for (let i = 0; i < mesh.count; i++) out.push(new THREE.Matrix4().fromArray(mesh.instanceMatrix.array, i * 16))
  })
  return out
}

describe('createNearBuildings', () => {
  it('stages nothing visible and builds no mesh before models arrive', () => {
    const { near } = setup()
    expect(near.group.children).toHaveLength(0)
  })

  it('stages two meshes per variant (one per material) within the near-mesh cap, all hidden and named', () => {
    const { near } = setup()
    near.stage(fakeModels())
    const meshes = near.group.children as THREE.InstancedMesh[]
    expect(meshes.length).toBeLessThanOrEqual(MAX_NEAR_MESHES)
    expect(near.group.visible).toBe(false)
    for (const mesh of meshes) expect(mesh.name.startsWith(NEAR_MESH_PREFIX)).toBe(true)
  })

  it('instance counts sum to the layer size, for full and lite', () => {
    for (const lowPower of [false, true]) {
      const { layer, near } = setup(lowPower)
      near.stage(fakeModels())
      const meshes = near.group.children as THREE.InstancedMesh[]
      // Two materials per variant: every building is counted once per material.
      expect(meshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(layer.buildings.length * 2)
      near.release()
    }
  })

  it('reflects in puddles', () => {
    const { near } = setup()
    near.stage(fakeModels())
    for (const mesh of near.group.children) expect(mesh.layers.isEnabled(REFLECT_LAYER)).toBe(true)
  })

  it('show hides every fallback mesh and shows the group', () => {
    const { near, fallbacks } = setup()
    near.stage(fakeModels())
    near.show()
    expect(near.group.visible).toBe(true)
    expect(fallbacks.every(mesh => !mesh.visible)).toBe(true)
  })

  it('does nothing on show before staging', () => {
    const { near, fallbacks } = setup()
    near.show()
    expect(fallbacks.every(mesh => mesh.visible)).toBe(true)
  })

  it('writes a matrix at each active building, scaled inside its rectangle, on the base', () => {
    const { layer, near } = setup()
    near.stage(fakeModels())
    applyBuildingState(layer, 1, 1, 0, true)
    near.show()
    const active = layer.buildings.filter(building => building.width > 0)
    const placed = instanceMatrices(near).filter(matrix => matrix.determinant() !== 0)
    expect(placed.length).toBe(active.length * 2)
    for (const matrix of placed) {
      const position = new THREE.Vector3().setFromMatrixPosition(matrix)
      expect(position.y).toBeCloseTo(-1, 5)
    }
  })

  it('hidden and inactive buildings get a zero matrix', () => {
    const { layer, near } = setup()
    near.stage(fakeModels())
    applyBuildingState(layer, 1, 0.5, 0, true)
    near.show()
    const activeCount = layer.lastActiveCount
    const expectedVisible = layer.buildings.filter((building, i) => i < activeCount && building.width > 0).length
    const nonZero = instanceMatrices(near).filter(matrix => matrix.determinant() !== 0)
    expect(nonZero.length).toBe(expectedVisible * 2)
  })

  it('rewrites matrices when the density changes', () => {
    const { layer, near } = setup()
    near.stage(fakeModels())
    applyBuildingState(layer, 1, 0, 0, true)
    near.show()
    expect(instanceMatrices(near).every(matrix => matrix.determinant() === 0)).toBe(true)
    applyBuildingState(layer, 1, 1, 0, true)
    near.write()
    expect(instanceMatrices(near).some(matrix => matrix.determinant() !== 0)).toBe(true)
  })

  it('clamps the height scale so the Y scale stays within the near range', () => {
    const { layer, near } = setup()
    near.stage(fakeModels())
    applyBuildingState(layer, 0.6, 1, 0, true)
    near.show()
    const low = instanceMatrices(near).filter(matrix => matrix.determinant() !== 0)[0]!
    applyBuildingState(layer, 1.15, 1, 0, true)
    near.write()
    const high = instanceMatrices(near).filter(matrix => matrix.determinant() !== 0)[0]!
    const ratio = (matrix: THREE.Matrix4) => new THREE.Vector3().setFromMatrixScale(matrix).y / new THREE.Vector3().setFromMatrixScale(matrix).x
    expect(ratio(high) / ratio(low)).toBeCloseTo(1.15 / 0.85, 3)
  })

  it('release removes and disposes the meshes and leaves the fallbacks visible', () => {
    const { near, fallbacks } = setup()
    near.stage(fakeModels())
    near.release()
    expect(near.group.children).toHaveLength(0)
    expect(fallbacks.every(mesh => mesh.visible)).toBe(true)
    near.release()
  })

  it('ignores a second stage', () => {
    const { near } = setup()
    near.stage(fakeModels())
    const count = near.group.children.length
    near.stage(fakeModels())
    expect(near.group.children).toHaveLength(count)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run tests/journey/near-buildings.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 7: Write `near-buildings.ts`**

```ts
// app/journey/near-buildings.ts
import * as THREE from 'three'
import { type BakedPart, mergeByMaterial } from './building-geometry'
import type { BuildingModels } from './building-models'
import type { SceneryPart } from './building-scenery'
import { NEAR_MESH_PREFIX } from './building-specs'
import { BASE_Y, type BuildingLayer, isActive } from './buildings'
import { nearFootprintScale, nearVariantFor, nearYaw, nearYScale } from './near-layout'
import { reflectInPuddles } from './reflect-layer'

export interface NearBuildings extends SceneryPart {
  readonly group: THREE.Group
  // Rewrites every instance matrix from the layer's stored height scale and active count. Call it after
  // `applyBuildingState` returns true. Does nothing before staging or before the layer's first apply.
  write(): void
}

interface VariantMeshes {
  // The index into `layer.buildings` of each instance slot.
  buildingIndices: readonly number[]
  meshes: readonly THREE.InstancedMesh[]
  parts: readonly BakedPart[]
}

// Module-level scratch objects: the per-frame update allocates nothing.
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const axisY = new THREE.Vector3(0, 1, 0)
const HIDDEN_Y = -100

export function createNearBuildings(layer: BuildingLayer, fallbacks: readonly THREE.Object3D[]): NearBuildings {
  const group = new THREE.Group()
  group.name = `${NEAR_MESH_PREFIX}group`
  let variants: VariantMeshes[] = []
  let sizes: BuildingModels['near'] = []
  let yaws: number[] = []
  let staged = false

  function release(): void {
    for (const variant of variants) {
      for (const mesh of variant.meshes) {
        group.remove(mesh)
        mesh.geometry.dispose()
        mesh.dispose()
      }
    }
    variants = []
    sizes = []
    yaws = []
    for (const fallback of fallbacks) fallback.visible = true
    staged = false
  }

  function write(): void {
    if (!staged || layer.lastActiveCount < 0) return
    const yScale = nearYScale(layer.lastHeightScale)
    variants.forEach((variant, v) => {
      const size = sizes[v]?.size
      if (!size) return
      variant.buildingIndices.forEach((buildingIndex, slot) => {
        const building = layer.buildings[buildingIndex]
        if (!building) return
        if (building.width > 0 && isActive(building, buildingIndex, layer.lastActiveCount)) {
          const yaw = yaws[buildingIndex] ?? 0
          const fit = nearFootprintScale(size, yaw, building.width, building.depth)
          matrix.compose(position.set(building.x, BASE_Y, building.z), rotation.setFromAxisAngle(axisY, yaw),
            scale.set(fit, fit * yScale, fit))
        } else {
          matrix.compose(position.set(building?.x ?? 0, HIDDEN_Y, building?.z ?? 0), rotation.identity(), scale.set(0, 0, 0))
        }
        for (const mesh of variant.meshes) mesh.setMatrixAt(slot, matrix)
      })
      for (const mesh of variant.meshes) mesh.instanceMatrix.needsUpdate = true
    })
  }

  return {
    group,
    stage(models) {
      if (staged) return
      staged = true
      sizes = models.near
      yaws = layer.buildings.map(building => nearYaw(building.x, building.z))
      const count = models.near.length
      try {
        variants = models.near.map((piece, v) => {
          const buildingIndices = layer.buildings.flatMap((_, i) => (nearVariantFor(i, count) === v ? [i] : []))
          const parts = mergeByMaterial(piece.parts)
          const meshes = parts.map((part, p) => {
            const mesh = new THREE.InstancedMesh(part.geometry, part.material, buildingIndices.length)
            mesh.name = `${NEAR_MESH_PREFIX}${v}-${p}`
            // r186 caches the instanced bounding sphere at first render, and setMatrixAt does not invalidate it.
            mesh.frustumCulled = false
            group.add(mesh)
            return mesh
          })
          return { buildingIndices, meshes, parts }
        })
      } catch (error) {
        release()
        throw error
      }
      reflectInPuddles(group)
      group.visible = false
    },
    show() {
      if (!staged) return
      group.visible = true
      for (const fallback of fallbacks) fallback.visible = false
      write()
    },
    release,
    write,
  }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run tests/journey/near-buildings.test.ts`
Expected: PASS (12 tests). The matrix tests assume at least one near building places on the first layer. `createBuildingLayer(0, ...)` places buildings deterministically, and the existing `buildings.test.ts` pins that some fit.

- [ ] **Step 9: Wire the near layer into `scene.ts`**

Add imports:

```ts
import { createNearBuildings } from './near-buildings'
```

The layer loop creates `layers` before the scenery block, so `layers[0]` exists by then. Replace the scenery block's composition (from Task 5) so it includes near buildings:

```ts
  const nearLayer = layers[0]
  const nearBuildings = nearLayer
    ? createNearBuildings(nearLayer, layerMeshes(nearLayer))
    : null
  if (nearBuildings) sceneryGroup.add(nearBuildings.group)
  const buildingScenery = createBuildingScenery(nearBuildings ? [setPieces, nearBuildings] : [setPieces])
```

(`sceneryGroup.add(setPieces.group)` stays above it.) In `apply`, change the layer loop so layer 0 also rewrites its GLB matrices:

```ts
    layers.forEach((layer, i) => {
      if (applyBuildingState(layer, state.buildingHeight, state.buildingDensity, lastTime, tier === 'reduced')) {
        writeLayerShadows(shadows, shadowOffsets[i] ?? 0, layer)
        if (i === 0) nearBuildings?.write()
      }
    })
```

`nearBuildings` is declared before `apply` (the scenery block runs before `apply` is defined). Confirm by reading `scene.ts`: `apply` is a function declaration inside `createJourneyScene` after the block, so it can read the `const`.

- [ ] **Step 10: Write the GPU spec**

```ts
// tests/gpu/buildings-near.spec.ts
import { expect, test } from '@playwright/test'
import { MAX_NEAR_MESHES, NEAR_MESH_PREFIX } from '../../app/journey/building-specs'
import { REFLECT_LAYER } from '../../app/journey/reflect-layer'

const GPU_TEST_TIMEOUT_MS = 120_000
// Full has 24 near buildings. Lite scales that by 0.6 and rounds: 14.
const NEAR_COUNT = { full: 24, lite: 14, reduced: 24 } as const

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

for (const [tier, lowPower] of [['full', false], ['lite', true], ['reduced', false]] as const) {
  test(`${tier}: the near layer shows at most ${MAX_NEAR_MESHES} instanced meshes covering every building, hides the near boxes, and reflects`, async ({ page }) => {
    test.setTimeout(GPU_TEST_TIMEOUT_MS)
    const result = await page.evaluate(async ({ tier, lowPower, prefix, layer }) => {
      window.cityGpu.mountJourney({ tier, lowPower, buildings: true })
      await window.cityGpu.waitForBuildings()
      const scene = window.cityGpu.getJourneyContext().scene
      const frames = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter }))
      type Probe = { isInstancedMesh?: boolean; count: number; visible: boolean; name: string; layers: { isEnabled(layer: number): boolean } }
      const near: Probe[] = []
      scene.traverse(object => {
        const probe = object as unknown as Probe
        if (probe.isInstancedMesh && probe.name.startsWith(prefix)) near.push(probe)
      })
      const nearBox = scene.getObjectByName('journey-building-near') as unknown as Probe | undefined
      window.cityGpu.dispose()
      return {
        frames, meshes: near.length, total: near.reduce((sum, mesh) => sum + mesh.count, 0),
        reflected: near.filter(mesh => mesh.layers.isEnabled(layer)).length, boxVisible: nearBox?.visible ?? null,
      }
    }, { tier, lowPower, prefix: NEAR_MESH_PREFIX, layer: REFLECT_LAYER })
    for (const frame of result.frames) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
    }
    expect(result.meshes).toBeGreaterThan(0)
    expect(result.meshes).toBeLessThanOrEqual(MAX_NEAR_MESHES)
    expect(result.boxVisible).toBe(false)
    expect(result.reflected).toBe(result.meshes)
    // Every building appears once per material, so the total is a whole multiple of the layer size.
    expect(result.total % NEAR_COUNT[tier]).toBe(0)
  })
}

test('the near boxes stay visible until the models load', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  const result = await page.evaluate(async () => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false })
    const scene = window.cityGpu.getJourneyContext().scene
    const frame = window.cityGpu.renderJourney({ chapter: 1 })
    const nearBox = scene.getObjectByName('journey-building-near')
    const visible = nearBox?.visible ?? null
    window.cityGpu.dispose()
    return { frame, visible }
  })
  expect(result.visible).toBe(true)
  expect(result.frame.shaderError).toBeNull()
})
```

- [ ] **Step 11: Run unit, typecheck, and GPU specs**

Run: `npm test && npm run typecheck`
Expected: PASS.

Run: `npx playwright test --config playwright.config.ts tests/gpu/buildings-near.spec.ts tests/gpu/buildings-models.spec.ts tests/gpu/buildings.spec.ts tests/gpu/contact-shadows.spec.ts`
Expected: PASS. `buildings.spec.ts` and `contact-shadows.spec.ts` run without GLBs, so they pin the box layer unchanged.

- [ ] **Step 12: Commit**

```bash
git add app/journey/near-layout.ts app/journey/near-buildings.ts app/journey/scene.ts tests/journey/near-layout.test.ts tests/journey/near-buildings.test.ts tests/gpu/buildings-near.spec.ts
git commit -m "feat: show GLB buildings in the near skyline layer"
```

---

### Task 7: Night glow, reflection budget, and failure paths

**Files:**
- Create: `app/journey/building-glow.ts`
- Modify: `app/journey/scene.ts` (call the glow update in `apply`)
- Modify: `app/journey/building-scenery.ts` (expose the models for the glow update)
- Test: `tests/journey/building-glow.test.ts`, extend `tests/gpu/buildings-models.spec.ts`, extend `tests/gpu/buildings-near.spec.ts`

**Interfaces:**
- Consumes: `WINDOW_MATERIAL_NAMES`, `WINDOW_GLOW`, `UNIFORM_GLOW`, `GLOW_START`, `GLOW_END` (Task 2); `smoothstep` (`sky-mirror.ts`); `WINDOW_PALETTE` (`window-look.ts`); `BuildingModels`.
- Produces: `glowFor(windowLitRatio: number): number` (0 to 1 ramp); `applyBuildingGlow(models: BuildingModels, windowLitRatio: number, windowNames?: readonly string[]): void`; `BuildingScenery.update(windowLitRatio: number): void`.

- [ ] **Step 1: Write the failing glow tests**

```ts
// tests/journey/building-glow.test.ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { GLOW_END, GLOW_START, UNIFORM_GLOW, WINDOW_GLOW } from '../../app/journey/building-specs'
import { applyBuildingGlow, glowFor } from '../../app/journey/building-glow'
import type { BuildingModels } from '../../app/journey/building-models'

function models(): { models: BuildingModels; wall: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial } {
  const wall = new THREE.MeshStandardMaterial({ name: 'wall' })
  const glass = new THREE.MeshStandardMaterial({ name: 'glass' })
  const part = (material: THREE.Material) => ({ geometry: new THREE.BoxGeometry(1, 1, 1), material })
  const piece = { parts: [part(wall), part(glass)], size: [1, 1, 1] as const }
  return {
    models: { setPieces: { gatePillar: piece, beam: piece, hallColumn: piece, hallWall: piece, stall: piece, house: piece }, near: [piece] },
    wall, glass,
  }
}

describe('glowFor', () => {
  it('is 0 by day and 1 at night, rising between the thresholds', () => {
    expect(glowFor(0)).toBe(0)
    expect(glowFor(GLOW_START)).toBe(0)
    expect(glowFor(GLOW_END)).toBe(1)
    expect(glowFor(1)).toBe(1)
    const mid = glowFor((GLOW_START + GLOW_END) / 2)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })
})

describe('applyBuildingGlow', () => {
  it('glow ramps with windowLitRatio on window materials only', () => {
    const { models: m, wall, glass } = models()
    applyBuildingGlow(m, 0, ['glass'])
    expect(glass.emissiveIntensity).toBe(0)
    expect(wall.emissiveIntensity).toBe(0)
    applyBuildingGlow(m, 1, ['glass'])
    expect(glass.emissiveIntensity).toBeCloseTo(WINDOW_GLOW, 5)
    expect(wall.emissiveIntensity).toBe(0)
    expect(glass.emissive.getHex()).not.toBe(0)
  })

  it('falls back to uniform glow without a window material', () => {
    const { models: m, wall, glass } = models()
    applyBuildingGlow(m, 1, [])
    expect(wall.emissiveIntensity).toBeCloseTo(UNIFORM_GLOW, 5)
    expect(glass.emissiveIntensity).toBeCloseTo(UNIFORM_GLOW, 5)
  })

  it('falls back to uniform glow when no material matches a window name', () => {
    const { models: m, wall } = models()
    applyBuildingGlow(m, 1, ['does-not-exist'])
    expect(wall.emissiveIntensity).toBeCloseTo(UNIFORM_GLOW, 5)
  })

  it('writes each shared material once', () => {
    const { models: m, glass } = models()
    let writes = 0
    let intensity = 0
    Object.defineProperty(glass, 'emissiveIntensity', { get: () => intensity, set: (value: number) => { writes++; intensity = value } })
    applyBuildingGlow(m, 1, ['glass'])
    expect(writes).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/journey/building-glow.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `building-glow.ts`**

```ts
// app/journey/building-glow.ts
import * as THREE from 'three'
import type { BuildingModels } from './building-models'
import { GLOW_END, GLOW_START, UNIFORM_GLOW, WINDOW_GLOW, WINDOW_MATERIAL_NAMES } from './building-specs'
import { smoothstep } from './sky-mirror'
import { WINDOW_PALETTE } from './window-look'

const [warm] = WINDOW_PALETTE

// 0 by day, 1 once the street is lit.
export function glowFor(windowLitRatio: number): number {
  return smoothstep(GLOW_START, GLOW_END, windowLitRatio)
}

function uniqueMaterials(models: BuildingModels): THREE.MeshStandardMaterial[] {
  const found = new Set<THREE.MeshStandardMaterial>()
  const pieces = [...Object.values(models.setPieces), ...models.near]
  for (const piece of pieces) {
    for (const part of piece.parts) found.add(part.material as THREE.MeshStandardMaterial)
  }
  return [...found]
}

// Window materials glow warm at night. A kit with no window material gets a faint uniform glow on every material.
export function applyBuildingGlow(
  models: BuildingModels, windowLitRatio: number, windowNames: readonly string[] = WINDOW_MATERIAL_NAMES,
): void {
  const ramp = glowFor(windowLitRatio)
  const materials = uniqueMaterials(models)
  const windows = materials.filter(material => windowNames.includes(material.name))
  if (windows.length > 0) {
    for (const material of windows) {
      material.emissive.setHex(warm.hex)
      material.emissiveIntensity = WINDOW_GLOW * ramp
    }
    return
  }
  for (const material of materials) {
    material.emissive.setHex(warm.hex)
    material.emissiveIntensity = UNIFORM_GLOW * ramp
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/journey/building-glow.test.ts`
Expected: PASS (5 tests). If `writes each shared material once` fails because `defineProperty` on a Three.js class instance does not intercept the prototype accessor, drop that test and keep the other four. Report that you dropped it.

- [ ] **Step 5: Expose the glow through the scenery composite**

Add a failing test to `tests/journey/building-scenery.test.ts`:

```ts
  it('update passes the lit ratio to the glow only once the models are staged', async () => {
    const glow = await import('../../app/journey/building-glow')
    const apply = vi.spyOn(glow, 'applyBuildingGlow').mockImplementation(() => {})
    const scenery = createBuildingScenery([part()])
    scenery.update(0.5)
    expect(apply).not.toHaveBeenCalled()
    scenery.stageModels(fakeModels)
    scenery.update(0.5)
    expect(apply).toHaveBeenCalledWith(fakeModels, 0.5)
    apply.mockRestore()
  })
```

Run: `npx vitest run tests/journey/building-scenery.test.ts`
Expected: FAIL, `scenery.update is not a function`.

In `building-scenery.ts`, add `update(windowLitRatio: number): void` to the `BuildingScenery` interface and to the returned object, and import `applyBuildingGlow`:

```ts
import { applyBuildingGlow } from './building-glow'
// interface: update(windowLitRatio: number): void
// object:
    update(windowLitRatio) {
      if (disposed || !owned) return
      applyBuildingGlow(owned, windowLitRatio)
    },
```

Run: `npx vitest run tests/journey/building-scenery.test.ts`
Expected: PASS.

- [ ] **Step 6: Call it from `scene.ts`**

In `apply`, beside `lamps.update(...)`:

```ts
    scenery?.update(state.windowLitRatio)
```

Because glow runs every `apply` call and writes a few material fields, it allocates nothing. Do not gate it on a dirty flag.

- [ ] **Step 7: Add GPU assertions for night, failure, dispose, and reflection**

Append to `tests/gpu/buildings-models.spec.ts`:

```ts
test('the kit glows at night and is dark by day', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  const result = await page.evaluate(async () => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, buildings: true, initialDark: true })
    await window.cityGpu.waitForBuildings()
    const scene = window.cityGpu.getJourneyContext().scene
    const intensities = () => {
      const seen = new Set<number>()
      scene.traverse(object => {
        const mesh = object as unknown as { isMesh?: boolean; material?: { emissiveIntensity?: number }; name: string }
        if (mesh.isMesh && (mesh.name.startsWith('journey-scenery') || mesh.name.startsWith('journey-near-building-'))) {
          seen.add(mesh.material?.emissiveIntensity ?? 0)
        }
      })
      return Math.max(0, ...seen)
    }
    window.cityGpu.renderJourney({ chapter: 0 })
    window.cityGpu.setJourneyTheme(false, { animate: false })
    window.cityGpu.renderJourney({ chapter: 0 })
    const day = intensities()
    window.cityGpu.setJourneyTheme(true, { animate: false })
    window.cityGpu.renderJourney({ chapter: 3 })
    const night = intensities()
    window.cityGpu.dispose()
    return { day, night }
  })
  expect(result.day).toBeCloseTo(0, 5)
  expect(result.night).toBeGreaterThan(0)
})

test('a scene disposed while the models are still loading shows nothing and throws nothing', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/models/buildings/*.glb', async route => {
    await new Promise(resolve => setTimeout(resolve, 500))
    await route.continue()
  })
  await page.evaluate(async () => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, buildings: true })
    window.cityGpu.dispose()
    await window.cityGpu.waitForBuildings()
  })
  await page.waitForTimeout(1500)
  expect(errors).toEqual([])
})
```

In the `reduced` loop of `buildings-models.spec.ts`, add a request check by appending:

```ts
test('reduced motion still downloads the building models', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/models/buildings/')) requests.push(request.url()) })
  await page.evaluate(async () => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: false, buildings: true })
    await window.cityGpu.waitForBuildings()
    window.cityGpu.dispose()
  })
  expect(requests.length).toBeGreaterThan(0)
})
```

Append to `tests/gpu/buildings-near.spec.ts` the reflection-budget check, because the near GLBs are reflected and the pass is capped:

```ts
import { PASS_DRAW_CALL_BUDGET, WET_ROAD_NAME } from '../../app/journey/wet-road'

test('with the near GLBs the wet-road pass stays within its draw-call budget', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  const result = await page.evaluate(async ({ wetRoadName }) => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, buildings: true, vehicles: true, people: true })
    await window.cityGpu.waitForBuildings()
    await window.cityGpu.waitForVehicles()
    window.cityGpu.renderJourney({ chapter: 2 })
    const scene = window.cityGpu.getJourneyContext().scene
    const stats = (scene.getObjectByName(wetRoadName)?.userData.wetRoad as { stats: { lastDrawCalls: number } } | undefined)?.stats
    window.cityGpu.dispose()
    return stats?.lastDrawCalls ?? null
  }, { wetRoadName: WET_ROAD_NAME })
  expect(result).not.toBeNull()
  expect(result!).toBeLessThanOrEqual(PASS_DRAW_CALL_BUDGET)
})
```

If the reflection-budget test fails, stop reflecting the near GLB meshes. Remove `reflectInPuddles(group)` from `near-buildings.ts` `stage`, change the `reflects in puddles` unit test and the `result.reflected` assertion in `buildings-near.spec.ts` to expect `0`, and record in the commit message that the wet look now reflects only the mid and far boxes. Do not raise `PASS_DRAW_CALL_BUDGET`.

- [ ] **Step 8: Run everything**

Run: `npm test && npm run typecheck`
Expected: PASS.

Run: `npx playwright test --config playwright.config.ts tests/gpu/buildings-models.spec.ts tests/gpu/buildings-near.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/journey/building-glow.ts app/journey/building-scenery.ts app/journey/scene.ts tests/journey/building-glow.test.ts tests/journey/building-scenery.test.ts tests/gpu/buildings-models.spec.ts tests/gpu/buildings-near.spec.ts
git commit -m "feat: add night glow, reflection budget, and failure checks for building models"
```

---

### Task 8: Acceptance and spec update

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-journey-buildings-design.md` (workspace root, not `repos/portfolio`)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Run the full automated verification**

Run each from `repos/portfolio`. Every one must pass.

- [ ] `npm test`
- [ ] `npm run test:gpu` (full suite; this repo's GPU suite has known sleep-induced timeouts, so if a case fails, rerun just that spec awake before treating it as a regression, and name each rerun in the handoff)
- [ ] `npm run typecheck`
- [ ] `npm run build`

- [ ] **Step 2: Update the spec**

In the spec, change `Status: Draft, awaiting review` to `Status: Implemented, pending manual checks`. Replace the three paragraphs it contradicts:

- Near-layer placement bullet: "Width and depth come from each variant's bounds" becomes "Each GLB is scaled uniformly to fit inside the building's already-placed width and depth rectangle. Placement is unchanged, so clearance and shadows hold."
- Near-layer shadows bullet: remove "This needs a small adapter and is the riskiest part." Replace with "Instances keep the existing `Building` records, so contact shadows need no adapter."
- Night-windows bullet: "Otherwise a small shader patch." becomes "Otherwise every kit material gets a faint uniform glow. There is no shader patch."

Add a line under Models naming the chosen packs from `public/models/buildings/LICENSE.txt`.

- [ ] **Step 3: Commit**

```bash
git add ../../docs/superpowers/specs/2026-10-15-journey-buildings-design.md
git commit -m "docs: mark the journey buildings spec implemented"
```

- [ ] **Step 4: Hand off the manual checklist**

Do not mark these done. List them for the user and wait for confirmation:

**Manual verification (a person must check):**

- [ ] Screenshots in light and dark theme, at each of the four chapters: gate, hall, market, house look like real buildings, with no floating or intersecting pieces.
- [ ] Night: window or glow reads well, no blown-out facades, courtyard windows sit on the house front.
- [ ] Near-layer facades are not visibly stretched when scrolling from the intro to the skills chapter.
- [ ] Hall picture frames sit in front of the new walls, and guides still stand between columns.
- [ ] Stalls face the road and none overlap the sidewalk.
- [ ] Classic near buildings beside modern mid/far skyline: judge whether the style seam looks acceptable.
- [ ] iPhone: scroll frame time, and memory after the models show.
- [ ] Wet-road reflection of the near buildings (or its absence, if Task 7 removed it) looks right at night.
- [ ] A throttled or offline load leaves the old look and the page works.
