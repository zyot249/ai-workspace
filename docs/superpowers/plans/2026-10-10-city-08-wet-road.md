# City 08: Wet Road Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work in an isolated worktree (`superpowers:using-git-worktrees`) on branch `feat/city-08-wet-road` cut from `master`.

**Goal:** Give the road asphalt grain, sidewalks with curbs, a dashed center line, a rain-wet sheen, and (on the composer pipeline) planar reflections of the city in the puddles.

**Architecture:** Road code moves out of `scene.ts` into `road.ts` (geometry, material patch) with pure helpers in `road-layout.ts`, `asphalt.ts`, and `path.ts`. Parts A and B (detail, sheen) run on every tier. Part C is one flat overlay mesh plus one extra scene render into a half-size half-float target, run explicitly from `renderFrame()` before the composer, only when `post !== null` and wetness is above 0.02. `wetness` is a new look field: dry in the light theme, 0 / 0.15 / 0.4 / 0.7 in the dark theme.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Three.js r186 (`MeshStandardMaterial` + `onBeforeCompile`, `ShaderMaterial`, render layers), Vitest, Playwright GPU harness (`tests/gpu/`).

**Spec:** `docs/superpowers/specs/2026-10-09-city-08-wet-road-design.md`. Also read `docs/superpowers/specs/2026-10-09-city-00-shared-conventions.md` (sections 1, 2, 4, 7, 8, 9).

**Research:** `docs/superpowers/research/2026-10-09-portfolio-overview-research.md` was written at commit `ef03e91`, before the facade, sky, and post pipeline existed. This plan does not rely on it. All code references below were read at `HEAD` (`f3cf350`).

## Global Constraints

Exact values copied from the spec. Every task's requirements include this section.

- `ROAD_HALF_WIDTH = 3`. Sidewalk strip: 3.0 to 3.9 units off the path center line, extruded to a height of 0.15, top at `y = -0.85`. Color `#4a4a52`, `MeshStandardMaterial`, roughness 0.9, asphalt texture as a faint bump.
- Asphalt texture: 256 x 256 grayscale value noise plus speckle, `RepeatWrapping`, `NoColorSpace`, `generateMipmaps = true`, `minFilter = LinearMipmapLinearFilter`, **`magFilter = LinearFilter`**, `anisotropy = min(4, maxAnisotropy)`. One tile covers 4 x 4 world units and the texture `repeat` stays (1, 1).
- Dashes: length 1.2, width 0.08, `y = -0.99`, period 3.0, at least 0.6 from an exterior segment end and at least 3.6 from an interior waypoint, 29 in total. `MeshBasicMaterial({ color: 0xf5e6a8, opacity: 0.55, transparent: true })`, `renderOrder = 2` (`ROAD_MARKING_RENDER_ORDER`).
- Wetness per chapter, dark theme: intro 0.00, projects 0.15, skills 0.40, about 0.70.
- Puddle mask: `smoothstep(0.45, 0.65, valueNoise(p / 24.0) * 0.75 + valueNoise(p / 6.0) * 0.25)`, Dave Hoskins float hash. The GLSL and `puddleMaskAt` agree within 0.02.
- Sheen: `roughnessFactor = mix(roughnessFactor, 0.35, wetAmt)` after `<roughnessmap_fragment>`; `outgoingLight += uSkyTint * fres * wetAmt * 0.5` before `<opaque_fragment>`, with `fres = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 4.0)`.
- Patch built-in materials with `onBeforeCompile` and `replaceOrThrow(source, marker, replacement)` from `app/journey/shader-utils.ts`. Declare every varying explicitly.
- Reflection: `REFLECT_LAYER = 1`; reflection plane `y = -0.997`; overlay mesh `renderOrder = 0.5`, `transparent: true`, `depthWrite: false`; alpha `mix(0.1, 0.9, fresnel) * wetAmt * (1.0 - fogFactor)`; distortion `(valueNoise(vWorldXZ * 3.0) - 0.5) * 0.02`; color written in linear HDR with no tone-mapping chunks.
- Reflection target: `HalfFloatType`, half the drawing-buffer size, no MSAA, no mipmaps. The pass does not run at `wetness <= 0.02`. It runs every frame otherwise and restores renderer state in `finally`. At most 16 draw calls.
- Reflections appear only on the road: not on the ground, sidewalks, set-pieces, shadow quads, pools, halos, or the far skyline.
- Part C runs only on the composer pipeline (`post !== null`). `lowPower` and the direct pipeline get Parts A and B.
- Cost: at most +1.2 ms on the named reference desktop (`full`) and +0.3 ms on a physical iPhone (`lowPower`), procedure in shared conventions, section 8.
- `StopState` colors are sRGB. Pass the space explicitly: `color.setRGB(r, g, b, THREE.SRGBColorSpace)`.
- `scene.ts` must stay under 800 lines (it is 627 today and loses about 45 lines of road code).
- Commit messages use `<type>: <description>`. Do not add a `Co-Authored-By` trailer.
- Code style: immutable data except per-frame render-loop scratch objects, small files, no `any`, no `console.log`, named constants for thresholds.

## Spec Corrections

The spec has six gaps. This plan fixes them. Each fix names the task that carries it.

1. **Light theme wetness (open question in the series index).** `wetness` is a look field, so each light entry needs a deliberate value. The light arc is morning to afternoon sun, so the road is dry: all four light values are 0. Reflections and sheen therefore appear in the dark theme only. Task 1.
2. **Mitered outside corners reach 5.5 units from the waypoint.** The spec's test 3 says a point with distance above 3.9 from the polyline is outside the sidewalk, and its building check uses Euclidean distance to the polyline. At a 90-degree outside corner the mitered polygon is a square: its far corner is at `(3.9, -29.9)`, 5.5 units from the waypoint. A building at `(3.2, -29.2)` passes the spec's check and stands on the sidewalk. This plan tests the polygon against the complete rectangle regions (`Outer \ Road`) and adds `clearsSidewalks`, an axis-aligned check, to building acceptance. Tasks 2 and 3.
3. **Near-layer buildings would almost all vanish.** Layer 0 candidates sit 3.55 to about 4.6 from the center line (`ROAD_CLEARANCE` window). The stricter acceptance needs about 4.5 to 4.9, so most layer 0 attempts fail and `hidden / 500 <= 0.05` breaks. Candidates must not move, because spec 03's stability test keeps every old position that passes the stricter check. This plan keeps attempts 0 to 7 unchanged and adds 8 more attempts with a candidate window that starts at `BUILDING_ROAD_MARGIN`. Task 3.
4. **UVs come from world position, and the road is one mesh.** The spec bakes UVs from each quad's local coordinates. Segment quads and joint quads overlap and are coplanar, so different UV phases would flicker where they overlap. This plan builds the five road rectangles directly in world space (`roadRects()`), takes `uv = (x, z) / 4`, and merges them into one geometry: one draw call, no flicker. Task 5.
5. **Asphalt tileability test.** The spec asks the left and right columns to differ by at most 2/255. Per-pixel speckle makes neighboring columns differ by about 30/255 even inside the tile. The test compares the wrap seam against the average neighbor difference inside the tile instead. Task 4.
6. **Puddle coverage.** With a 24-unit lattice the road bounding box holds only a few noise cells, so coverage depends on hash luck. The spec marks the values as tuning starts. This plan adds a world offset `PUDDLE_ORIGIN = (31, 17)` that gives 32% of the bounding box above 0.5 (measured with the TypeScript mirror), inside the required 15% to 45%. Task 4.

Smaller changes: the pass is explicit (`renderFrame()` calls it) instead of a nested render inside `Reflector.onBeforeRender`, because a nested `renderer.render` resets `renderer.info` mid-frame and the composer would not see the reflection ordering; the overlay is sized from `roadRects()` (40 x 82, centered at `(-13, -0.997, -29)`) instead of the waypoint box (34 x 82); the overlay material uses `polygonOffset` because the overlay sits 3 mm above the road and depth precision at 60+ units is coarser than that; test 10b checks lit versus unlit pixels in the reflection instead of the 10% ratio, which needs per-face sampling that software WebGL cannot hold steady; the market footprint grows with `BUILDING_CLEARANCE`; two debug defines (`WET_DEBUG_COVERAGE`, `WET_DEBUG_FLOOD`) make tests 10c and 12 exact.

## Review Focus

Failure modes the spec implies but does not test. Each line names the task whose tests pin it.

1. **Outside-corner sidewalk against placed buildings.** A building center can pass a Euclidean check and still overlap the square outside corner of the sidewalk. Task 3 samples every placed rectangle against both sidewalk polygons, and checks the diagonal point `(3.2, -29.2)` directly.
2. **Near layer starved of buildings.** Raising the acceptance margin without a wider candidate window hides most layer 0 buildings. Task 3 asserts at most 5% hidden per layer and that layer 0 keeps at least 90% of its buildings.
3. **Dry chapters do zero reflection work.** Intro, and every chapter in the light theme, must not run the pass, draw the overlay, or change a single pixel. Task 8 compares frames at wetness 0.02 and 0. Task 9 asserts the pass counter does not move at intro or in the light theme.
4. **Far puddles must fade into the fog.** A bright reflection at the horizon would read as a white band. Task 8 renders with fog density 0.5 and requires the puddle pixel to match the dry pixel.
5. **Resize and context restore must not show a blank reflection.** A reallocated target is empty until the next pass. Task 9 resizes, loses and restores the context, and requires the frame after to equal the frame before (and to differ from a frame without the overlay).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `app/journey/stops.ts` | Modify | `wetness` on `LookState` and the eight `LOOKS` entries |
| `app/journey/interpolate.ts` | Modify | `wetness` in `lerpLook` |
| `app/journey/path.ts` | Modify | Sidewalk constants, `Rect`, `pathBandRects`, `roadRects`, `clearsSidewalks`, `BUILDING_CLEARANCE` |
| `app/journey/road-layout.ts` | Create | Pure `sidewalkPolygon`, `dashPositions` |
| `app/journey/buildings.ts` | Modify | Stricter acceptance and sidewalk-window fallback attempts in `placeBuilding` |
| `app/journey/footprints.ts` | Modify | Market footprint `halfX` 7.5 to 8.7 |
| `app/journey/asphalt.ts` | Create | `asphaltPixels`, `createAsphaltTexture`, `puddleMaskAt`, `PUDDLE_GLSL` |
| `app/journey/road.ts` | Create | Road surface, sidewalks, dashes, wet material patch, `createRoad` |
| `app/journey/reflect-layer.ts` | Create | `REFLECT_LAYER`, `reflectInPuddles` |
| `app/journey/reflection.ts` | Create | `reflectedCamera`, `applyObliqueClip`, `updateReflectionCamera` |
| `app/journey/wet-road.ts` | Create | Overlay mesh, shader, half-float target, explicit pass, `createWetRoad` |
| `app/journey/post.ts` | Modify | Export `preservingState` |
| `app/journey/scene.ts` | Modify | Use `road.ts`, opt objects into the reflection layer, create and drive `wetRoad`, resize, dispose |
| `tests/journey/stops.test.ts`, `interpolate.test.ts`, `target.test.ts` | Modify | `wetness` assertions |
| `tests/journey/road-layout.test.ts` | Create | Rectangles, sidewalk polygon, dashes, placement against sidewalks |
| `tests/journey/buildings.test.ts`, `footprints.test.ts` | Modify | Stricter acceptance, fallback, market footprint |
| `tests/journey/asphalt.test.ts`, `road.test.ts`, `reflection.test.ts`, `reflect-layer.test.ts` | Create | Unit tests |
| `tests/gpu/road-probe.ts`, `road.spec.ts` | Create | Mask agreement, sheen, shader errors, journey-level Part C checks |
| `tests/gpu/wet-road-probe.ts`, `wet-road.spec.ts` | Create | Isolated overlay and pass checks |
| `tests/gpu/harness.ts` | Modify | Register probes, `directPipeline` and `failWetRoadTarget` mount options |
| `tests/gpu/facade.spec.ts` | Modify | Draw-call baseline |

All paths below are relative to `repos/portfolio` unless they start with `docs/`. Run npm commands from `repos/portfolio`.

---

### Task 1: The `wetness` look field

**Files:**
- Modify: `app/journey/stops.ts`
- Modify: `app/journey/interpolate.ts`
- Test: `tests/journey/stops.test.ts`, `tests/journey/interpolate.test.ts`, `tests/journey/target.test.ts`

**Interfaces:**
- Produces: `LookState.wetness: number` (0 to 1), in every `LOOKS` entry. `lerpLook` interpolates it. Later tasks read `state.wetness`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/journey/stops.test.ts`:

```ts
it('authors wetness per theme: dry day, rain-wet dusk to night', () => {
  expect(CHAPTER_IDS.map(id => LOOKS.light[id].wetness)).toEqual([0, 0, 0, 0])
  expect(CHAPTER_IDS.map(id => LOOKS.dark[id].wetness)).toEqual([0, .15, .4, .7])
})
```

Append to `tests/journey/interpolate.test.ts`:

```ts
it('interpolates wetness at p = 0, 0.5 and 1', () => {
  const a = LOOKS.dark.skills, b = LOOKS.dark.about
  expect(lerpLook(a, b, 0).wetness).toBe(.4)
  expect(lerpLook(a, b, .5).wetness).toBeCloseTo(.55, 12)
  expect(lerpLook(a, b, 1).wetness).toBe(.7)
})
```

Append to `tests/journey/target.test.ts`:

```ts
it('returns the light and dark wetness at themeMix 0 and 1', () => {
  expect(targetFor(3, 0, 0, false).wetness).toBe(0)
  expect(targetFor(3, 0, 1, false).wetness).toBe(.7)
  expect(targetFor(1, 0, 1, false).wetness).toBe(.15)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/journey/stops.test.ts tests/journey/interpolate.test.ts tests/journey/target.test.ts`
Expected: FAIL. The new assertions see `undefined` for `wetness`.

- [ ] **Step 3: Add the field**

In `app/journey/stops.ts`, add `wetness: number` after `bloomStrength: number` in `LookState`.

Then add the value to each of the eight `LOOKS` entries. Replace these eight endings (each is the last field of its entry; the light and dark `exposure`/`bloomStrength` lines are unique per entry):

| Entry | Replace | With |
|---|---|---|
| light.intro | `windowLitRatio: .05, exposure: 1, bloomStrength: 0 },` (first occurrence, the entry whose `sunElevation` is 12) | `windowLitRatio: .05, exposure: 1, bloomStrength: 0, wetness: 0 },` |
| light.projects | `windowLitRatio: .03, exposure: 1, bloomStrength: 0 },` | `windowLitRatio: .03, exposure: 1, bloomStrength: 0, wetness: 0 },` |
| light.skills | `windowLitRatio: .02, exposure: 1, bloomStrength: 0 },` | `windowLitRatio: .02, exposure: 1, bloomStrength: 0, wetness: 0 },` |
| light.about | `windowLitRatio: .05, exposure: 1, bloomStrength: 0 },` (second occurrence, the entry whose `sunElevation` is 28) | `windowLitRatio: .05, exposure: 1, bloomStrength: 0, wetness: 0 },` |
| dark.intro | `windowLitRatio: .3, exposure: 1, bloomStrength: .12 },` | `windowLitRatio: .3, exposure: 1, bloomStrength: .12, wetness: 0 },` |
| dark.projects | `windowLitRatio: .55, exposure: 1.1, bloomStrength: .25 },` | `windowLitRatio: .55, exposure: 1.1, bloomStrength: .25, wetness: .15 },` |
| dark.skills | `windowLitRatio: .75, exposure: 1.15, bloomStrength: .35 },` | `windowLitRatio: .75, exposure: 1.15, bloomStrength: .35, wetness: .4 },` |
| dark.about | `windowLitRatio: .9, exposure: 1.25, bloomStrength: .42 },` | `windowLitRatio: .9, exposure: 1.25, bloomStrength: .42, wetness: .7 },` |

Above the `LOOKS` constant, add this comment line:

```ts
// `wetness` (spec 08): the light arc is a dry morning-to-afternoon day, so it is 0 throughout. The dark arc is a street that has just rained as dusk turns to night.
```

In `app/journey/interpolate.ts`, add this line at the end of the object returned by `lerpLook`, after `bloomStrength`:

```ts
    wetness: lerp(a.wetness, b.wetness, p),
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm test -- tests/journey/stops.test.ts tests/journey/interpolate.test.ts tests/journey/target.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS. If a test or GPU file builds a `StopState` or `LookState` literal without `wetness`, TypeScript names the file. Add `wetness: 0` to that literal and re-run.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/journey/stops.ts app/journey/interpolate.ts tests/journey
git commit -m "feat: add wetness look field"
```

---

### Task 2: Road rectangles, sidewalk polygon, and dash layout

**Files:**
- Modify: `app/journey/path.ts`
- Create: `app/journey/road-layout.ts`
- Test: `tests/journey/road-layout.test.ts`

**Interfaces:**
- Produces from `path.ts`: `SIDEWALK_INNER = 3`, `SIDEWALK_OUTER = 3.9`, `SIDEWALK_HEIGHT = 0.15`, `BUILDING_SIDEWALK_GAP = 0.3`, `BUILDING_ROAD_MARGIN = 4.2`, `BUILDING_CLEARANCE = 4.5`, `type Rect = readonly [minX: number, minZ: number, maxX: number, maxZ: number]`, `pathBandRects(halfWidth: number): Rect[]`, `roadRects(): Rect[]`, `clearsSidewalks(x: number, z: number, halfExtent?: number): boolean`.
- Produces from `road-layout.ts`: `DASH_LENGTH = 1.2`, `DASH_WIDTH = 0.08`, `DASH_PERIOD = 3`, `DASH_END_MARGIN = 0.6`, `DASH_JOINT_MARGIN = 3.6`, `interface Dash { x; z; dirX; dirZ }`, `dashPositions(): Dash[]`, `sidewalkPolygon(side: -1 | 1, inner?: number, outer?: number): Vec2[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/journey/road-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  BUILDING_CLEARANCE, BUILDING_ROAD_MARGIN, clearsSidewalks, PATH_SEGMENTS, pathBandRects, ROAD_HALF_WIDTH,
  roadRects, SIDEWALK_INNER, SIDEWALK_OUTER, type Rect, type Vec2, WAYPOINTS,
} from '../../app/journey/path'
import {
  DASH_JOINT_MARGIN, DASH_LENGTH, DASH_PERIOD, DASH_WIDTH, dashPositions, sidewalkPolygon,
} from '../../app/journey/road-layout'

function inRects(rects: readonly Rect[], x: number, z: number, grow = 0): boolean {
  return rects.some(([minX, minZ, maxX, maxZ]) =>
    x >= minX - grow && x <= maxX + grow && z >= minZ - grow && z <= maxZ + grow)
}

function inPolygon(polygon: readonly Vec2[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

function hasVertex(polygon: readonly Vec2[], x: number, z: number): boolean {
  return polygon.some(p => Math.abs(p.x - x) < 1e-9 && Math.abs(p.z - z) < 1e-9)
}

function crosses(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x)
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

describe('roadRects', () => {
  it('lists the three segment rectangles and the two joint squares', () => {
    expect(roadRects()).toEqual([
      [-3, -26, 3, 8], [-26, -29, 0, -23], [-29, -66, -23, -26],
      [-3, -29, 3, -23], [-29, -29, -23, -23],
    ])
  })

  it('covers the road geometry and nothing farther than 0.01 beyond it', () => {
    const rects = roadRects()
    // Independent description of the geometry: each segment quad is `length` long and 2 * ROAD_HALF_WIDTH wide,
    // centered on the segment middle, and each interior waypoint carries a 6 x 6 square.
    const onGeometry = (x: number, z: number, grow: number) => {
      const onSegment = PATH_SEGMENTS.some(segment => {
        const dx = x - (segment.fromX + segment.dirX * segment.length / 2)
        const dz = z - (segment.fromZ + segment.dirZ * segment.length / 2)
        return Math.abs(dx * segment.dirX + dz * segment.dirZ) <= segment.length / 2 + grow
          && Math.abs(dx * segment.rightX + dz * segment.rightZ) <= ROAD_HALF_WIDTH + grow
      })
      const onJoint = WAYPOINTS.slice(1, -1).some(point =>
        Math.abs(x - point.x) <= ROAD_HALF_WIDTH + grow && Math.abs(z - point.z) <= ROAD_HALF_WIDTH + grow)
      return onSegment || onJoint
    }
    for (let x = -34; x <= 8; x += 0.07) for (let z = -72; z <= 14; z += 0.07) {
      if (onGeometry(x, z, 0)) expect(inRects(rects, x, z)).toBe(true)
      if (inRects(rects, x, z)) expect(onGeometry(x, z, 0.01)).toBe(true)
    }
  })
})

describe('sidewalkPolygon', () => {
  const outer = pathBandRects(SIDEWALK_OUTER)
  const road = roadRects()

  it('matches the complete region between the road and the 3.9 band', () => {
    const polygons = ([-1, 1] as const).map(side => sidewalkPolygon(side))
    const mismatches: string[] = []
    // Offset grid: no sample sits exactly on a boundary at a multiple of 0.1.
    for (let x = -36.05; x <= 10; x += 0.1) for (let z = -76.05; z <= 18; z += 0.1) {
      const expected = inRects(outer, x, z) && !inRects(road, x, z)
      const actual = polygons.some(polygon => inPolygon(polygon, x, z))
      if (expected !== actual) mismatches.push(`${x.toFixed(2)},${z.toFixed(2)}`)
    }
    expect(mismatches).toEqual([])
  })

  it('reaches the square outside corner and keeps a clean inside corner', () => {
    const right = sidewalkPolygon(1), left = sidewalkPolygon(-1)
    expect(hasVertex(right, 3.9, -29.9)).toBe(true)
    expect(hasVertex(right, 3, -29)).toBe(true)
    expect(hasVertex(left, -3, -23)).toBe(true)
    expect(hasVertex(left, -3.9, -22.1)).toBe(true)
  })

  it('has no self-intersection and the two sides never overlap', () => {
    for (const side of [-1, 1] as const) {
      const polygon = sidewalkPolygon(side)
      for (let i = 0; i < polygon.length; i++) for (let j = i + 2; j < polygon.length; j++) {
        if (i === 0 && j === polygon.length - 1) continue
        expect(crosses(polygon[i]!, polygon[(i + 1) % polygon.length]!, polygon[j]!, polygon[(j + 1) % polygon.length]!)).toBe(false)
      }
    }
    const [left, right] = [sidewalkPolygon(-1), sidewalkPolygon(1)]
    for (let x = -36.05; x <= 10; x += 0.1) for (let z = -76.05; z <= 18; z += 0.1)
      expect(inPolygon(left, x, z) && inPolygon(right, x, z)).toBe(false)
  })

  it('honors the inner and outer distances', () => {
    expect(hasVertex(sidewalkPolygon(1, 3, 5), 5, 8)).toBe(true)
    expect(SIDEWALK_INNER).toBe(ROAD_HALF_WIDTH)
  })
})

describe('dashPositions', () => {
  const dashes = dashPositions()

  it('places 29 dashes: 10, 7 and 12 on the three segments', () => {
    expect(dashes).toHaveLength(29)
    const perSegment = PATH_SEGMENTS.map(segment =>
      dashes.filter(d => d.dirX === segment.dirX && d.dirZ === segment.dirZ
        && Math.abs((d.x - segment.fromX) * segment.rightX + (d.z - segment.fromZ) * segment.rightZ) < 1e-9
        && ((d.x - segment.fromX) * segment.dirX + (d.z - segment.fromZ) * segment.dirZ) >= -1e-9
        && ((d.x - segment.fromX) * segment.dirX + (d.z - segment.fromZ) * segment.dirZ) <= segment.length + 1e-9).length)
    expect(perSegment).toEqual([10, 7, 12])
  })

  it('spaces dashes 3.0 apart along each segment', () => {
    for (const segment of PATH_SEGMENTS) {
      const along = dashes
        .filter(d => d.dirX === segment.dirX && d.dirZ === segment.dirZ
          && Math.abs((d.x - segment.fromX) * segment.rightX + (d.z - segment.fromZ) * segment.rightZ) < 1e-9)
        .map(d => (d.x - segment.fromX) * segment.dirX + (d.z - segment.fromZ) * segment.dirZ)
        .filter(a => a >= -1e-9 && a <= segment.length + 1e-9)
        .sort((a, b) => a - b)
      for (let i = 1; i < along.length; i++) expect(along[i]! - along[i - 1]!).toBeCloseTo(DASH_PERIOD, 9)
    }
  })

  it('keeps the whole dash inside its segment and 3.0 from every interior waypoint', () => {
    expect(DASH_JOINT_MARGIN).toBe(ROAD_HALF_WIDTH + DASH_LENGTH / 2)
    const interior = WAYPOINTS.slice(1, -1)
    for (const dash of dashes) {
      // The dash rectangle's four corners in world space.
      const corners = [-1, 1].flatMap(a => [-1, 1].map(b => ({
        x: dash.x + dash.dirX * a * DASH_LENGTH / 2 - dash.dirZ * b * DASH_WIDTH / 2,
        z: dash.z + dash.dirZ * a * DASH_LENGTH / 2 + dash.dirX * b * DASH_WIDTH / 2,
      })))
      for (const corner of corners) {
        expect(inRects(roadRects().slice(0, 3), corner.x, corner.z, 1e-9)).toBe(true)
        for (const point of interior)
          expect(Math.max(Math.abs(corner.x - point.x), Math.abs(corner.z - point.z))).toBeGreaterThanOrEqual(ROAD_HALF_WIDTH - 1e-9)
      }
      for (const point of interior)
        expect(Math.hypot(dash.x - point.x, dash.z - point.z)).toBeGreaterThanOrEqual(DASH_JOINT_MARGIN - 1e-9)
    }
  })

  it('puts every center on the path center line', () => {
    for (const dash of dashes) {
      const onLine = PATH_SEGMENTS.some(segment =>
        Math.abs((dash.x - segment.fromX) * segment.rightX + (dash.z - segment.fromZ) * segment.rightZ) < 1e-9)
      expect(onLine).toBe(true)
    }
  })
})

describe('clearsSidewalks', () => {
  it('rejects the sidewalk, its margin, and the square outside corner', () => {
    expect(clearsSidewalks(3.5, -10)).toBe(false)
    expect(clearsSidewalks(4.1, -10)).toBe(false) // inside the 0.3 gap
    expect(clearsSidewalks(4.3, -10)).toBe(true)
    expect(clearsSidewalks(3.2, -29.2)).toBe(false) // diagonal from the waypoint: Euclidean distance 4.53
    expect(clearsSidewalks(4.3, -10, 0.2)).toBe(false) // halfExtent grows the margin
  })

  it('keeps BUILDING_ROAD_MARGIN consistent with the sidewalk and gap', () => {
    expect(BUILDING_ROAD_MARGIN).toBeCloseTo(SIDEWALK_OUTER + 0.3, 12)
  })

  it('clears the nearest market stall edge from the sidewalk', () => {
    // Stall x = side * (BUILDING_CLEARANCE + 0.5 + up to 3); half width 0.6.
    expect(BUILDING_CLEARANCE + 0.5 - 0.6).toBeGreaterThanOrEqual(SIDEWALK_OUTER)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/journey/road-layout.test.ts`
Expected: FAIL. The imports from `path` and `road-layout` do not exist yet.

- [ ] **Step 3: Add the path helpers**

Append to `app/journey/path.ts`:

```ts

// Sidewalk strip (spec 08): from the road edge to 3.9 units off the center line.
export const SIDEWALK_INNER = ROAD_HALF_WIDTH
export const SIDEWALK_OUTER = 3.9
export const SIDEWALK_HEIGHT = 0.15
// Gap kept between a background building and the outer sidewalk edge.
export const BUILDING_SIDEWALK_GAP = 0.3
export const BUILDING_ROAD_MARGIN = SIDEWALK_OUTER + BUILDING_SIDEWALK_GAP
// Market stalls start this far off the center line, so the nearest stall edge (4.4) clears the 3.9 sidewalk.
export const BUILDING_CLEARANCE = 4.5

export type Rect = readonly [minX: number, minZ: number, maxX: number, maxZ: number]

// Axis-aligned rectangles of a band `halfWidth` either side of the path: one per leg (between its waypoints,
// not extended past the exterior ends) and one square at each interior waypoint. Every leg of this path is
// axis aligned, which the check below enforces.
export function pathBandRects(halfWidth: number): Rect[] {
  const legs = PATH_SEGMENTS.map((segment): Rect => {
    if (Math.abs(segment.dirX) > 1e-9 && Math.abs(segment.dirZ) > 1e-9) throw new Error('path legs must be axis aligned')
    const toX = segment.fromX + segment.dirX * segment.length
    const toZ = segment.fromZ + segment.dirZ * segment.length
    return Math.abs(segment.dirX) > 0.5
      ? [Math.min(segment.fromX, toX), segment.fromZ - halfWidth, Math.max(segment.fromX, toX), segment.fromZ + halfWidth]
      : [segment.fromX - halfWidth, Math.min(segment.fromZ, toZ), segment.fromX + halfWidth, Math.max(segment.fromZ, toZ)]
  })
  const joints = WAYPOINTS.slice(1, -1).map((point): Rect =>
    [point.x - halfWidth, point.z - halfWidth, point.x + halfWidth, point.z + halfWidth])
  return [...legs, ...joints]
}

// The road surface: three leg rectangles, then the two joint squares.
export function roadRects(): Rect[] {
  return pathBandRects(ROAD_HALF_WIDTH)
}

const SIDEWALK_RECTS: readonly Rect[] = pathBandRects(SIDEWALK_OUTER)

// True if a building whose center is (x, z) and whose rectangle reaches `halfExtent` from it stays at least
// BUILDING_SIDEWALK_GAP clear of every sidewalk rectangle. Distance to the polyline is not enough here: the
// mitered sidewalk is square at an outside corner and reaches 3.9 * sqrt(2) from the waypoint.
export function clearsSidewalks(x: number, z: number, halfExtent = 0): boolean {
  const margin = BUILDING_SIDEWALK_GAP + halfExtent
  return SIDEWALK_RECTS.every(([minX, minZ, maxX, maxZ]) =>
    x < minX - margin || x > maxX + margin || z < minZ - margin || z > maxZ + margin)
}
```

- [ ] **Step 4: Add the layout module**

Create `app/journey/road-layout.ts`:

```ts
import { PATH_SEGMENTS, ROAD_HALF_WIDTH, SIDEWALK_INNER, SIDEWALK_OUTER, type Vec2, WAYPOINTS } from './path'

export const DASH_LENGTH = 1.2
export const DASH_WIDTH = 0.08
export const DASH_PERIOD = 3
// A dash center stays this far from an exterior segment end.
export const DASH_END_MARGIN = DASH_LENGTH / 2
// And this far from an interior waypoint: the 6 x 6 joint patch half width plus the dash half length.
export const DASH_JOINT_MARGIN = ROAD_HALF_WIDTH + DASH_LENGTH / 2

export interface Dash {
  x: number
  z: number
  dirX: number
  dirZ: number
}

// Dash centers for the whole path: 10, 7, and 12 on the three legs.
export function dashPositions(): Dash[] {
  const dashes: Dash[] = []
  const lastIndex = PATH_SEGMENTS.length - 1
  PATH_SEGMENTS.forEach((segment, index) => {
    const first = index === 0 ? DASH_END_MARGIN : DASH_JOINT_MARGIN
    const last = segment.length - (index === lastIndex ? DASH_END_MARGIN : DASH_JOINT_MARGIN)
    for (let along = first; along <= last + 1e-9; along += DASH_PERIOD) {
      dashes.push({
        x: segment.fromX + segment.dirX * along,
        z: segment.fromZ + segment.dirZ * along,
        dirX: segment.dirX,
        dirZ: segment.dirZ,
      })
    }
  })
  return dashes
}

// The path offset by `distance` on one side, with mitered corners: at each waypoint the offset point is
// pushed along the normalized sum of the adjacent legs' right vectors, scaled so it stays `distance` from both.
function offsetPath(side: -1 | 1, distance: number): Vec2[] {
  return WAYPOINTS.map((waypoint, index) => {
    const before = PATH_SEGMENTS[index - 1]
    const after = PATH_SEGMENTS[index]
    const first = before ?? after
    const second = after ?? before
    if (!first || !second) throw new Error('path has no segments')
    const sumX = first.rightX + second.rightX
    const sumZ = first.rightZ + second.rightZ
    const length = Math.hypot(sumX, sumZ)
    if (length < 1e-9) throw new Error('path doubles back on itself')
    const miterX = sumX / length
    const miterZ = sumZ / length
    const scale = 1 / (miterX * second.rightX + miterZ * second.rightZ)
    return { x: waypoint.x + side * miterX * scale * distance, z: waypoint.z + side * miterZ * scale * distance }
  })
}

// One sidewalk strip as a closed polygon: the inner offset points, then the outer offset points reversed.
export function sidewalkPolygon(side: -1 | 1, inner = SIDEWALK_INNER, outer = SIDEWALK_OUTER): Vec2[] {
  return [...offsetPath(side, inner), ...offsetPath(side, outer).reverse()]
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/journey/road-layout.test.ts`
Expected: PASS.

If the geometry test reports mismatches, print the first few. A mismatch inside a 0.1 band of a boundary means the polygon edge is off; check `offsetPath`'s `scale` first.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/journey/path.ts app/journey/road-layout.ts tests/journey/road-layout.test.ts
git commit -m "feat: add road rectangles, sidewalk polygon, and dash layout"
```

---

### Task 3: Keep buildings and market stalls off the sidewalk

**Files:**
- Modify: `app/journey/buildings.ts`
- Modify: `app/journey/footprints.ts`
- Modify: `app/journey/scene.ts` (the `BUILDING_CLEARANCE` constant only)
- Test: `tests/journey/buildings.test.ts`, `tests/journey/footprints.test.ts`, `tests/journey/road-layout.test.ts`

**Interfaces:**
- Consumes: `BUILDING_ROAD_MARGIN`, `clearsSidewalks`, `BUILDING_CLEARANCE`, `sidewalkPolygon` from Task 2.
- Produces: `SIDEWALK_ATTEMPTS = 8` (exported from `buildings.ts`); `placeBuilding` that accepts only candidates clear of the sidewalk.

- [ ] **Step 1: Write the failing tests**

In `tests/journey/buildings.test.ts`:

1. Add `SIDEWALK_ATTEMPTS` to the import from `../../app/journey/buildings`, and `BUILDING_ROAD_MARGIN, clearsSidewalks` to the import from `../../app/journey/path` (it currently imports `clearsPath, ROAD_HALF_WIDTH`).

2. In the test `layer %i: 500 seeds keep the whole rectangle off road, set-pieces, and corner blocks`, add one line after the `clearsCornerBlocks` violation line:

```ts
          if (!clearsSidewalks(x, z)) violations.push(`sidewalk ${layer}:${i}`)
```

3. Replace the `passes` expression in `keeps every position from today's city that also passes the stricter check`. If `ROAD_CLEARANCE` is then unused in the test file, remove it from the import. Leave the final `expect(checked).toBeGreaterThan(total * 0.5)` as it is: with the stricter check, 54 of the 96 golden positions still qualify and keep their place (measured), which clears the 50% bar.

```ts
        const passes = clearsPath(old.x, old.z, BUILDING_ROAD_MARGIN + halfExtent)
          && clearsSidewalks(old.x, old.z, halfExtent)
          && clearsFootprints(old.x, old.z, halfExtent) && clearsCornerBlocks(old.x, old.z, halfExtent)
```

4. Append these tests inside the same `describe` block:

```ts
  it('adds sidewalk-window attempts after the original eight', () => {
    expect(SIDEWALK_ATTEMPTS).toBe(8)
  })

  it('keeps at least 90% of the near layer after the stricter acceptance', () => {
    let placed = 0
    for (let i = 0; i < 500; i++) if (placeBuilding(i, LAYERS[0].sideSpread)) placed++
    expect(placed / 500).toBeGreaterThanOrEqual(0.9)
  })

  it('never places a building on the diagonal of an outside corner', () => {
    // (3.2, -29.2) is 4.53 from the waypoint (0, -26): it passes a Euclidean check and stands on the square sidewalk corner.
    expect(clearsSidewalks(3.2, -29.2, 0.3)).toBe(false)
  })
```

In `tests/journey/footprints.test.ts`, append:

```ts
it('keeps the market stalls inside the market footprint', () => {
  const market = FOOTPRINTS[2]!
  // Stalls reach BUILDING_CLEARANCE + 0.5 + 3 + 0.6 off the center line.
  expect(market.halfX).toBeGreaterThanOrEqual(BUILDING_CLEARANCE + 0.5 + 3 + 0.6)
})
```

and add `import { BUILDING_CLEARANCE } from '../../app/journey/path'` at the top.

In `tests/journey/road-layout.test.ts`, append this test (add `import { LAYERS, placeBuilding } from '../../app/journey/buildings'` at the top):

```ts
describe('placed buildings and the sidewalk', () => {
  const polygons = ([-1, 1] as const).map(side => sidewalkPolygon(side))

  it.each(LAYERS.map((config, layer) => [layer, config.sideSpread] as const))(
    'layer %i: no building rectangle touches either sidewalk polygon',
    (layer, sideSpread) => {
      const offenders: string[] = []
      for (let i = 0; i < 500; i++) {
        const placed = placeBuilding(layer * 1000 + i, sideSpread)
        if (!placed) continue
        const halfW = placed.width / 2, halfD = placed.depth / 2
        for (let gx = -1; gx <= 1; gx += 0.25) for (let gz = -1; gz <= 1; gz += 0.25) {
          const x = placed.x + gx * halfW, z = placed.z + gz * halfD
          if (polygons.some(polygon => inPolygon(polygon, x, z))) offenders.push(`${layer}:${i}`)
        }
        for (const polygon of polygons) for (const vertex of polygon) {
          if (Math.abs(vertex.x - placed.x) < halfW && Math.abs(vertex.z - placed.z) < halfD) offenders.push(`${layer}:${i} vertex`)
        }
      }
      expect(offenders).toEqual([])
    },
  )
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/journey/buildings.test.ts tests/journey/footprints.test.ts tests/journey/road-layout.test.ts`
Expected: FAIL. `SIDEWALK_ATTEMPTS` is not exported, and the footprint is 7.5 wide.

- [ ] **Step 3: Change the placement**

In `app/journey/buildings.ts`:

1. Change the import from `./path`:

```ts
import { BUILDING_ROAD_MARGIN, clearsPath, clearsSidewalks, PATH_TOTAL_LENGTH, pathPointAt, ROAD_HALF_WIDTH } from './path'
```

2. Below `export const PLACEMENT_ATTEMPTS = 8` add:

```ts
// Extra attempts whose candidate window starts at the sidewalk edge (spec 08). The first PLACEMENT_ATTEMPTS keep
// their original candidates, so every old position that also passes the stricter check keeps its place.
export const SIDEWALK_ATTEMPTS = 8
```

3. Replace the whole `placeBuilding` function and its leading comment with:

```ts
// Picks a point off to one side of the path that is clear of every road
// segment, sidewalk, set-piece footprint, and corner block for the building's
// whole axis-aligned rectangle. The first PLACEMENT_ATTEMPTS candidates are
// generated exactly as before the footprint and sidewalk changes; only the
// acceptance test is stricter. The later SIDEWALK_ATTEMPTS candidates start
// beyond the sidewalk, so the near layer is not starved. Gives up (returns
// null, hidden off-scene) if none clear.
export function placeBuilding(seedBase: number, sideSpread: number): Placement | null {
  const width = 0.5 + seeded(seedBase + 100) * 0.6
  const depth = width * (0.7 + 0.6 * seeded(seedBase + 300))
  const halfExtent = Math.max(width, depth) / 2
  const roadWindow = ROAD_CLEARANCE + width / 2
  const sidewalkWindow = BUILDING_ROAD_MARGIN + width / 2
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS + SIDEWALK_ATTEMPTS; attempt++) {
    const minClear = attempt < PLACEMENT_ATTEMPTS ? roadWindow : sidewalkWindow
    const s = seedBase + attempt * 977
    const distance = seeded(s + 400) * PATH_TOTAL_LENGTH
    const point = pathPointAt(distance)
    const half = Math.max(sideSpread / 2, minClear + 1)
    const side = seeded(s) < 0.5 ? -1 : 1
    const offset = side * (minClear + seeded(s + 1000) * (half - minClear))
    const x = point.x + point.rightX * offset
    const z = point.z + point.rightZ * offset
    if (clearsPath(x, z, BUILDING_ROAD_MARGIN + halfExtent) && clearsSidewalks(x, z, halfExtent)
      && clearsFootprints(x, z, halfExtent) && clearsCornerBlocks(x, z, halfExtent)) {
      return { x, z, width, depth }
    }
  }
  return null
}
```

In `app/journey/footprints.ts`, change the market footprint's `halfX` from `7.5` to `8.7` and extend the comment above `FOOTPRINTS`:

```ts
  // Market halfX covers the stalls at BUILDING_CLEARANCE + 0.5 + 3 + 0.6 = 8.6 off the center line.
  { x: PLACES.market.x, z: PLACES.market.z, heading: headingFor(seg2.dirX, seg2.dirZ), halfX: 8.7, halfZ: 6.5 },
```

In `app/journey/scene.ts`: delete the line `const BUILDING_CLEARANCE = 3.3` and add `BUILDING_CLEARANCE` to the import from `./path`:

```ts
import { BUILDING_CLEARANCE, headingFor, PATH_SEGMENTS, PATH_TOTAL_LENGTH, type PathSegment, pathPointAt, PLACES, ROAD_HALF_WIDTH, WAYPOINTS } from './path'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/journey/buildings.test.ts tests/journey/footprints.test.ts tests/journey/road-layout.test.ts tests/journey/building-layer.test.ts`
Expected: PASS.

If `hidden / 500` fails for a layer, print how many attempts the failing seeds used before changing numbers. Do not move the first eight candidates; only the second window may change.

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/journey/buildings.ts app/journey/footprints.ts app/journey/scene.ts tests/journey
git commit -m "feat: keep buildings and market stalls clear of the sidewalk"
```

---

### Task 4: Asphalt texture and puddle mask

**Files:**
- Create: `app/journey/asphalt.ts`
- Test: `tests/journey/asphalt.test.ts`

**Interfaces:**
- Produces: `ASPHALT_SIZE = 256`, `ASPHALT_SEED = 7`, `ASPHALT_TILE_UNITS = 4`, `asphaltPixels(size: number, seed: number): Uint8Array` (grayscale, `size * size` bytes), `createAsphaltTexture(maxAnisotropy: number): THREE.DataTexture`, `PUDDLE_ORIGIN: readonly [number, number]`, `puddleMaskAt(x: number, z: number): number`, `PUDDLE_GLSL: string` (declares `float puddleHash(vec2)`, `float puddleNoise(vec2)`, `float puddleMask(vec2 worldXZ)`).

- [ ] **Step 1: Write the failing tests**

Create `tests/journey/asphalt.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  ASPHALT_SEED, ASPHALT_SIZE, asphaltPixels, createAsphaltTexture, PUDDLE_GLSL, PUDDLE_ORIGIN, puddleMaskAt,
} from '../../app/journey/asphalt'
import { seeded } from '../../app/journey/random'

describe('asphaltPixels', () => {
  const pixels = asphaltPixels(ASPHALT_SIZE, ASPHALT_SEED)
  const values = Array.from(pixels, v => v / 255)
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const deviation = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length)

  it('is deterministic and depends on the seed', () => {
    expect(asphaltPixels(ASPHALT_SIZE, ASPHALT_SEED)).toEqual(pixels)
    expect(asphaltPixels(ASPHALT_SIZE, ASPHALT_SEED + 1)).not.toEqual(pixels)
    expect(pixels).toHaveLength(ASPHALT_SIZE * ASPHALT_SIZE)
  })

  it('has a mean near 0.5 and visible grain', () => {
    expect(mean).toBeGreaterThan(0.35)
    expect(mean).toBeLessThan(0.65)
    expect(deviation).toBeGreaterThan(0.05)
  })

  it('tiles: the wrap seam is no rougher than the interior', () => {
    // Per-pixel speckle makes neighbors differ, so the 2/255 bound of the spec cannot hold. A visible seam would
    // show as a seam difference well above the average neighbor difference inside the tile.
    const at = (x: number, y: number) => pixels[y * ASPHALT_SIZE + x]!
    let seamX = 0, interiorX = 0, seamY = 0, interiorY = 0
    for (let a = 0; a < ASPHALT_SIZE; a++) {
      seamX += Math.abs(at(0, a) - at(ASPHALT_SIZE - 1, a))
      seamY += Math.abs(at(a, 0) - at(a, ASPHALT_SIZE - 1))
      for (let b = 0; b < ASPHALT_SIZE - 1; b++) {
        interiorX += Math.abs(at(b, a) - at(b + 1, a))
        interiorY += Math.abs(at(a, b) - at(a, b + 1))
      }
    }
    expect(seamX / ASPHALT_SIZE).toBeLessThanOrEqual(1.2 * interiorX / (ASPHALT_SIZE * (ASPHALT_SIZE - 1)))
    expect(seamY / ASPHALT_SIZE).toBeLessThanOrEqual(1.2 * interiorY / (ASPHALT_SIZE * (ASPHALT_SIZE - 1)))
  })
})

describe('createAsphaltTexture', () => {
  it('sets the filtering r186 needs for anisotropy to apply', () => {
    const texture = createAsphaltTexture(16)
    expect(texture.wrapS).toBe(THREE.RepeatWrapping)
    expect(texture.wrapT).toBe(THREE.RepeatWrapping)
    expect(texture.colorSpace).toBe(THREE.NoColorSpace)
    expect(texture.generateMipmaps).toBe(true)
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter)
    expect(texture.magFilter).toBe(THREE.LinearFilter)
    expect(texture.anisotropy).toBe(4)
    expect(texture.repeat.toArray()).toEqual([1, 1])
    expect(createAsphaltTexture(2).anisotropy).toBe(2)
  })

  it('stores the grayscale in all three color channels', () => {
    const texture = createAsphaltTexture(1)
    const data = texture.image.data as Uint8Array
    const gray = asphaltPixels(ASPHALT_SIZE, ASPHALT_SEED)
    expect(data).toHaveLength(ASPHALT_SIZE * ASPHALT_SIZE * 4)
    for (const i of [0, 1, 777, 65535]) {
      expect([data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]]).toEqual([gray[i], gray[i], gray[i], 255])
    }
  })
})

describe('puddleMaskAt', () => {
  it('stays in [0, 1] and is deterministic', () => {
    for (let i = 0; i < 500; i++) {
      const x = -40 + 60 * seeded(i), z = -80 + 100 * seeded(i + 1000)
      const value = puddleMaskAt(x, z)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
      expect(puddleMaskAt(x, z)).toBe(value)
    }
  })

  it('is continuous: points 0.01 apart differ by less than 0.05', () => {
    for (let i = 0; i < 2000; i++) {
      const x = -40 + 60 * seeded(i), z = -80 + 100 * seeded(i + 5000)
      expect(Math.abs(puddleMaskAt(x, z) - puddleMaskAt(x + 0.01, z))).toBeLessThan(0.05)
      expect(Math.abs(puddleMaskAt(x, z) - puddleMaskAt(x, z + 0.01))).toBeLessThan(0.05)
    }
  })

  it('puts between 15% and 45% of the road bounding box above 0.5', () => {
    let above = 0, total = 0
    for (let x = -30; x <= 4; x += 0.5) for (let z = -70; z <= 12; z += 0.5) {
      total++
      if (puddleMaskAt(x, z) > 0.5) above++
    }
    expect(above / total).toBeGreaterThanOrEqual(0.15)
    expect(above / total).toBeLessThanOrEqual(0.45)
  })
})

describe('PUDDLE_GLSL', () => {
  it('mirrors the TypeScript mask: same octaves, thresholds, and origin', () => {
    for (const token of ['float puddleHash(vec2 p)', 'float puddleNoise(vec2 p)', 'float puddleMask(vec2 worldXZ)',
      'p / 24.0', 'p / 6.0', '0.75', '0.25', 'smoothstep(0.45, 0.65', '0.1031', '33.33']) expect(PUDDLE_GLSL).toContain(token)
    expect(PUDDLE_GLSL).toContain(`vec2(${PUDDLE_ORIGIN[0]}.0, ${PUDDLE_ORIGIN[1]}.0)`)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/journey/asphalt.test.ts`
Expected: FAIL, because `asphalt.ts` does not exist.

- [ ] **Step 3: Write the module**

Create `app/journey/asphalt.ts`:

```ts
import * as THREE from 'three'
import { glslFloat } from './shader-utils'
import { smoothstep } from './sky-mirror'

export const ASPHALT_SIZE = 256
export const ASPHALT_SEED = 7
// World units covered by one texture tile (road UVs are world position / this).
export const ASPHALT_TILE_UNITS = 4

const COARSE_CELLS = 8
const MEDIUM_CELLS = 32
const COARSE_WEIGHT = 0.3
const MEDIUM_WEIGHT = 0.2
const SPECKLE_WEIGHT = 0.35
// r186 skips anisotropy when magFilter is NearestFilter (the DataTexture default), so the filters below are explicit.
const MAX_ASPHALT_ANISOTROPY = 4

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

// Value noise on a lattice that wraps after `cells` cells, so the image tiles. (u, v) are tile fractions in [0, 1).
function periodicNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells, y = v * cells
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = smooth(x - ix), fy = smooth(y - iy)
  const at = (i: number, j: number) => hash2(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed)
  const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx
  const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx
  return top * (1 - fy) + bottom * fy
}

// Tileable grayscale asphalt: two octaves of periodic value noise plus per-pixel speckle.
export function asphaltPixels(size: number, seed: number): Uint8Array {
  const pixels = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size
      const value = 0.5
        + COARSE_WEIGHT * (periodicNoise(u, v, COARSE_CELLS, seed) - 0.5)
        + MEDIUM_WEIGHT * (periodicNoise(u, v, MEDIUM_CELLS, seed + 1) - 0.5)
        + SPECKLE_WEIGHT * (hash2(x, y, seed + 2) - 0.5)
      pixels[y * size + x] = Math.round(255 * Math.min(1, Math.max(0, value)))
    }
  }
  return pixels
}

// The grayscale goes in all four channels' RGB so any channel can drive roughness (r186 reads green) or bump.
export function createAsphaltTexture(maxAnisotropy: number): THREE.DataTexture {
  const gray = asphaltPixels(ASPHALT_SIZE, ASPHALT_SEED)
  const rgba = new Uint8Array(ASPHALT_SIZE * ASPHALT_SIZE * 4)
  gray.forEach((value, i) => {
    rgba[i * 4] = value
    rgba[i * 4 + 1] = value
    rgba[i * 4 + 2] = value
    rgba[i * 4 + 3] = 255
  })
  const texture = new THREE.DataTexture(rgba, ASPHALT_SIZE, ASPHALT_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.NoColorSpace
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.anisotropy = Math.min(MAX_ASPHALT_ANISOTROPY, maxAnisotropy)
  texture.needsUpdate = true
  return texture
}

// World offset added before the noise lookup. Chosen so 32% of the road bounding box is above 0.5 (spec: 15% to 45%).
export const PUDDLE_ORIGIN: readonly [number, number] = [31, 17]
const PUDDLE_LARGE_SCALE = 24
const PUDDLE_SMALL_SCALE = 6
const PUDDLE_LARGE_WEIGHT = 0.75
const PUDDLE_SMALL_WEIGHT = 0.25
const PUDDLE_EDGE_LOW = 0.45
const PUDDLE_EDGE_HIGH = 0.65

function fract(value: number): number {
  return value - Math.floor(value)
}

// Dave Hoskins hash, float64 mirror of puddleHash in PUDDLE_GLSL.
function puddleHash(px: number, py: number): number {
  let a = fract(px * 0.1031), b = fract(py * 0.1031), c = fract(px * 0.1031)
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33)
  a += d
  b += d
  c += d
  return fract((a + b) * c)
}

function puddleNoise(px: number, py: number): number {
  const ix = Math.floor(px), iy = Math.floor(py)
  const ux = smooth(px - ix), uy = smooth(py - iy)
  const mix = (p: number, q: number, t: number) => p * (1 - t) + q * t
  return mix(
    mix(puddleHash(ix, iy), puddleHash(ix + 1, iy), ux),
    mix(puddleHash(ix, iy + 1), puddleHash(ix + 1, iy + 1), ux),
    uy,
  )
}

// Float64 mirror of puddleMask in PUDDLE_GLSL; the test oracle (tolerance 0.02 against the shader).
export function puddleMaskAt(x: number, z: number): number {
  const px = x + PUDDLE_ORIGIN[0], pz = z + PUDDLE_ORIGIN[1]
  const n = puddleNoise(px / PUDDLE_LARGE_SCALE, pz / PUDDLE_LARGE_SCALE) * PUDDLE_LARGE_WEIGHT
    + puddleNoise(px / PUDDLE_SMALL_SCALE, pz / PUDDLE_SMALL_SCALE) * PUDDLE_SMALL_WEIGHT
  return smoothstep(PUDDLE_EDGE_LOW, PUDDLE_EDGE_HIGH, n)
}

// Shared by the road material and the reflection overlay, so both agree on where the puddles are.
export const PUDDLE_GLSL = `
float puddleHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float puddleNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(puddleHash(i), puddleHash(i + vec2(1.0, 0.0)), u.x),
             mix(puddleHash(i + vec2(0.0, 1.0)), puddleHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float puddleMask(vec2 worldXZ) {
  vec2 p = worldXZ + vec2(${glslFloat(PUDDLE_ORIGIN[0])}, ${glslFloat(PUDDLE_ORIGIN[1])});
  float n = puddleNoise(p / 24.0) * 0.75 + puddleNoise(p / 6.0) * 0.25;
  return smoothstep(0.45, 0.65, n);
}
`
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/journey/asphalt.test.ts`
Expected: PASS. The coverage test measures about 32%. If it fails, change only `PUDDLE_ORIGIN` (and the number in its comment), then rerun.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/journey/asphalt.ts tests/journey/asphalt.test.ts
git commit -m "feat: add asphalt texture and shared puddle mask"
```

---

### Task 5: Road module (surface, sidewalks, dashes, wet material)

**Files:**
- Create: `app/journey/road.ts`
- Test: `tests/journey/road.test.ts`

**Interfaces:**
- Consumes: `roadRects`, `SIDEWALK_HEIGHT`, `headingFor`, `Rect` (path), `dashPositions`, `sidewalkPolygon`, `DASH_LENGTH`, `DASH_WIDTH` (road-layout), `createAsphaltTexture`, `ASPHALT_TILE_UNITS`, `PUDDLE_GLSL` (asphalt), `ROAD_MARKING_RENDER_ORDER` (contact-shadows), `replaceOrThrow` (shader-utils).
- Produces: `ROAD_Y = -1`, `DASH_Y = -0.99`, `flatQuadGeometry(rect: Rect, y: number): THREE.BufferGeometry`, `sidewalkGeometry(): THREE.BufferGeometry`, `createDashes()`, `createRoadMaterial(texture, uniforms)`, `interface RoadUniforms { uWetness: { value: number }; uSkyTint: { value: THREE.Color } }`, `interface Road { group; surface; sidewalks; dashes; uniforms; update(wetness: number, skyColor: Vec3): void }`, `createRoad(maxAnisotropy: number): Road`. Debug define `ROAD_DEBUG_PUDDLE` makes the road fragment output `vec4(vec3(puddle), 1.0)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/journey/road.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ASPHALT_TILE_UNITS } from '../../app/journey/asphalt'
import { ROAD_MARKING_RENDER_ORDER } from '../../app/journey/contact-shadows'
import { headingFor, roadRects, SIDEWALK_HEIGHT } from '../../app/journey/path'
import { DASH_Y, flatQuadGeometry, createRoad, ROAD_Y, sidewalkGeometry } from '../../app/journey/road'
import { dashPositions } from '../../app/journey/road-layout'

type Shader = Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0]

function fakeShader(): Shader {
  return {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>\n',
    fragmentShader: '#include <common>\n#include <roughnessmap_fragment>\n#include <opaque_fragment>\n#include <dithering_fragment>\n',
  } as unknown as Shader
}

describe('flatQuadGeometry', () => {
  it('lies flat at y, faces up, and bakes world-unit UVs', () => {
    for (const rect of roadRects()) {
      const [minX, minZ, maxX, maxZ] = rect
      const geometry = flatQuadGeometry(rect, ROAD_Y)
      const position = geometry.getAttribute('position')
      const uv = geometry.getAttribute('uv')
      const normal = geometry.getAttribute('normal')
      const us: number[] = [], vs: number[] = []
      for (let i = 0; i < position.count; i++) {
        expect(position.getY(i)).toBe(ROAD_Y)
        expect([normal.getX(i), normal.getY(i), normal.getZ(i)]).toEqual([0, 1, 0])
        expect(uv.getX(i)).toBeCloseTo(position.getX(i) / ASPHALT_TILE_UNITS, 6)
        expect(uv.getY(i)).toBeCloseTo(position.getZ(i) / ASPHALT_TILE_UNITS, 6)
        us.push(uv.getX(i)); vs.push(uv.getY(i))
      }
      expect(Math.max(...us) - Math.min(...us)).toBeCloseTo((maxX - minX) / ASPHALT_TILE_UNITS, 6)
      expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo((maxZ - minZ) / ASPHALT_TILE_UNITS, 6)
    }
  })

  it('winds its triangles counter-clockwise seen from above', () => {
    const geometry = flatQuadGeometry([0, 0, 2, 2], 0)
    const index = geometry.getIndex()!, position = geometry.getAttribute('position')
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(position, index.getX(t + k)))
      expect(new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!)).y).toBeGreaterThan(0)
    }
  })
})

describe('sidewalkGeometry', () => {
  it('spans the curb height and the sidewalk bands, with world-unit UVs', () => {
    const geometry = sidewalkGeometry()
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    expect(box.min.y).toBeCloseTo(ROAD_Y, 6)
    expect(box.max.y).toBeCloseTo(ROAD_Y + SIDEWALK_HEIGHT, 6)
    expect(box.min.x).toBeCloseTo(-29.9, 6)
    expect(box.max.x).toBeCloseTo(3.9, 6)
    expect(box.min.z).toBeCloseTo(-66, 6)
    expect(box.max.z).toBeCloseTo(8, 6)
    const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
    for (let i = 0; i < position.count; i += 7) {
      expect(uv.getX(i)).toBeCloseTo(position.getX(i) / ASPHALT_TILE_UNITS, 6)
      expect(uv.getY(i)).toBeCloseTo(position.getZ(i) / ASPHALT_TILE_UNITS, 6)
    }
  })
})

describe('createRoad', () => {
  const road = createRoad(8)

  it('is three draw calls: one surface, one sidewalk mesh, one dash batch', () => {
    expect(road.group.children).toHaveLength(3)
    expect(road.surface.geometry.getIndex()!.count).toBe(roadRects().length * 6)
    expect(road.dashes.count).toBe(29)
  })

  it('keeps the shared texture at repeat (1, 1) on every map', () => {
    const material = road.surface.material
    expect(material.roughnessMap).toBe(material.bumpMap)
    expect(material.roughnessMap!.repeat.toArray()).toEqual([1, 1])
    expect(road.sidewalks.material.bumpMap).toBe(material.bumpMap)
  })

  it('uses the center-line transparency rules: transparent, after the shadow quads', () => {
    expect(road.dashes.material.transparent).toBe(true)
    expect(road.dashes.material.opacity).toBe(0.55)
    expect(road.dashes.renderOrder).toBe(ROAD_MARKING_RENDER_ORDER)
    expect(road.dashes.frustumCulled).toBe(false)
  })

  it('places each dash at its center, flat at DASH_Y, turned to its leg', () => {
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3()
    dashPositions().forEach((dash, i) => {
      road.dashes.getMatrixAt(i, matrix)
      matrix.decompose(position, quaternion, scale)
      expect(position.x).toBeCloseTo(dash.x, 4)
      expect(position.y).toBeCloseTo(DASH_Y, 4)
      expect(position.z).toBeCloseTo(dash.z, 4)
      const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingFor(dash.dirX, dash.dirZ))
      expect(quaternion.angleTo(expected)).toBeLessThan(1e-5)
    })
  })

  it('converts the sky color from sRGB to linear in update()', () => {
    road.update(0.4, [0.5, 0.5, 0.5])
    expect(road.uniforms.uWetness.value).toBe(0.4)
    expect(road.uniforms.uSkyTint.value.r).toBeCloseTo(0.214, 3)
  })

  it('patches the road shader at its anchors and throws when an anchor is missing', () => {
    const shader = fakeShader()
    road.surface.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
    expect(shader.vertexShader).toContain('varying vec2 vWorldPos;')
    expect(shader.vertexShader).toContain('vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xz;')
    expect(shader.fragmentShader).toContain('float puddleMask(vec2 worldXZ)')
    expect(shader.fragmentShader).toContain('roughnessFactor = mix(roughnessFactor, 0.35, wetAmt);')
    expect(shader.fragmentShader).toMatch(/outgoingLight \+= uSkyTint \* wetFresnel \* wetAmt \* 0\.5;\s*#include <opaque_fragment>/)
    expect(shader.fragmentShader).toContain('ROAD_DEBUG_PUDDLE')
    expect(shader.uniforms).toHaveProperty('uWetness')
    const broken = { uniforms: {}, vertexShader: '#include <common>', fragmentShader: '' } as unknown as Shader
    expect(() => road.surface.material.onBeforeCompile(broken, {} as THREE.WebGLRenderer)).toThrow(/Missing shader marker/)
  })

  it('keys the program cache on the debug define', () => {
    const material = createRoad(1).surface.material
    const plain = material.customProgramCacheKey()
    material.defines = { ROAD_DEBUG_PUDDLE: 1 }
    expect(material.customProgramCacheKey()).not.toBe(plain)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/journey/road.test.ts`
Expected: FAIL, because `road.ts` does not exist.

- [ ] **Step 3: Write the module**

Create `app/journey/road.ts`:

```ts
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ASPHALT_TILE_UNITS, createAsphaltTexture, PUDDLE_GLSL } from './asphalt'
import { ROAD_MARKING_RENDER_ORDER } from './contact-shadows'
import { headingFor, type Rect, roadRects, SIDEWALK_HEIGHT } from './path'
import { DASH_LENGTH, DASH_WIDTH, dashPositions, sidewalkPolygon } from './road-layout'
import { replaceOrThrow } from './shader-utils'
import type { Vec3 } from './stops'

export const ROAD_Y = -1
export const DASH_Y = -0.99
// The texture averages about 0.5 gray and drives roughness through its green channel, so a scale of 1.8 gives a dry roughness near 0.9.
export const ROAD_ROUGHNESS_SCALE = 1.8
const ROAD_BUMP_SCALE = 0.4
const SIDEWALK_BUMP_SCALE = 0.3
const WET_ROUGHNESS = 0.35
const WET_SHEEN = 0.5
const DASH_COLOR = 0xf5e6a8
const DASH_OPACITY = 0.55

export interface RoadUniforms {
  uWetness: { value: number }
  uSkyTint: { value: THREE.Color }
}

// UVs come from world position, so coplanar quads that overlap (a leg and its joint) sample the same texel.
function bakeWorldUv(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position')
  const uv = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / ASPHALT_TILE_UNITS
    uv[i * 2 + 1] = position.getZ(i) / ASPHALT_TILE_UNITS
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

// A world-space quad facing up, built straight from a rectangle.
export function flatQuadGeometry(rect: Rect, y: number): THREE.BufferGeometry {
  const [minX, minZ, maxX, maxZ] = rect
  const corners = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]] as const
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap(([x, z]) => [x, y, z]), 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(corners.flatMap(() => [0, 1, 0]), 3))
  bakeWorldUv(geometry)
  geometry.setIndex([0, 3, 2, 0, 2, 1])
  return geometry
}

function mergeOrThrow(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(geometries)
  if (!merged) throw new Error('[journey] road geometries could not be merged')
  for (const geometry of geometries) geometry.dispose()
  return merged
}

// Both sidewalk strips extruded to SIDEWALK_HEIGHT above the road surface, merged into one geometry.
export function sidewalkGeometry(): THREE.BufferGeometry {
  const strips = ([-1, 1] as const).map(side => {
    // Shape y is -z: rotating by -90 degrees about X sends (x, y, depth) to (x, depth, -y).
    const shape = new THREE.Shape(sidewalkPolygon(side).map(point => new THREE.Vector2(point.x, -point.z)))
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: SIDEWALK_HEIGHT, bevelEnabled: false })
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(0, ROAD_Y, 0)
    bakeWorldUv(geometry)
    return geometry
  })
  return mergeOrThrow(strips)
}

export function createDashes(): THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const dashes = dashPositions()
  const geometry = new THREE.PlaneGeometry(DASH_WIDTH, DASH_LENGTH)
  geometry.rotateX(-Math.PI / 2) // flat, long axis along Z; the instance heading turns it to the leg
  // `transparent: true` is required: opacity alone leaves the mesh in the opaque queue, where renderOrder
  // would not place it after the transparent shadow quads.
  const material = new THREE.MeshBasicMaterial({ color: DASH_COLOR, opacity: DASH_OPACITY, transparent: true })
  material.name = 'journey-road-dash'
  const mesh = new THREE.InstancedMesh(geometry, material, dashes.length)
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const unit = new THREE.Vector3(1, 1, 1)
  dashes.forEach((dash, i) => {
    quaternion.setFromAxisAngle(up, headingFor(dash.dirX, dash.dirZ))
    mesh.setMatrixAt(i, matrix.compose(position.set(dash.x, DASH_Y, dash.z), quaternion, unit))
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  mesh.renderOrder = ROAD_MARKING_RENDER_ORDER
  mesh.name = 'journey-road-dashes'
  return mesh
}

const vertexDeclarations = 'varying vec2 vWorldPos;'
const fragmentDeclarations = `
uniform float uWetness;
uniform vec3 uSkyTint;
varying vec2 vWorldPos;
${PUDDLE_GLSL}`

export function createRoadMaterial(texture: THREE.Texture, uniforms: RoadUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0x1a1a1f, roughness: ROAD_ROUGHNESS_SCALE, roughnessMap: texture, bumpMap: texture, bumpScale: ROAD_BUMP_SCALE,
  })
  material.name = 'journey-road'
  material.precision = 'highp'
  material.customProgramCacheKey = () => `road-wet-${material.defines?.ROAD_DEBUG_PUDDLE ?? 0}`
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <common>', `#include <common>\n${vertexDeclarations}`)
    // `worldpos_vertex` is conditional, and the road meshes are not instanced, so compute the world position here.
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xz;`)
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <common>', `#include <common>\n${fragmentDeclarations}`)
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float puddle = puddleMask(vWorldPos);
float wetAmt = uWetness * puddle;
roughnessFactor = mix(roughnessFactor, ${WET_ROUGHNESS.toFixed(2)}, wetAmt);`)
    // After lighting, so outgoingLight is complete, and before tone mapping. `normal` is the view-space normal
    // after bump mapping; vViewPosition points from the fragment to the camera.
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <opaque_fragment>', `vec3 wetView = normalize(vViewPosition);
float wetFresnel = pow(1.0 - clamp(dot(normal, wetView), 0.0, 1.0), 4.0);
outgoingLight += uSkyTint * wetFresnel * wetAmt * ${WET_SHEEN.toFixed(1)};
#include <opaque_fragment>`)
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <dithering_fragment>', `#include <dithering_fragment>
#ifdef ROAD_DEBUG_PUDDLE
gl_FragColor = vec4(vec3(puddle), 1.0);
#endif`)
  }
  return material
}

export interface Road {
  readonly group: THREE.Group
  readonly surface: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  readonly sidewalks: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  readonly dashes: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  readonly uniforms: RoadUniforms
  update(wetness: number, skyColor: Vec3): void
}

// Road surface (the five road rectangles merged), sidewalks with curbs, and the dashed center line:
// three draw calls. The scene's dispose() reaches the geometries and the shared texture by traversal.
export function createRoad(maxAnisotropy: number): Road {
  const texture = createAsphaltTexture(maxAnisotropy)
  const uniforms: RoadUniforms = { uWetness: { value: 0 }, uSkyTint: { value: new THREE.Color() } }

  const surface = new THREE.Mesh(
    mergeOrThrow(roadRects().map(rect => flatQuadGeometry(rect, ROAD_Y))),
    createRoadMaterial(texture, uniforms),
  )
  surface.name = 'journey-road-surface'

  const sidewalkMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a4a52, roughness: 0.9, bumpMap: texture, bumpScale: SIDEWALK_BUMP_SCALE,
  })
  sidewalkMaterial.name = 'journey-sidewalk'
  const sidewalks = new THREE.Mesh(sidewalkGeometry(), sidewalkMaterial)
  sidewalks.name = 'journey-sidewalks'

  const dashes = createDashes()
  const group = new THREE.Group()
  group.name = 'journey-road'
  group.add(surface, sidewalks, dashes)

  return {
    group, surface, sidewalks, dashes, uniforms,
    update(wetness, skyColor) {
      uniforms.uWetness.value = wetness
      uniforms.uSkyTint.value.setRGB(skyColor[0], skyColor[1], skyColor[2], THREE.SRGBColorSpace)
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/journey/road.test.ts`
Expected: PASS.

If the sidewalk bounding box test fails on `max.x` or `min.z`, print `box`: ExtrudeGeometry y/z orientation is the usual cause. The rotation comment above states the mapping the code relies on.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/journey/road.ts tests/journey/road.test.ts
git commit -m "feat: add road module with sidewalks, dashes, and wet sheen"
```

---

### Task 6: Wire the road into the scene and test Parts A and B on the GPU

**Files:**
- Modify: `app/journey/scene.ts`
- Create: `tests/gpu/road-probe.ts`
- Create: `tests/gpu/road.spec.ts`
- Modify: `tests/gpu/harness.ts`
- Modify: `tests/gpu/facade.spec.ts`

**Interfaces:**
- Consumes: `createRoad`, `Road`, `ROAD_Y` (Task 5); `puddleMaskAt` (Task 4); `roadRects` (Task 2); `LookState.wetness` (Task 1).
- Produces: scene children `journey-road` (group). `cityGpu.road.probeMask()` and `cityGpu.road.probeSheen(...)`. Exports from `road-probe.ts` used again in Task 8: `ROAD_BOUNDS`, `insideRects`, `findPuddlePoint`.

- [ ] **Step 1: Write the GPU probes and spec (they fail until the road exists in the scene and the harness registers them)**

Create `tests/gpu/road-probe.ts`:

```ts
import * as THREE from 'three'
import { puddleMaskAt } from '../../app/journey/asphalt'
import { type Rect, roadRects } from '../../app/journey/path'
import { createRoad, ROAD_Y } from '../../app/journey/road'
import { createTestRenderer, readPixel } from './gpu-utils'

export const ROAD_BOUNDS = { minX: -30, maxX: 4, minZ: -70, maxZ: 12 }
const PIXELS_PER_UNIT = 10
const MASK_GRID = 20

export function insideRects(rects: readonly Rect[], x: number, z: number, inset = 0): boolean {
  return rects.some(([minX, minZ, maxX, maxZ]) =>
    x >= minX + inset && x <= maxX - inset && z >= minZ + inset && z <= maxZ - inset)
}

// A point on the first leg whose neighborhood is all puddle, closest to (0, -10).
export function findPuddlePoint(): { x: number; z: number } {
  let best: { x: number; z: number; distance: number } | null = null
  for (let x = -2; x <= 2; x += 0.25) for (let z = -22; z <= 0; z += 0.25) {
    if (puddleMaskAt(x, z) < 0.97) continue
    let wet = true
    for (let dx = -1; dx <= 1; dx += 0.5) for (let dz = -1; dz <= 1; dz += 0.5) if (puddleMaskAt(x + dx, z + dz) < 0.9) wet = false
    const distance = Math.hypot(x, z + 10)
    if (wet && (!best || distance < best.distance)) best = { x, z, distance }
  }
  if (!best) throw new Error('No puddle point on the first leg; PUDDLE_ORIGIN changed?')
  return { x: best.x, z: best.z }
}

export function topDownCamera(bounds = ROAD_BOUNDS): THREE.OrthographicCamera {
  const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 0.1, 200)
  camera.up.set(0, 0, -1) // screen up is -Z, screen right is +X
  camera.position.set((bounds.minX + bounds.maxX) / 2, 50, (bounds.minZ + bounds.maxZ) / 2)
  camera.lookAt(camera.position.x, 0, camera.position.z)
  return camera
}

// Pixel (x from left, y from the bottom, as readPixels wants) of a world point under topDownCamera.
export function topDownPixel(x: number, z: number, height: number, bounds = ROAD_BOUNDS): { px: number; py: number } {
  return {
    px: Math.floor((x - bounds.minX) * PIXELS_PER_UNIT),
    py: height - 1 - Math.floor((z - bounds.minZ) * PIXELS_PER_UNIT),
  }
}

function configure(renderer: THREE.WebGLRenderer): void {
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
}

// Renders only the road surface with ROAD_DEBUG_PUDDLE and reads back the mask on a 20 x 20 grid over the road.
function probeMask() {
  const width = (ROAD_BOUNDS.maxX - ROAD_BOUNDS.minX) * PIXELS_PER_UNIT
  const height = (ROAD_BOUNDS.maxZ - ROAD_BOUNDS.minZ) * PIXELS_PER_UNIT
  const ctx = createTestRenderer({ width, height })
  try {
    const { renderer, recorder } = ctx
    configure(renderer)
    const road = createRoad(renderer.capabilities.getMaxAnisotropy())
    road.surface.material.defines = { ...road.surface.material.defines, ROAD_DEBUG_PUDDLE: 1 }
    road.surface.material.needsUpdate = true
    const scene = new THREE.Scene()
    scene.add(road.surface)
    renderer.render(scene, topDownCamera())
    recorder.assertClean()
    const rects = roadRects()
    const samples: { x: number; z: number; gpu: number; cpu: number }[] = []
    for (let i = 0; i < MASK_GRID; i++) for (let j = 0; j < MASK_GRID; j++) {
      const x = ROAD_BOUNDS.minX + (i + 0.5) * (ROAD_BOUNDS.maxX - ROAD_BOUNDS.minX) / MASK_GRID
      const z = ROAD_BOUNDS.minZ + (j + 0.5) * (ROAD_BOUNDS.maxZ - ROAD_BOUNDS.minZ) / MASK_GRID
      if (!insideRects(rects, x, z, 0.3)) continue
      const { px, py } = topDownPixel(x, z, height)
      samples.push({ x, z, gpu: readPixel(renderer, px, py)[0]! / 255, cpu: puddleMaskAt(x, z) })
    }
    return { samples, shaderError: recorder.error?.message ?? null, glError: renderer.getContext().getError() }
  } finally {
    ctx.dispose()
  }
}

// Lights are absent, so the only light in the pixel is the Fresnel sheen term.
function probeSheen(input: { cameraY: number; distance: number; wetness: number }) {
  const ctx = createTestRenderer({ width: 160, height: 90 })
  try {
    const { renderer, recorder } = ctx
    configure(renderer)
    const road = createRoad(renderer.capabilities.getMaxAnisotropy())
    road.update(input.wetness, [0.5, 0.6, 0.8])
    const scene = new THREE.Scene()
    scene.add(road.surface)
    const point = findPuddlePoint()
    const camera = new THREE.PerspectiveCamera(40, 160 / 90, 0.1, 200)
    camera.position.set(point.x, input.cameraY, point.z + input.distance)
    camera.lookAt(point.x, ROAD_Y, point.z)
    renderer.render(scene, camera)
    recorder.assertClean()
    return { pixel: readPixel(renderer, 80, 45), shaderError: recorder.error?.message ?? null, glError: renderer.getContext().getError() }
  } finally {
    ctx.dispose()
  }
}

export const roadProbe = { probeMask, probeSheen }
```

In `tests/gpu/harness.ts`, add `import { roadProbe } from './road-probe'` after the `render-cost` import, and add `road: roadProbe,` after `sky: skyProbe,` in the `cityGpu` object.

Create `tests/gpu/road.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

test('the shader puddle mask agrees with puddleMaskAt on a 20 x 20 grid over the road', async ({ page }) => {
  const result = await page.evaluate(() => window.cityGpu.road.probeMask())
  expect(result.shaderError).toBeNull()
  expect(result.glError).toBe(0)
  expect(result.samples.length).toBeGreaterThan(40)
  for (const sample of result.samples) expect(Math.abs(sample.gpu - sample.cpu)).toBeLessThan(0.02)
  // The check is only meaningful if the grid sees both puddle and dry asphalt.
  expect(result.samples.some(s => s.cpu > 0.9)).toBe(true)
  expect(result.samples.some(s => s.cpu < 0.1)).toBe(true)
})

test('wet sheen grows toward grazing angles and is absent when dry', async ({ page }) => {
  const grazing = await page.evaluate(() => window.cityGpu.road.probeSheen({ cameraY: 0.5, distance: 8, wetness: 0.7 }))
  const steep = await page.evaluate(() => window.cityGpu.road.probeSheen({ cameraY: 14, distance: 1, wetness: 0.7 }))
  const dry = await page.evaluate(() => window.cityGpu.road.probeSheen({ cameraY: 0.5, distance: 8, wetness: 0 }))
  for (const result of [grazing, steep, dry]) {
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
  }
  expect(grazing.pixel[2]).toBeGreaterThan(15)
  expect(steep.pixel[2]).toBeLessThanOrEqual(2)
  expect(dry.pixel.slice(0, 3)).toEqual([0, 0, 0])
})

const CONFIGS = [
  { tier: 'full', lowPower: false }, { tier: 'full', lowPower: true }, { tier: 'lite', lowPower: true },
  { tier: 'lite', lowPower: false }, { tier: 'reduced', lowPower: false }, { tier: 'reduced', lowPower: true },
] as const

for (const config of CONFIGS) {
  test(`${config.tier} lowPower=${config.lowPower}: the road renders at every chapter in both themes`, async ({ page }) => {
    test.setTimeout(120000)
    const frames = await page.evaluate(({ tier, lowPower }) => {
      window.cityGpu.mountJourney({ tier, lowPower, width: 640, height: 360 })
      const results = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter, frames: 3 }))
      window.cityGpu.setJourneyTheme(false, { animate: false })
      results.push(window.cityGpu.renderJourney({ chapter: 3, frames: 3 }))
      const road = window.cityGpu.getJourneyContext().scene.getObjectByName('journey-road')
      const meshes = road?.children.map(child => child.name) ?? []
      window.cityGpu.dispose()
      return { results, meshes }
    }, config)
    expect(frames.meshes).toEqual(['journey-road-surface', 'journey-sidewalks', 'journey-road-dashes'])
    for (const frame of frames.results) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
    }
  })
}
```

- [ ] **Step 2: Run the new spec to verify it fails**

Run: `npm run test:gpu -- road.spec.ts`
Expected: FAIL. The scene still builds the old road, so the mask probe renders but the per-config tests fail on the mesh names (`journey-road` does not exist).

- [ ] **Step 3: Swap the scene's road for the new module**

In `app/journey/scene.ts`:

1. Delete the function `flattenAndHeadPlane` with its comment, and the function `createRoad` with its comment (both sit between `createStars` and `createCornerBlocks`).
2. Update imports:
   - From `./contact-shadows`, remove `ROAD_MARKING_RENDER_ORDER` (leave `createContactShadowField, writeLayerShadows`).
   - From `./path`, remove `WAYPOINTS`.
   - Add after the `./random` import: `import { createRoad } from './road'`.
3. Replace `scene.add(createRoad())` with:

```ts
  const road = createRoad(renderer.capabilities.getMaxAnisotropy())
  scene.add(road.group)
```

4. In `apply`, after the line `facade.uLit.value = state.windowLitRatio`, add:

```ts
    road.update(state.wetness, state.skyColor)
```

- [ ] **Step 4: Update the draw-call baseline in `tests/gpu/facade.spec.ts`**

The old road drew 8 meshes (3 surfaces, 3 center lines, 2 joints). The new road draws 3. Under `const LANDMARK_DRAW_CALLS = 4` add:

```ts
// City 08 replaces the 8 road draws (3 surfaces, 3 center lines, 2 joints) with 3: surface, sidewalks, dashes.
const ROAD_DRAW_CALL_DELTA = -5
```

and change the `expectedCalls` line to:

```ts
    const expectedCalls = (lowPower ? [60, 28, 17] : [61, 29, 18]).map(calls => calls + (lowPower ? 0 : LANDMARK_DRAW_CALLS) + 1 + ROAD_DRAW_CALL_DELTA)
```

If city 07 landed first and the line already differs, keep its terms and add `+ ROAD_DRAW_CALL_DELTA`.

- [ ] **Step 5: Run the checks**

Run: `npm test && npm run typecheck`
Expected: PASS.

Run: `npm run test:gpu -- road.spec.ts facade.spec.ts`
Expected: PASS. If a `chapters, mid-transition and restore` test is off by a count other than 5, print `result.frames[n].calls`, subtract the old baseline, and check that the road group has exactly the three meshes the spec lists before touching the constant.

Run: `npm run test:gpu`
Expected: PASS. Other GPU specs (`buildings`, `contact-shadows`, `post`, `sky`, `windows`, `theme-scene`) must stay green. A failure that mentions the road, the sidewalk, or building positions comes from this task or Task 3; fix it here.

Run: `wc -l app/journey/scene.ts`
Expected: fewer than 800 lines.

- [ ] **Step 6: Commit**

```bash
git add app/journey/scene.ts tests/gpu
git commit -m "feat: render the road from the road module with sheen and dashes"
```

---

### Task 7: Reflection layer and mirrored camera

**Files:**
- Create: `app/journey/reflect-layer.ts`
- Create: `app/journey/reflection.ts`
- Test: `tests/journey/reflect-layer.test.ts`, `tests/journey/reflection.test.ts`

**Interfaces:**
- Produces: `REFLECT_LAYER = 1`; `reflectInPuddles(...objects: THREE.Object3D[]): void` (enables layer 1 on each object and its descendants, keeps layer 0); `REFLECT_PLANE_Y = -0.997`; `reflectedCamera(position: Vec3, target: Vec3, up: Vec3, planeY: number): { position: Vec3; target: Vec3; up: Vec3 }`; `applyObliqueClip(projection: THREE.Matrix4, plane: THREE.Vector4, clipBias?: number): void`; `updateReflectionCamera(virtual: THREE.PerspectiveCamera, source: THREE.PerspectiveCamera, planeY?: number): void`.

- [ ] **Step 1: Write the failing tests**

Create `tests/journey/reflect-layer.test.ts`:

```ts
import * as THREE from 'three'
import { expect, it } from 'vitest'
import { REFLECT_LAYER, reflectInPuddles } from '../../app/journey/reflect-layer'

it('opts an object and its descendants into the reflection layer without leaving layer 0', () => {
  const group = new THREE.Group()
  const child = new THREE.Mesh()
  const light = new THREE.DirectionalLight()
  group.add(child)
  reflectInPuddles(group, light)
  const reflection = new THREE.Layers()
  reflection.set(REFLECT_LAYER)
  const main = new THREE.Layers()
  for (const object of [group, child, light]) {
    expect(object.layers.test(reflection)).toBe(true)
    expect(object.layers.test(main)).toBe(true)
  }
})

it('leaves objects that were not listed on layer 0 only', () => {
  const reflection = new THREE.Layers()
  reflection.set(REFLECT_LAYER)
  expect(new THREE.Mesh().layers.test(reflection)).toBe(false)
})
```

Create `tests/journey/reflection.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { REFLECT_LAYER } from '../../app/journey/reflect-layer'
import { REFLECT_PLANE_Y, reflectedCamera, updateReflectionCamera } from '../../app/journey/reflection'

describe('reflectedCamera', () => {
  it('mirrors the position and look-at across the plane and flips the up vector', () => {
    const mirrored = reflectedCamera([1, 0.5, -3], [1, 0.2, -10], [0, 1, 0], REFLECT_PLANE_Y)
    expect(mirrored.position).toEqual([1, 2 * REFLECT_PLANE_Y - 0.5, -3])
    expect(mirrored.target).toEqual([1, 2 * REFLECT_PLANE_Y - 0.2, -10])
    expect(mirrored.up).toEqual([0, -1, 0])
  })

  it('returns the original when applied twice', () => {
    const once = reflectedCamera([2, 1.25, -7], [3, -0.4, -9], [0.1, 0.9, 0.2], REFLECT_PLANE_Y)
    const twice = reflectedCamera(once.position, once.target, once.up, REFLECT_PLANE_Y)
    expect(twice.position[0]).toBeCloseTo(2, 12)
    expect(twice.position[1]).toBeCloseTo(1.25, 12)
    expect(twice.position[2]).toBeCloseTo(-7, 12)
    expect(twice.target[1]).toBeCloseTo(-0.4, 12)
    expect(twice.up).toEqual([0.1, 0.9, 0.2])
  })

  it('leaves points on the plane where they are', () => {
    expect(reflectedCamera([0, REFLECT_PLANE_Y, 0], [4, REFLECT_PLANE_Y, 4], [0, 1, 0], REFLECT_PLANE_Y).position[1])
      .toBeCloseTo(REFLECT_PLANE_Y, 12)
  })
})

describe('updateReflectionCamera', () => {
  function rig() {
    const source = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 260)
    source.position.set(1, 0.5, -3)
    source.lookAt(1, 0.2, -10)
    source.updateMatrixWorld()
    const virtual = new THREE.PerspectiveCamera()
    updateReflectionCamera(virtual, source)
    return { source, virtual }
  }

  it('sits under the plane, mirrored from the source camera', () => {
    const { virtual } = rig()
    expect(virtual.position.x).toBeCloseTo(1, 9)
    expect(virtual.position.y).toBeCloseTo(2 * REFLECT_PLANE_Y - 0.5, 9)
    expect(virtual.position.z).toBeCloseTo(-3, 9)
    expect(virtual.far).toBe(260)
  })

  it('keeps the horizontal projection rows and replaces the depth row with the clip plane', () => {
    const { source, virtual } = rig()
    for (const i of [0, 5, 8, 9, 11]) expect(virtual.projectionMatrix.elements[i]).toBe(source.projectionMatrix.elements[i])
    expect(virtual.projectionMatrix.elements[10]).not.toBe(source.projectionMatrix.elements[10])
  })

  it('maps points on the plane to the near plane and clips points below it', () => {
    const { virtual } = rig()
    const ndcZ = (y: number) => {
      const clip = new THREE.Vector4(1.5, y, -8, 1).applyMatrix4(virtual.matrixWorldInverse).applyMatrix4(virtual.projectionMatrix)
      return clip.z / clip.w
    }
    expect(ndcZ(REFLECT_PLANE_Y)).toBeCloseTo(-1, 5)
    expect(ndcZ(0.5)).toBeGreaterThan(-1)
    expect(ndcZ(-3)).toBeLessThan(-1)
  })

  it('can be called every frame without drifting', () => {
    const { source, virtual } = rig()
    const first = virtual.projectionMatrix.clone()
    for (let i = 0; i < 5; i++) updateReflectionCamera(virtual, source)
    expect(virtual.projectionMatrix.equals(first)).toBe(true)
    virtual.layers.set(REFLECT_LAYER)
    expect(virtual.layers.mask).toBe(1 << REFLECT_LAYER)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/journey/reflect-layer.test.ts tests/journey/reflection.test.ts`
Expected: FAIL, because neither module exists.

- [ ] **Step 3: Write the modules**

Create `app/journey/reflect-layer.ts`:

```ts
import type * as THREE from 'three'

// The reflection camera renders only this layer. Objects stay on layer 0 for the main camera.
export const REFLECT_LAYER = 1

// The one place that decides what puddles reflect. r186 filters lights by the rendering camera's layers too,
// so lights belong in this list: a lit material in the reflection is black without them.
export function reflectInPuddles(...objects: THREE.Object3D[]): void {
  for (const object of objects) object.traverse(child => child.layers.enable(REFLECT_LAYER))
}
```

Create `app/journey/reflection.ts`:

```ts
import * as THREE from 'three'
import type { Vec3 } from './stops'

// 3 mm above the road (-1). The ground is at -1.01 and the shadow quads at -0.995.
export const REFLECT_PLANE_Y = -0.997

export interface ReflectedCamera {
  position: Vec3
  target: Vec3
  up: Vec3
}

// Mirror a camera across the horizontal plane y = planeY. Points mirror; the up direction only flips in y.
export function reflectedCamera(position: Vec3, target: Vec3, up: Vec3, planeY: number): ReflectedCamera {
  return {
    position: [position[0], 2 * planeY - position[1], position[2]],
    target: [target[0], 2 * planeY - target[1], target[2]],
    up: [up[0], -up[1], up[2]],
  }
}

const clipScratch = new THREE.Vector4()
const q = new THREE.Vector4()

// Lengyel's oblique near-plane clipping (the maths in three's Reflector), perspective cameras only. `plane` is in
// the camera's view space; geometry on its negative side is clipped. Rewrites the depth row of `projection`.
export function applyObliqueClip(projection: THREE.Matrix4, plane: THREE.Vector4, clipBias = 0): void {
  const e = projection.elements
  q.set(
    (Math.sign(plane.x) + e[8]!) / e[0]!,
    (Math.sign(plane.y) + e[9]!) / e[5]!,
    -1,
    (1 + e[10]!) / e[14]!,
  )
  clipScratch.copy(plane).multiplyScalar(2 / plane.dot(q))
  e[2] = clipScratch.x
  e[6] = clipScratch.y
  e[10] = clipScratch.z + 1 - clipBias
  e[14] = clipScratch.w
}

const sourcePosition = new THREE.Vector3()
const sourceForward = new THREE.Vector3()
const sourceUp = new THREE.Vector3()
const plane = new THREE.Plane()
const upAxis = new THREE.Vector3(0, 1, 0)

// Points `virtual` at the mirror image of `source`, copies its lens, and clips everything under the plane.
// The image is upside down by design (the up vector is mirrored); the overlay's texture matrix undoes that.
export function updateReflectionCamera(
  virtual: THREE.PerspectiveCamera, source: THREE.PerspectiveCamera, planeY = REFLECT_PLANE_Y,
): void {
  source.updateMatrixWorld()
  sourcePosition.setFromMatrixPosition(source.matrixWorld)
  sourceForward.set(0, 0, -1).transformDirection(source.matrixWorld)
  sourceUp.set(0, 1, 0).transformDirection(source.matrixWorld)
  const mirrored = reflectedCamera(
    [sourcePosition.x, sourcePosition.y, sourcePosition.z],
    [sourcePosition.x + sourceForward.x, sourcePosition.y + sourceForward.y, sourcePosition.z + sourceForward.z],
    [sourceUp.x, sourceUp.y, sourceUp.z],
    planeY,
  )
  virtual.position.set(...mirrored.position)
  virtual.up.set(...mirrored.up)
  virtual.lookAt(...mirrored.target)
  virtual.near = source.near
  virtual.far = source.far
  virtual.projectionMatrix.copy(source.projectionMatrix)
  virtual.projectionMatrixInverse.copy(source.projectionMatrixInverse)
  virtual.updateMatrixWorld()
  plane.set(upAxis, -planeY).applyMatrix4(virtual.matrixWorldInverse)
  clipScratch.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
  applyObliqueClip(virtual.projectionMatrix, clipScratch)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/journey/reflect-layer.test.ts tests/journey/reflection.test.ts`
Expected: PASS.

If the NDC test fails with `ndcZ(REFLECT_PLANE_Y)` far from -1, the clip plane's sign is wrong: the plane normal must point up in world space (the side to keep) before it is moved into view space.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/journey/reflect-layer.ts app/journey/reflection.ts tests/journey/reflect-layer.test.ts tests/journey/reflection.test.ts
git commit -m "feat: add reflection layer and mirrored camera with oblique clip"
```

---

### Task 8: The reflection overlay and pass

**Files:**
- Create: `app/journey/wet-road.ts`
- Modify: `app/journey/post.ts` (export `preservingState`)
- Create: `tests/journey/wet-road.test.ts`
- Create: `tests/gpu/wet-road-probe.ts`
- Create: `tests/gpu/wet-road.spec.ts`
- Modify: `tests/gpu/harness.ts`

**Interfaces:**
- Consumes: `PUDDLE_GLSL` (Task 4); `roadRects` (Task 2); `REFLECT_LAYER` (Task 7); `REFLECT_PLANE_Y`, `updateReflectionCamera` (Task 7); `preservingState`, `probePostSupport` (post.ts); `findPuddlePoint`, `insideRects`, `topDownCamera`, `topDownPixel` (Task 6 probe); `createRoad`, `ROAD_Y` (Task 5).
- Produces:

```ts
export const WET_ROAD_NAME = 'journey-wet-road'
export const WET_MIN = 0.02            // below or at this wetness the pass does not run and the overlay is hidden
export const WET_WARMUP = 0.5          // wetness used to force the overlay programs to compile at startup
export const REFLECTION_SCALE = 0.5    // target size relative to the drawing buffer
export const PASS_DRAW_CALL_BUDGET = 16
export function overlayPlacement(): { center: [number, number, number]; size: [number, number] }
export interface WetRoadStats { passes: number; lastDrawCalls: number }
export interface WetRoadOptions { checkComplete?: (renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) => boolean }
export interface WetRoad {
  readonly overlay: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>  // name WET_ROAD_NAME, userData.wetRoad = this
  readonly target: THREE.WebGLRenderTarget
  readonly stats: WetRoadStats
  enabled: boolean                       // false hides the overlay and skips the pass (test seam)
  setLook(wetness: number, fogDensity: number): void
  setSize(drawingWidth: number, drawingHeight: number): void
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void
  dispose(): void
}
export function createWetRoad(renderer: THREE.WebGLRenderer, options?: WetRoadOptions): WetRoad | null
```

Debug defines on the overlay material: `WET_DEBUG_COVERAGE` (every on-road fragment is opaque red) and `WET_DEBUG_FLOOD` (puddle mask forced to 1 and the distortion switched off, so geometry can be checked exactly).

- [ ] **Step 1: Write the unit test**

Create `tests/journey/wet-road.test.ts`:

```ts
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
```

- [ ] **Step 2: Write the GPU probe and spec**

Create `tests/gpu/wet-road-probe.ts`:

```ts
import * as THREE from 'three'
import { type Rect, roadRects } from '../../app/journey/path'
import { reflectInPuddles, REFLECT_LAYER } from '../../app/journey/reflect-layer'
import { REFLECT_PLANE_Y } from '../../app/journey/reflection'
import { createRoad } from '../../app/journey/road'
import { createGround } from '../../app/journey/skyline-far'
import { createWetRoad, type WetRoad } from '../../app/journey/wet-road'
import { createTestRenderer, readFrame, readPixel } from './gpu-utils'
import { findPuddlePoint, insideRects, topDownCamera, topDownPixel } from './road-probe'

const WIDTH = 320
const HEIGHT = 180
const BACKGROUND = 0x101828
const OVERLAY_BOUNDS = { minX: -33, maxX: 7, minZ: -70, maxZ: 12 }
// Linear HDR, warm: far above 1 so even a faint alpha saturates the 8-bit pixel.
const WARM_MARKER: [number, number, number] = [3, 2, 0.8]

interface Rig {
  ctx: ReturnType<typeof createTestRenderer>
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  wetRoad: WetRoad
  setWetness(wetness: number, fogDensity?: number): void
  frame(): void
  center(): number[]
  dispose(): void
}

function createRig(): Rig {
  const ctx = createTestRenderer({ width: WIDTH, height: HEIGHT })
  const { renderer, recorder } = ctx
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND)
  scene.fog = new THREE.FogExp2(BACKGROUND, 0.02)
  const road = createRoad(renderer.capabilities.getMaxAnisotropy())
  scene.add(road.group)
  const wetRoad = createWetRoad(renderer)
  if (!wetRoad) {
    ctx.dispose()
    throw new Error('The wet road is unavailable in this browser')
  }
  scene.add(wetRoad.overlay)
  const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 260)
  return {
    ctx, scene, camera, wetRoad,
    setWetness(wetness, fogDensity = 0) {
      road.update(wetness, [0, 0, 0]) // black sky tint: the road's own sheen adds nothing to the pixels under test
      wetRoad.setLook(wetness, fogDensity)
    },
    frame() {
      camera.updateMatrixWorld()
      wetRoad.render(scene, camera)
      renderer.render(scene, camera)
      recorder.assertClean()
    },
    center: () => readPixel(renderer, WIDTH / 2, HEIGHT / 2),
    dispose: () => ctx.dispose(),
  }
}

// Camera low over a puddle, looking at it. Returns the puddle point.
function aimAtPuddle(rig: Rig): { x: number; z: number } {
  const point = findPuddlePoint()
  rig.camera.position.set(point.x, 0.5, point.z + 8)
  rig.camera.lookAt(point.x, REFLECT_PLANE_Y, point.z)
  return point
}

// The point whose mirror image, seen from `camera`, lands on `point`: along the reflected ray, `distance` past it.
function mirrorImageSource(camera: THREE.Vector3, point: { x: number; z: number }, distance = 4): THREE.Vector3 {
  const ray = new THREE.Vector3(point.x - camera.x, REFLECT_PLANE_Y - camera.y, point.z - camera.z).normalize()
  return new THREE.Vector3(point.x, REFLECT_PLANE_Y, point.z).add(new THREE.Vector3(ray.x, -ray.y, ray.z).multiplyScalar(distance))
}

function marker(position: THREE.Vector3, size: number, color: [number, number, number]): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({ fog: false })
  material.color.setRGB(...color)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material)
  mesh.position.copy(position)
  return mesh
}

function probeReflection() {
  const rig = createRig()
  try {
    const point = aimAtPuddle(rig)
    const box = marker(mirrorImageSource(rig.camera.position, point), 1.2, WARM_MARKER)
    rig.scene.add(box)
    reflectInPuddles(box)

    rig.setWetness(0); rig.frame()
    const dry = rig.center()
    rig.setWetness(0.7); rig.frame()
    const wet = rig.center()

    rig.setWetness(0.02)
    const passesBefore = rig.wetRoad.stats.passes
    rig.frame()
    const intro = rig.center()
    const passesAfter = rig.wetRoad.stats.passes

    rig.setWetness(0.7, 0.5); rig.frame()
    const fogged = rig.center()

    box.layers.disable(REFLECT_LAYER) // main camera only: a decoy that must not appear in the puddle
    rig.setWetness(0.7); rig.frame()
    const decoy = rig.center()

    rig.scene.remove(box); rig.frame()
    const withoutMarker = rig.center()
    return { dry, wet, intro, fogged, decoy, withoutMarker, passesBefore, passesAfter,
      shaderError: rig.ctx.recorder.error?.message ?? null, glError: rig.ctx.renderer.getContext().getError() }
  } finally {
    rig.dispose()
  }
}

function probeLights() {
  const rig = createRig()
  try {
    const point = aimAtPuddle(rig)
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }))
    box.position.copy(mirrorImageSource(rig.camera.position, point))
    const sun = new THREE.DirectionalLight(0xffffff, 3)
    sun.position.set(0, 2, 6) // shines on the +z face, the face the reflection ray hits
    rig.scene.add(box, sun)
    reflectInPuddles(box, sun)
    rig.setWetness(0.7)
    rig.frame()
    const lit = rig.center()
    sun.layers.disable(REFLECT_LAYER) // the light stays in the main scene only
    rig.frame()
    const unlit = rig.center()
    return { lit, unlit, shaderError: rig.ctx.recorder.error?.message ?? null, glError: rig.ctx.renderer.getContext().getError() }
  } finally {
    rig.dispose()
  }
}

// Top-down render of the overlay alone with every on-road fragment forced to opaque red.
function probeCoverage() {
  const width = (OVERLAY_BOUNDS.maxX - OVERLAY_BOUNDS.minX) * 10
  const height = (OVERLAY_BOUNDS.maxZ - OVERLAY_BOUNDS.minZ) * 10
  const ctx = createTestRenderer({ width, height })
  try {
    const { renderer, recorder } = ctx
    renderer.toneMapping = THREE.NoToneMapping
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    const wetRoad = createWetRoad(renderer)
    if (!wetRoad) throw new Error('The wet road is unavailable in this browser')
    wetRoad.overlay.material.defines = { WET_DEBUG_COVERAGE: 1 }
    wetRoad.overlay.material.needsUpdate = true
    wetRoad.setLook(0.7, 0)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x000000)
    scene.add(wetRoad.overlay)
    renderer.render(scene, topDownCamera(OVERLAY_BOUNDS))
    recorder.assertClean()
    const rects = roadRects()
    const joints: Rect[] = rects.slice(3)
    const inside: [number, number][] = [[2.8, -28.8]]
    for (const [minX, minZ, maxX, maxZ] of joints) {
      for (const x of [minX + 0.05, maxX - 0.05]) for (const z of [minZ + 0.05, maxZ - 0.05]) inside.push([x, z])
    }
    // Just outside the squares and the leg rectangles.
    const outside: [number, number][] = [[3.1, -20], [3.05, -29.05], [-1, -29.1], [-22.95, -29.05], [-29.05, -30]]
    const cases = [...inside, ...outside].map(([x, z]) => {
      const { px, py } = topDownPixel(x, z, height, OVERLAY_BOUNDS)
      return { x, z, insideRoad: insideRects(rects, x, z), pixel: readPixel(renderer, px, py) }
    })
    wetRoad.dispose()
    return { cases, shaderError: recorder.error?.message ?? null, glError: renderer.getContext().getError() }
  } finally {
    ctx.dispose()
  }
}

const MIRROR_CASES = [
  { name: 'leg 1', camera: [0, 0.5, -6], dir: [0, 0, -1] },
  { name: 'leg 2', camera: [-8, 0.5, -26], dir: [-1, 0, 0] },
  { name: 'leg 3', camera: [-26, 0.5, -40], dir: [0, 0, -1] },
  { name: 'joint', camera: [-1, 0.5, -24.5], dir: [0, 0, -1] },
] as const

// A small bright box beside the camera's heading. Its reflection must land where the mirror law puts it, whichever
// way the leg runs: one shared overlay and one texture matrix must serve all three rotated legs and the joints.
function probeMirror(index: number) {
  const mirrorCase = MIRROR_CASES[index]
  if (!mirrorCase) throw new Error(`Unknown mirror case ${index}`)
  const rig = createRig()
  try {
    rig.wetRoad.overlay.material.defines = { WET_DEBUG_FLOOD: 1 }
    rig.wetRoad.overlay.material.needsUpdate = true
    rig.setWetness(0.7)
    const cam = new THREE.Vector3(...mirrorCase.camera)
    const dir = new THREE.Vector3(...mirrorCase.dir)
    const right = dir.clone().cross(new THREE.Vector3(0, 1, 0))
    rig.camera.position.copy(cam)
    rig.camera.lookAt(cam.clone().addScaledVector(dir, 5).setY(-0.5))
    const center = cam.clone().addScaledVector(dir, 5).addScaledVector(right, 2.2).setY(0.2)
    const box = marker(center, 0.3, [30, 0, 0])
    rig.scene.add(box)
    reflectInPuddles(box)

    rig.frame()
    const withReflection = readFrame(rig.ctx.renderer)
    box.layers.disable(REFLECT_LAYER)
    rig.frame()
    const mainOnly = readFrame(rig.ctx.renderer)

    let count = 0, sumX = 0, sumY = 0
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      if (Math.abs(withReflection[i * 4]! - mainOnly[i * 4]!) <= 100) continue
      count++
      sumX += (i % WIDTH) + 0.5
      sumY += Math.floor(i / WIDTH) + 0.5
    }
    const image = new THREE.Vector3(center.x, 2 * REFLECT_PLANE_Y - center.y, center.z)
    const t = (REFLECT_PLANE_Y - cam.y) / (image.y - cam.y)
    const hit = cam.clone().lerp(image, t)
    rig.camera.updateMatrixWorld()
    const ndc = image.clone().project(rig.camera)
    return {
      name: mirrorCase.name,
      hitOnRoad: insideRects(roadRects(), hit.x, hit.z),
      predicted: [(ndc.x * 0.5 + 0.5) * WIDTH, (ndc.y * 0.5 + 0.5) * HEIGHT],
      centroid: count > 0 ? [sumX / count, sumY / count] : null,
      count,
      shaderError: rig.ctx.recorder.error?.message ?? null,
      glError: rig.ctx.renderer.getContext().getError(),
    }
  } finally {
    rig.dispose()
  }
}

function probeRoadOnly() {
  const rig = createRig()
  try {
    rig.scene.add(createGround(), new THREE.HemisphereLight(0xffffff, 0x556677, 1))
    const point = findPuddlePoint()
    rig.camera.position.set(point.x + 7, 5, point.z + 6)
    rig.camera.lookAt(point.x + 2, -1, point.z - 3)
    rig.camera.updateMatrixWorld()
    rig.setWetness(0.7)
    const spots = {
      road: new THREE.Vector3(point.x, REFLECT_PLANE_Y, point.z),
      sidewalk: new THREE.Vector3(3.45, -0.85, point.z - 1),
      ground: new THREE.Vector3(8, -1.01, point.z - 3),
    }
    const pixelOf = (name: keyof typeof spots): [number, number] => {
      const ndc = spots[name].clone().project(rig.camera)
      if (Math.abs(ndc.x) > 0.95 || Math.abs(ndc.y) > 0.95) throw new Error(`${name} sample is outside the view; move the camera`)
      return [Math.floor((ndc.x * 0.5 + 0.5) * WIDTH), Math.floor((ndc.y * 0.5 + 0.5) * HEIGHT)]
    }
    const pixels = { road: pixelOf('road'), sidewalk: pixelOf('sidewalk'), ground: pixelOf('ground') }
    const read = () => ({
      road: readPixel(rig.ctx.renderer, ...pixels.road),
      sidewalk: readPixel(rig.ctx.renderer, ...pixels.sidewalk),
      ground: readPixel(rig.ctx.renderer, ...pixels.ground),
    })
    rig.wetRoad.enabled = true; rig.frame()
    const on = read()
    rig.wetRoad.enabled = false; rig.frame()
    const off = read()
    return { on, off, shaderError: rig.ctx.recorder.error?.message ?? null, glError: rig.ctx.renderer.getContext().getError() }
  } finally {
    rig.dispose()
  }
}

function snapshot(rig: Rig) {
  const { renderer } = rig.ctx
  const visibility: Record<string, boolean> = {}
  rig.scene.traverse(object => { if (object.name !== 'thrower') visibility[object.uuid] = object.visible })
  return {
    targetIsNull: renderer.getRenderTarget() === null,
    autoClear: renderer.autoClear,
    clearAlpha: renderer.getClearAlpha(),
    clearColor: renderer.getClearColor(new THREE.Color()).getHex(),
    clippingPlanes: renderer.clippingPlanes.length,
    localClipping: renderer.localClippingEnabled,
    scissorTest: renderer.getScissorTest(),
    viewport: renderer.getViewport(new THREE.Vector4()).toArray(),
    visibility,
  }
}

function probeHygiene() {
  const rig = createRig()
  try {
    aimAtPuddle(rig)
    rig.setWetness(0.7)
    rig.camera.updateMatrixWorld()
    const before = snapshot(rig)
    rig.wetRoad.render(rig.scene, rig.camera)
    const afterPass = snapshot(rig)

    const thrower = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    thrower.name = 'thrower'
    thrower.onBeforeRender = () => { throw new Error('forced reflection failure') }
    reflectInPuddles(thrower)
    rig.scene.add(thrower)
    let message: string | null = null
    try { rig.wetRoad.render(rig.scene, rig.camera) } catch (error) { message = error instanceof Error ? error.message : String(error) }
    const afterThrow = snapshot(rig)
    rig.scene.remove(thrower)

    rig.frame() // the next normal frame must render without errors
    return { before, afterPass, afterThrow, message, shaderError: rig.ctx.recorder.error?.message ?? null,
      glError: rig.ctx.renderer.getContext().getError() }
  } finally {
    rig.dispose()
  }
}

function probeForcedFailure() {
  const ctx = createTestRenderer({ width: 160, height: 90 })
  try {
    const failed = createWetRoad(ctx.renderer, { checkComplete: () => false })
    const gl = ctx.renderer.getContext()
    const failure = { isNull: failed === null, targetIsNull: ctx.renderer.getRenderTarget() === null, glError: gl.getError() }
    const working = createWetRoad(ctx.renderer)
    const success = { isNull: working === null, glError: gl.getError() }
    working?.dispose()
    return { failure, success, shaderError: ctx.recorder.error?.message ?? null }
  } finally {
    ctx.dispose()
  }
}

export const wetRoadProbe = {
  probeReflection, probeLights, probeCoverage, probeMirror, probeRoadOnly, probeHygiene, probeForcedFailure,
}
```

Create `tests/gpu/wet-road.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

const sum = (pixel: number[]) => pixel[0]! + pixel[1]! + pixel[2]!

test('a puddle shows a warm lit marker that wetness 0 does not', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeReflection())
  expect(r.shaderError).toBeNull()
  expect(r.glError).toBe(0)
  // Brighter and warmer than the dry road, and brighter than the same puddle without the marker.
  expect(sum(r.wet)).toBeGreaterThan(sum(r.dry) + 40)
  expect(r.wet[0]! - r.wet[2]!).toBeGreaterThan(r.dry[0]! - r.dry[2]! + 20)
  expect(sum(r.wet)).toBeGreaterThan(sum(r.withoutMarker) + 40)
})

test('only objects on the reflection layer appear in the puddle', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeReflection())
  for (let i = 0; i < 3; i++) expect(Math.abs(r.decoy[i]! - r.withoutMarker[i]!)).toBeLessThanOrEqual(1)
})

test('at wetness 0.02 the pass does not run and the pixel matches the dry road', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeReflection())
  expect(r.passesAfter).toBe(r.passesBefore)
  for (let i = 0; i < 3; i++) expect(Math.abs(r.intro[i]! - r.dry[i]!)).toBeLessThanOrEqual(1)
})

test('a puddle fades into the fog instead of shining at the horizon', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeReflection())
  for (let i = 0; i < 3; i++) expect(Math.abs(r.fogged[i]! - r.dry[i]!)).toBeLessThanOrEqual(3)
})

test('lights on the reflection layer light the reflected surface; lights left on layer 0 do not', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeLights())
  expect(r.shaderError).toBeNull()
  expect(r.glError).toBe(0)
  expect(sum(r.lit)).toBeGreaterThan(sum(r.unlit) + 25)
})

test('the overlay covers the road rectangles, the joint corners, and nothing past them', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeCoverage())
  expect(r.shaderError).toBeNull()
  expect(r.glError).toBe(0)
  expect(r.cases.filter(c => c.insideRoad).length).toBe(9) // 8 joint corners and (2.8, -28.8)
  for (const c of r.cases) {
    if (c.insideRoad) expect(c.pixel[0], `(${c.x}, ${c.z}) should be covered`).toBeGreaterThan(200)
    else expect(c.pixel[0], `(${c.x}, ${c.z}) should be bare`).toBeLessThan(30)
  }
})

for (const index of [0, 1, 2, 3]) {
  test(`reflections line up with the mirror image (case ${index})`, async ({ page }) => {
    const r = await page.evaluate(i => window.cityGpu.wetRoad.probeMirror(i), index)
    expect(r.shaderError).toBeNull()
    expect(r.glError).toBe(0)
    expect(r.hitOnRoad, `${r.name}: the reflection point must lie on the road`).toBe(true)
    expect(r.count, `${r.name}: the reflected marker should be visible`).toBeGreaterThan(10)
    expect(Math.abs(r.centroid![0]! - r.predicted[0]!), `${r.name} x`).toBeLessThanOrEqual(2)
    expect(Math.abs(r.centroid![1]! - r.predicted[1]!), `${r.name} y`).toBeLessThanOrEqual(2)
  })
}

test('the overlay changes road pixels only: ground and sidewalk are identical with it on and off', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeRoadOnly())
  expect(r.shaderError).toBeNull()
  expect(r.glError).toBe(0)
  expect(r.on.ground).toEqual(r.off.ground)
  expect(r.on.sidewalk).toEqual(r.off.sidewalk)
  expect(r.on.road).not.toEqual(r.off.road)
})

test('the pass restores renderer state, even when a render throws, and the next frame is clean', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeHygiene())
  expect(r.afterPass).toEqual(r.before)
  expect(r.message).toBe('forced reflection failure')
  expect(r.afterThrow).toEqual(r.before)
  expect(r.shaderError).toBeNull()
  expect(r.glError).toBe(0)
})

test('a target that fails the framebuffer check gives null, no pending GL error, and a working retry', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeForcedFailure())
  expect(r.failure).toEqual({ isNull: true, targetIsNull: true, glError: 0 })
  expect(r.success).toEqual({ isNull: false, glError: 0 })
  expect(r.shaderError).toBeNull()
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- tests/journey/wet-road.test.ts`
Expected: FAIL, because `wet-road.ts` does not exist.

The GPU spec cannot run yet: the probe is not registered in the harness. That is the red state for the GPU tests (`cityGpu.wetRoad` is undefined).

- [ ] **Step 4: Export the render-state helper**

In `app/journey/post.ts`, change `function preservingState<T>(` to `export function preservingState<T>(`.

- [ ] **Step 5: Write the module**

Create `app/journey/wet-road.ts`:

```ts
import * as THREE from 'three'
import { PUDDLE_GLSL } from './asphalt'
import { roadRects } from './path'
import { preservingState, probePostSupport } from './post'
import { REFLECT_LAYER } from './reflect-layer'
import { REFLECT_PLANE_Y, updateReflectionCamera } from './reflection'

export const WET_ROAD_NAME = 'journey-wet-road'
// At or below this wetness the pass does not run and the overlay is hidden (the intro chapter, and the whole light theme).
export const WET_MIN = 0.02
export const WET_WARMUP = 0.5
export const REFLECTION_SCALE = 0.5
export const PASS_DRAW_CALL_BUDGET = 16
// Before the shadow quads (renderOrder 1), set on the mesh, not the material.
const OVERLAY_RENDER_ORDER = 0.5
const OVERLAY_MARGIN = 4
const ROAD_RECT_COUNT = 5

// The overlay is one flat quad over the whole road: the road bounding box plus a margin on every side.
export function overlayPlacement(): { center: [number, number, number]; size: [number, number] } {
  const rects = roadRects()
  const minX = Math.min(...rects.map(r => r[0])) - OVERLAY_MARGIN
  const minZ = Math.min(...rects.map(r => r[1])) - OVERLAY_MARGIN
  const maxX = Math.max(...rects.map(r => r[2])) + OVERLAY_MARGIN
  const maxZ = Math.max(...rects.map(r => r[3])) + OVERLAY_MARGIN
  return { center: [(minX + maxX) / 2, REFLECT_PLANE_Y, (minZ + maxZ) / 2], size: [maxX - minX, maxZ - minZ] }
}

const vertexShader = `
uniform mat4 textureMatrix;
varying vec2 vWorldXZ;
varying float vViewDepth;
varying vec4 vReflUv;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vWorldXZ = world.xz;
  vViewDepth = -view.z;
  vReflUv = textureMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
}`

// Linear HDR out, no tone-mapping or color-space chunks: the composer's OutputPass maps the whole frame.
const fragmentShader = `
uniform sampler2D tDiffuse;
uniform vec4 uRects[${ROAD_RECT_COUNT}];
uniform float uWetness;
uniform float uFogDensity;
varying vec2 vWorldXZ;
varying float vViewDepth;
varying vec4 vReflUv;
${PUDDLE_GLSL}
void main() {
  bool onRoad = false;
  for (int i = 0; i < ${ROAD_RECT_COUNT}; i++) {
    vec4 r = uRects[i];
    if (vWorldXZ.x >= r.x && vWorldXZ.y >= r.y && vWorldXZ.x <= r.z && vWorldXZ.y <= r.w) onRoad = true;
  }
  if (!onRoad) discard;
#ifdef WET_DEBUG_COVERAGE
  gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
  return;
#endif
  float wetAmt = uWetness * puddleMask(vWorldXZ);
  float distortion = (puddleNoise(vWorldXZ * 3.0) - 0.5) * 0.02;
#ifdef WET_DEBUG_FLOOD
  wetAmt = 1.0;
  distortion = 0.0;
#endif
  vec3 reflected = texture2D(tDiffuse, vReflUv.xy / vReflUv.w + distortion).rgb;
  vec3 V = normalize(cameraPosition - vec3(vWorldXZ.x, ${REFLECT_PLANE_Y}, vWorldXZ.y));
  float fresnel = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
  float fogFactor = 1.0 - exp(-pow(uFogDensity * vViewDepth, 2.0));
  float alpha = mix(0.1, 0.9, fresnel) * wetAmt * (1.0 - fogFactor);
  gl_FragColor = vec4(reflected, alpha);
}`

export interface WetRoadStats {
  passes: number
  lastDrawCalls: number
}

export interface WetRoadOptions {
  // Test seam: replaces the framebuffer-completeness check of the freshly allocated target.
  checkComplete?: (renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) => boolean
}

export interface WetRoad {
  readonly overlay: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  readonly target: THREE.WebGLRenderTarget
  readonly stats: WetRoadStats
  enabled: boolean
  setLook(wetness: number, fogDensity: number): void
  setSize(drawingWidth: number, drawingHeight: number): void
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void
  dispose(): void
}

function drainErrors(gl: WebGL2RenderingContext): void {
  while (gl.getError() !== gl.NO_ERROR) if (gl.isContextLost()) return
}

// Allocation is lazy, so a target built without error can still fail on first use. Bind it and ask.
function targetComplete(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): boolean {
  const gl = renderer.getContext() as WebGL2RenderingContext
  renderer.setRenderTarget(target)
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  renderer.setRenderTarget(null)
  return complete
}

const scaled = (size: number) => Math.max(1, Math.floor(size * REFLECTION_SCALE))
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)

// Returns null when the reflection is unavailable (no HDR targets, or the target is incomplete); the caller then
// keeps Parts A and B. Shader and JS failures propagate to the scene's unavailable guard.
export function createWetRoad(renderer: THREE.WebGLRenderer, options: WetRoadOptions = {}): WetRoad | null {
  if (!probePostSupport(renderer)) return null
  const gl = renderer.getContext() as WebGL2RenderingContext
  const drawing = renderer.getDrawingBufferSize(new THREE.Vector2())
  const target = new THREE.WebGLRenderTarget(scaled(drawing.x), scaled(drawing.y), {
    type: THREE.HalfFloatType, depthBuffer: true,
  })
  if (!(options.checkComplete ?? targetComplete)(renderer, target)) {
    target.dispose()
    renderer.setRenderTarget(null)
    drainErrors(gl)
    return null
  }

  const textureMatrix = new THREE.Matrix4()
  const uniforms = {
    tDiffuse: { value: target.texture },
    textureMatrix: { value: textureMatrix },
    uRects: { value: roadRects().map(([minX, minZ, maxX, maxZ]) => new THREE.Vector4(minX, minZ, maxX, maxZ)) },
    uWetness: { value: 0 },
    uFogDensity: { value: 0 },
  }
  const material = new THREE.ShaderMaterial({
    name: WET_ROAD_NAME, uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, fog: false,
    // The overlay floats 3 mm above the road; depth precision is coarser than that past about 60 units.
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  material.customProgramCacheKey = () =>
    `wet-road-${material.defines?.WET_DEBUG_COVERAGE ?? 0}-${material.defines?.WET_DEBUG_FLOOD ?? 0}`

  const { center, size } = overlayPlacement()
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material)
  overlay.rotation.x = -Math.PI / 2
  overlay.position.set(...center)
  overlay.updateMatrixWorld(true)
  overlay.name = WET_ROAD_NAME
  overlay.renderOrder = OVERLAY_RENDER_ORDER
  overlay.frustumCulled = false
  overlay.visible = false

  const virtual = new THREE.PerspectiveCamera()
  virtual.layers.set(REFLECT_LAYER)
  const stats: WetRoadStats = { passes: 0, lastDrawCalls: 0 }
  let enabled = true

  const wetRoad: WetRoad = {
    overlay, target, stats,
    get enabled() { return enabled },
    set enabled(value: boolean) {
      enabled = value
      overlay.visible = enabled && uniforms.uWetness.value > WET_MIN
    },
    setLook(wetness, fogDensity) {
      uniforms.uWetness.value = wetness
      uniforms.uFogDensity.value = fogDensity
      overlay.visible = enabled && wetness > WET_MIN
    },
    setSize(drawingWidth, drawingHeight) {
      target.setSize(scaled(drawingWidth), scaled(drawingHeight))
    },
    render(scene, camera) {
      if (!overlay.visible) return
      updateReflectionCamera(virtual, camera)
      textureMatrix.copy(BIAS).multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse).multiply(overlay.matrixWorld)
      // Every frame: cars move, windows flicker, and a resize or context restore leaves a new target empty.
      preservingState(renderer, () => {
        renderer.setRenderTarget(target)
        renderer.autoClear = true
        renderer.render(scene, virtual)
        stats.lastDrawCalls = renderer.info.render.calls
      })
      stats.passes += 1
    },
    dispose() {
      target.dispose()
      overlay.geometry.dispose()
      material.dispose()
    },
  }
  overlay.userData.wetRoad = wetRoad
  return wetRoad
}
```

- [ ] **Step 6: Register the probe in the harness**

In `tests/gpu/harness.ts`, add `import { wetRoadProbe } from './wet-road-probe'` after the `windows-probe` import, and add `wetRoad: wetRoadProbe,` after `road: roadProbe,`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- tests/journey/wet-road.test.ts`
Expected: PASS.

Run: `npm run test:gpu -- wet-road.spec.ts`
Expected: PASS. Software WebGL is slow; each test takes a few seconds.

Likely failures and where to look:
- `probeMirror` centroid off by more than 2 pixels in every case: the texture matrix. `BIAS * projection * view * overlay.matrixWorld` must use the virtual camera after `updateReflectionCamera`, and the multiplication order matters.
- `probeMirror` off in only the leg 2 case: the overlay's `matrixWorld` was not updated before the first render (`overlay.updateMatrixWorld(true)` in `createWetRoad`).
- `probeCoverage` shows red outside the road: the `uRects` order or the `vWorldXZ` varying. `vWorldXZ.y` is world Z.
- `probeLights` lit equals unlit: the light is missing from the virtual camera's layers (`reflectInPuddles(sun)`).
- A threshold failure with correct geometry (for example `sum(r.wet)` exceeds the dry pixel by only 30): print the pixels. Change a threshold only when the pixels show the effect clearly present, and record the measured values in the test comment.

Run: `npm run test:gpu`
Expected: PASS. The new probe adds shader programs; the other specs must be unaffected.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/journey/wet-road.ts app/journey/post.ts tests/journey/wet-road.test.ts tests/gpu
git commit -m "feat: add the wet road reflection overlay and pass"
```

---

### Task 9: Wire the reflection into the scene

**Files:**
- Modify: `app/journey/scene.ts`
- Modify: `tests/gpu/harness.ts` (`directPipeline` and `failWetRoadTarget` mount options)
- Modify: `tests/gpu/road.spec.ts`
- Modify: `tests/gpu/facade.spec.ts`

**Interfaces:**
- Consumes: `createWetRoad`, `WetRoad`, `WetRoadOptions`, `WET_WARMUP` (Task 8); `reflectInPuddles` (Task 7); `LookState.wetness` (Task 1).
- Produces: `JourneySceneOptions.wetRoad?: WetRoadOptions` (test seam); scene child `journey-wet-road` when the reflection is available; `overlay.userData.wetRoad` reachable from GPU tests. The reflection layer holds: building boxes, spires and beacons, the sky dome, the corner blocks, the stars, and both lights. City 07's lamps and cars join it in its own plan (Step 6).

- [ ] **Step 1: Write the failing GPU tests**

In `tests/gpu/harness.ts`, extend the `mountJourney` options type and body. The signature line becomes:

```ts
  mountJourney(options: { tier: 'full' | 'lite' | 'reduced'; lowPower: boolean; width?: number; height?: number; initialDark?: boolean;
    directPipeline?: boolean; failWetRoadTarget?: boolean },
```

Replace the `journey = createJourneyScene(...)` statement with the same call wrapped as follows (keep the existing options and callbacks unchanged; the two new lines are marked):

```ts
    const previousObserver = window.__cityGpuRendererObserver
    if (options.directPipeline) {
      // Pretend the HDR color buffers are missing so the post probe fails and the scene falls back to the direct pipeline.
      window.__cityGpuRendererObserver = value => {
        const has = value.extensions.has.bind(value.extensions)
        value.extensions.has = name => (name === 'EXT_color_buffer_float' || name === 'EXT_color_buffer_half_float' ? false : has(name))
      }
    }
    try {
      journey = createJourneyScene(canvas, options.tier, [{ title: 'GPU test exhibit', date: '2026-10' }], {
        lowPower: options.lowPower,
        wetRoad: options.failWetRoadTarget ? { checkComplete: () => false } : undefined, // new
        onRenderer(value) {
          /* existing body, unchanged */
        },
        onSceneReady(value) { context = value; observers?.onSceneReady?.(value) },
        onStateApplied(state) {
          appliedState = state
          observers?.onStateApplied?.(state)
        },
      })
    } finally {
      window.__cityGpuRendererObserver = previousObserver
    }
```

(`window.__cityGpuRendererObserver` is called from the code `vite.gpu.config.ts` injects right after the renderer is created, so the stub is in place before `createPostPipeline` probes.)

Append to `tests/gpu/road.spec.ts`:

```ts
type WetHandle = { stats: { passes: number; lastDrawCalls: number }; overlay: { visible: boolean }; enabled: boolean }

test('the reflection pass stays within 16 draw calls, runs when wet, and is off at intro', async ({ page }) => {
  test.setTimeout(120000)
  const r = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, width: 640, height: 360 })
    const wet = window.cityGpu.getJourneyContext().scene.getObjectByName('journey-wet-road')?.userData.wetRoad as WetHandle | undefined
    if (!wet) throw new Error('The journey has no wet road on the composer pipeline')
    const start = wet.stats.passes
    window.cityGpu.renderJourney({ chapter: 0, frames: 3 })
    const intro = { passes: wet.stats.passes - start, visible: wet.overlay.visible }
    const stops = ([[1, 0], [1, 0.5], [2, 0], [2, 0.5], [3, 0]] as const).map(([chapter, progress]) => {
      window.cityGpu.renderJourney({ chapter, progress, frames: 30 })
      return { chapter, progress, calls: wet.stats.lastDrawCalls, visible: wet.overlay.visible, passes: wet.stats.passes }
    })
    window.cityGpu.dispose()
    return { intro, stops }
  })
  expect(r.intro).toEqual({ passes: 0, visible: false })
  let previous = 0
  for (const stop of r.stops) {
    expect(stop.visible).toBe(true)
    expect(stop.calls).toBeGreaterThan(0)
    expect(stop.calls, `draw calls at chapter ${stop.chapter} progress ${stop.progress}`).toBeLessThanOrEqual(16)
    expect(stop.passes).toBeGreaterThan(previous)
    previous = stop.passes
  }
})

test('the light theme is dry: no pass and no overlay at any chapter', async ({ page }) => {
  const r = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, width: 640, height: 360, initialDark: false })
    const wet = window.cityGpu.getJourneyContext().scene.getObjectByName('journey-wet-road')?.userData.wetRoad as WetHandle | undefined
    if (!wet) throw new Error('The journey has no wet road on the composer pipeline')
    const start = wet.stats.passes
    const visible = [0, 1, 2, 3].map(chapter => {
      window.cityGpu.renderJourney({ chapter, frames: 30 })
      return wet.overlay.visible
    })
    const passes = wet.stats.passes - start
    window.cityGpu.dispose()
    return { visible, passes }
  })
  expect(r.visible).toEqual([false, false, false, false])
  expect(r.passes).toBe(0)
})

const FALLBACKS = [
  { label: 'lowPower', options: { tier: 'full', lowPower: true }, overlay: false },
  { label: 'the direct pipeline', options: { tier: 'full', lowPower: false, directPipeline: true }, overlay: false },
  { label: 'a target that fails the framebuffer check', options: { tier: 'full', lowPower: false, failWetRoadTarget: true }, overlay: false },
  { label: 'reduced motion', options: { tier: 'reduced', lowPower: false }, overlay: true },
] as const

for (const fallback of FALLBACKS) {
  test(`with ${fallback.label} the scene ${fallback.overlay ? 'keeps' : 'drops'} the reflection and still renders`, async ({ page }) => {
    const r = await page.evaluate(options => {
      window.cityGpu.mountJourney({ ...options, width: 640, height: 360 })
      const frame = window.cityGpu.renderJourney({ chapter: 3, frames: 5 })
      const overlay = window.cityGpu.getJourneyContext().scene.getObjectByName('journey-wet-road')
      const visible = (overlay as { visible?: boolean } | undefined)?.visible ?? null
      window.cityGpu.dispose()
      return { frame, hasOverlay: overlay !== undefined, visible }
    }, fallback.options)
    expect(r.hasOverlay).toBe(fallback.overlay)
    if (fallback.overlay) expect(r.visible).toBe(true)
    expect(r.frame.shaderError).toBeNull()
    expect(r.frame.glError).toBe(0)
  })
}

test('resize and context loss keep the reflection: the frame after matches the frame before', async ({ page }) => {
  test.setTimeout(120000)
  const r = await page.evaluate(async () => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, width: 640, height: 360 })
    window.cityGpu.renderJourney({ chapter: 3 })
    window.cityGpu.resizeJourney(480, 270)
    window.cityGpu.renderJourney({ chapter: 3, frames: 3 })
    const wet = window.cityGpu.getJourneyContext().scene.getObjectByName('journey-wet-road')?.userData.wetRoad as WetHandle | undefined
    if (!wet) throw new Error('The journey has no wet road on the composer pipeline')
    const before = window.cityGpu.readFrame()
    wet.enabled = false
    window.cityGpu.renderJourney({ chapter: 3, frames: 1 })
    const withoutOverlay = window.cityGpu.readFrame()
    wet.enabled = true
    window.cityGpu.renderJourney({ chapter: 3, frames: 1 })
    const passesBefore = wet.stats.passes
    const restored = await window.cityGpu.loseAndRestore()
    const after = window.cityGpu.readFrame()
    const passesAfter = wet.stats.passes
    const meanDifference = before.reduce((sum, byte, i) => sum + Math.abs(byte - after[i]!), 0) / before.length
    const overlayPixels = before.reduce((n, byte, i) => (i % 4 < 3 && Math.abs(byte - withoutOverlay[i]!) > 6 ? n + 1 : n), 0)
    window.cityGpu.dispose()
    return { restored, meanDifference, overlayPixels, passesBefore, passesAfter }
  })
  expect(r.restored.shaderError).toBeNull()
  expect(r.restored.glError).toBe(0)
  expect(r.passesAfter).toBeGreaterThan(r.passesBefore)
  // The overlay really changes the frame at this camera (so "equal" below is not vacuous)...
  expect(r.overlayPixels).toBeGreaterThan(100)
  // ...and after the restore the reflection is back, with no blank frame.
  expect(r.meanDifference).toBeLessThan(1)
})
```

In `tests/gpu/facade.spec.ts`, under `const ROAD_DRAW_CALL_DELTA = -5` add:

```ts
// City 08 adds the reflection overlay as one transparent draw once the road is wet (chapters 2 and 3 in the dark theme, composer pipeline only).
const WET_OVERLAY_DRAW_CALLS = 1
```

and change the `expectedCalls` line to:

```ts
    const expectedCalls = (lowPower ? [60, 28, 17] : [61, 29, 18]).map((calls, index) =>
      calls + (lowPower ? 0 : LANDMARK_DRAW_CALLS) + 1 + ROAD_DRAW_CALL_DELTA + (!lowPower && index > 0 ? WET_OVERLAY_DRAW_CALLS : 0))
```

(`index` 0 is chapter 0, which is dry; 1 and 2 are chapters 2 and 3.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:gpu -- road.spec.ts facade.spec.ts`
Expected: FAIL. The scene has no `journey-wet-road` yet, and `facade.spec.ts` expects one extra call on the wet chapters.

- [ ] **Step 3: Wire the scene**

In `app/journey/scene.ts`:

1. Imports. Add `import { reflectInPuddles } from './reflect-layer'` on the line before `import { createRoad } from './road'`, and add this line after `import { windowLookFor } from './window-look'`:

```ts
import { createWetRoad, WET_WARMUP, type WetRoad, type WetRoadOptions } from './wet-road'
```

2. In `JourneySceneOptions` add:

```ts
  // Test seam: lets a GPU test make the reflection target fail its framebuffer check.
  wetRoad?: WetRoadOptions
```

3. Next to `let post: PostPipeline | null = null` add `let wetRoad: WetRoad | null = null`. In `dispose()`, add `wetRoad?.dispose()` on the line after `post?.dispose()`.

4. Opt objects into the reflection layer:
   - In the building layer loop, after `scene.add(...layerMeshes(layer))` add `reflectInPuddles(...layerMeshes(layer))`.
   - Replace `scene.add(createCornerBlocks())` with:

```ts
  const cornerBlocks = createCornerBlocks()
  scene.add(cornerBlocks)
  reflectInPuddles(cornerBlocks)
```

   - Replace `if (stars) scene.add(stars)` with `if (stars) { scene.add(stars); reflectInPuddles(stars) }`.
   - After `scene.add(sky.mesh, ...farSkyline.objects)` add `reflectInPuddles(sky.mesh)` (the far skyline and haze stay out).
   - After `scene.add(hemi, sun)` add `reflectInPuddles(hemi, sun)`.

5. In `apply`, after the `road.update(...)` line, add:

```ts
    wetRoad?.setLook(state.wetness, state.fogDensity)
```

6. In `resize`, after `post?.setSize(safeWidth, safeHeight, renderer.getPixelRatio())` add:

```ts
    if (wetRoad) {
      const drawing = renderer.getDrawingBufferSize(new THREE.Vector2())
      wetRoad.setSize(drawing.x, drawing.y)
    }
```

7. Replace `renderFrame` with:

```ts
  function renderFrame() {
    wetRoad?.render(scene, camera)
    if (post) post.render()
    else renderer.render(scene, camera)
    recorder.assertClean()
  }
```

8. Create the reflection after the post pipeline and compile its programs in the warm-up. Replace this block:

```ts
  post = lowPower ? null : createPostPipeline(renderer, scene, camera)
  apply(current)
  if (post) {
    // Force bloom on so every optional fullscreen program compiles now, then
    // restore the real look; a later night chapter must not compile mid-scroll.
    post.setLook(current.exposure, 0.5)
    post.render()
    recorder.assertClean()
    apply(current)
  }
```

with:

```ts
  post = lowPower ? null : createPostPipeline(renderer, scene, camera)
  // Part C needs the composer pipeline: the direct pipeline CPU-tone-maps fog and background, which a linear HDR
  // reflection would map twice. A null result (no HDR targets, incomplete target) keeps Parts A and B.
  wetRoad = post ? createWetRoad(renderer, options.wetRoad) : null
  if (wetRoad) scene.add(wetRoad.overlay)
  apply(current)
  if (post) {
    // Force bloom and the reflection on so every optional program compiles now, then
    // restore the real look; a later night chapter must not compile mid-scroll.
    post.setLook(current.exposure, 0.5)
    wetRoad?.setLook(WET_WARMUP, current.fogDensity)
    wetRoad?.render(scene, camera)
    post.render()
    recorder.assertClean()
    apply(current)
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:gpu -- road.spec.ts facade.spec.ts wet-road.spec.ts`
Expected: PASS.

If the draw-call test is off by a different amount, print `result.frames[n].calls` and compare with the old baseline before touching constants. The reflection pass's own render must not be counted: `sceneCalls` in the harness is overwritten by the main scene render that follows it.

If the pass-budget test reports more than 16 calls, list what the virtual camera drew: temporarily log `renderer.info.render.calls` per object name by setting `renderer.info.autoReset = false` inside a throwaway probe, and check that every object on layer 1 is in the table in the Task 9 Interfaces list.

Run: `npm test && npm run typecheck`
Expected: PASS.

Run: `npm run test:gpu`
Expected: PASS for the whole suite.

Run: `wc -l app/journey/scene.ts`
Expected: fewer than 800 lines.

- [ ] **Step 5: Commit**

```bash
git add app/journey/scene.ts tests/gpu
git commit -m "feat: reflect the city in rain puddles on the composer pipeline"
```

- [ ] **Step 6: Add city 07 objects to the reflection layer, if city 07 has landed**

Run: `git log --oneline master | head -20` and `ls app/journey | grep -E "lamps|traffic"`.

If `lamps.ts` and `traffic.ts` do not exist, skip this step and say so in the handoff. City 07's plan then has to add, in its own scene-wiring task, `reflectInPuddles(...lamps.posts and heads)` and `reflectInPuddles(...traffic bodies and lights)` and leave the pool and halo meshes out. The reflection budget leaves room: 11 draws today, plus lamps 2 and cars 2 is 15 of 16.

If they exist, in `scene.ts` after the line that adds `lamps.objects` and `traffic.objects`, opt in only the lamp posts, lamp heads, car bodies, and car lights. Read `lamps.ts` and `traffic.ts` for their mesh names. Leave out the pool and halo meshes: they are additive overlays on the road and would double their light in the puddle. Run the pass-budget test again: it must still report at most 16 calls. Commit with `feat: reflect lamps and cars in puddles`.

---

### Task 10: Final acceptance

**Files:**
- No code changes expected. Fixes found here go in the task that owns the code.

**Automated verification:** commands the agent runs and that must pass.

- [ ] **Step 1: Run the full automated suite**

Run each and record the result:

- `npm test` (Vitest, Node). Expected: PASS, including `road-layout`, `asphalt`, `road`, `reflection`, `reflect-layer`, `wet-road`, `buildings`, `footprints`, `stops`, `interpolate`, `target`.
- `npm run test:gpu` (Playwright, software WebGL2). Expected: PASS for every spec, including `road.spec.ts`, `wet-road.spec.ts`, `facade.spec.ts`, `post.spec.ts`, `sky.spec.ts`, `windows.spec.ts`, `theme-scene.spec.ts`.
- `npm run typecheck`. Expected: PASS.
- `npm run build`. Expected: PASS, 18 routes.
- `wc -l app/journey/scene.ts`. Expected: fewer than 800.

- [ ] **Step 2: Check the spec's tests against this plan**

Open the spec's Testing section and confirm each item has a passing test:

| Spec test | Where |
|---|---|
| 1 asphalt pixels | `tests/journey/asphalt.test.ts` (tile test uses a seam statistic, see Spec Corrections, item 5) |
| 2 dash positions | `tests/journey/road-layout.test.ts` |
| 3 sidewalk polygon | `tests/journey/road-layout.test.ts` (complete-region oracle, Spec Corrections, item 2) |
| 4 clearance | `tests/journey/buildings.test.ts`, `footprints.test.ts`, `road-layout.test.ts` |
| 5 puddle mask | `tests/journey/asphalt.test.ts` |
| 6 reflected camera | `tests/journey/reflection.test.ts` |
| 7 wetness interpolates | `stops.test.ts`, `interpolate.test.ts`, `target.test.ts` |
| 8 UV baking | `tests/journey/road.test.ts` |
| 9 shader errors in every configuration | `tests/gpu/road.spec.ts` (tier table, both themes), `wet-road.spec.ts` |
| 10 reflection content, layer exclusion, intro off | `tests/gpu/wet-road.spec.ts` (a decoy on layer 0 replaces the pool and halo comparison; pools and halos arrive with city 07) |
| 10b lights in the reflection | `tests/gpu/wet-road.spec.ts` (lit versus unlit, simplified) |
| 10c corner coverage | `wet-road.spec.ts` (coverage probe), `road-layout.test.ts` (`roadRects`) |
| 11 road only | `wet-road.spec.ts` |
| 12 shared reflection across rotated legs | `wet-road.spec.ts` (four mirror cases) |
| 13 mask agreement | `road.spec.ts` |
| 14 sheen on `lowPower` | `road.spec.ts` (sheen), fallbacks test (no overlay on `lowPower`) |
| 15 pass budget | `road.spec.ts` |
| 16 pass hygiene | `wet-road.spec.ts` |
| 17 forced framebuffer failure | `wet-road.spec.ts`, `road.spec.ts` fallbacks |
| 18 pipeline fallback | `road.spec.ts` fallbacks |
| 19 context restore | `road.spec.ts` |

**Manual verification:** checks only a person can do. Collect these in the final handoff and do not mark them done until the user confirms them.

- [ ] **Step 3: Write the handoff for the person**

Report the automated results, then list the manual checks below as unchecked. Do not pause the plan for them.

- [ ] Screenshots at the four chapters plus one mid-transition frame, desktop and iPhone 14 Pro Max emulation, light and dark theme, per shared conventions section 9. Light theme must show a dry road with grain, sidewalks and dashes; dark theme must show the sheen rising from intro to about.
- [ ] Entrance view and market view at `about` on desktop: lit windows and lamps visible in puddles; the reflection follows the camera through both turns without a seam or a jump.
- [ ] Each corner: the sidewalk meets the joint patches with no gap and no poking corner, and the square outside corner looks intended.
- [ ] Dash pattern does not shimmer at distance. If it does, give the dash material a 1 x 1 white mipmapped texture (spec, Risks).
- [ ] Framing at each chapter after the buildings moved away from the sidewalk: the street canyon is narrower by up to 0.9 units on the near layer. Note any chapter whose framing got worse.
- [ ] Set-piece bases against the 0.15 high sidewalk slab: gate pillars, hall wall, market lamp posts, courtyard walls.
- [ ] Performance, per shared conventions section 8: run the uncapped sync-based loop (add the temporary build flag from section 8, step 1, on a scratch commit and do not merge it; `cityGpu.measureJourney({ chapter })` in the GPU harness times the same path) on the named reference desktop (`full`) and a physical iPhone (`lowPower`), at chapters 0, 2, and 3, on the commit before this branch and the last commit, three runs each, compare medians. Budget: +1.2 ms desktop, +0.3 ms iPhone. If the desktop is over budget, apply the spec's fallbacks in order: `REFLECTION_SCALE = 0.25`, then `WET_MIN = 0.3`, and re-measure.
- [ ] Physical iPhone: no WebGL context loss in a two-minute scroll through all four chapters (lowPower has no reflection pass, so this checks Parts A and B only).
- [ ] The light-theme decision (dry road, all four values 0). Confirm, or give new values; they are one block in `LOOKS.light`.

- [ ] **Step 4: Commit any fix made during acceptance**

Fixes go in the task that owns the code, as `fix:` commits. If nothing needed fixing, there is nothing to commit.

---

## Spec Coverage Check

Done while writing this plan, against the spec's Goal, Design, Tier behavior, Files, and Risks sections:

- Road detail (asphalt, sidewalks with curbs, dashed line): Tasks 2, 4, 5, 6.
- Wet sheen on all tiers: Tasks 5, 6.
- Planar reflection on `full` with the composer, road only, at most 16 calls: Tasks 7, 8, 9.
- Wetness per chapter: Task 1 (light theme decision in Spec Corrections).
- Building and market clearance: Task 3.
- Tier behavior table: Task 9 (`lowPower`, direct pipeline, failed target, reduced motion tests).
- Context loss and resize: Task 9.
- Files list: every file in the spec's table appears in this plan's File Structure (plus `road-layout.ts`, `reflect-layer.ts`, `reflection.ts`, and the GPU probes).
- Risks: second-render cost (Task 10 fallbacks), oblique clipping with custom shaders (Task 8 `probeReflection` renders facade materials in the real scene via Task 9's pass-budget and restore tests), layer bookkeeping (`reflectInPuddles`, Tasks 7 and 9), dome reflection (sky dome on the layer, Task 9), sidewalk clearance (Task 3 and the framing check), dash shimmer (manual check).
