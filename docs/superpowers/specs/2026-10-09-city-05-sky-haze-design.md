# City polish 05: Sky dome and atmospheric haze

Date: 2026-10-09
Status: Draft, pending review and prioritization. Palette, cloud streaks, and star rule superseded by [spec 09](2026-10-09-city-09-theme-sky-design.md), section 7.
Direction: Realistic dusk/dawn skyline
Series: City polish (05 of 08). Read [00 shared conventions](2026-10-09-city-00-shared-conventions.md) first.

## Problem

The sky is one flat color (`scene.background`) that changes per chapter. There is no horizon glow, no gradient from zenith to horizon, no visible sun, and no depth behind the nearest buildings. The ground plane ends in a hard edge that fog only partly hides. The single directional light never moves, so dusk light looks the same as noon light.

## Goal

Replace the flat sky with a gradient dome that has a sun glow near the horizon. Move the sun and its light color per chapter. Add a haze band and distant silhouettes so the skyline has depth and the ground edge disappears.

Success criteria:

- The sky shows a vertical gradient (zenith to horizon) and a sun glow whose position and color change across the four chapters. At `projects` the glow is low and warm. At `about` the glow is gone and the sky is dark and cool.
- The directional light's direction and color follow the sun, so wall shading changes between chapters.
- The ground edge is never visible as a hard line at any chapter, camera position, or portrait or landscape viewport. The ground extends to 130 units from the scene center, so its edge is at least 80 units from every camera position, where fog has fully saturated it.
- At least two depth layers of distant silhouettes are visible behind the near buildings at chapters `projects` and `skills`.
- The dome equals the authored `fogColor` exactly for every direction with `h <= 0.01`, so the horizon row matches fog to within 2/255 per channel after tone mapping. Fully fogged **ground** (appearing at about `h = -0.02` from a camera 1.8 units above it, 80 units away) dissolves into the sky without a seam at every camera heading, including mid-turn. The rule has no heading term, so it holds by construction. Distant **building tops** rise above the horizon (a 7-unit building at 60 units sits near `h = 0.1`), where the sky carries gradient and glow, so the skyline silhouettes against the sky there. That contrast is intended: fully fogged buildings read as dark shapes against a bright dusk glow.
- The sky never triggers bloom: its output luminance is capped at 0.92, below spec 02's threshold of 1.0.
- Render cost: at most +0.4 ms on the named reference desktop and +0.4 ms on a physical iPhone (shared conventions, section 8).

## Non-goals

- Volumetric clouds or a moving cloud layer. This spec includes a static, cheap cloud streak term in the sky shader (full variant only) and nothing else.
- Real-time sky models (Preetham, Hosek). The sky is an authored gradient.
- Shadow maps. The sun direction only drives shading and the rim from spec 04.
- Star twinkling. The existing `Points` stars remain unchanged.

## Current state

- `scene.background = sky` (`THREE.Color` mutated each frame from `state.skyColor`).
- `FogExp2` color follows `state.fogColor`, density follows `state.fogDensity`.
- `HemisphereLight(sky, 0x1a1a1f)` and `DirectionalLight(0xffffff, 0.8)` at `(-4, 6, 4)`. `setTheme(isDark)` changes only the intensities.
- `camera far = 120`. Stars are `Points` with `fog: false`. They fade with `windowLitRatio` on the `full` tier only.
- Ground: one plane sized to the waypoint bounds plus margins (40 units in X, 10 in Z).

## Design

### New `StopState` fields

Follow shared conventions, section 4 (type, `STOPS`, `lerpStop`, `interpolate.test.ts`).

| Field | Type | Meaning |
| --- | --- | --- |
| `skyZenith` | `Vec3` (sRGB) | Color straight up |
| `sunElevation` | number (degrees) | Angle above the horizon. Negative is below. |
| `sunAzimuth` | number (degrees) | Compass direction in world space (0 = toward -Z, positive turns toward -X) |
| `sunColor` | `Vec3` (sRGB) | Color of the glow and of the directional light |
| `sunGlow` | number 0 to 1 | Strength of the horizon glow |

The dome gradient has three stops: the horizon color is the existing `fogColor` (so fog and the horizon row are the same value), `skyColor` becomes the **mid-sky** color, and `skyZenith` is straight up. `fogColor` and `skyColor` keep their current fields and values, so `StopState` keeps `fogColor`. Starting values (the `skyColor` column is unchanged from today's `STOPS`):

| Chapter | `skyZenith` | `skyColor` (mid-sky) | `fogColor` (horizon) | `sunElevation` | `sunAzimuth` | `sunColor` | `sunGlow` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| intro | `#7fb2f0` | `#bfdbfe` | `#e0e7ff` | 38 | 20 | `#fff4e0` | 0.15 |
| projects | `#6f7fb8` | `#fbbf9f` | `#f3a683` | 7 | 5 | `#ffb27a` | 0.85 |
| skills | `#2e2a5c` | `#7c6aa8` | `#6b5b95` | -3 | 10 | `#c97aa8` | 0.45 |
| about | `#0a0d22` | `#1e2340` | `#141833` | -22 | 10 | `#7a8cc4` | 0 |

These are starting values to tune in screenshots. The sun sits ahead of and slightly to the side of the camera at `projects`, so the first views of the hall are backlit by the dusk glow. Azimuth is in world space. The camera turns twice along the path, so check each chapter's view direction and adjust per stop. Colors written to uniforms follow shared conventions, section 1.

`sunElevation` below 0 means the sun has set. The directional light keeps a minimum cool "moonlight" intensity at night (below), so the sun's light never goes to zero and flips direction.

### New module: `app/journey/sky.ts`

```ts
export interface Sky {
  mesh: THREE.Mesh              // the dome
  update(state: StopState, cameraPosition: THREE.Vector3, t: number): void
  sunDirection: THREE.Vector3   // world, normalized, unclamped, reused every frame
  sunVisibility: number         // 0..1, smoothstep(-0.3, 0, sunDirection.y)
  dispose(): void
}
export function createSky(variant: 'full' | 'lite'): Sky
```

**Dome.** A `SphereGeometry(200, 32, 16)` (24 x 12 on `lowPower`) with `side: THREE.BackSide`, rendered with `ShaderMaterial` (`fog: false`, `depthWrite: false`, `toneMapped` follows renderer rules). The mesh follows the camera position each frame, so the horizon stays at eye level and the dome never reaches the far plane. Set `renderOrder = -1000` and `frustumCulled = false`. Raise `camera.far` from 120 to 260. The dome follows the camera, so its far side is 200 units from the camera. The haze and silhouette rings are scene-centered (below) and reach up to about 135 units from the scene center, which is up to about 185 from the camera at the path ends. All of it stays inside 260.

**Fragment shader.** All colors in the shader are linear (converted on the CPU per shared conventions, section 1).

1. Gradient. `float h = normalize(vDir).y;` Define `S(x) = pow(smoothstep(0.0, 1.0, clamp(x, 0.0, 1.0)), 1.2)` and `float hh = max(h - 0.01, 0.0) / 0.99;`, which runs from 0 at `h = 0.01` to exactly 1 at `h = 1`. `vec3 low = mix(horizon, mid, S(hh / 0.4)); vec3 base = mix(low, zenith, S((hh - 0.25) / 0.75));` where `horizon` is the stop's `fogColor` and `mid` is `skyColor`. Shifting `h` by 0.01 makes the horizon row **exactly** flat: for `h <= 0.01` the color equals `horizon`, with no deviation, which also covers the dome below the horizon.
2. Sun visibility. `float vis = smoothstep(-0.3, 0.0, sunDir.y);` It is 1 above the horizon, falls to 0 at about -17 degrees elevation, and multiplies the glow and the band below. `about` also sets `sunGlow = 0`.
3. Glow envelope. `float env = smoothstep(0.01, 0.05, h);` Both sun terms below are multiplied by `env`, so nothing touches the row at `h <= 0.01`. The glow is an aureole lifted slightly off the horizon line.
4. Sun glow. `float s = max(dot(normalize(vDir), sunDir), 0.0);` `glow = pow(s, 8.0) * 0.5 + pow(s, 64.0) * 0.8;` Added as `sunColor * glow * sunGlow * vis * env`.
5. Horizon band. Added as `sunColor * 0.25 * sunGlow * vis * env * exp(-pow((h - 0.07) / 0.07, 2.0))`, weighted by `0.5 + 0.5 * dot(horizontal(vDir), horizontal(sunDir))`. A tint that hugs the horizon on the sun's side.
6. Cloud streaks (`full` variant): a two-octave value-noise function of `vec2(atan(vDir.x, vDir.z) * 3.0, h * 6.0)`, thresholded to thin horizontal bands between `h = 0.05` and `0.4`, tinted by `mix(sunColor, zenith, 0.6)`, with alpha 0.25 near the sun and 0.08 elsewhere. Static: no time term. `lowPower` skips this term.
7. Bloom cap. After all terms: `float L = dot(col, vec3(0.2126, 0.7152, 0.0722)); col *= min(1.0, SKY_MAX_LUMINANCE / max(L, 1e-4));` with `SKY_MAX_LUMINANCE = 0.92`. The sun glow at `projects` adds to a bright palette and would otherwise exceed the bloom threshold (spec 02, luminance 1.0). The cap keeps the sky out of bloom without touching the composer. The tone-mapping and output chunks follow (`#include <tonemapping_fragment>`, `#include <colorspace_fragment>`).

**Sun direction and visibility.** `sunDirection` is built from elevation and azimuth. `sun.position` (the directional light) is set to `sunDirection * 10` with its Y clamped (below); the target stays at the origin. `Sky` also exposes `sunVisibility` = `smoothstep(-0.3, 0.0, sunDirection.y)`, the same value the shader uses (`vis`). Spec 04 reads `sunDirection` and `sunVisibility` for the roof rim; it does not read `sun.position`, because the light's Y is clamped for moonlight.

**Directional light and hemisphere.** Per frame:

- `sun.color` = `sunColor` (sRGB converted).
- `sun.intensity` = `max(0.25, smoothstep(-6, 12, sunElevation) * 1.0)` times the theme factor (`setTheme`: 0.5 / 0.9 ratio kept). The 0.25 floor is moonlight. Its color at night is the cool `sunColor` of `about`.
- Hemisphere light: sky color = `skyZenith` mixed 50% with `skyColor`; ground color keeps `0x1a1a1f`.

When the sun is below the horizon its direction would point up from below. Clamp the light's `position.y` to at least `2` so night shading comes from above (moonlight), but keep `sunDirection` itself (used by the sky glow and spec 04's rim) unclamped.

### Fog

Fog keeps its authored `fogColor` and `fogDensity` from `STOPS`. The dome's horizon row is the same `fogColor`, with no heading term and no glow at `h <= 0.01`, so the fog and the horizon agree by construction at every camera heading. Fully fogged **ground** appears at about `h = -0.02`, inside the exact-match range. Distant building tops appear at positive elevation, where the sky has gradient and glow, so they silhouette against the sky and are outside this match (see the success criteria). Color space follows shared conventions, section 1: both the dome uniform and `scene.fog.color` are set from the same sRGB stop value. On the direct pipeline, spec 02's CPU tone mapping applies to `fogColor` as before.

### Ground, haze band, and distant silhouettes

New module `app/journey/skyline-far.ts`. Everything in this section is centered on the **scene center**, not the camera: `SCENE_CENTER = ((minX + maxX) / 2, (minZ + maxZ) / 2)` of `WAYPOINTS`, about `(-13, -29)`. A camera-centered ring cannot work here, because the path is 100 units long and buildings near the far end are about 95 units from the camera at the start. A ring around the camera at 88 would cut through them. From the scene center, no building is farther than about 60 units (half the path bounding box plus the 18-unit side spread), so everything below sits well outside the city.

1. **Ground.** Replace the ground plane with one sized `260 x 260` centered on `SCENE_CENTER` (radius 130). Its edge is then at least 80 units from every camera position, where `FogExp2` at the lowest density (0.045) has fog factor `exp(-(0.045 * 80)^2)`, about 2e-6: the ground is fully fog-colored. Past the edge, the dome below the horizon shows the same fog color (dome rule 1), so the edge disappears. Update the ground-size comment in `createGround`.

2. **Far silhouettes.** Two rings of boxes as `InstancedMesh` + `MeshBasicMaterial` (`fog: false`, `vertexColors: true`, **white** material color), scene-centered. r186 multiplies material color, geometry vertex color, and instance color together, so the material stays white and the geometry's vertex colors carry the whole gradient. Do not use `setColorAt` on these meshes.
   - Ring A: center distance 100 to 110, 36 boxes, width 5 to 10, depth 5 to 10, height 10 to 26.
   - Ring B: center distance 116 to 124, 36 boxes (20 on `lowPower`), same widths and depths, height 14 to 34.
   - Layout comes from `silhouetteLayout(ring, count, seed)` (pure, seeded with `seeded()` from `random.ts`).
   - Each ring has its own box geometry with a `color` attribute (24 vertices). Bottom vertices take the horizon color (`fogColor`), top vertices take the ring color: ring A is `mix(fogColor, 0x15182a, 0.22)` and ring B is `mix(fogColor, 0x15182a, 0.10)`. The base melts into the horizon without transparency. The 24 vertex colors are rewritten each frame (`needsUpdate`), in linear space via `Color.setRGB(..., THREE.SRGBColorSpace)`.
   - Fog is off on purpose: at these distances `FogExp2` would fully hide the boxes, so the explicit gradient simulates atmospheric perspective.
   - They are static in world space, so as the camera moves along the path they parallax slowly, which adds depth.
   - Far extent of any box: ring B center 124 plus the half-diagonal of a 10 x 10 footprint (7.1) is 131.1.

3. **Haze band.** An open-ended `CylinderGeometry(136, 136, 40, 64, 1, true)` centered on `SCENE_CENTER` at `y = -1 + 20`, `side: BackSide`. It sits beyond every silhouette (131.1 < 136) and beyond the ground edge (130), and its job is to soften the base of the silhouettes and the ground-to-dome transition. Material: `MeshBasicMaterial({ vertexColors: true, color: <fog color>, transparent: true, depthWrite: false, fog: false })`. In r186, vertex alpha is used only with `vertexColors: true` and a four-component color attribute, so the geometry gets an RGBA `color` attribute (`itemSize 4`) with RGB = 1 (white) and alpha 0.85 at the bottom ring of vertices, 0 at the top ring. The material color (the derived fog color) tints it. `renderOrder = -900`.

   The band sits behind both rings and behind the ground edge, so it never overlaps the city or the silhouettes. Its job is to blend the ground edge and the lower dome into one horizon haze. It does not soften the silhouettes' bases, because it is behind them. The silhouettes handle their own base blend with the vertex-color gradient described above.

4. **Draw calls.** Dome (1) + haze (1) + two rings (2) = 4 on every tier. `lowPower` uses fewer boxes and a lower-segment dome and cylinder, not fewer calls.

### Interaction with spec 02 (tone mapping)

The dome is a scene mesh, so on both pipelines it is a normally rendered object. Consequences:

- Composer pipeline: the dome writes HDR values, and `OutputPass` tone-maps them with everything else. The fog color is also tone-mapped in the same pass. The horizon match holds by construction.
- Direct pipeline: the dome's shader includes the tone-mapping chunk, so the renderer tone-maps it like any material. Fog is applied after tone mapping with the fog uniform, which is not tone-mapped, so fog would no longer match the sky. Spec 02's direct-path CPU mapping of `fogColor` (`skyForDirectPipeline`) already fixes this: keep it for fog. `scene.background` is hidden behind the dome, but keep it set to the CPU-mapped horizon color as a fallback if the dome fails to draw.
- If spec 02 has not landed, there is no tone mapping. The dome and fog use plain output and the match is direct.

### Tier behavior

| Situation | Behavior |
| --- | --- |
| full | Dome with cloud streaks (32 x 16 sphere), haze, two silhouette rings (36 + 36 boxes). |
| lowPower | Dome without clouds (24 x 12), haze (32 segments), two rings (36 + 20 boxes). |
| reduced | Static sun and sky per chapter. Otherwise follows `lowPower`. No time-driven term exists in the sky, so nothing else changes. |

### Stars

Stars stay as they are. Their opacity follows `windowLitRatio`. Draw them after the dome: set `renderOrder = -999` so they are not covered. Because `depthWrite` is false on the dome, stars inside the dome remain visible. The current star radius must be below the dome radius (200); check `createStars` and scale it if needed.

## Files

| File | Change |
| --- | --- |
| `app/journey/sky.ts` | New. |
| `app/journey/skyline-far.ts` | New. |
| `app/journey/stops.ts` | New fields and values, updated comments. `fogColor` stays. |
| `app/journey/interpolate.ts` | Interpolate the new fields. |
| `app/journey/scene.ts` | Add the sky and far skyline, 260 x 260 ground, light updates, `camera.far = 260`, `renderOrder` for stars. |
| `tests/journey/sky.test.ts` | New. |
| `tests/journey/interpolate.test.ts` | New fields at p = 0, 0.5, 1. |
| `tests/gpu/sky.spec.ts` | New. |

## Testing

Unit (Vitest, `tests/journey/`):

1. `sunDirectionFor(elevation, azimuth)` returns a unit vector. Elevation 90 gives `(0, 1, 0)`. Elevation 0 and azimuth 0 gives `(0, 0, -1)`. Azimuth 90 gives `-X`. Elevation -22 gives `y < 0`.
2. `lightFromStop(state)` returns intensity at the floor of 0.25 at `about`, and a position with `y >= 2` even when the sun is below the horizon, while `sunDirectionFor` itself is unclamped. `sunVisibility` is 1 at elevation 7, about 0.92 at -3, and 0 at -22. A separate case shows moonlight does not feed it: at `about`, `sunVisibility` is 0 while the light intensity is the 0.25 floor.
3. `lerpStop` interpolates the five new fields (shared conventions, section 4). `sunAzimuth` interpolates linearly; assert that no value in the stop table crosses a 180-degree wrap (the table values are within 40 degrees of each other).
4. `silhouetteLayout(ring, count, seed)` returns positions inside the ring's radius band, heights within the ring's range, and identical output for identical seeds. For every box, `center distance + half-diagonal` is below 136 (the haze radius). Separation from the city: compute `cityOuterRadius` as the largest distance from `SCENE_CENTER` to any building footprint corner across all layers and seeds (from the placement code; it is about 41 units today), and assert that every ring-A box's `center distance - half-diagonal` is at least `cityOuterRadius + 30`.
4b. `skyGradient(h, stopState)` (pure mirror of shader steps 1 to 7, taking linear colors from `toLinear(stop.colorSrgb)`): for `h` in [-0.03, 0.01] it returns `toLinear(fogColor)` exactly (within 1e-6) at every chapter. Endpoints: the **gradient term alone** (steps 1, without glow, band, clouds, or the cap) returns exactly the zenith color at `h = 1`. Glow and cloud terms are tested separately; at `intro` the glow adds a small nonzero amount at the zenith (sun elevation 38 degrees), which is expected. It is continuous: adjacent samples 0.01 apart in `h` differ by less than 0.05 per channel. It is **not** tested for monotonicity, because mid-sky colors in the palette can have channels that are not between the horizon and zenith values (for example `projects`). Pin the curve: `S(0.05)` is below 0.005. Luminance never exceeds `SKY_MAX_LUMINANCE` over a grid of `h` and sun-relative angles at every chapter, including `projects` looking straight at the sun. At `about` the sun terms contribute below 1/255 (`sunGlow = 0` and `vis = 0`).
4c. Haze geometry: the color attribute has `itemSize` 4, RGB all 1, alpha 0.85 on the bottom ring and 0 on the top ring, and the middle is interpolated. The material has `vertexColors: true`.
4d. Silhouette geometry colors: bottom vertices equal the horizon color and top vertices equal the ring color in linear space, and the material color is white. The mesh has no `instanceColor`.
5. `farColor(horizon, mixAmount)` stays within [0, 1] and equals `horizon` at mix 0.

GPU (Playwright, `tests/gpu/sky.spec.ts`):

6. Horizon match: at each chapter's camera heading, and at five progress points through each of the two turns, render and read the sky pixels for `h` in [-0.03, 0.01] and the fog-saturated **ground** pixel at distance 80 (elevation about -0.02). The difference is at most 2/255 per channel, on both pipelines from spec 02 (when it has landed) and on the plain renderer otherwise.
6a. Building-top contrast (separate from the horizon match): for a 7-unit wall at distance 60, the wall's fully fogged top and the sky behind it are different surfaces, so compare **displayed** pixels, not linear palette values. Compute the camera ray through the wall top's pixel and take its actual elevation `h` and its direction relative to the sun. Expected sky pixel: `output(T(skyGradient(h, ray)))` where `skyGradient` is the TypeScript mirror (with glow and cap) and `T` is the pipeline's tone mapping (`neutralToneMap` and sRGB conversion on the composer pipeline; on the direct pipeline the dome is tone-mapped by its material and the fog by the CPU mapping from spec 02). Expected top pixel: the same `output(T(fogColor))`. Assert the rendered sky pixel behind the top equals its expected value within 3/255, and the rendered top pixel equals its expected value within 3/255, for each pipeline. This documents the intended silhouette and catches an unexpected seam. Without spec 02 there is no tone mapping and `T` is the identity.
6b. Sky does not bloom: with spec 02's pipeline, render `projects` looking at the sun with bloom forced to strength 0.5 and with bloom off. The sky pixels differ by at most 2/255.
7. Ground edge: place the camera at the path start, the path end, and each waypoint, and look toward each of the four ground plane edges. No pixel row has a luminance step above 3/255 across the ground-to-dome transition. Also assert the nearest ground edge is at least 80 units from every sampled camera position.
8. Sun glow: at `projects`, the brightest sky pixel lies within 25 degrees of the sun's projected position. At `about`, the glow contribution is below 2/255.
9. Sorting: render with the haze band, silhouettes, buildings, and stars. Buildings occlude silhouettes. Stars are visible above the dome at `about`. The haze does not tint near buildings (a building pixel at distance 5 equals the same render with the haze hidden, within 1/255). Haze alpha, measured by rendering it over a black background: about 0.85 at the bottom edge, about 0.43 at mid height, and 0 at the top, within 0.03.
10. Shader errors and context restore, for the `full` and `lowPower` variants. After restore, the sky and glow match the pre-loss pixels.

Manual verification (shared conventions, section 9): all four chapters on desktop and iPhone emulation, in light and dark theme. In portrait, check that the sun glow stays in view or leaves it cleanly. Look at each chapter's turn (the camera heading changes by 90 degrees twice) for a visible ring seam in the haze or silhouettes.

Performance: shared conventions, section 8. Budget +0.4 ms on both devices.

## Risks

- **Dome and ground overlap**: the large ground plane (260 x 260) and the dome both span the horizon. Check there is no visible line where the ground's fully fogged color meets the dome's below-horizon color (test 7).
- **Overdraw of fullscreen dome**: the dome covers every pixel, and the buildings and ground cover most of it again. Render the dome first with `depthWrite: false` and test early-z behavior on the iPhone. Fallback: shrink the dome to cover only the upper hemisphere and let the ground plane plus haze cover the rest.
- **Camera far plane**: raising `far` from 120 to 260 reduces depth precision slightly. Check z-fighting in the road/ground/shadow stack (specs 04 and 08).
- **Portrait FOV**: `fovForAspect` widens the vertical FOV on portrait screens. The dome is spherical and unaffected, but the sun may sit out of view. Check each chapter in portrait and adjust azimuth.
- **Silhouettes look too sparse or regular**: 36 boxes per ring at 100+ units is a hint, not a skyline. Tune count and size in screenshots before adding more geometry.
- **Haze band mismatch**: the band is a backdrop beyond everything. If it shows a visible seam against the dome, lower its alpha. Test 9 guards sorting.
- **Moonlight floor**: the 0.25 floor plus the hemisphere light may brighten `about` more than today. Compare with the current night look and tune.

## Dependencies

- Supplies spec 04's rim direction (`sky.sunDirection`) and strength (`sky.sunVisibility`). Spec 04 uses its own approximation until this spec lands.
- Works with spec 02 (tone mapping) as described. Independent otherwise.
- Spec 06 uses `skyColor` for glass tint. It is unchanged.

## Open questions

None. The stop table is a starting point for tuning.
