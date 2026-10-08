# City polish 04: Vertical gradient and contact shadows

Date: 2026-10-09
Status: Draft, pending review and prioritization
Direction: Realistic dusk/dawn skyline
Series: City polish (04 of 08). Read [00 shared conventions](2026-10-09-city-00-shared-conventions.md) first.

## Problem

Building walls have one flat color from base to roof, and buildings stand on the ground with no sign of contact. Real city walls are darker near the street (bounced and occluded light) and catch warm light at the roof edge at dusk. Without shadow maps, nothing grounds the buildings, so they look pasted on.

## Goal

Add two cheap cues that give buildings volume and weight without shadow maps:

1. A vertical gradient in the wall shader: darker at the base, a warm rim of light near the roof edge on sun-facing walls, and a faint bounce glow near the base at night.
2. Soft contact shadows: a dark, blurred quad on the ground under each building.

Success criteria:

- On a wall seen from the entrance view, linear luminance 0.2 units above the base is at most 70% of the luminance 1.5 units above the base, on all four chapters. The GPU test measures the ambient-occlusion term alone: windows, rim, and bounce are disabled, and it reads linear values from a float render target, not displayed sRGB (see Testing).
- At chapters `intro` and `projects`, sun-facing roof edges show a visible warm rim. At `about` (night) the rim is off.
- Every active building has a contact shadow, and no inactive building does.
- Cost: one extra draw call, and at most 0.3 ms on the named reference desktop and 0.3 ms on a physical iPhone (render-cost procedure in shared conventions, section 8).
- The gradient does not shift as heights animate: the darkening is measured from the ground, not from the building's current center.

## Non-goals

- Real shadow maps (cost too high for phones).
- Shadows for set-pieces (hall, market, courtyard, gate) and corner blocks. They could reuse the quad later. Out of scope here.
- Sun movement. Spec 05 moves the sun. This spec reads the sun direction from the existing directional light and follows spec 05's change automatically.
- Window brightness and flicker (specs 01 and 06).

## Current state

- Walls: `MeshStandardMaterial` with a flat color per layer (spec 01 patches it, and spec 03 may add per-instance tint).
- Lighting: `HemisphereLight` (sky color from the current stop, ground color `0x1a1a1f`) plus one `DirectionalLight` at `(-4, 6, 4)`. Building bases receive the same light as roofs.
- Ground: a plane at `y = -1.01` with a flat color. No contact shading under buildings.

## Design

### Part A: wall gradient (extends spec 01)

This part patches the facade material from spec 01 (`facade-material.ts`), so it depends on spec 01. It adds code after the facade logic and the instance color (`<color_fragment>`), in the same `onBeforeCompile`.

Vertex shader additions:

- `vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vWorldY = wp.y;`
- `vTopY = (modelMatrix * instanceMatrix * vec4(0.0, 0.5, 0.0, 1.0)).y;` (world height of this instance's top)
- `vWorldNormal = normalize(mat3(modelMatrix) * normal);` Instances are scale-and-translate only (shared conventions assume no rotation), so the unscaled normal direction is correct.

Fragment shader, after the facade code:

1. Height above the ground: `float h = vWorldY + 1.0;` (ground at world `y = -1`, shared conventions section 6). Measuring from the ground means stacked parts (spec 03 setback upper bodies) continue the gradient instead of restarting it.
2. Base occlusion: `float ao = mix(AO_MIN, 1.0, smoothstep(0.0, AO_HEIGHT, h)); diffuseColor.rgb *= mix(1.0, ao, uAoStrength);` with `AO_MIN = 0.55` and `AO_HEIGHT = 0.9` world units. Windows are emissive and are not darkened.
3. Roof rim (`full` variant only): `float rim = smoothstep(vTopY - RIM_DEPTH, vTopY, vWorldY) * max(dot(vWorldNormal, uSunDir), 0.0); totalEmissiveRadiance += uSunColor * rim * uRimStrength;` with `RIM_DEPTH = 0.25` and `uRimStrength` from the stop (below). The roof top face has `dot(normal, sun) > 0` and `vWorldY == vTopY`, so it catches a faint highlight too, which separates roof from wall.
4. Night bounce (`full` variant only): `float bounce = 1.0 - smoothstep(0.0, 0.6, h); totalEmissiveRadiance += uBounceColor * bounce * uBounce;`. `uBounce` is `0.06 * windowLitRatio`, so base glow grows as the street lights come on.

Constants live in TypeScript (`AO_MIN`, `AO_HEIGHT`, `RIM_DEPTH`) and are injected into the GLSL string, so TypeScript tests and the shader share one source.

New fields on `FacadeUniforms` (defined in spec 01):

| Uniform | Type | Set from |
| --- | --- | --- |
| `uSunDir` | vec3 (world, normalized) | Before spec 05: `sun.position` normalized. After spec 05: `sky.sunDirection` (unclamped). The light's position has its Y clamped for moonlight, so it must not drive the rim after spec 05. |
| `uSunColor` | color (linear) | `sun.color` (spec 05 changes it by chapter) |
| `uRimStrength` | float | `0.35 * sunVisibility`. Before spec 05: `sunVisibility = clamp(1 - windowLitRatio * 1.3, 0, 1)`. After spec 05: `sky.sunVisibility`. |
| `uAoStrength` | float | `1 - 0.25 * windowLitRatio` |
| `uBounce` | float | `0.06 * windowLitRatio` |
| `uBounceColor` | color (linear) | warm lamp color `#ffc983` |

Before spec 05, `sunVisibility` approximates day-to-night from `windowLitRatio`. When spec 05 lands, replace it with `sky.sunVisibility` (a smoothstep on the unclamped sun elevation) and delete the approximation in the same change. At `about` it is 0 on both, so the rim is off. Moonlight (the 0.25 floor on the directional light from spec 05) lights walls but does not drive the rim, because `sunVisibility` is 0 at night. Colors written to uniforms follow shared conventions, section 1.

Lite variant (`lowPower`): gradient only (steps 1 and 2). No rim, no bounce, no extra varyings for sun or normal. The vertex shader drops `vWorldNormal` and `vTopY` in this variant. `customProgramCacheKey` already includes the variant.

### Part B: contact shadows

New module `app/journey/contact-shadows.ts`:

```ts
export interface ContactShadowField {
  mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  write(index: number, building: Building, height: number, active: boolean): void
  commit(): void   // sets instanceMatrix.needsUpdate if anything was written
  dispose(): void
}
export function createContactShadowField(totalBuildings: number): ContactShadowField
```

- One `InstancedMesh` for all buildings of all layers (96 instances today), so one draw call. Layers get consecutive index ranges. `frustumCulled = false` (shared conventions, section 2).
- Geometry: a `PlaneGeometry(1, 1)` rotated `-PI / 2` about X once in the constructor (not per instance), so quads lie flat.
- Material: `MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: SHADOW_OPACITY, alphaMap, depthWrite: false })` with `polygonOffset: true`, `polygonOffsetFactor: -1`, `polygonOffsetUnits: -1`. `SHADOW_OPACITY = 0.45`. Fog stays on, so far shadows fade to the fog color together with the ground.

`alphaMap` falloff texture. In r186, `alphamap_fragment` reads the texture's **green channel** (`.g`) and ignores texture alpha. The falloff must therefore be stored as opaque grayscale RGB: for every pixel, `R = G = B = falloff`, `A = 255`, with `falloff = 1` at the center and `0` at the edge (smoothstep). Build it with a pure function `radialFalloffPixels(size): Uint8Array` and wrap it in a `THREE.DataTexture` (no canvas, so it also runs under the Node test environment). Set `colorSpace = THREE.NoColorSpace`, linear filtering, and no mipmaps. Size 64 x 64.

Draw order. Three sorts transparent objects by `renderOrder`, then by depth, and it sorts an `InstancedMesh` as one object, not per instance. The center-line meshes are transparent too (opacity 0.5). Set the shadow mesh `renderOrder = 1` and the road markings' `renderOrder = 2` (in `createRoad`), so shadows always draw before the lines. Neither depends on camera position.
- Height: quads sit at `y = -0.995`: above the road surface (`-1`) and the ground (`-1.01`), below the center line (`-0.99`). A 0.005 gap in world Y is not reliably resolved at distance: 24-bit view-depth steps are about 0.0005 at 30 units and 0.006 at 100 units. The polygon offset covers z-fighting against the road, `depthWrite: false` keeps the quads from occluding anything, and fog hides the far field. The offset could also let a quad edge pass the depth test against a building's base. Quads sit under the footprint, so this is a hairline at most. Check it in the screenshots.
- Size: `sx = building.width * 1.5 + 0.2 + 0.12 * min(height, 2.5)` and `sz = (building.depth ?? building.width) * 1.5 + 0.2 + 0.12 * min(height, 2.5)`. `Building.depth` exists only after spec 03. Without it, `depth ?? width` keeps the shadow square instead of producing `NaN`. Taller buildings cast slightly larger soft shadows. Position is `(building.x, -0.995, building.z)`.
- Inactive buildings (`index >= activeCount` or `width === 0`): scale 0.
- Textures are disposed in `dispose()` by hand. The scene traverse disposes geometry and material but not the alpha map.

Integration: `applyBuildingState` already iterates buildings. It calls `field.write(globalIndex, building, height, active)` inside its loop (reusing the module-level matrix objects), and the dirty check from spec 03 gates both writes. If spec 03 has not landed, add the same dirty check here. `commit()` runs once per frame.

Contact shadows sit entirely under the building footprints, which are already kept clear of the road by at least `ROAD_CLEARANCE`. A shadow blob reaches at most about 0.6 units beyond the footprint, so it can overlap the road edge slightly, which is realistic.

### Tier behavior

| Situation | Behavior |
| --- | --- |
| full | Gradient with rim and bounce, plus contact shadows. |
| lowPower | Gradient only (AO), plus contact shadows. The quads are cheap: 96 instances, one call. |
| reduced | Static `uSunDir` and strengths per chapter. Otherwise follows `lowPower`. |

## Files

| File | Change |
| --- | --- |
| `app/journey/facade-material.ts` | Add gradient code, constants, uniforms (depends on spec 01). |
| `app/journey/contact-shadows.ts` | New. |
| `app/journey/buildings.ts` (or `scene.ts` if spec 03 has not landed) | Call `write`/`commit` in the building update. |
| `app/journey/scene.ts` | Update the new uniforms in `apply`, add and dispose the shadow field. |
| `tests/journey/contact-shadows.test.ts` | New. |
| `tests/gpu/gradient.spec.ts` | New. |

## Testing

Unit (Vitest, `tests/journey/`):

1. `shadowTransform(building, height, active)` (a pure function used by `write`): scale is 0 for inactive and for `width === 0`. For active buildings it returns `y = -0.995`, size equal to the formula above, and grows with height up to the 2.5 clamp. Run it with a building that has `depth` and one that does not (the order where spec 03 has not landed); neither returns `NaN`.
2. `aoFactor(h)` (TypeScript mirror of the GLSL formula using the shared constants): equals `AO_MIN` at `h = 0`, `1` at `h >= AO_HEIGHT`, and is monotonic in between.
3. The uniform mapping function (`facadeLookFor(state, sun)`): `uAoStrength` and `uBounce` at the four stop values. For `uRimStrength` there are two groups of cases. Before spec 05: `uRimStrength = 0.35 * clamp(1 - 1.3 * windowLitRatio, 0, 1)`, which is 0 at `windowLitRatio >= 0.77`. After spec 05 (when `sky.sunVisibility` feeds it): `uRimStrength = 0.35 * sunVisibility`, so it follows the unclamped sun elevation and may stay positive at `windowLitRatio >= 0.77` during a transition. Keep the two groups in separate test blocks, and delete the first when spec 05 lands.
4. `radialFalloffPixels(64)`: the center pixel is `(255, 255, 255, 255)`, the corner pixel is `(0, 0, 0, 255)`, `R = G = B` everywhere, and the green value falls monotonically with distance. A mid-radius pixel has an intermediate green value. `createContactShadowField` (with the texture generator injected, or using `DataTexture`, which needs no DOM) allocates one instance per building and one mesh. `commit()` sets `needsUpdate` only after a `write` changed a matrix.

GPU (Playwright, `tests/gpu/gradient.spec.ts`):

5. Gradient: the AO term is tested directly, not through lit luminance. Lit luminance includes r186's dielectric specular term (base reflectance 0.04 even at `roughness = 1`), fog, and hemisphere versus direct light, none of which AO scales. The facade shader therefore has a compile-time debug define, `FACADE_DEBUG_AO`, that replaces the final fragment color with `vec4(vec3(aoEffective), 1.0)`, where `aoEffective = mix(1.0, ao, uAoStrength)` is the exact multiplier applied to `diffuseColor`. The test builds the material with the define, renders a wall into an 8-bit target (values are 0 to 1 and need no HDR), and reads the red channel at heights 0.2 and 1.5 above the base. It asserts `aoEffective(0.2) / aoEffective(1.5)` is at most 0.70 for chapters 0 to 3 on both variants, matching the expected 0.61, 0.64, 0.67, 0.70. The define adds a distinct `customProgramCacheKey` suffix and is never set outside tests.
6. Height independence of the AO term: with the same disabled terms, sample the same world height on a building at two different heights. Luminance matches within 3%. Separately, with the rim enabled, assert the rim **moves with the roof**: the brightest wall row sits within `RIM_DEPTH` of the top at both heights. The AO height test uses `FACADE_DEBUG_AO`, so it has no window, rim, bounce, fog, or specular contribution.
7. Contact shadow: sample a ground pixel 0.2 units outside a building edge and another 3 units away. The near pixel is darker. For an inactive building the pixel next to its position matches the far pixel.
8. Rim: at `intro`, a roof-edge pixel on a sun-facing wall is brighter than the wall pixel 0.6 units below. At `about`, the difference is below 2/255, driven by whichever visibility source is active (the `windowLitRatio` approximation before spec 05, `sky.sunVisibility` after). A sunset case for the second source (elevation -3, `sunVisibility` about 0.92) asserts the rim is still visible, while moonlight alone (elevation -22) gives none.
9. Shader errors and context restore: recorder empty for both variants; after `loseContext()` and `restoreContext()` the shadow alpha map and gradient render the same pixels.

Manual verification (shared conventions, section 9): entrance view at all four chapters, plus mid-transition. Check there is no visible seam where the shadow quad meets the road edge and no z-fighting at 60 to 100 units.

Performance: shared conventions, section 8. Budget 0.3 ms each on desktop and iPhone.

## Risks

- **Double darkening at night**: AO plus low hemisphere light plus fog can crush building bases. `uAoStrength` falls with `windowLitRatio`, and the night bounce lifts bases. Check `about` for lost silhouettes.
- **Stale sun on `reduced`**: static strengths per chapter. If spec 05 is not applied, the rim direction is the fixed `(-4, 6, 4)`.
- **Alpha overdraw**: 96 overlapping blurred quads. Coverage is small and the quads are transparent without depth writes, so cost is low, but verify on the iPhone.
- **Polygon offset side effects**: the offset applies only to the shadow material.

## Dependencies

- Requires spec 01 for Part A. Part B stands alone.
- Coordinates with spec 03 on the shared update loop and dirty check.
- Improves with spec 05 (real sun direction and elevation), and spec 06/07 (night light sources).

## Open questions

None.
