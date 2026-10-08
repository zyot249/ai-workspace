# City polish 08: Wet road and road detail

Date: 2026-10-09
Status: Draft, pending review and prioritization
Direction: Realistic dusk/dawn skyline
Series: City polish (08 of 08). Read [00 shared conventions](2026-10-09-city-00-shared-conventions.md) first.

## Problem

The road is a flat dark quad with a continuous translucent line down the middle. It has no texture, no edge, no sidewalk, and no sheen. The ground beside it is another flat plane. At dusk the strongest cue of a real city is a wet street that reflects the sky and the lights. Today the road reflects nothing, so the lit windows, lamps, and warm sky never reach the ground.

## Goal

Make the road read as asphalt after rain, and give it an edge.

1. **Road detail (all tiers).** Speckled asphalt, sidewalks with curbs, dashed lane markings.
2. **Wet sheen (all tiers).** A lower roughness and a sky tint in puddles, growing toward night.
3. **Planar reflection (`full` tier with the composer pipeline).** Puddles reflect buildings, lit windows, lamps, cars, and the sky.

Success criteria:

- The road shows asphalt grain at close range, a sidewalk with a curb on both sides with no gap or overlap at the turns, and a dashed center line.
- Wetness rises across the chapters: 0, 0.15, 0.4, 0.7 (starting values). At `intro` there is no sheen and no reflection.
- At `about`, on `full` with the composer pipeline, lit windows and lamps are visible in puddles. On every other configuration the road shows the sky sheen only.
- Reflections appear only on the road, not on the ground or sidewalks.
- Added cost: at most +1.2 ms on the named reference desktop (`full`) and +0.3 ms on a physical iPhone (`lowPower`), using the procedure in shared conventions, section 8.
- The reflection pass renders at most 16 draw calls.
- Context loss and restore leave sheen and reflection working.

## Non-goals

- Reflections on walls, windows, sidewalks, or the ground beside the road.
- Rain drops, ripples, splashes, or animated puddles.
- Screen-space reflections or ray tracing.
- Sidewalk props. Lamps come from spec 07.
- Reflecting the set-pieces (gate, hall, market, courtyard). They have too many meshes for the budget (the market alone has 16).

## Current state

- `createRoad` builds one `PlaneGeometry(6, segmentLength)` per segment and a `PlaneGeometry(6, 6)` joint at each interior waypoint, all with `MeshStandardMaterial({ color: 0x1a1a1f, roughness: 1 })` at `y = -1`. A center-line plane per segment (`MeshBasicMaterial`, `0xf5e6a8`, transparent, opacity 0.5) sits at `y = -0.99`.
- The ground is a plane at `y = -1.01` (spec 05 enlarges it).
- `ROAD_HALF_WIDTH = 3`, `ROAD_CLEARANCE = 3.3`. The camera is on the path center at height 0.2 to 0.8, so it sees the road at grazing angles, where reflections are strongest.
- Draw order (specs 04 and 07): shadow quads `renderOrder 1`, lamp pools `1.5`, road markings `2`, halos `3`.

## Design

All road code moves from `scene.ts` into `app/journey/road.ts` (about 50 lines leave `scene.ts`).

### Part A: road detail (all tiers)

**Asphalt texture.** `asphaltPixels(size, seed): Uint8Array` (pure) returns a tileable 256 x 256 grayscale value-noise-plus-speckle image. Wrap it in a `THREE.DataTexture` with `RepeatWrapping`, `NoColorSpace`, `generateMipmaps = true`, `minFilter = LinearMipmapLinearFilter`, **`magFilter = LinearFilter`** (r186 skips anisotropy when magnification is `NearestFilter`, which is the `DataTexture` default), and `anisotropy = min(4, maxAnisotropy)`. It drives `roughnessMap` and a faint `bumpMap`.

**UV scale is baked into geometry.** All road segments and joints share one material and one texture, and r186 stores texture transforms per texture. A per-mesh `repeat` would therefore change every segment. Instead each road geometry gets a `uv` attribute in world units: `uv = (localX, localY) / 4`, so one texture tile covers 4 x 4 world units, with `repeat = 1`. The sidewalk geometry gets the same world-unit UVs.

**Sidewalks as mitered polygons.** A sidewalk is the region between two offset curves of the path polyline at 3.0 (road edge) and 3.9 units. It is built from a pure function:

```ts
export function sidewalkPolygon(side: -1 | 1, inner = 3.0, outer = 3.9): Vec2[]
```

For each waypoint the offset point is `waypoint + miter(side) * d`, where `miter` is the normalized sum of the adjacent segments' right vectors, scaled by `1 / dot(miter, segmentRight)` so the offset stays `d` from both segments. At the two 90-degree turns this puts a mitered corner (a square outside corner, a clean inside corner). The polygon is the inner offset points followed by the outer offset points in reverse. Extrude it to a height of 0.15 with `ExtrudeGeometry` (no bevel), so the top is at `y = -0.85`, then merge both sides into one geometry (`mergeGeometries`): one mesh, one draw call. Color `#4a4a52`, `MeshStandardMaterial`, roughness 0.9, with the asphalt texture as a faint bump. There are no corner blocks and no instances to close gaps: the mitered polygon covers the strip continuously.

The road joint patches (6 x 6 squares at the interior waypoints) stay. Their outer corners lie at distance up to `3 * sqrt(2)` from the waypoint, inside the miter region. Where a joint patch corner pokes into the sidewalk polygon the sidewalk (top at `-0.85`) hides it; check the corners in screenshots.

Buildings must stand clear of the 3.9 outer edge. `ROAD_CLEARANCE` (3.3) keeps its value, because it also drives candidate generation in `placeBuilding` (`minClear`), and changing it would move every candidate and break spec 03's guarantee that surviving buildings keep their positions. A new constant `BUILDING_ROAD_MARGIN = SIDEWALK_OUTER + 0.3` (4.2) is used only in the **acceptance** test: a candidate is accepted when `clearsPath(x, z, BUILDING_ROAD_MARGIN + halfExtent)` holds, in addition to spec 03's other checks. Candidates are unchanged, so every building whose old position also passes the stricter test keeps it. The market stalls sit at `BUILDING_CLEARANCE + 0.5 + ...` from the center with a half width of 0.6, which puts the nearest edge at 3.2, inside the sidewalk. Raise `BUILDING_CLEARANCE` to 4.5 (nearest stall edge 4.4). The gate pillars (at 3.4) and other set-piece geometry may stand on the sidewalk slab. Spec 07's lamps stand at 3.3 from the center line, on the sidewalk, where street lamps belong. Check set-piece bases against the slab in screenshots.

**Dashed center line.** One `InstancedMesh` of dash quads replaces the continuous plane. Dash length 1.2, width 0.08, `y = -0.99`. Dash centers are computed per segment by a pure function `dashPositions()`:

- Along each segment, a dash center must be at least `0.6` from the segment's exterior ends and at least `3.6` from each interior waypoint. The 3.6 comes from the joint patch half-width (3.0) plus the dash half-length (0.6): the whole dash rectangle must clear the patch.
- Centers start at the lowest allowed position and repeat every 3.0 until the highest allowed position.

For segment lengths 34, 26, and 40 this gives 10, 7, and 12 dashes: **29**. Each dash takes the segment's heading. Material `MeshBasicMaterial({ color: 0xf5e6a8, opacity: 0.55, transparent: true })`: `transparent: true` is required, because `opacity` alone leaves the object in the opaque queue, where `renderOrder` does not place it after the transparent shadow and pool quads. `renderOrder = 2`.

### Part B: wet sheen (all tiers)

The road material is patched with `onBeforeCompile` and `replaceOrThrow`. Anchors and spaces (r186 chunk names):

- **Vertex shader**, after `<begin_vertex>`: `vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xz;` with `varying vec2 vWorldPos;` declared explicitly. Do not rely on `worldpos_vertex`, which is conditional. The road meshes are not instanced.
- **Fragment shader**, after `<roughnessmap_fragment>`: `float puddle = puddleMask(vWorldPos); float wetAmt = uWetness * puddle; roughnessFactor = mix(roughnessFactor, 0.35, wetAmt);`
- **Fragment shader**, before `#include <opaque_fragment>` (after lighting, so `outgoingLight` is complete and before tone mapping): `vec3 V = normalize(vViewPosition); float fres = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 4.0); outgoingLight += uSkyTint * fres * wetAmt * 0.5;` Here `normal` is the view-space normal after bump mapping and `vViewPosition` is the view-space vector to the camera (r186 standard-material convention).
- `puddleMask(p)`: `smoothstep(0.45, 0.65, valueNoise(p / 24.0) * 0.75 + valueNoise(p / 6.0) * 0.25)`, with a float hash (Dave Hoskins style, as in spec 06) and a two-octave value noise. `puddleMaskAt(x, z)` in `asphalt.ts` is the same function in TypeScript (float64) and is the test oracle (tolerance 0.02 against the shader).
- Uniforms: `uWetness` (from the stop), `uSkyTint` (mid-sky color, `skyColor`, linear per shared conventions, section 1).

This is the whole wet look on `lowPower` and on `full` when the reflection is unavailable.

### Part C: planar reflection (`full` tier, composer pipeline)

Part C runs only when spec 02's composer pipeline is active (`post !== null`). On the direct pipeline, `scene.fog.color` and the background are CPU tone-mapped (spec 02), and capturing them into a linear HDR reflection that is then tone-mapped again would map them twice. Part C therefore falls back to Part B whenever the direct pipeline is used.

**One overlay mesh, one reflection pass.** The road has three differently rotated segments and two joints. Giving each its own `Reflector` would triple the cost, and a Reflector's texture matrix includes the mesh's own world matrix, so it cannot be shared across differently rotated meshes. Instead, a single flat overlay quad covers the road:

- Geometry and transform: a `PlaneGeometry` of 34 x 82 units, the path bounding box (x from -26 to 0, z from -66 to 8) plus 4 units on every side. The mesh is rotated flat and **positioned at the bounding-box center `(-13, -0.997, -29)`**, so it covers the whole road. The shader computes world XZ from `modelMatrix`, and the standard `Reflector` texture matrix (which includes the mesh's own `matrixWorld`) is correct for this single mesh.
- Material: a `ShaderMaterial` derived from a copy of three's `Reflector` (MIT, `three/addons/objects/Reflector.js`). Changes from the original: a custom shader, `virtualCamera.layers.set(REFLECT_LAYER)`, and an explicit `try`/`finally` around its render. It keeps the original uniform names `tDiffuse` (the reflection texture) and `textureMatrix`. `transparent: true`, `depthWrite: false`. `renderOrder = 0.5` is set on the **mesh** (before the shadow quads at 1), not on the material. The Reflector hides itself while rendering. It does not need to hide the road: the oblique clip plane at `y = -0.997` removes the road (at `-1`) and the ground (at `-1.01`).
- Shader plumbing, declared explicitly. Vertex: `varying vec2 vWorldXZ; varying float vViewDepth; varying vec4 vReflUv;` with `vWorldXZ = (modelMatrix * vec4(position, 1.0)).xz`, `vViewDepth = -(modelViewMatrix * vec4(position, 1.0)).z`, and `vReflUv = textureMatrix * vec4(position, 1.0)`. Fragment uniforms: `sampler2D tDiffuse`, `vec4 uRects[5]`, `float uWetness`, `float uFogDensity` (refreshed each frame from `scene.fog.density`), and the shared puddle-noise GLSL from `asphalt.ts`. The overlay does not use three's fog chunks.
- **Road mask: the union of the road rectangles, not distance to the polyline.** Distance to the polyline rounds the outside corners, while the joints are 6 x 6 squares: the point `(2.8, -28.8)` lies inside the first joint but is about 3.96 units from both finite segments, so a distance mask would discard it. `roadRects()` (pure, from `path.ts`) returns five axis-aligned rectangles as `[minX, minZ, maxX, maxZ]`: the three segment rectangles (`x` in [-3, 3] and `z` in [-26, 8]; `x` in [-26, 0] and `z` in [-29, -23]; `x` in [-29, -23] and `z` in [-66, -26]) and the two joint squares (`[-3, 3] x [-29, -23]` and `[-29, -23] x [-29, -23]`). The fragment shader discards pixels outside every rectangle.
- Reflection lookup: `vec2 r = vReflUv.xy / vReflUv.w + distortion;` where `distortion = (valueNoise(vWorldXZ * 3.0) - 0.5) * 0.02`. The overlay is flat, so its normal is `(0, 1, 0)`, and the Fresnel term is `pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0)` with `V = normalize(cameraPosition - vec3(vWorldXZ.x, -0.997, vWorldXZ.y))`.
- Alpha: `mix(0.1, 0.9, fresnel) * wetAmt * (1.0 - fogFactor)`, where `wetAmt = uWetness * puddleMask(vWorldXZ)` and `fogFactor = 1.0 - exp(-pow(uFogDensity * vViewDepth, 2.0))`. Far reflections fade out where the road itself has fogged to the fog color.
- Color is written in linear HDR. No tone-mapping chunks are included: the composer path tone-maps the whole frame in `OutputPass`.

**What the reflection contains: render layers.** The virtual camera renders only `REFLECT_LAYER = 1`. The scene objects that opt in call `object.layers.enable(1)` (they stay on layer 0 for the main camera):

| Object | Spec | Draw calls |
| --- | --- | --- |
| Building box meshes (3 layers) | 01, 03 | 3 |
| Spire and beacon meshes | 03 | up to 3 |
| Sky dome | 05 | 1 |
| Corner blocks (two meshes today) | existing | 2 |
| Lamp posts and heads | 07 | 2 |
| Car bodies and lights | 07 | 2 |
| Stars | existing | 1 |

That is at most 14 draw calls. The budget is 16, leaving margin. The corner blocks are two separate meshes in `createCornerBlocks`, and no spec merges them, so they count as two calls.

**Lights must be on the reflection layer too.** r186 filters lights by the rendering camera's layers. With the virtual camera restricted to layer 1, lights on layer 0 would disappear and reflected standard-material surfaces would render unlit. Call `reflectInPuddles(light)` on the hemisphere light and the directional light as well. A GPU test (item 10b) checks a reflected non-emissive surface. Excluded on purpose: the ground, road, sidewalks, shadow quads (they sit 0.002 above the overlay plane and would reflect as black blobs), pools and halos (additive overlays on the road, which would double their light), the haze band and far silhouettes (spec 05; too far to read), and all set-pieces. The hall's gallery pictures are therefore not reflected. The hall appears at `projects`, where wetness is only 0.15.

**Render target.** `HalfFloatType` (reflected lit windows exceed 1.0 and must survive for bloom), half the drawing-buffer size, no MSAA, no mipmaps. Capability: use spec 02's probe (`probePostSupport`) and, after creating the target, bind it explicitly and check `gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE`. A target constructed without error can still fail on first use, because allocation is lazy. On failure: dispose the target, call `renderer.setRenderTarget(null)`, drain `gl.getError()`, and return `null` so the scene falls back to Part B. Test the forced-failure path independently of the composer probe.

**Per-frame behavior.** When `uWetness <= 0.02` (the `intro` chapter) the pass does not run and the overlay is hidden. Otherwise it renders every frame: cars move, windows flicker, and beacons blink while the camera stands still, so an unchanged-camera cache would show stale reflections, and a resize or a context restore leaves a newly allocated target empty. The pass uses `try`/`finally` to restore the renderer's render target, clipping, and any state it changed, even if the render throws.

### Wetness per chapter

New `StopState` field `wetness` (shared conventions, section 4):

| Chapter | `wetness` |
| --- | --- |
| intro | 0.00 |
| projects | 0.15 |
| skills | 0.40 |
| about | 0.70 |

Starting values; tune in screenshots. The story beat is a street that has just rained as dusk turns to night.

### Tier behavior

| Situation | Behavior |
| --- | --- |
| full, composer pipeline | Parts A, B, and C. |
| full, direct pipeline (probe failed) | Parts A and B. |
| lowPower | Parts A and B. |
| reduced | Variant follows the rules above. Part C still renders when wet (it is not time-driven by itself; moving sources are absent under reduced motion). |

## Files

| File | Change |
| --- | --- |
| `app/journey/road.ts` | New. Moved from `scene.ts`: road surface, joints, sidewalk mesh, dashes, material patch. |
| `app/journey/asphalt.ts` | New. `asphaltPixels`, `puddleMaskAt`, texture creation, GLSL noise strings. |
| `app/journey/wet-road.ts` | New. The reflection overlay and pass. |
| `app/journey/stops.ts`, `interpolate.ts` | `wetness` field. |
| `app/journey/scene.ts` | Use the road module, set reflection layers, call `wetRoad.update`, resize and dispose, clearance changes. |
| `tests/journey/road.test.ts` | New. |
| `tests/journey/interpolate.test.ts` | `wetness` at p = 0, 0.5, 1. |
| `tests/gpu/road.spec.ts` | New. |

## Testing

Unit (Vitest, `tests/journey/`):

1. `asphaltPixels(256, seed)`: deterministic, mean between 0.35 and 0.65, standard deviation above 0.05, and tileable: the left and right columns differ by at most 2/255 per pixel, and so do the top and bottom rows.
2. `dashPositions()`: exactly 29 dashes (10, 7, 12 per segment). Spacing is 3.0. For every dash, the whole 1.2 x 0.08 rectangle lies inside its segment and at least 3.0 from every interior waypoint (so no dash overlaps a joint patch), with centers at least 3.6 from interior waypoints along the segment. Every center is on the path center line.
3. `sidewalkPolygon(side)`, tested against complete regions, not per segment. Define the road region `R` as the union of the five rectangles from `roadRects()` (three segment rectangles and two joint squares, below). Sample a 0.1-unit grid over the path bounding box plus 6 units. For each sample point `q`, with `d` its distance to the finite path polyline: if `q` is in `R`, it is outside the sidewalk polygon (the sidewalk never covers the road); otherwise, if `d` is between 3.0 and 3.9, it is inside the polygon; if `d` is above 3.9 + 0.01, it is outside. (Near an inside turn, a point offset from one segment can lie in the other leg's roadway, for example `(-3.05, -25)`, so a per-segment check would be wrong. The complete-region check handles it.) The polygon has no self-intersection, and its two sides never overlap each other.
4. Clearance: with `BUILDING_ROAD_MARGIN = 4.2` in the acceptance test, spec 03's placement property test still holds, no building footprint intersects either sidewalk polygon, and the market stalls (`BUILDING_CLEARANCE = 4.5`) clear it too. Spec 03's stability test (positions equal the golden fixture or fail the stricter check) still passes unchanged with the fixture captured before spec 03; candidate positions are not affected by this change.
5. `puddleMaskAt`: values in [0, 1], deterministic, continuous (points 0.01 apart differ by less than 0.05), and between 15% and 45% of the road bounding box has a mask above 0.5.
6. `reflectedCamera(position, target, up, planeY)` (pure helper used by the pass): reflecting across `y = -0.997` mirrors the position and look-at, and applying it twice returns the original.
7. `wetness` interpolates (shared conventions, section 4).
8. UV baking: every road geometry's `uv` range equals its local size divided by 4, and the material's texture `repeat` is (1, 1).

GPU (Playwright, `tests/gpu/road.spec.ts`):

9. Shader errors for the road material, the overlay material, and the pass, in all configurations in the tier table. The recorder is empty after the warm-up frames (shared conventions, section 2).
10. Reflection content: at `about` on `full` with the composer, a puddle pixel with a lit window directly across the road is brighter and warmer than the same pixel with `wetness = 0`. At `intro` they match within 1/255 (pass disabled). Lamps appear in the reflection and pools do not: the reflection render target is identical (within 1/255) with the pool and halo meshes enabled or disabled, since they are not on the reflection layer. (A main-scene pixel comparison would be wrong here: pools intentionally render over the puddle at `renderOrder 1.5`.)
10b. Lights in the reflection: with a lit, non-emissive test box on the reflection layer, the reflection of its sunlit face is brighter than that of its shadowed face by the same ratio as in the main render (within 10%). With the lights left on layer 0 only, the reflected box is unlit; the test fails in that configuration.
10c. Corner coverage: for the four corner pixels of each joint square and the point `(2.8, -28.8)`, the overlay has a reflection (non-zero alpha), and a point just outside the squares and the segment rectangles has none. `roadRects()` unit test: the union covers every point of the road geometry (the segment planes and joints) and nothing farther than 0.01 beyond them.
11. Road-only: a ground pixel and a sidewalk pixel next to the road are identical with the overlay on and off.
12. Shared reflection across rotated segments: place the camera on each of the three segments and at a joint. At each, reflection pixels for a reference object line up with the object's mirror image (a lit marker box beside the road reflects at the mirrored position within 2 pixels). This is the case that a shared Reflector matrix across rotated meshes would fail.
13. Mask agreement: a debug define outputs `puddleMask`. The shader values equal `puddleMaskAt` within 0.02 on a 20 x 20 grid over the road bounding box.
14. Sheen on `lowPower`: at `about`, a puddle pixel at a grazing angle is brighter than at a steep angle, and no reflection render target exists.
15. Pass budget: on the composer pipeline with `renderer.info.autoReset = false`, the reflection pass issues at most 16 draw calls at each chapter and at five camera positions along the path (count the calls between `info.reset()` calls around the reflection render). It does not run at `intro`.
16. Pass hygiene: after the pass (including a forced throw in the render), the renderer's render target, clipping planes, and the visibility of every object are restored, and the next normal frame renders correctly.
17. Forced framebuffer failure: make the target allocation fail (stub `checkFramebufferStatus`). `createWetRoad` returns `null`, the scene renders with Part B, no GL error is left pending, and the shared guard does not trigger `unavailable`.
18. Pipeline fallback: with the direct pipeline forced (`post === null`), Part C is off, and the road pixels equal Part B's.
19. Context restore: after `loseContext()` and `restoreContext()` with a resized canvas and `wetness = 0.7`, the next frame shows the reflection with no blank frame.

Manual verification (shared conventions, section 9): the entrance view and the market view at `about`, plus each corner. Check that the reflection follows the camera through the turns, that the sidewalk meets the joint patches without gaps or poking corners, and that the dash pattern does not shimmer at distance.

Performance: shared conventions, section 8. Budget +1.2 ms (desktop `full`) and +0.3 ms (iPhone `lowPower`).

## Risks

- **Cost of the second scene render.** It is the most expensive item in the series. The layer list keeps it to at most 16 calls at half resolution. If the budget is exceeded, drop the reflection to quarter resolution or enable it only when `wetness >= 0.3`.
- **Oblique clipping with the custom shaders** from specs 01, 04, and 06: they use `projectionMatrix` normally, so clipping should apply. Test 10 covers a facade.
- **Layer bookkeeping.** Objects added later must opt into layer 1 to appear in the reflection. A missing object is invisible in puddles, not an error. Keep the list in one helper, `reflectInPuddles(object)`.
- **Dome reflection.** The sky dome follows the main camera and is centered 2 units or less from the virtual camera, so it reflects correctly with `camera.far` 260 (spec 05). Without spec 05 there is no dome. `scene.background` is rendered independently of object layers, so the reflection pass still clears to the current background color and the puddle shows buildings over the sky color. No clear-color override is needed.
- **Sidewalk clearance** moves some buildings 0.9 units away from the road (and rejects a few candidates), which narrows the street canyon slightly. Check framing at each chapter.
- **Dash shimmer**: thin dashes can shimmer at a distance. If it appears, give the marking material a 1 x 1 white mipmapped texture.

## Dependencies

- Parts A and B are independent of everything else.
- Part C needs spec 02's composer pipeline. It benefits from spec 05 (sky in puddles) and spec 07 (lamps and cars in puddles).
- The stricter building acceptance margin (`BUILDING_ROAD_MARGIN`) touches spec 03's placement code, and `BUILDING_CLEARANCE = 4.5` moves the market stalls. Spec 04 (shadow quads near the road) and spec 07 (lamps on the sidewalk) need no change.

## Open questions

None. The wetness table and puddle coverage are starting values for tuning.
