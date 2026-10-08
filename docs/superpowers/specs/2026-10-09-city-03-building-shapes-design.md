# City polish 03: Building shape variety

Date: 2026-10-09
Status: Draft, pending review and prioritization
Direction: Realistic dusk/dawn skyline
Series: City polish (03 of 08). Read [00 shared conventions](2026-10-09-city-00-shared-conventions.md) first.

## Problem

Every background building is the same unit cube, scaled to a square footprint. All three layers (96 buildings) share one geometry, so the skyline is a row of plain rectangular prisms. No building has a roof feature, a setback, or a non-square footprint. Silhouettes are the first thing the eye reads at dusk, and today they are all the same.

## Goal

Give the skyline recognizable variety: setback towers, rooftop equipment, antenna spires, and non-square footprints. Keep layout stable, keep draw calls low, and keep the existing height and density animation.

Success criteria:

- At chapter `about` (full density), the skyline shows at least four distinct silhouette types in a single view from the entrance.
- Building draw calls rise from 3 to at most 8 (`renderer.info.render.calls`, buildings only).
- Layout is stable across renders (same seed, same result). Against today's city, every building whose current position also passes the stricter footprint check keeps that exact position. A building that fails the stricter check takes a later attempt or hides, as `placeBuilding` already does.
- Per-frame CPU cost of the building update falls (see "Per-frame update").
- No building footprint (its full rectangle, not only its center) intersects the road, a set-piece footprint, or a corner block.
- Rooftop equipment and spires keep a constant physical size while `buildingHeight` animates. They do not stretch.

## Non-goals

- Facade windows. Spec 01 owns them. This spec only adds the `aWindowed` attribute so equipment parts can opt out.
- Gradient, ambient occlusion, and contact shadows. Spec 04.
- The set-pieces: gate, hall, market, courtyard, corner blocks.
- Real roads between buildings, city blocks, or grid layout.

## Current state

- `createBuildingLayer` builds one `InstancedMesh<BoxGeometry, MeshStandardMaterial>` per layer from `LAYERS` (24, 32, and 40 buildings).
- `placeBuilding` picks a width in 0.5 to 1.1 and a point beside the path. Depth equals width. Clearance uses `width / 2`.
- `applyBuildingState` runs every frame for every layer, allocates `new THREE.Vector3`, `new THREE.Quaternion`, and `new THREE.Vector3` per building per frame, and recomputes matrices even when nothing changed. The scale is `(width, height, width)`, and the center is `height / 2 - 1`, so the base stays at world `y = -1`.
- `scene.ts` is 692 lines. Building code is about 120 lines of it.

## Design

### Archetypes

Each building gets a fixed archetype at creation. Parts are boxes unless noted.

| Archetype | Parts | Notes |
| --- | --- | --- |
| `slab` | 1 body | Today's look, with a non-square footprint. |
| `setback` | lower body (62% of height, full footprint) + upper body (38% of height, 70% footprint) | The upper body sits exactly on top of the lower one. |
| `crowned` | body (full height) + rooftop block | Block is 40% of footprint, constant 0.12 units tall. |
| `spire` | body + rooftop block + spire (thin cone) + beacon | Spire length 0.5 to 0.9 units, constant. Beacon is a tiny emissive sphere. |

Archetypes are not all random. Spires go to the tallest buildings, so they read as landmarks:

1. **Spire assignment (not random).** In the near and mid layers, the `SPIRE_COUNT` tallest placed buildings by `baseHeight` become `spire`: 2 in the near layer, 2 in the mid layer, 0 in the far layer. Buildings that failed placement (`width === 0`) are never chosen. On `lowPower` devices `SPIRE_COUNT` is 0. A fixed count guarantees silhouettes in every seed and avoids the problem of a random roll rarely meeting a height threshold. At low density some spires are hidden by density; the rest appear as density rises.
2. **Random assignment for the rest.** Every other building rolls one of the three remaining archetypes with these weights (percent). The near layer has the most detail because it fills the most screen:

| Layer | slab | setback | crowned |
| --- | --- | --- | --- |
| near (0) | 33 | 33 | 34 |
| mid (1) | 55 | 30 | 15 |
| far (2) | 70 | 25 | 5 |

### Footprint

Add `depth` to `Building`: `depth = width * (0.7 + 0.6 * seeded(seedBase + 300))`. Buildings stay axis-aligned, which matches both path directions because the path runs along X and Z only.

Placement keeps today's candidate generation exactly. The lateral offset still uses `minClear = ROAD_CLEARANCE + width / 2`, so candidate positions do not move. After a candidate is generated, the acceptance test becomes stricter:

- Road: `clearsPath(x, z, ROAD_CLEARANCE + halfExtent)` with `halfExtent = max(width, depth) / 2`.
- Set-pieces: `clearsFootprints(x, z, halfExtent)`. Add the `halfExtent` parameter to the function in `footprints.ts`. It enlarges each footprint rectangle by `halfExtent` on both axes (`Math.abs(lx) <= fp.halfX + halfExtent`). Footprint headings are multiples of 90 degrees, so the building's axis-aligned box is covered by this conservative test.
- Corner blocks: new `clearsCornerBlocks(x, z, halfExtent)` using the two `CORNER_BLOCKS` rectangles, enlarged the same way. Today's code does not check them, although a comment says it should.

A candidate that fails tries the next attempt, as today. This keeps every previously accepted position that still passes, and nothing else moves. Later acceptance-only changes (for example spec 08's sidewalk margin) follow the same rule: candidates stay the same, and only the acceptance test gets stricter. A change that alters candidate generation (the `minClear` formula or the seeds) resets the guarantee and requires a new fixture captured from the implementation immediately before that change.

### One box mesh per layer, plus a spire mesh

All box parts across all archetypes in a layer go into one `InstancedMesh<BoxGeometry>`. The instance count is the sum of parts, known at creation because archetypes are fixed. Spires use a second `InstancedMesh<ConeGeometry(0.5, 1, 5)>`, and beacons a third `InstancedMesh<SphereGeometry>`. Per layer: 1 box draw call, plus at most 1 spire and 1 beacon call. Worst case 3 layers x 2 + 1 beacon call = 7 calls. The beacon mesh is shared by all layers (one call), so the total is at most 7 for buildings. That meets the budget of 8.

Instances keep a static map from building index to part indices: `partRanges[buildingIndex] = { start, count }`.

### Part transforms: a pure function

New pure function in `buildings.ts`:

```ts
export interface PartTransform {
  kind: 'body' | 'equipment'   // equipment gets no windows
  x: number; y: number; z: number
  sx: number; sy: number; sz: number
}

export function boxPartsFor(building: Building, archetype: Archetype, height: number): PartTransform[]
```

Rules:

- Every body part's bottom (`y - sy / 2`) is at world `y = -1` for the lowest body, and at the top of the part below for stacked bodies.
- The rooftop block uses a fixed `sy` of 0.12 and sits on the top of the body: `y = -1 + height + 0.06`. Because its scale never depends on `height`, it does not stretch. Spires and beacons stack above it as described next.
- When `height` is 0, a part's scale is 0 (hidden).

Vertical stacking for a `spire` building, from the roof up: body top, rooftop block (0.12 tall, bottom at body top), spire (bottom at block top, length 0.5 to 0.9), beacon (center at spire top). Each part's bottom equals the top of the part below it.

Allocation-free signature. The function above returns an array of objects, which allocates on every call. The per-frame path uses a writer instead:

```ts
export const PART_STRIDE = 7  // kind, x, y, z, sx, sy, sz

export function writeBoxParts(
  out: Float32Array,
  offset: number,           // float index to start at
  building: Building,
  archetype: Archetype,
  height: number,
): number                   // number of parts written
```

`writeBoxParts` writes only box parts (bodies and rooftop blocks). The spire cone and beacon sphere have their own writers with the same style: `writeSpirePart(out, offset, building, height, length)` and `writeBeaconPart(out, offset, building, height, length, on)`. The Vitest tests call each writer into a small `Float32Array` and read the values back, and `boxPartsFor` stays as a thin test helper that wraps `writeBoxParts`. The update path reuses module-level `Matrix4`, `Vector3`, and `Quaternion` objects and one `Float32Array` per layer, which the Three.js render-loop exception in `.claude/rules/common/coding-style.md` allows. Zero allocations applies to `applyBuildingState` after creation.

### Per-frame update

Today `applyBuildingState` rewrites every matrix each frame. New behavior:

- Store `lastHeightScale` and `lastActiveCount` per layer, where `activeCount = Math.round(density * buildings.length)`. Rewrite the matrices if `|heightScale - lastHeightScale| >= 1e-4` or `activeCount !== lastActiveCount`. Comparing the integer count separately matters: `Math.round` can cross a rounding boundary on a change much smaller than `1e-4`, and the height tolerance alone would skip it. `dampState` converges asymptotically, so once a chapter settles the update becomes a no-op.
- Reuse module-level `Matrix4`, `Vector3`, `Quaternion` objects instead of allocating per building.

This cuts per-frame allocations from about 300 objects to zero and avoids the GPU upload when nothing moved. `instanceMatrix.needsUpdate = true` is set only when matrices were rewritten.

### Beacon blink

Spire beacons are red with linear luminance of at least 2.0 (spec 02 contract), blinking: on for 0.2 s out of every 1.6 s with a per-building phase from `seeded`. The beacon geometry is a unit sphere. The authored radius, `BEACON_RADIUS = 0.04`, is the instance scale. `update(t)` writes, for each beacon, scale `BEACON_RADIUS` when the building is active (`index < activeCount` and `width > 0`) and the blink phase is on, and scale 0 otherwise. The position stays roof-relative (top of the spire at the current height), so the beacon follows height animation. A beacon never appears on an inactive building, because visibility combines the density test and the blink. On `reduced` tier the blink phase is always on. On `lowPower` there are no spires, hence no beacons.

Because the blink changes at most once per frame, the beacon matrices are rewritten only when the on/off state, the height, or the active count changes.

### Color variation

Call `setColorAt(i, color)` per box instance with the layer's base color multiplied by `0.92 + 0.16 * seeded(...)`, so neighbors differ slightly. Crown and equipment parts use a darker gray (`0x2a2a30`). The material's own `color` stays white so the per-instance color is the full albedo.

r186 multiplies `diffuseColor` by the instance color in `<color_fragment>`. Spec 01's facade patch runs after that chunk and treats `diffuseColor.rgb` as the wall albedo, so per-instance tint reaches the wall while glass keeps its own color. If spec 03 lands first, nothing else is needed. If spec 01 lands first, the facade material needs `vertexColors`-style instance color enabled by `setColorAt`, which three does automatically when `instanceColor` exists.

### `aWindowed` attribute for spec 01

Add an `InstancedBufferAttribute` `aWindowed` (1 for body parts, 0 for equipment) on the box geometry, with one value per box instance (not per building). Spec 01's `aSeed` follows the same rule: one value per part instance, with parts of one building sharing its seed. Both attribute arrays must have the layer's total box-instance count as length. Spec 01's facade material reads `aWindowed` to skip windows on rooftop blocks. If spec 01 has not landed, the attribute is unused and costs nothing. Whichever of the two specs lands second wires the shader read.

All instanced meshes in this spec set `frustumCulled = false` (shared conventions, section 2), because r186 caches the instanced bounding sphere at first render and `setMatrixAt` does not invalidate it.

### Module split

`scene.ts` shrinks. New modules:

| Module | Contents |
| --- | --- |
| `app/journey/random.ts` | `seeded` (moved, exported). `scene.ts` and others import it. |
| `app/journey/footprints.ts` | `Footprint`, `FOOTPRINTS`, `clearsFootprints` (moved). |
| `app/journey/buildings.ts` | `LAYERS`, `Building`, archetype logic, `placeBuilding`, `createBuildingLayer`, `applyBuildingState`, `boxPartsFor`. |

`scene.ts` keeps `BUILDING_CLEARANCE` (the market uses it) and the wiring calls.

### Tier behavior

| Situation | Behavior |
| --- | --- |
| full, not low power | All four archetypes, full counts. |
| lowPower (including `reduced` on a phone) | `slab`, `setback`, `crowned` only. Counts at 60% as today (`lite ? count * 0.6`). No spire, no beacon. |
| reduced (not low power) | All archetypes. Beacon static (always on). |

Today counts key on `tier === 'lite'`. This spec keys them on `lowPower` (shared conventions, section 3). A `reduced` phone therefore gets the cheaper counts instead of desktop counts. This is a deliberate behavior change, now recorded as a rule in the shared conventions: motion preference must not raise the cost on a phone.

## Files

| File | Change |
| --- | --- |
| `app/journey/random.ts` | New. `seeded`. |
| `app/journey/footprints.ts` | New. Moved from `scene.ts`. Adds the `halfExtent` parameter and `clearsCornerBlocks`. |
| `tests/journey/fixtures/building-positions.json` | New. Golden positions captured from the current implementation before the change. |
| `app/journey/buildings.ts` | New. Archetypes, placement, layers, update. |
| `app/journey/scene.ts` | Remove moved code (about -140 lines), call the new module. |
| `tests/journey/buildings.test.ts` | New. |
| `tests/gpu/buildings.spec.ts` | New. Draw-call count and render check. |

## Testing

Unit (Vitest, `tests/journey/`):

1. Random archetype roll: `rollArchetype(seed, layerIndex)` is deterministic for a seed, and over 2000 seeds each layer's distribution is within 5 percentage points of the table. This tests raw weights only.
2. Spire assignment: on the `full` setup, exactly 2 near and 2 mid buildings are `spire`, they are the tallest placed buildings of their layer, and no hidden (`width === 0`) building is chosen. With `lowPower = true`, there are no spires and no beacons.
3. `writeBoxParts`, for each archetype and for heights 0.5, 1.0, 2.0:
   - the lowest body's bottom is at `-1`
   - in `setback`, the upper body's bottom equals the lower body's top
   - for the box parts of a `spire` building, block bottom = body top
   - equipment `sy` is identical across heights (no stretch)
   - at `height = 0`, every part has zero scale
3b. `writeSpirePart` and `writeBeaconPart`: spire bottom = block top, beacon center = spire top, and both scales are independent of `height`. At `height = 0` the spire scale is 0.
4. Placement property test: for 500 seeds per layer, the accepted building's full footprint rectangle does not intersect the road polyline expanded by `ROAD_CLEARANCE`, any set-piece footprint, or any corner block. Count hidden instances; at most 5% per layer.
5. Stability against today's city: `tests/journey/fixtures/building-positions.json` holds the positions captured from the current `placeBuilding` before this change (step 0 of implementation; capture them on the commit before). For each building, the new position equals the golden one, or the golden position fails the stricter footprint check. Also assert the position list is identical across two runs.
6. Dirty check: calling the update twice with the same state writes matrices once. A state change that moves `activeCount` across a rounding boundary by less than `1e-4` in density does rewrite them. A height change under `1e-4` with the same count does not.
7. Beacon visibility: for an inactive building (index above `activeCount`), the beacon scale is 0 in both blink phases. For an active one, it is `BEACON_RADIUS` or 0 by phase only.

GPU (Playwright, `tests/gpu/buildings.spec.ts`):

8. Draw calls. With a composer, `renderer.info` resets on every renderer invocation by default, so a count taken after `composer.render()` can reflect only the output pass. Measure on the direct path: set `renderer.info.autoReset = false`, call `renderer.info.reset()`, hide everything except the building meshes, call `renderer.render(scene, camera)` once, and read `info.render.calls`. The count at chapter `about` is at most 7. The shader-error recorder is empty. Repeat for `lowPower`.
9. Context restore: after `loseContext()` and `restoreContext()`, instance matrices and colors render the same pixels as before.

Manual verification (screenshots per shared conventions, section 9):

- Entrance view at chapter `about`: at least four silhouette types visible.
- Mid-transition frame between `intro` and `projects`: setback upper bodies and rooftop blocks stay attached to their buildings while heights change. No gaps, no stretching.
- Look for intersecting buildings near the set-pieces and the two corner blocks.

Performance: follow shared conventions, section 8. Target: no render-cost increase on `lowPower`. The reduced matrix writes should offset the extra instances.

## Risks

- **Stacked-body facade grid**: the upper body of a `setback` building starts its own floor grid from its base (spec 01 measures from each instance's base). Floor lines will not line up between the lower and upper bodies. This reads as a stepped tier, which is acceptable.
- **Seed drift**: candidate generation is unchanged, so positions only move when the stricter check rejects them. Test 5 pins this against golden values from today's code.
- **Overlap**: the stricter acceptance test may reject more candidates (`PLACEMENT_ATTEMPTS = 6`). A rejected building hides off-scene, so density may drop slightly. If more than 5% of instances end up hidden, raise attempts to 8. Test 4 counts hidden instances.
- **Beacon cost**: the blink writes at most about 10 instance matrices per frame on `full`. This is small, but it forces an upload of the beacon mesh each frame. Acceptable.
- **Instance count limits**: a box mesh holds up to about 40 x 3 parts per layer, far below any limit.

## Dependencies

- Independent of every other spec. Interacts with spec 01 through `aWindowed` and with spec 04 (shared update loop for contact shadows).
- Spec 02: beacon color follows the luminance contract.

## Open questions

None. Counts follow `lowPower`, as the shared conventions now state.
