# City polish 01: Procedural facade shader

Date: 2026-10-09
Status: Draft, pending review and prioritization
Direction: Realistic dusk/dawn skyline
Series: City polish (01 of 08). Read [00 shared conventions](2026-10-09-city-00-shared-conventions.md) first. The index is at the end of this file.

## Problem

Journey buildings are flat-colored boxes. Windows are a separate `InstancedMesh` of 6 small quads per near-layer building, placed only on the +Z face. The quads float 0.01 units off the wall, appear only on one side, and fade in together through one opacity value. Mid and far layers have no windows. At dusk the skyline reads as grey blocks.

## Goal

Buildings show a believable facade: floor lines, window grid, glass that reflects the sky by day, and lit windows at night. The facade stays glued to the building while its height animates between chapters.

Success criteria:

- Every visible side face of every building layer shows a window grid. Top faces show none.
- No floating window quads remain. The window mesh and its per-frame matrix update are deleted.
- When `buildingHeight` animates from 0.6 to 1.0, windows keep their physical size and spacing. They are revealed or hidden by the growing wall, and they do not stretch.
- At chapter `intro` (`windowLitRatio` 0.05) almost no windows are lit. At chapter `about` (0.9) most are lit.
- Draw calls go down by one (the window mesh is removed). No frame-time regression above 10% on the `lite` tier.

## Non-goals

- Per-window color variety, flicker, and floor-dependent lighting. These belong to spec 06.
- Ambient-occlusion gradient and roof rim light. These belong to spec 04.
- New building geometry. This belongs to spec 03. This spec must work with any box-like part whose scale comes from `instanceMatrix`.

## Current state

- `app/journey/scene.ts`: `createBuildingLayer` builds one `InstancedMesh<BoxGeometry, MeshStandardMaterial>` per layer. `applyBuildingState` writes the instance matrix every frame, with `scale = (width, height, width)` and `y = height / 2 - 1`.
- `createWindows` and `applyWindowState` (about 50 lines) build and update the quads.
- `apply()` sets `windowsMesh.material.opacity = state.windowLitRatio`.

## Design

### Why a shader, not a texture

Instance scale changes every frame while `buildingHeight` animates. A UV-mapped texture stretches with the scale. A shader that works in scaled object space (`position * instanceScale`) gives a grid in world units, so windows keep their size.

### New module: `app/journey/facade-material.ts`

Exports:

```ts
export interface FacadeUniforms {
  uLit: { value: number }      // 0..1 fraction of lit windows (windowLitRatio)
  uSkyTint: { value: THREE.Color } // glass reflection tint (current sky color)
}

export type FacadeVariant = 'full' | 'lite'

export function createFacadeMaterial(options: {
  color: number
  uniforms: FacadeUniforms
  variant: FacadeVariant
}): THREE.MeshStandardMaterial
```

The function returns a `MeshStandardMaterial` patched through `onBeforeCompile`. Set `customProgramCacheKey` to `facade-${variant}`. Materials with the same variant share one compiled program, and the two variants never collide in the cache. Each layer still gets its own material instance for its base `color`. The variant is `lite` when `lowPower` is true and `full` otherwise (shared conventions, section 3).

### Patch points (three r186 chunk names)

Vertex shader:

1. After `#include <begin_vertex>`, compute the scaled object-space position:
   - `vec3 s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));`
   - `vFacadePos = (position + vec3(0.0, 0.5, 0.0)) * s;` and `vFaceNormal = normal;`

   The `+ 0.5` makes `y` measured up from the building base. The base is the fixed point: `applyBuildingState` places the center at `height / 2 - 1`, so the base stays at world `y = -1` while the top moves. Measuring from the center would slide every row as the height animates.
2. Pass a per-instance seed: `attribute float aSeed; varying float vSeed;`.

Fragment shader:

1. After `#include <color_fragment>`, choose 2D facade coordinates from the face normal. r186's `color_fragment` multiplies `diffuseColor` by the instance color (`vColor`), so patching after it means `diffuseColor.rgb` already holds the wall albedo (material color times per-instance tint) and is used as `wallColor` below. Glass colors are assigned directly and do not inherit the wall tint:
   - `abs(vFaceNormal.x) > 0.5`: `uv = vec2(vFacadePos.z, vFacadePos.y)`
   - `abs(vFaceNormal.z) > 0.5`: `uv = vec2(vFacadePos.x, vFacadePos.y)`
   - `abs(vFaceNormal.y) > 0.5`: no windows (roof).
2. Compute the cell: `cell = floor(uv / CELL)` with `CELL = vec2(0.16, 0.22)` world units. Compute `local = fract(uv / CELL)`. Window rect is `local` inside `[0.2, 0.8] x [0.18, 0.82]`.
3. Hash `h = hash(vec3(cell, vSeed))`. A window is lit when `h < uLit`.
4. Anti-aliasing (`full` variant): `vec2 aa = fwidth(uv) / CELL;` (both axes). Let `fade = smoothstep(0.35, 0.7, max(aa.x, aa.y))`. Multiply the window-rect coverage, the floor-line coverage, and the emissive term by `1.0 - fade`, and blend the diffuse color toward the average facade color by `fade`. Filtering all three terms stops lit windows from shimmering at distance.
5. Output:
   - Unlit window: `diffuseColor.rgb = mix(wallColor, uSkyTint * 0.35, 0.6)` (dark glass that picks up the sky). `uSkyTint` is stored in linear working space (see Integration).
   - Lit window: `diffuseColor.rgb` stays dark glass, and `totalEmissiveRadiance += warmColor * EMISSIVE_GAIN` in the `emissivemap_fragment` replacement. `warmColor` is the linear value of `#ffe1a8` (linear luminance about 0.78). `EMISSIVE_GAIN = 2.7` puts lit windows at linear luminance of about 2.1, the brightness contract that spec 02's bloom threshold relies on (see spec 02, "Making bright sources exceed the threshold").
   - Floor line: a 0.02-unit band at each cell boundary in y, slightly darker than the wall.

`aSeed` is an `InstancedBufferAttribute` (Float32, one value per instance) set once from `seeded(layerIndex * 1000 + i)`. Spec 03 splits a building into several box instances. In that case every part instance gets a value, and parts of the same building share the building's seed. The attribute length must equal the `InstancedMesh` instance count, or the extra instances read zeros. Spec 03 also adds `aWindowed` the same way.

### Integration in `scene.ts`

- Create one `FacadeUniforms` object. Pass it to every layer's material.
- In `apply(state)`: `facade.uLit.value = state.windowLitRatio; facade.uSkyTint.value.setRGB(state.skyColor[0], state.skyColor[1], state.skyColor[2], THREE.SRGBColorSpace)`. `state.skyColor` holds sRGB values (see `hexToRgb`), and `setRGB` defaults to linear. Passing the color space matches how `sky` and `fog` are set today.
- Delete `createWindows`, `applyWindowState`, `windowsMesh`, `WindowLight`. This frees about 55 lines in a 692-line file.
- Mid and far layers use the same material class, so they get windows for free.

### Tier behavior

| Tier | Behavior |
| --- | --- |
| full | Full shader, `fwidth` anti-aliasing. |
| lite (`lowPower`) | `lite` variant: no `fwidth`. Fade window rect, floor lines, and emissive to the average facade color by view depth: `fade = smoothstep(FADE_NEAR, FADE_FAR, -mvPosition.z)` with `FADE_NEAR = 6.0` and `FADE_FAR = 14.0` world units. `FogExp2` has no finite distance, so the thresholds are fixed view depths. Tune them in screenshots. |
| reduced | Variant follows `lowPower`. `uLit` is set once per chapter (no animation). |

### Shader guard and failure path

`onBeforeCompile` uses string replacement. If a three upgrade renames a chunk, the replacement silently does nothing. Three also calls `onBeforeCompile` during a render, not at scene creation, and it logs GLSL errors instead of throwing them. This spec implements the guard defined in shared conventions, section 2:

1. `replaceOrThrow(source, marker, replacement)` in the new `app/journey/shader-utils.ts` throws when a marker is missing.
2. A shader-error recorder (also in `shader-utils.ts`) is installed on `renderer.debug.onShaderError` at the start of `createJourneyScene`. A warm-up frame at the end of `createJourneyScene` checks it, and `update` checks it after every render.
3. `JourneyCanvas.vue` `render()` wraps `scene.update(...)` in `try`/`catch`, stops the loop, disposes the scene, and emits `unavailable`.

## Files

| File | Change |
| --- | --- |
| `app/journey/facade-material.ts` | New. Material factory and GLSL strings. |
| `app/journey/shader-utils.ts` | New. `replaceOrThrow`, shader-error recorder. |
| `app/journey/scene.ts` | Use the facade material, delete window code, update `apply`, add `compile` guard. |
| `app/components/JourneyCanvas.vue` | Guard `render()` with `try`/`catch` that emits `unavailable`. |
| `app/journey/shader-utils.ts` | (above) also holds the shader-error recorder. |
| `tests/journey/facade-material.test.ts` | New. See Testing. |
| `tests/gpu/facade.spec.ts` | New. Playwright GPU test. |
| `playwright.config.ts`, `package.json` | Add Playwright and the `test:gpu` script. |

## Testing

GLSL does not run under Vitest. Test what can run:

1. `replaceOrThrow` throws with a clear message when the marker is absent.
2. Run the patch against `THREE.ShaderLib.standard.vertexShader` and `.fragmentShader` from the pinned three version. Assert each marker exists. This test fails on a three upgrade that renames a chunk.
3. `createFacadeMaterial` returns a material whose `onBeforeCompile` registers `uLit` and `uSkyTint` on the shader it receives (call it with a fake shader object), and whose `customProgramCacheKey()` differs between the two variants.
4. A real render check in `tests/gpu/facade.spec.ts`. Marker and fake-shader tests can pass with invalid GLSL. The Playwright test creates the scene on a canvas for the `full` and `lite` variants, renders frames at the four chapters, and asserts the shader-error recorder is empty and `gl.getError()` is `NO_ERROR`. See shared conventions, section 8.
5. A grid-anchor test for the TypeScript half: given a building at heights 0.6 and 1.0, the world-space `y` of floor line N is identical. Implement the grid math as a small pure function that the GLSL mirrors, and test the function.

Manual verification (record screenshots in the PR):

- Desktop at the four chapters, plus mid-transition frames at progress 0.5 between chapters 0 and 1 (height animating).
- iPhone 14 Pro Max emulation (lite tier).
- Run the existing WebGL context-loss recovery flow (`WEBGL_lose_context`). After restore, confirm the material recompiles and `uLit` and `uSkyTint` still show the current chapter's values.

Performance procedure (the 10% criterion):

- Measure on a physical iPhone, not emulation. Emulation uses the host GPU and cannot show phone cost.
- Method: the render-cost procedure in shared conventions, section 8 (uncapped loop with a GPU sync, mean and p95 ms per frame, three runs, medians). The `lite` budget is the 10% criterion above.

## Risks

- **Instance scale extraction**: `length(instanceMatrix[i].xyz)` assumes no shear. Current matrices use only translation and scale, so this holds. Spec 03 must keep parts scale-only.
- **Fragment cost on lite**: about 12 ALU operations extra per fragment. Measure with the frame-time probe before enabling on phones. Fallback: disable the grid on far layers on lite.
- **Moire at grazing angles**: mitigated by `fwidth` fade. Verify at the long straight views in chapter `intro`.

## Dependencies

- Required by: spec 04 (shares the material), spec 06 (extends the window logic).
- Independent of: specs 02, 05, 07, 08.

## Open questions

None. Cell size (0.16 x 0.22) and window ratios are starting values. Tune them in screenshots during implementation.

## Index of the series

1. 01 Facade shader (this file)
2. 02 Tone mapping and bloom
3. 03 Building shape variety
4. 04 Vertical gradient and contact shadows
5. 05 Sky dome and atmospheric haze
6. 06 Staggered night windows
7. 07 Street life
8. 08 Wet road and road detail
