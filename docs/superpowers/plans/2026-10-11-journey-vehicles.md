# Journey Vehicles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work in an isolated worktree (`superpowers:using-git-worktrees`) on branch `feat/journey-vehicles` cut from `master`. All paths and commands below are relative to `repos/portfolio` unless a path starts with `docs/`.

**Goal:** Replace the box cars in the journey traffic with three recognizable CC0 GLB vehicle types: sedan, SUV, and truck.

**Architecture:** Each Kenney GLB uses one shared palette material, so its body, wheels, and glass merge into one geometry per type. Traffic renders one `InstancedMesh` per type that has cars, plus the existing light mesh: 4 draw calls. Traffic starts with the current box cars. The GLBs load in the background, and `traffic.useModels()` swaps the bodies in on arrival. A failed load keeps the box cars.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Three.js r186 (`GLTFLoader`, `BufferGeometryUtils.mergeGeometries`, `InstancedMesh`), Vitest, Playwright GPU harness (`tests/gpu/`).

**Spec:** `docs/superpowers/specs/2026-10-11-journey-vehicles-design.md`. Research doc: none covers this code. Related: `docs/superpowers/specs/2026-10-09-city-07-street-life-design.md`, `docs/superpowers/specs/2026-10-10-city-08-wet-road-design.md` (the reflection draw-call cap).

## Global Constraints

- Models are the Kenney Car Kit 3.1 (CC0): `sedan.glb`, `suv.glb`, `truck.glb`. Source: `https://kenney.nl/media/pages/assets/car-kit/1a312ec241-1775131960/kenney_car-kit.zip`, folder `Models/GLB format/`.
- SHA-256 of the source files: sedan `b532ea7d2c59f7f6b22b138cf1955218a2c1898f1cea932af4d3fd563c3959b7`, suv `9df31f6e89e927a8176fc792aa125f0b19dc1ba29d2025bfef7c4f4d6ab1778a`, truck `5e1bc66c343501dd7d5734b57e672dd949bf95d7abdce680c6508cef99d374f8`.
- Kenney models face +Z. This codebase authors cars facing -Z. Normalization rotates each model 180° about Y.
- Traffic draw calls: at most 4 (3 body meshes + 1 light mesh). Street total with lamps: at most 8 at full count.
- Car counts stay 12 (full), 6 (low power), 0 (reduced motion). Reduced motion fetches no models.
- Keep the U-turn loop, the shared speed, `carPoseAt`, `cornerScale`, and the dusk light ramp unchanged.
- A failed model load keeps the box cars and logs one `console.warn`. It never throws into the scene.
- Follow `.claude/rules/common/coding-style.md`: small files, no mutation outside render-loop scratch objects and per-instance closures, no magic numbers. TDD: every behavior starts with a failing test.

## Review Focus

1. A GLB 404s or fails to parse: box cars stay, no unhandled rejection, one warning. Pinned in Task 3.
2. The scene is disposed before the models arrive: nothing is added, and the models are disposed. Pinned in Task 3.
3. Low power (6 cars): a type with zero cars gets no empty `InstancedMesh`. Pinned in Task 4.
4. The models arrive after `traffic.update` has been running: the first update after the swap writes every matrix, and the light mesh and its colors survive the swap. Pinned in Task 4.
5. A car hidden at a corner (scale 0) hides its lights and body in every mesh, including after the swap. Pinned in Task 4.

---

### Task 1: Vendor the models, vehicle specs, and spec corrections

**Files:**
- Create: `public/models/vehicles/sedan.glb`, `public/models/vehicles/suv.glb`, `public/models/vehicles/truck.glb`, `public/models/vehicles/LICENSE.txt`
- Create: `app/journey/vehicle-specs.ts`
- Test: `tests/journey/vehicle-specs.test.ts`
- Modify: `docs/superpowers/specs/2026-10-11-journey-vehicles-design.md`

**Interfaces:**
- Produces (used by Tasks 2, 3, 4):
  - `VEHICLE_TYPES: readonly ['sedan', 'suv', 'truck']`, `type VehicleType`
  - `VEHICLE_SCALE: number` (0.36)
  - `VEHICLE_SPECS: Record<VehicleType, VehicleSpec>` where `VehicleSpec = { file: string; frontZ: number; rearZ: number }` in model units, front toward +Z
  - `VEHICLE_HALF_WIDTH: number`, `VEHICLE_HEIGHT: number` (model units)
  - `vehicleBounds(type): { minX; maxX; minY; maxY; minZ; maxZ }` in scene units, front at -Z
  - `interface VehicleLightOffset { x: number; y: number; z: number; kind: 'front' | 'rear' }`
  - `vehicleLightOffsets(type): readonly VehicleLightOffset[]` (4 entries: front, front, rear, rear)

Measured values (from the GLB node transforms and accessor bounds; the GPU test in Task 5 re-checks them against the real files): all three models are 1.3 tall and 1.5 wide, and the wheel bottoms are at y = 0. Front/rear extents in model Z: sedan -1.3 to 1.25, suv -1.35 to 1.35 (spare wheel on the back), truck -1.5 to 1.45.

- [ ] **Step 1: Write the failing test**

Create `tests/journey/vehicle-specs.test.ts`:

```ts
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  VEHICLE_HALF_WIDTH, VEHICLE_HEIGHT, VEHICLE_SCALE, VEHICLE_SPECS, VEHICLE_TYPES, vehicleBounds, vehicleLightOffsets,
} from '../../app/journey/vehicle-specs'

const MODEL_DIR = new URL('../../public/models/vehicles/', import.meta.url)
const MAX_MODEL_BYTES = 250_000
const LIGHT_DEPTH = 0.03

describe('vehicle files', () => {
  it('ships one non-empty GLB per type under 250 KB, and the CC0 licence note', () => {
    for (const type of VEHICLE_TYPES) {
      const size = fs.statSync(new URL(VEHICLE_SPECS[type].file, MODEL_DIR)).size
      expect(size, type).toBeGreaterThan(0)
      expect(size, type).toBeLessThan(MAX_MODEL_BYTES)
    }
    expect(fs.readFileSync(new URL('LICENSE.txt', MODEL_DIR), 'utf8')).toContain('Creative Commons Zero')
  })
})

describe('vehicleBounds', () => {
  it('is front at -Z, wheels on the ground and scaled from the model units', () => {
    for (const type of VEHICLE_TYPES) {
      const spec = VEHICLE_SPECS[type]
      const bounds = vehicleBounds(type)
      expect(bounds.minZ).toBeCloseTo(-spec.frontZ * VEHICLE_SCALE, 9)
      expect(bounds.maxZ).toBeCloseTo(-spec.rearZ * VEHICLE_SCALE, 9)
      expect(bounds.minY).toBe(0)
      expect(bounds.maxY).toBeCloseTo(VEHICLE_HEIGHT * VEHICLE_SCALE, 9)
      expect(bounds.maxX).toBeCloseTo(VEHICLE_HALF_WIDTH * VEHICLE_SCALE, 9)
      expect(bounds.minX).toBeCloseTo(-bounds.maxX, 9)
    }
  })

  it('makes the truck the longest vehicle and keeps all lengths near 1 unit', () => {
    const length = (type: (typeof VEHICLE_TYPES)[number]) => vehicleBounds(type).maxZ - vehicleBounds(type).minZ
    expect(length('truck')).toBeGreaterThan(length('sedan'))
    expect(length('truck')).toBeGreaterThan(length('suv'))
    for (const type of VEHICLE_TYPES) {
      expect(length(type)).toBeGreaterThan(0.8)
      expect(length(type)).toBeLessThan(1.2)
    }
  })
})

describe('vehicleLightOffsets', () => {
  it('lists two front lights then two rear lights, matching the dusk ramp order', () => {
    for (const type of VEHICLE_TYPES) {
      expect(vehicleLightOffsets(type).map(light => light.kind)).toEqual(['front', 'front', 'rear', 'rear'])
    }
  })

  it('puts front lights at the -Z end, rear lights at the +Z end, and every light inside the body bounds', () => {
    for (const type of VEHICLE_TYPES) {
      const bounds = vehicleBounds(type)
      for (const light of vehicleLightOffsets(type)) {
        expect(light.kind === 'front' ? light.z < 0 : light.z > 0, `${type} ${light.kind}`).toBe(true)
        expect(light.x).toBeGreaterThanOrEqual(bounds.minX)
        expect(light.x).toBeLessThanOrEqual(bounds.maxX)
        expect(light.y).toBeGreaterThan(bounds.minY)
        expect(light.y).toBeLessThan(bounds.maxY)
        expect(light.z).toBeGreaterThanOrEqual(bounds.minZ - LIGHT_DEPTH / 2)
        expect(light.z).toBeLessThanOrEqual(bounds.maxZ + LIGHT_DEPTH / 2)
      }
    }
  })

  it('mirrors the lights left and right', () => {
    for (const type of VEHICLE_TYPES) {
      const [frontLeft, frontRight, rearLeft, rearRight] = vehicleLightOffsets(type)
      expect(frontLeft!.x).toBeCloseTo(-frontRight!.x, 9)
      expect(rearLeft!.x).toBeCloseTo(-rearRight!.x, 9)
    }
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/journey/vehicle-specs.test.ts`
Expected: FAIL, `Failed to resolve import "../../app/journey/vehicle-specs"`.

- [ ] **Step 3: Vendor the models and licence note**

Run, from `repos/portfolio`, using a new empty temp directory (the zip is untrusted data; do not run anything from inside it):

```bash
KIT=$(mktemp -d)
curl -sL -o "$KIT/kit.zip" "https://kenney.nl/media/pages/assets/car-kit/1a312ec241-1775131960/kenney_car-kit.zip"
unzip -q "$KIT/kit.zip" -d "$KIT/out"
mkdir -p public/models/vehicles
for name in sedan suv truck; do cp "$KIT/out/Models/GLB format/$name.glb" public/models/vehicles/$name.glb; done
shasum -a 256 public/models/vehicles/*.glb
```

Expected: the three hashes equal the SHA-256 values in Global Constraints. If any differs, stop and report it. The upstream file changed, and the measured values in this task need re-checking.

Create `public/models/vehicles/LICENSE.txt`:

```text
Vehicle models: Kenney Car Kit 3.1 (sedan, suv, truck)
Created and distributed by Kenney (www.kenney.nl)
License: Creative Commons Zero (CC0), http://creativecommons.org/publicdomain/zero/1.0/
Source: https://kenney.nl/assets/car-kit
Attribution is not required.
```

- [ ] **Step 4: Write `app/journey/vehicle-specs.ts`**

```ts
export const VEHICLE_TYPES = ['sedan', 'suv', 'truck'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

// Kenney's cars are 2.55 to 3 model units long. At 0.36 the sedan is 0.92 scene units, near the old box car (0.9).
export const VEHICLE_SCALE = 0.36

// Measured from the Kenney GLBs, in model units. The model faces +Z, so the front is at `frontZ`.
// Wheel bottoms sit at y = 0 and the roof at VEHICLE_HEIGHT. The loader re-checks these against the real files.
export const VEHICLE_HALF_WIDTH = 0.75
export const VEHICLE_HEIGHT = 1.3

export interface VehicleSpec {
  file: string
  frontZ: number
  rearZ: number
}

export const VEHICLE_SPECS: Readonly<Record<VehicleType, VehicleSpec>> = {
  sedan: { file: 'sedan.glb', frontZ: 1.25, rearZ: -1.3 },
  suv: { file: 'suv.glb', frontZ: 1.35, rearZ: -1.35 },
  truck: { file: 'truck.glb', frontZ: 1.45, rearZ: -1.5 },
}

export interface VehicleBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

// Scene units after normalization: front toward -Z, wheels on y = 0, scaled by VEHICLE_SCALE.
export function vehicleBounds(type: VehicleType): VehicleBounds {
  const { frontZ, rearZ } = VEHICLE_SPECS[type]
  return {
    minX: -VEHICLE_HALF_WIDTH * VEHICLE_SCALE,
    maxX: VEHICLE_HALF_WIDTH * VEHICLE_SCALE,
    minY: 0,
    maxY: VEHICLE_HEIGHT * VEHICLE_SCALE,
    minZ: -frontZ * VEHICLE_SCALE,
    maxZ: -rearZ * VEHICLE_SCALE,
  }
}

export interface VehicleLightOffset {
  x: number
  y: number
  z: number
  kind: 'front' | 'rear'
}

// Light height and inset in model units. Tuned by eye against the Kenney bumpers.
const LIGHT_HEIGHT = 0.55
const LIGHT_INSET_X = 0.45
// The light box is 0.03 deep. Center it just inside the bumper.
const LIGHT_Z_INSET = 0.02

function lightOffsetsFor(type: VehicleType): readonly VehicleLightOffset[] {
  const bounds = vehicleBounds(type)
  const x = LIGHT_INSET_X * VEHICLE_SCALE
  const y = LIGHT_HEIGHT * VEHICLE_SCALE
  const front = bounds.minZ + LIGHT_Z_INSET
  const rear = bounds.maxZ - LIGHT_Z_INSET
  return [
    { x: -x, y, z: front, kind: 'front' },
    { x, y, z: front, kind: 'front' },
    { x: -x, y, z: rear, kind: 'rear' },
    { x, y, z: rear, kind: 'rear' },
  ]
}

const LIGHT_OFFSETS: Readonly<Record<VehicleType, readonly VehicleLightOffset[]>> = {
  sedan: lightOffsetsFor('sedan'),
  suv: lightOffsetsFor('suv'),
  truck: lightOffsetsFor('truck'),
}

export function vehicleLightOffsets(type: VehicleType): readonly VehicleLightOffset[] {
  return LIGHT_OFFSETS[type]
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run tests/journey/vehicle-specs.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Correct the spec**

In `docs/superpowers/specs/2026-10-11-journey-vehicles-design.md` make these edits:

1. Replace `- Added bundle weight is tens of KB per model, not MB.` with `- Added download weight is about 170 to 210 KB per model (about 550 KB for three), loaded in the background after the scene starts.`
2. Replace the table row `| Rendering | One \`InstancedMesh\` set per type, merged by material | About 9 body-related draw calls. Cloning scene graphs would cost about 60. |` with `| Rendering | One \`InstancedMesh\` per type, one merged geometry per model | Every Kenney model uses a single palette material, so body, wheels, and glass merge into one geometry. That gives 3 body draw calls plus 1 for lights. Cloning scene graphs would cost about 60. |`
3. Replace the whole `### Color` section body with: `Kenney models share one palette texture, and the glass lives inside the body mesh. A per-car tint therefore multiplies the whole model. The body paint is a dark charcoal swatch, so the tint is the existing \`BODY_COLORS\` value times a compensation factor (\`PAINT_COMPENSATION\`, 2.5, tuned in the browser). Glass and trim take a faint tint too. If that looks wrong in the manual check, set the factor to give every car a neutral tint and rely on the three silhouettes for variety.`
4. In `### Model loading` replace `merge meshes into one geometry per material group (body, glass, wheels and trim)` with `merge all meshes into one geometry (one shared material)`.

- [ ] **Step 7: Commit**

```bash
git add public/models/vehicles app/journey/vehicle-specs.ts tests/journey/vehicle-specs.test.ts ../../docs/superpowers/specs/2026-10-11-journey-vehicles-design.md
git commit -m "feat: vendor Kenney vehicle models and measured specs"
```

---

### Task 2: Merge model parts into one normalized geometry

**Files:**
- Create: `app/journey/vehicle-geometry.ts`
- Test: `tests/journey/vehicle-geometry.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (used by Task 3): `interface VehiclePart { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }` and `mergeVehicleParts(parts: readonly VehiclePart[], scale: number): THREE.BufferGeometry`. The result has the part matrices baked in, faces -Z (rotated 180° about Y), is scaled by `scale`, and has a computed bounding box. The inputs are not modified or disposed.

- [ ] **Step 1: Write the failing test**

Create `tests/journey/vehicle-geometry.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { mergeVehicleParts } from '../../app/journey/vehicle-geometry'

function box(width: number, height: number, depth: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(width, height, depth)
}

function translate(x: number, y: number, z: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(x, y, z)
}

describe('mergeVehicleParts', () => {
  it('bakes each part matrix, then scales and flips the model so the +Z front faces -Z', () => {
    const body = box(1, 1, 2)
    // A "headlight" block on the +Z (front) end of the model.
    const front = box(0.2, 0.2, 0.2)
    const merged = mergeVehicleParts([
      { geometry: body, matrix: translate(0, 0.5, 0) },
      { geometry: front, matrix: translate(0, 0.5, 1.1) },
    ], 0.5)
    const frontBlockCenterZ = (() => {
      const probe = mergeVehicleParts([{ geometry: front, matrix: translate(0, 0.5, 1.1) }], 0.5)
      probe.computeBoundingBox()
      return probe.boundingBox!.getCenter(new THREE.Vector3()).z
    })()
    expect(frontBlockCenterZ).toBeCloseTo(-0.55, 6)
    merged.computeBoundingBox()
    expect(merged.boundingBox!.min.z).toBeCloseTo(-0.6 * 1, 6)
    expect(merged.boundingBox!.max.z).toBeCloseTo(0.5, 6)
  })

  it('scales the bounds and keeps wheel-bottom parts on y = 0', () => {
    const merged = mergeVehicleParts([{ geometry: box(1, 1, 2), matrix: translate(0, 0.5, 0) }], 0.36)
    expect(merged.boundingBox!.min.y).toBeCloseTo(0, 6)
    expect(merged.boundingBox!.max.y).toBeCloseTo(0.36, 6)
    expect(merged.boundingBox!.max.z - merged.boundingBox!.min.z).toBeCloseTo(0.72, 6)
  })

  it('sums the vertices of every part and keeps position, normal and uv', () => {
    const a = box(1, 1, 1)
    const b = box(1, 1, 1)
    const merged = mergeVehicleParts([
      { geometry: a, matrix: new THREE.Matrix4() },
      { geometry: b, matrix: translate(2, 0, 0) },
    ], 1)
    expect(merged.getAttribute('position').count).toBe(a.getAttribute('position').count * 2)
    expect(merged.getAttribute('normal')).toBeDefined()
    expect(merged.getAttribute('uv')).toBeDefined()
  })

  it('does not modify or dispose the input geometries', () => {
    const body = box(1, 1, 2)
    const before = Array.from(body.getAttribute('position').array)
    let disposed = false
    body.addEventListener('dispose', () => { disposed = true })
    mergeVehicleParts([{ geometry: body, matrix: translate(0, 0.5, 0) }], 0.5)
    expect(Array.from(body.getAttribute('position').array)).toEqual(before)
    expect(disposed).toBe(false)
  })

  it('throws a clear error for a model with no meshes', () => {
    expect(() => mergeVehicleParts([], 1)).toThrow('no meshes')
  })

  it('throws a clear error when parts have different attributes', () => {
    const plain = box(1, 1, 1)
    const noUv = box(1, 1, 1)
    noUv.deleteAttribute('uv')
    expect(() => mergeVehicleParts([
      { geometry: plain, matrix: new THREE.Matrix4() },
      { geometry: noUv, matrix: new THREE.Matrix4() },
    ], 1)).toThrow('incompatible')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/journey/vehicle-geometry.test.ts`
Expected: FAIL, `Failed to resolve import "../../app/journey/vehicle-geometry"`.

- [ ] **Step 3: Write `app/journey/vehicle-geometry.ts`**

```ts
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface VehiclePart {
  geometry: THREE.BufferGeometry
  // The part's transform relative to the model root, with the node hierarchy already applied.
  matrix: THREE.Matrix4
}

// Kenney models face +Z. Traffic authors cars facing -Z, so every model turns 180 degrees about Y.
const FACE_NEGATIVE_Z = new THREE.Matrix4().makeRotationY(Math.PI)

export function mergeVehicleParts(parts: readonly VehiclePart[], scale: number): THREE.BufferGeometry {
  if (parts.length === 0) throw new Error('A vehicle model has no meshes')
  const normalize = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(FACE_NEGATIVE_Z)
  const baked = parts.map(({ geometry, matrix }) =>
    geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(normalize, matrix)))
  const merged = mergeGeometries(baked, false)
  for (const geometry of baked) geometry.dispose()
  if (!merged) throw new Error('Vehicle model parts have incompatible attributes')
  merged.computeBoundingBox()
  return merged
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/journey/vehicle-geometry.test.ts`
Expected: PASS, 6 tests. If `mergeGeometries` logs an error to the console for the mismatched case and returns null, the last test still passes.

- [ ] **Step 5: Commit**

```bash
git add app/journey/vehicle-geometry.ts tests/journey/vehicle-geometry.test.ts
git commit -m "feat: merge and normalize vehicle model parts"
```

---

### Task 3: Load the models and attach them to traffic safely

**Files:**
- Create: `app/journey/vehicle-models.ts`
- Test: `tests/journey/vehicle-models.test.ts`

**Interfaces:**
- Consumes: `VEHICLE_TYPES`, `VehicleType`, `VEHICLE_SPECS`, `VEHICLE_SCALE`, `vehicleBounds` (Task 1); `mergeVehicleParts`, `VehiclePart` (Task 2).
- Produces (used by Tasks 4 and 5):
  - `interface VehicleModels { readonly geometries: Readonly<Record<VehicleType, THREE.BufferGeometry>>; readonly map: THREE.Texture }`
  - `type GltfSource = (url: string) => Promise<{ scene: THREE.Object3D }>`
  - `loadVehicleModels(source?: GltfSource): Promise<VehicleModels>` (default source: `GLTFLoader` from a dynamic import, base URL `/models/vehicles/`)
  - `disposeVehicleModels(models: VehicleModels): void`
  - `attachVehicleModels(options: { traffic: { useModels(models: VehicleModels): void }; load: () => Promise<VehicleModels>; isDisposed: () => boolean; onReady?: () => void; onError?: (error: unknown) => void }): Promise<void>` (never rejects)
  - `VEHICLE_BOUNDS_TOLERANCE: number` (0.05 scene units)

- [ ] **Step 1: Write the failing test**

Create `tests/journey/vehicle-models.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { VEHICLE_SCALE, VEHICLE_SPECS, VEHICLE_TYPES, type VehicleType } from '../../app/journey/vehicle-specs'
import {
  attachVehicleModels, disposeVehicleModels, type GltfSource, loadVehicleModels, type VehicleModels,
} from '../../app/journey/vehicle-models'

const MODEL_HEIGHT = 1.3
const MODEL_HALF_WIDTH = 0.75

// A stand-in GLB scene: one body block spanning the spec'd front and rear, plus a wheel on the ground.
function fakeScene(type: VehicleType, map = new THREE.Texture()): THREE.Group {
  const { frontZ, rearZ } = VEHICLE_SPECS[type]
  const material = new THREE.MeshStandardMaterial({ map })
  const length = frontZ - rearZ
  const body = new THREE.Mesh(new THREE.BoxGeometry(MODEL_HALF_WIDTH * 2, MODEL_HEIGHT - 0.3, length), material)
  body.position.set(0, 0.3 + (MODEL_HEIGHT - 0.3) / 2, (frontZ + rearZ) / 2)
  const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.6), material)
  wheel.position.set(0.3, 0.3, frontZ - 0.5)
  const group = new THREE.Group()
  group.add(body, wheel)
  return group
}

function fakeSource(overrides: Partial<Record<VehicleType, THREE.Object3D>> = {}): GltfSource {
  return async url => {
    const type = VEHICLE_TYPES.find(candidate => url.endsWith(VEHICLE_SPECS[candidate].file))
    if (!type) throw new Error(`Unexpected url ${url}`)
    return { scene: overrides[type] ?? fakeScene(type) }
  }
}

describe('loadVehicleModels', () => {
  it('returns one merged geometry per type, scaled and facing -Z, with one shared texture', async () => {
    const models = await loadVehicleModels(fakeSource())
    for (const type of VEHICLE_TYPES) {
      const box = models.geometries[type].boundingBox!
      const { frontZ, rearZ } = VEHICLE_SPECS[type]
      expect(box.min.z).toBeCloseTo(-frontZ * VEHICLE_SCALE, 5)
      expect(box.max.z).toBeCloseTo(-rearZ * VEHICLE_SCALE, 5)
      expect(box.min.y).toBeCloseTo(0, 5)
      expect(box.max.y).toBeCloseTo(MODEL_HEIGHT * VEHICLE_SCALE, 5)
    }
    expect(models.map).toBeInstanceOf(THREE.Texture)
    disposeVehicleModels(models)
  })

  it('applies parent node transforms to the parts', async () => {
    const nested = new THREE.Group()
    nested.position.set(0, 0, 0)
    const inner = fakeScene('sedan')
    const offset = new THREE.Group()
    offset.add(inner)
    nested.add(offset)
    const models = await loadVehicleModels(fakeSource({ sedan: nested }))
    expect(models.geometries.sedan.boundingBox!.min.y).toBeCloseTo(0, 5)
    disposeVehicleModels(models)
  })

  it('rejects with the measured size when a model does not match its spec', async () => {
    const tooTall = new THREE.Group()
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3, 2.55), new THREE.MeshStandardMaterial({ map: new THREE.Texture() }))
    slab.position.set(0, 1.5, -0.025)
    tooTall.add(slab)
    await expect(loadVehicleModels(fakeSource({ sedan: tooTall }))).rejects.toThrow(/sedan.*does not match/)
  })

  it('rejects when a model has no textured material', async () => {
    const bare = new THREE.Group()
    bare.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    await expect(loadVehicleModels(fakeSource({ truck: bare }))).rejects.toThrow(/truck/)
  })

  it('rejects when a download fails', async () => {
    const failing: GltfSource = async () => { throw new Error('404') }
    await expect(loadVehicleModels(failing)).rejects.toThrow('404')
  })

  it('disposes the geometries and the texture on request', async () => {
    const models = await loadVehicleModels(fakeSource())
    const spies = VEHICLE_TYPES.map(type => vi.spyOn(models.geometries[type], 'dispose'))
    const mapSpy = vi.spyOn(models.map, 'dispose')
    disposeVehicleModels(models)
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
    expect(mapSpy).toHaveBeenCalledTimes(1)
  })
})

describe('attachVehicleModels', () => {
  function stubModels(): VehicleModels {
    const geometries = { sedan: new THREE.BufferGeometry(), suv: new THREE.BufferGeometry(), truck: new THREE.BufferGeometry() }
    return { geometries, map: new THREE.Texture() }
  }

  it('hands the loaded models to traffic and reports ready', async () => {
    const models = stubModels()
    const traffic = { useModels: vi.fn() }
    const onReady = vi.fn()
    await attachVehicleModels({ traffic, load: async () => models, isDisposed: () => false, onReady })
    expect(traffic.useModels).toHaveBeenCalledWith(models)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('keeps the box cars and reports the error once when the load fails', async () => {
    const traffic = { useModels: vi.fn() }
    const onError = vi.fn()
    const onReady = vi.fn()
    const failure = new Error('404')
    await expect(attachVehicleModels({
      traffic, load: async () => { throw failure }, isDisposed: () => false, onReady, onError,
    })).resolves.toBeUndefined()
    expect(traffic.useModels).not.toHaveBeenCalled()
    expect(onReady).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('keeps the box cars when traffic rejects the models', async () => {
    const onError = vi.fn()
    const traffic = { useModels: () => { throw new Error('bad models') } }
    await attachVehicleModels({ traffic, load: async () => stubModels(), isDisposed: () => false, onError })
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('adds nothing and disposes the models when the scene was disposed before they arrived', async () => {
    const models = stubModels()
    const spies = VEHICLE_TYPES.map(type => vi.spyOn(models.geometries[type], 'dispose'))
    const mapSpy = vi.spyOn(models.map, 'dispose')
    const traffic = { useModels: vi.fn() }
    const onReady = vi.fn()
    await attachVehicleModels({ traffic, load: async () => models, isDisposed: () => true, onReady })
    expect(traffic.useModels).not.toHaveBeenCalled()
    expect(onReady).not.toHaveBeenCalled()
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
    expect(mapSpy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/journey/vehicle-models.test.ts`
Expected: FAIL, `Failed to resolve import "../../app/journey/vehicle-models"`.

- [ ] **Step 3: Write `app/journey/vehicle-models.ts`**

```ts
import * as THREE from 'three'
import { mergeVehicleParts, type VehiclePart } from './vehicle-geometry'
import { VEHICLE_SCALE, VEHICLE_SPECS, VEHICLE_TYPES, type VehicleType, vehicleBounds } from './vehicle-specs'

export const VEHICLE_MODEL_DIR = '/models/vehicles/'
// How far a merged model may drift from its measured bounds, in scene units, before the load is rejected.
export const VEHICLE_BOUNDS_TOLERANCE = 0.05

export interface VehicleModels {
  readonly geometries: Readonly<Record<VehicleType, THREE.BufferGeometry>>
  // The palette texture every Kenney model shares. All three GLBs embed the same image; the first one is kept.
  readonly map: THREE.Texture
}

export type GltfSource = (url: string) => Promise<{ scene: THREE.Object3D }>

async function loadGltf(url: string): Promise<{ scene: THREE.Object3D }> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  return new GLTFLoader().loadAsync(url)
}

function collectParts(root: THREE.Object3D): { parts: VehiclePart[]; map: THREE.Texture | null } {
  root.updateWorldMatrix(true, true)
  const parts: VehiclePart[] = []
  let map: THREE.Texture | null = null
  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    parts.push({ geometry: mesh.geometry, matrix: mesh.matrixWorld.clone() })
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    map ??= (material as THREE.MeshStandardMaterial | undefined)?.map ?? null
  })
  return { parts, map }
}

function assertMatchesSpec(type: VehicleType, geometry: THREE.BufferGeometry): void {
  const box = geometry.boundingBox
  const expected = vehicleBounds(type)
  const measured = box
    ? { minZ: box.min.z, maxZ: box.max.z, minY: box.min.y, maxY: box.max.y }
    : null
  const matches = measured !== null
    && Math.abs(measured.minZ - expected.minZ) <= VEHICLE_BOUNDS_TOLERANCE
    && Math.abs(measured.maxZ - expected.maxZ) <= VEHICLE_BOUNDS_TOLERANCE
    && Math.abs(measured.minY - expected.minY) <= VEHICLE_BOUNDS_TOLERANCE
    && Math.abs(measured.maxY - expected.maxY) <= VEHICLE_BOUNDS_TOLERANCE
  if (!matches) {
    throw new Error(
      `The ${type} model does not match its spec. Measured ${JSON.stringify(measured)}, expected ${JSON.stringify({
        minZ: expected.minZ, maxZ: expected.maxZ, minY: expected.minY, maxY: expected.maxY,
      })}`,
    )
  }
}

export async function loadVehicleModels(source: GltfSource = loadGltf): Promise<VehicleModels> {
  const loaded = await Promise.all(VEHICLE_TYPES.map(async type => ({
    type,
    gltf: await source(VEHICLE_MODEL_DIR + VEHICLE_SPECS[type].file),
  })))
  const geometries: Partial<Record<VehicleType, THREE.BufferGeometry>> = {}
  let map: THREE.Texture | null = null
  const spareMaps: THREE.Texture[] = []
  try {
    for (const { type, gltf } of loaded) {
      const collected = collectParts(gltf.scene)
      if (!collected.map) throw new Error(`The ${type} model has no textured material`)
      if (map === null) map = collected.map
      else if (collected.map !== map) spareMaps.push(collected.map)
      const geometry = mergeVehicleParts(collected.parts, VEHICLE_SCALE)
      assertMatchesSpec(type, geometry)
      geometries[type] = geometry
    }
  } catch (error) {
    for (const geometry of Object.values(geometries)) geometry.dispose()
    for (const texture of [map, ...spareMaps]) texture?.dispose()
    throw error
  }
  // The other two palette copies are never drawn.
  for (const texture of spareMaps) texture.dispose()
  return {
    geometries: geometries as Record<VehicleType, THREE.BufferGeometry>,
    map: map as unknown as THREE.Texture,
  }
}

export function disposeVehicleModels(models: VehicleModels): void {
  for (const type of VEHICLE_TYPES) models.geometries[type].dispose()
  models.map.dispose()
}

export interface AttachVehicleModelsOptions {
  traffic: { useModels(models: VehicleModels): void }
  load: () => Promise<VehicleModels>
  isDisposed: () => boolean
  onReady?: () => void
  onError?: (error: unknown) => void
}

// Never rejects: a failed load or a bad swap leaves the traffic as it is, which is the box cars.
export async function attachVehicleModels(options: AttachVehicleModelsOptions): Promise<void> {
  const { traffic, load, isDisposed, onReady, onError } = options
  let models: VehicleModels
  try {
    models = await load()
  } catch (error) {
    onError?.(error)
    return
  }
  if (isDisposed()) {
    disposeVehicleModels(models)
    return
  }
  try {
    traffic.useModels(models)
  } catch (error) {
    disposeVehicleModels(models)
    onError?.(error)
    return
  }
  onReady?.()
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/journey/vehicle-models.test.ts`
Expected: PASS, 10 tests.

If the "disposes … texture" test fails because the first fake scene shares one `THREE.Texture` per type, remember each `fakeScene` call creates its own texture by default. That is intended: it exercises the spare-map path.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If `map as unknown as THREE.Texture` triggers a lint complaint, replace it with an explicit guard that throws `new Error('No vehicle model has a texture')` when `map === null`, and return `map`.

- [ ] **Step 6: Commit**

```bash
git add app/journey/vehicle-models.ts tests/journey/vehicle-models.test.ts
git commit -m "feat: load vehicle GLBs and attach them to traffic safely"
```

---

### Task 4: Traffic renders vehicle types

**Files:**
- Modify: `app/journey/traffic.ts`
- Modify: `tests/journey/traffic.test.ts` (the `car()` helper, plus new tests)

**Interfaces:**
- Consumes: `VehicleType`, `VEHICLE_TYPES`, `VehicleLightOffset`, `vehicleLightOffsets` (Task 1); `VehicleModels`, `disposeVehicleModels` (Task 3).
- Produces (used by Task 5):
  - `Car` gains `type: VehicleType`. `createCars` assigns `VEHICLE_TYPES[i % 3]`.
  - `TRAFFIC_GROUP_NAME: string` (`'journey-street-traffic'`)
  - `vehicleBodyName(type: VehicleType): string` (`'journey-street-car-bodies-sedan'`, and so on)
  - `Traffic` gains `readonly group: THREE.Group` and `useModels(models: VehicleModels): void`. `objects` stays and returns the group's current meshes: bodies first, then lights.
  - `CAR_LIGHT_OFFSETS` entries gain `y: 0` and type `readonly VehicleLightOffset[]`.
  - `PAINT_COMPENSATION: number` (2.5), `ROAD_Y: number` (-1)

- [ ] **Step 1: Update the existing test helper so it compiles**

In `tests/journey/traffic.test.ts` replace the `car` helper:

```ts
function car(startDistance: number, speed = 3, type: VehicleType = 'sedan'): Car {
  return { speed, startDistance, bodyColor: 0x3a3a40, type }
}
```

and add to the imports:

```ts
import { VEHICLE_TYPES, type VehicleType, vehicleBounds, vehicleLightOffsets } from '../../app/journey/vehicle-specs'
import type { VehicleModels } from '../../app/journey/vehicle-models'
```

Also extend the `traffic` import list with `PAINT_COMPENSATION, ROAD_Y, TRAFFIC_GROUP_NAME, vehicleBodyName`.

- [ ] **Step 2: Write the failing tests**

Append to `tests/journey/traffic.test.ts`:

```ts
function fakeModels(): VehicleModels {
  const geometries = {
    sedan: new THREE.BoxGeometry(0.5, 0.4, 0.9),
    suv: new THREE.BoxGeometry(0.5, 0.45, 0.95),
    truck: new THREE.BoxGeometry(0.5, 0.5, 1.05),
  }
  return { geometries, map: new THREE.Texture() }
}

const bodyMeshes = (traffic: Traffic) =>
  traffic.objects.filter(mesh => mesh.name.startsWith(`${STREET_NAMES.carBodies}-`))

describe('createCars vehicle types', () => {
  it('assigns the three types in rotation, so low power still has all three', () => {
    for (const count of [CAR_COUNT_FULL, CAR_COUNT_LOW_POWER]) {
      const types = createCars(count).map(c => c.type)
      expect(new Set(types)).toEqual(new Set(VEHICLE_TYPES))
    }
    expect(createCars(CAR_COUNT_FULL).map(c => c.type)).toEqual(createCars(CAR_COUNT_FULL).map(c => c.type))
  })
})

describe('createTraffic with vehicle models', () => {
  it('exposes a named group that holds the box meshes until models arrive', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    expect(traffic.group.name).toBe(TRAFFIC_GROUP_NAME)
    expect(traffic.group.name.startsWith('journey-street-')).toBe(true)
    expect(traffic.group.children).toHaveLength(2)
    traffic.dispose()
  })

  it('swaps the box bodies for one body mesh per type: three bodies plus the lights, four draw calls', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    traffic.useModels(fakeModels())
    expect(traffic.objects).toHaveLength(4)
    expect(bodyMeshes(traffic).map(mesh => mesh.name).sort()).toEqual(VEHICLE_TYPES.map(vehicleBodyName).sort())
    expect(bodyMeshes(traffic).map(mesh => mesh.count)).toEqual([4, 4, 4])
    expect(meshNamed(traffic, STREET_NAMES.carLights).count).toBe(48)
    expect(traffic.objects.some(mesh => mesh.name === STREET_NAMES.carBodies)).toBe(false)
    for (const mesh of traffic.objects) expect(mesh.frustumCulled).toBe(false)
    traffic.dispose()
  })

  it('creates no empty mesh for a type with no cars', () => {
    const traffic = createTraffic([car(10, 3, 'sedan'), car(40, 3, 'sedan'), car(70, 3, 'truck')])
    traffic.useModels(fakeModels())
    expect(bodyMeshes(traffic).map(mesh => [mesh.name, mesh.count])).toEqual([
      [vehicleBodyName('sedan'), 2],
      [vehicleBodyName('truck'), 1],
    ])
    traffic.dispose()
  })

  it('copies the reflection layers of the group onto the new meshes', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_LOW_POWER))
    traffic.group.layers.enable(1)
    traffic.useModels(fakeModels())
    for (const mesh of bodyMeshes(traffic)) expect(mesh.layers.isEnabled(1)).toBe(true)
    traffic.dispose()
  })

  it('ignores a second useModels call and keeps the first meshes', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    traffic.useModels(fakeModels())
    const first = bodyMeshes(traffic)
    traffic.useModels(fakeModels())
    expect(bodyMeshes(traffic)).toEqual(first)
    traffic.dispose()
  })

  it('does nothing after dispose, and with no cars', () => {
    const none = createTraffic([])
    none.useModels(fakeModels())
    expect(none.group.children).toHaveLength(0)
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    traffic.dispose()
    expect(() => traffic.useModels(fakeModels())).not.toThrow()
  })

  it('puts the vehicles on the road and each on its lane position', () => {
    const fixture = car(50, 3, 'suv')
    const traffic = createTraffic([fixture])
    traffic.useModels(fakeModels())
    traffic.update(1, 0)
    const bodies = meshNamed(traffic, vehicleBodyName('suv'))
    const pose = carPoseAt(fixture, 0)
    const position = positionOf(bodies, 0)
    expect(position.y).toBeCloseTo(ROAD_Y, 6)
    expect(position.x).toBeCloseTo(pose.x, 6)
    expect(position.z).toBeCloseTo(pose.z, 6)
    expect(scaleOf(bodies, 0)).toBeCloseTo(1, 6)
    traffic.dispose()
  })

  it('writes every matrix on the first update after a swap that happens mid-run, and keeps the light mesh', () => {
    const traffic = createTraffic([car(50, 3, 'sedan'), car(80, 3, 'truck')])
    traffic.update(0.3, 0)
    const lights = meshNamed(traffic, STREET_NAMES.carLights)
    const colorVersion = lights.instanceColor!.version
    traffic.useModels(fakeModels())
    expect(meshNamed(traffic, STREET_NAMES.carLights)).toBe(lights)
    traffic.update(0.3, 1)
    for (const mesh of bodyMeshes(traffic)) {
      expect(scaleOf(mesh, 0)).toBeGreaterThan(0)
      expect(Number.isNaN(positionOf(mesh, 0).x)).toBe(false)
    }
    expect(lights.instanceColor!.version).toBe(colorVersion)
    traffic.dispose()
  })

  it('places each type\'s lights at its own bumpers, ahead of or behind the body in both lanes', () => {
    for (const type of VEHICLE_TYPES) {
      for (const [lane, fixture] of [[1, forwardAt(50)], [-1, backAt(50)]] as const) {
        const typed = { ...fixture, type }
        const traffic = createTraffic([typed])
        traffic.useModels(fakeModels())
        traffic.update(1, 0)
        const body = positionOf(meshNamed(traffic, vehicleBodyName(type)), 0)
        const lights = meshNamed(traffic, STREET_NAMES.carLights)
        const point = pathPointAt(50)
        const travel = new THREE.Vector3(lane * point.dirX, 0, lane * point.dirZ)
        const bounds = vehicleBounds(type)
        vehicleLightOffsets(type).forEach((offset, k) => {
          const light = positionOf(lights, k)
          expect(light.y).toBeCloseTo(ROAD_Y + offset.y, 6)
          const ahead = light.clone().sub(body).dot(travel)
          const halfLength = (bounds.maxZ - bounds.minZ) / 2
          if (offset.kind === 'front') expect(ahead, `${type} lane ${lane} light ${k}`).toBeGreaterThan(halfLength * 0.8)
          else expect(ahead, `${type} lane ${lane} light ${k}`).toBeLessThan(-halfLength * 0.8)
        })
        traffic.dispose()
      }
    }
  })

  it('hides a car at a corner in every mesh, lights included', () => {
    for (const distance of [34, 60]) {
      const traffic = createTraffic([car(distance, 3, 'truck')])
      traffic.useModels(fakeModels())
      traffic.update(1, 0)
      expect(scaleOf(meshNamed(traffic, vehicleBodyName('truck')), 0)).toBe(0)
      for (let k = 0; k < 4; k++) expect(scaleOf(meshNamed(traffic, STREET_NAMES.carLights), k)).toBe(0)
      traffic.dispose()
    }
  })

  it('tints each body by its palette color times the paint compensation', () => {
    const cars = createCars(CAR_COUNT_LOW_POWER)
    const traffic = createTraffic(cars)
    traffic.useModels(fakeModels())
    const out = new THREE.Color()
    const expected = new THREE.Color()
    for (const type of VEHICLE_TYPES) {
      const mesh = meshNamed(traffic, vehicleBodyName(type))
      cars.filter(c => c.type === type).forEach((c, j) => {
        mesh.getColorAt(j, out)
        expected.set(c.bodyColor).multiplyScalar(PAINT_COMPENSATION)
        expect(out.r).toBeCloseTo(expected.r, 5)
        expect(out.g).toBeCloseTo(expected.g, 5)
        expect(out.b).toBeCloseTo(expected.b, 5)
      })
    }
    traffic.dispose()
  })

  it('disposes the model geometries, texture and shared material, and the lights', () => {
    const models = fakeModels()
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    traffic.useModels(models)
    const geometrySpies = VEHICLE_TYPES.map(type => vi.spyOn(models.geometries[type], 'dispose'))
    const mapSpy = vi.spyOn(models.map, 'dispose')
    const material = bodyMeshes(traffic)[0]!.material as THREE.Material
    const materialSpy = vi.spyOn(material, 'dispose')
    const lights = meshNamed(traffic, STREET_NAMES.carLights)
    const lightGeometrySpy = vi.spyOn(lights.geometry, 'dispose')
    traffic.dispose()
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalledTimes(1)
    expect(mapSpy).toHaveBeenCalledTimes(1)
    expect(materialSpy).toHaveBeenCalledTimes(1)
    expect(lightGeometrySpy).toHaveBeenCalledTimes(1)
  })
})
```

Add `vi` to the vitest import at the top of the file: `import { describe, expect, it, vi } from 'vitest'`. The file defines `meshNamed`, `positionOf`, `scaleOf` helpers already (used by the existing tests); do not redefine them.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run tests/journey/traffic.test.ts`
Expected: FAIL. The new suites fail on missing exports (`TRAFFIC_GROUP_NAME`, `vehicleBodyName`, `PAINT_COMPENSATION`, `ROAD_Y`) and `car.type`.

- [ ] **Step 4: Implement in `app/journey/traffic.ts`**

4a. Imports. Add after the existing imports:

```ts
import { disposeVehicleModels, type VehicleModels } from './vehicle-models'
import { VEHICLE_TYPES, type VehicleLightOffset, type VehicleType, vehicleLightOffsets } from './vehicle-specs'
```

4b. Constants. After `export const REAR_MIN_INTENSITY = 0.2` add:

```ts
// Road surface is at y = -1. Model geometry has its wheel bottoms at y = 0.
export const ROAD_Y = -1
// The Kenney body paint is a dark charcoal swatch, so a plain tint barely shows. This brings it up
// to roughly the color in BODY_COLORS. Tuned by eye in the browser.
export const PAINT_COMPENSATION = 2.5
export const TRAFFIC_GROUP_NAME = `${STREET_NAME_PREFIX}traffic`

export function vehicleBodyName(type: VehicleType): string {
  return `${STREET_NAMES.carBodies}-${type}`
}
```

and extend the lamps import: `import { DARK_GLASS_HEX, lampIntensity, STREET_LIGHT_LUMINANCE, STREET_NAME_PREFIX, STREET_NAMES } from './lamps'`.

4c. `Car`, `createCars`. Add `type: VehicleType` to `Car`. In `createCars`, add `type: VEHICLE_TYPES[i % VEHICLE_TYPES.length] ?? 'sedan',` to the pushed object.

4d. Light offsets. Replace the `CarLightKind` and `CAR_LIGHT_OFFSETS` block with:

```ts
export type CarLightKind = 'front' | 'rear'

// Box-car fallback. Authored facing -Z: the front is at -Z, the rear at +Z, at body-center height.
export const CAR_LIGHT_OFFSETS: readonly VehicleLightOffset[] = [
  { x: -0.15, y: 0, z: -0.46, kind: 'front' },
  { x: 0.15, y: 0, z: -0.46, kind: 'front' },
  { x: -0.15, y: 0, z: 0.46, kind: 'rear' },
  { x: 0.15, y: 0, z: 0.46, kind: 'rear' },
]
```

4e. `Traffic` interface and `createTraffic`. Replace everything from `export interface Traffic {` to the end of the file with:

```ts
export interface Traffic {
  // Stable parent of the meshes below. The scene adds it once; `useModels` swaps its children.
  readonly group: THREE.Group
  // Car bodies, then car lights. Box bodies and lights at first (two meshes), then one body mesh per
  // vehicle type that has cars plus the lights (up to four). Empty when there are no cars.
  readonly objects: readonly THREE.InstancedMesh[]
  // Replaces the box bodies with the vehicle models. Ignored when there are no cars, after dispose, or
  // after the first call. Traffic owns the models from then on and disposes them in `dispose`.
  useModels(models: VehicleModels): void
  update(windowLitRatio: number, t: number): void
  dispose(): void
}

// Module-level scratch objects: the per-frame writer reuses them. `pathPointAt` still returns one
// small object per car per frame, which is negligible next to the matrix work.
const matrix = new THREE.Matrix4()
const bodyPosition = new THREE.Vector3()
const lightOffset = new THREE.Vector3()
const bodyScale = new THREE.Vector3()
const bodyRotation = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)
const pose: CarPose = { x: 0, z: 0, yaw: 0, distance: 0, scale: 0 }
const scratchColor = new THREE.Color()

// One body mesh. Instance j draws cars[carIndices[j]], with its wheels on `baseY`.
interface BodySet {
  mesh: THREE.InstancedMesh
  carIndices: readonly number[]
  baseY: number
}

function createEmptyTraffic(group: THREE.Group): Traffic {
  return { group, objects: [], useModels() {}, update() {}, dispose() {} }
}

export function createTraffic(cars: readonly Car[]): Traffic {
  const group = new THREE.Group()
  group.name = TRAFFIC_GROUP_NAME
  if (cars.length === 0) return createEmptyTraffic(group)

  const boxMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.3 })
  boxMaterial.name = 'journey-street-car-body'
  const boxBodies = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CAR_SIZE.width, CAR_SIZE.height, CAR_SIZE.length), boxMaterial, cars.length)
  boxBodies.name = STREET_NAMES.carBodies
  boxBodies.frustumCulled = false
  cars.forEach((car, i) => boxBodies.setColorAt(i, scratchColor.set(car.bodyColor)))
  if (boxBodies.instanceColor) boxBodies.instanceColor.needsUpdate = true

  const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  lightMaterial.name = 'journey-street-car-light'
  const lights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(LIGHT_SIZE.width, LIGHT_SIZE.height, LIGHT_SIZE.depth), lightMaterial, cars.length * LIGHTS_PER_CAR)
  lights.name = STREET_NAMES.carLights
  lights.frustumCulled = false

  let sets: BodySet[] = [{ mesh: boxBodies, carIndices: cars.map((_, i) => i), baseY: CAR_CENTER_Y }]
  let offsetsFor: (car: Car) => readonly VehicleLightOffset[] = () => CAR_LIGHT_OFFSETS
  let models: VehicleModels | null = null
  let modelMaterial: THREE.MeshStandardMaterial | null = null
  let disposed = false

  function fillGroup() {
    group.clear()
    group.add(...sets.map(set => set.mesh), lights)
  }
  fillGroup()

  // Light kinds follow the same front, front, rear, rear order in every offset table.
  function writeLightColors(windowLitRatio: number) {
    for (let i = 0; i < cars.length; i++) {
      for (let k = 0; k < LIGHTS_PER_CAR; k++) {
        const light = CAR_LIGHT_OFFSETS[k]
        if (!light) continue
        lights.setColorAt(i * LIGHTS_PER_CAR + k, carLightColor(light.kind, windowLitRatio, scratchColor))
      }
    }
    if (lights.instanceColor) lights.instanceColor.needsUpdate = true
  }
  // Create the color attribute before the first render: three decides USE_INSTANCING_COLOR from it.
  writeLightColors(0)
  let lastKey = 0

  function releaseBoxBodies() {
    boxBodies.geometry.dispose()
    boxMaterial.dispose()
  }

  function createModelSets(next: VehicleModels, material: THREE.MeshStandardMaterial): BodySet[] {
    const indicesByType = new Map<VehicleType, number[]>()
    cars.forEach((car, i) => indicesByType.set(car.type, [...(indicesByType.get(car.type) ?? []), i]))
    const modelSets: BodySet[] = []
    for (const type of VEHICLE_TYPES) {
      const carIndices = indicesByType.get(type)
      if (!carIndices) continue
      const mesh = new THREE.InstancedMesh(next.geometries[type], material, carIndices.length)
      mesh.name = vehicleBodyName(type)
      mesh.frustumCulled = false
      mesh.layers.mask = group.layers.mask
      carIndices.forEach((carIndex, j) => {
        const car = cars[carIndex]
        if (car) mesh.setColorAt(j, scratchColor.set(car.bodyColor).multiplyScalar(PAINT_COMPENSATION))
      })
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      modelSets.push({ mesh, carIndices, baseY: ROAD_Y })
    }
    return modelSets
  }

  return {
    group,
    get objects() { return group.children as THREE.InstancedMesh[] },
    useModels(next) {
      if (disposed || models) return
      const material = new THREE.MeshStandardMaterial({ map: next.map, roughness: 0.55, metalness: 0.3 })
      material.name = 'journey-street-car-body'
      sets = createModelSets(next, material)
      models = next
      modelMaterial = material
      offsetsFor = car => vehicleLightOffsets(car.type)
      releaseBoxBodies()
      fillGroup()
    },
    update(windowLitRatio, t) {
      const key = Math.round(windowLitRatio / RATIO_QUANTUM)
      if (key !== lastKey) {
        lastKey = key
        writeLightColors(windowLitRatio)
      }
      for (const set of sets) {
        set.carIndices.forEach((carIndex, j) => {
          const car = cars[carIndex]
          if (!car) return
          carPoseAt(car, t, pose)
          bodyRotation.setFromAxisAngle(UP, pose.yaw)
          bodyScale.setScalar(pose.scale)
          bodyPosition.set(pose.x, set.baseY, pose.z)
          matrix.compose(bodyPosition, bodyRotation, bodyScale)
          set.mesh.setMatrixAt(j, matrix)
          const offsets = offsetsFor(car)
          for (let k = 0; k < LIGHTS_PER_CAR; k++) {
            const light = offsets[k]
            if (!light) continue
            lightOffset.set(light.x, light.y, light.z).applyQuaternion(bodyRotation).multiplyScalar(pose.scale).add(bodyPosition)
            matrix.compose(lightOffset, bodyRotation, bodyScale)
            lights.setMatrixAt(carIndex * LIGHTS_PER_CAR + k, matrix)
          }
        })
        set.mesh.instanceMatrix.needsUpdate = true
      }
      lights.instanceMatrix.needsUpdate = true
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (models) {
        disposeVehicleModels(models)
        modelMaterial?.dispose()
      } else {
        releaseBoxBodies()
      }
      lights.geometry.dispose()
      ;(lights.material as THREE.Material).dispose()
    },
  }
}
```

Keep `LIGHT_SIZE`, `RATIO_QUANTUM`, `LIGHTS_PER_CAR` where they are, above the `Traffic` interface (they already are). Remove the old `bodies`, `objects`, and `writeLightColors` implementations that this block replaces.

- [ ] **Step 5: Run the traffic tests and confirm they pass**

Run: `npx vitest run tests/journey/traffic.test.ts`
Expected: PASS, all old and new tests. The old test `creates one body per car and four lights per car … two draw calls` must pass unchanged.

- [ ] **Step 6: Run the whole unit suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. Fix any other test that constructs a `Car` without `type`.

- [ ] **Step 7: Commit**

```bash
git add app/journey/traffic.ts tests/journey/traffic.test.ts
git commit -m "feat: render sedan, suv and truck bodies in traffic"
```

---

### Task 5: Wire the scene and the GPU harness, and verify on the GPU

**Files:**
- Modify: `app/journey/scene.ts` (the options interface at line 38-45, the street-life block at lines 437-445)
- Modify: `tests/gpu/harness.ts` (`mountJourney`, around line 63-95, and the `cityGpu` object)
- Create: `tests/gpu/vehicles.spec.ts`

**Interfaces:**
- Consumes: `createTraffic`, `Traffic.group`, `vehicleBodyName`, `TRAFFIC_GROUP_NAME` (Task 4); `loadVehicleModels`, `attachVehicleModels`, `VehicleModels` (Task 3).
- Produces: `JourneySceneOptions.loadVehicleModels?: () => Promise<VehicleModels>` and `JourneySceneOptions.onVehiclesReady?: () => void`. Harness: `mountJourney({ …, vehicles?: boolean })` and `window.cityGpu.waitForVehicles(): Promise<void>`. By default the harness never resolves the load, so existing GPU tests keep seeing box cars.

- [ ] **Step 1: Write the failing GPU test**

Create `tests/gpu/vehicles.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { STREET_NAMES } from '../../app/journey/lamps'
import { REFLECT_LAYER } from '../../app/journey/reflect-layer'

const GPU_TEST_TIMEOUT_MS = 120_000
const TYPES = ['sedan', 'suv', 'truck'] as const
// Four lamp meshes, three vehicle bodies, one light mesh.
const STREET_DRAW_CALLS_WITH_VEHICLES = 8

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

for (const [tier, lowPower, perType] of [['full', false, 4], ['lite', true, 2]] as const) {
  test(`${tier}: the real GLBs load, replace the box cars, reflect and cost eight street draw calls`, async ({ page }) => {
    test.setTimeout(GPU_TEST_TIMEOUT_MS)
    const result = await page.evaluate(async ({ tier, lowPower, names, layer, types }) => {
      window.cityGpu.mountJourney({ tier, lowPower, vehicles: true })
      await window.cityGpu.waitForVehicles()
      const frames = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter }))
      const scene = window.cityGpu.getJourneyContext().scene
      type Probe = { count: number; layers: { isEnabled(layer: number): boolean } } | undefined
      const bodies = types.map(type => {
        const mesh = scene.getObjectByName(`${names.carBodies}-${type}`) as unknown as Probe
        return mesh ? { type, count: mesh.count, reflects: mesh.layers.isEnabled(layer) } : null
      })
      const box = scene.getObjectByName(names.carBodies)
      const calls = window.cityGpu.streetDrawCalls()
      window.cityGpu.dispose()
      return { frames, bodies, hasBox: Boolean(box), calls }
    }, { tier, lowPower, names: STREET_NAMES, layer: REFLECT_LAYER, types: TYPES })
    for (const frame of result.frames) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
    }
    expect(result.hasBox).toBe(false)
    expect(result.bodies).toEqual(TYPES.map(type => ({ type, count: perType, reflects: true })))
    expect(result.calls.shaderError).toBeNull()
    expect(result.calls.glError).toBe(0)
    expect(result.calls.calls).toBe(STREET_DRAW_CALLS_WITH_VEHICLES)
  })
}

test('reduced motion creates no cars and starts no model download', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/models/vehicles/')) requests.push(request.url()) })
  await page.evaluate(async () => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: false, vehicles: true })
    await window.cityGpu.waitForVehicles()
    window.cityGpu.dispose()
  })
  expect(requests).toEqual([])
})

test('a missing model keeps the box cars and does not break the scene', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  await page.route('**/models/vehicles/truck.glb', route => route.fulfill({ status: 404, body: 'missing' }))
  const result = await page.evaluate(async ({ names }) => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, vehicles: true })
    await window.cityGpu.waitForVehicles()
    const frame = window.cityGpu.renderJourney({ chapter: 1 })
    const scene = window.cityGpu.getJourneyContext().scene
    const hasBox = Boolean(scene.getObjectByName(names.carBodies))
    window.cityGpu.dispose()
    return { frame, hasBox }
  }, { names: STREET_NAMES })
  expect(result.hasBox).toBe(true)
  expect(result.frame.shaderError).toBeNull()
  expect(result.frame.glError).toBe(0)
})
```

For the reduced-motion and failure tests, `waitForVehicles()` must resolve even though `onVehiclesReady` never fires. The harness (Step 3) resolves it after a failed or skipped load too.

- [ ] **Step 2: Run the GPU test and confirm it fails**

Run: `npx playwright test --config playwright.config.ts tests/gpu/vehicles.spec.ts`
Expected: FAIL. TypeScript or runtime error: `vehicles` is not a known `mountJourney` option, or `window.cityGpu.waitForVehicles is not a function`.

- [ ] **Step 3: Add the scene options and wiring**

In `app/journey/scene.ts`:

3a. Add imports near the other journey imports (next to `import { carCountFor, createCars, createTraffic } from './traffic'`):

```ts
import { attachVehicleModels, loadVehicleModels, type VehicleModels } from './vehicle-models'
```

3b. In `JourneySceneOptions` add:

```ts
  // Test seam: replaces the GLB download. The default loads the vehicle GLBs from /models/vehicles/.
  loadVehicleModels?: () => Promise<VehicleModels>
  // Called after the vehicle models replace the box cars. Never called if the load fails or the scene is disposed first.
  onVehiclesReady?: () => void
  // Called once when the vehicle load or swap fails. The box cars stay.
  onVehiclesFailed?: (error: unknown) => void
```

3c. Replace the street-life block (the lines from `const traffic = createTraffic(...)` through the `reflectInPuddles(...)` call that follows `scene.add(...)`) with:

```ts
  const carCount = carCountFor(tier === 'reduced', lowPower)
  const traffic = createTraffic(createCars(carCount))
  scene.add(...lamps.objects, traffic.group)
  // Pools and halos already light the road; reflecting them would double that light.
  // The traffic group carries only car bodies and car lights, and every mesh `useModels` adds inherits its layers.
  reflectInPuddles(
    ...lamps.objects.filter(object => object.name === STREET_NAMES.posts || object.name === STREET_NAMES.heads),
    traffic.group,
  )
  // Cars start as boxes. The GLB models swap in when they arrive. A failed load keeps the boxes.
  if (carCount > 0) {
    void attachVehicleModels({
      traffic,
      load: options.loadVehicleModels ?? (() => loadVehicleModels()),
      isDisposed: () => disposed,
      onReady: options.onVehiclesReady,
      onError(error) {
        console.warn('Journey vehicles: the GLB models failed to load. Keeping the box cars.', error)
        options.onVehiclesFailed?.(error)
      },
    })
  }
```

Check that `disposed` is declared before this block. It is declared at `let disposed = false` inside `createJourneyScene` before line 437. If it is declared after, move the declaration above this block. Remove the now-unused `STREET_NAMES.carBodies` and `STREET_NAMES.carLights` references from the old filter. `STREET_NAMES` is still used for posts and heads.

- [ ] **Step 4: Add the harness seam**

In `tests/gpu/harness.ts`:

4a. Near the other module-level `let` declarations (before the `cityGpu` object), add:

```ts
let vehiclesSettled: Promise<void> = Promise.resolve()
```

4b. Add `vehicles?: boolean` to the `mountJourney` options type (`options: { tier: …; lowPower: boolean; …; failWetRoadTarget?: boolean; vehicles?: boolean }`).

4c. At the top of the `mountJourney` body, after `cityGpu.dispose()`, add:

```ts
    let settleVehicles: () => void = () => {}
    vehiclesSettled = new Promise<void>(resolve => { settleVehicles = resolve })
    // Reduced motion has no cars, so no load starts and nothing would ever settle the promise.
    if (!options.vehicles || options.tier === 'reduced') settleVehicles()
```

4d. In the `createJourneyScene(canvas, options.tier, [...], { … })` options object add:

```ts
        // Existing GPU tests pin box cars, so by default the load never finishes. Pass `vehicles: true` for the real GLBs.
        loadVehicleModels: options.vehicles ? undefined : () => new Promise<never>(() => {}),
        onVehiclesReady: settleVehicles,
        onVehiclesFailed: settleVehicles,
```

4e. Add to the `cityGpu` object (next to `mountJourney`):

```ts
  waitForVehicles(): Promise<void> {
    return vehiclesSettled
  },
```

- [ ] **Step 5: Run the new GPU test and confirm it passes**

Run: `npx playwright test --config playwright.config.ts tests/gpu/vehicles.spec.ts`
Expected: PASS, 4 tests. Real GLBs go through `assertMatchesSpec`. If a test fails with `The <type> model does not match its spec. Measured {...}, expected {...}`, update that type's `frontZ`/`rearZ` (or `VEHICLE_HEIGHT`) in `app/journey/vehicle-specs.ts` from the measured values in the message (measured scene units ÷ `VEHICLE_SCALE`, with the Z sign flipped), re-run `npx vitest run tests/journey/vehicle-specs.test.ts`, and re-run this step.

- [ ] **Step 6: Run the existing GPU suites that touch the street and the road**

Run: `npx playwright test --config playwright.config.ts tests/gpu/street.spec.ts tests/gpu/road.spec.ts tests/gpu/wet-road.spec.ts`
Expected: PASS. Existing tests keep their pinned counts (6 street draw calls with box cars) because the harness never resolves the load by default.

- [ ] **Step 7: Run unit tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/journey/scene.ts tests/gpu/harness.ts tests/gpu/vehicles.spec.ts
git commit -m "feat: swap GLB vehicles into the journey traffic"
```

---

### Task 6: Final acceptance

**Files:**
- Modify: `docs/superpowers/plans/2026-10-11-journey-vehicles.md` (check off steps as they pass)

- [ ] **Step 1: Automated verification.** Run each command from `repos/portfolio`. All must pass.

- [ ] `npm test`
- [ ] `npm run test:gpu` (the full GPU suite, including the new `vehicles.spec.ts` and the existing street, road, wet-road, and theme-scene specs)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `wc -l app/journey/scene.ts app/journey/traffic.ts` shows `scene.ts` at or under its current line limit and no source file over 800 lines. If `scene.ts` grew past its limit (it was 620 lines against a 606-line project guard), move the vehicle-load block into a small helper in `vehicle-models.ts` and re-run the gates.

- [ ] **Step 2: Check the shipped files**

Run: `ls -l public/models/vehicles/ && npm run build 2>&1 | tail -5`
Expected: three GLBs plus `LICENSE.txt`, and the build output includes `public/models/vehicles/*.glb`.

- [ ] **Step 3: Hand off the manual checks.** Do not mark these done. Report them to the user and wait for confirmation.

Manual verification (a person does these):

- [ ] The three vehicle types look distinct from the journey camera: a lower sedan, a taller SUV, and a longer truck.
- [ ] Body colors look right in both themes. Tune `PAINT_COMPENSATION` in `app/journey/traffic.ts` if cars look washed out or too dark. If glass looks wrong with the tint, set the factor so the tint is neutral and accept three silhouettes without color variety.
- [ ] Head and tail lights sit on the bumpers and ramp up at dusk. Adjust `LIGHT_HEIGHT`, `LIGHT_INSET_X`, and `LIGHT_Z_INSET` in `app/journey/vehicle-specs.ts` if they float or sink.
- [ ] Cars at the courtyard U-turn show no clipping, popping, or sideways cars. A truck turning in the lane looks plausible.
- [ ] The swap from box cars to models happens after the first frames without a visible jump or flash.
- [ ] Wet-road reflections show the vehicles in the puddles at night.
- [ ] iPhone Safari: the models load, frame rate does not drop against the previous build, and nothing stalls on a slow connection.
- [ ] Throttle the network to "Slow 3G" in the browser: the scene runs with box cars first and nothing breaks while the 550 KB loads.
- [ ] The final merged branch keeps the CC0 licence note at `public/models/vehicles/LICENSE.txt`.
