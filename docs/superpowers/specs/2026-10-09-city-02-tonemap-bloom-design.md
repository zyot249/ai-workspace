# City polish 02: Tone mapping and selective bloom

Date: 2026-10-09
Status: Draft, pending review and prioritization
Direction: Realistic dusk/dawn skyline
Series: City polish (02 of 08). Read [00 shared conventions](2026-10-09-city-00-shared-conventions.md) first.

## Problem

The renderer outputs raw linear colors with no tone mapping and no post-processing. Bright sources (lit windows, lamps) cannot exceed white, so they look the same as any light surface. There is no glow, no highlight roll-off, and no sense of exposure changing from day to night.

## Goal

Add a filmic tone-mapping curve with a per-chapter exposure, and a subtle bloom that only bright emissive sources trigger. Lit windows and lamps glow at dusk and night. The day chapter stays clean.

Success criteria:

- At chapter `intro` bloom is off. The picture matches the approved tone-mapped palette (the `T(authored)` sky and fog below), which is slightly darker and less saturated than today's flat colors. This is an accepted, visible change, reviewed in the before/after screenshots.
- At chapters `projects`, `skills`, and `about` lit windows show a soft halo that grows with the chapter. The sky and wall surfaces do not bloom.
- The sky and fog pixels at the horizon, sampled at each chapter, match between the composer and direct pipelines within 3/255 per channel. The reference is the tone-mapped palette `T(authored)`, not the authored hex (see "Tone mapping choice"). The direct pipeline reaches parity by applying the curve to sky and fog on the CPU.
- On the composer pipeline, mean render cost rises by at most 2 ms at a 2560 x 1440 drawing buffer on the named reference desktop. On the direct pipeline, mean render cost rises by at most 0.5 ms on a physical iPhone. Both use the render-cost procedure in shared conventions, section 8.
- Context loss and restore leave the scene correct on both pipelines, including bloom state after a resize.
- A device that cannot render to a half-float target, or that fails the multisample probe, falls back to the direct pipeline without error.

## Non-goals

- Depth of field, vignette, film grain, color grading LUTs, and screen-space reflections. Out of scope for the series.
- Bloom on low-power devices. They get tone mapping only. Lamp glow on phones comes from sprites in spec 07.
- Window emissive values. Specs 01 and 06 own them. This spec defines the brightness contract they follow (see "Making bright sources exceed the threshold") and changes only the lamp and courtyard materials that exist today.

## Current state

- `new THREE.WebGLRenderer({ canvas, antialias: tier !== 'lite' })` in `createJourneyScene`. No `toneMapping`, no `toneMappingExposure`.
- `renderer.render(scene, camera)` is called once per frame in `update`.
- `scene.background` is a `Color` mutated each frame from `state.skyColor`. `FogExp2` color follows `state.fogColor`.

## Design

### Tone mapping choice

Use `THREE.NeutralToneMapping` (Khronos PBR Neutral). It compresses highlights and keeps mid-tones close to the input, which preserves most of the authored palette. It does not preserve every color. In r186 it subtracts an offset that depends on the minimum channel, then compresses highlights above about 0.76, so dark and saturated colors change. Applying the r186 formula to the authored sky colors at the exposures below gives `#bfdbfe` -> `#b2cdef` (intro), `#fbbf9f` -> `#eeb393` (projects), and `#1e2340` -> `#05133f` (about). The result is a slightly darker, less saturated sky. This is a visible change from today, and it is the intended look of a filmic curve. If a chapter's sky looks wrong, retune its hex in `stops.ts` and treat the new value as the HDR scene color.

Keep the curve in one constant, `TONE_MAPPING`, so a later experiment with ACES or AgX is a one-line change.

Design rule: `STOPS` sky and fog colors are scene colors. The final pixel is `T(color * exposure)`, on both pipelines.

### Two pipelines

| Pipeline | Used when | Tone mapping applied by |
| --- | --- | --- |
| Composer: `RenderPass` -> `UnrealBloomPass` -> `OutputPass` | `!lowPower` and the capability probe passes | `OutputPass` |
| Direct: `renderer.render` | `lowPower`, or the probe fails | The renderer (`renderer.toneMapping`) |

`lowPower` is the flag from shared conventions, section 3. It replaces the earlier plan to key on `tier`, because a phone with reduced motion enabled reports `tier === 'reduced'` and would otherwise get the desktop pipeline.

How each pipeline treats the sky and fog:

- Composer: the background and fog render into the HDR target, and `OutputPass` tone-maps the whole frame. Sky and fog are therefore tone-mapped for free.
- Direct: three clears to `scene.background` without tone mapping, and applies fog after the tone-mapping chunk, so sky and fog would stay at their authored colors and no longer match the composer. `post.ts` exports `neutralToneMap(rgbLinear, exposure)`, a TypeScript mirror of r186's `NeutralToneMapping` (source: `node_modules/three/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js`), which operates on linear values after multiplying by exposure. In `apply(state)`, on the direct pipeline only, the scene writes `neutralToneMap(toLinear(state.skyColor), exposure)` converted back to sRGB into `scene.background`, and the same for `fog.color`. The forward map is exact and needs no solver.

Highlights above 1.0 never appear in the sky or fog, so the bloom threshold (luminance 1.0) cannot catch them. An earlier draft inverted the curve to preserve the authored hex; the inverse pushes the day sky's blue channel to about 4.5 in the HDR buffer, which sits at the bloom threshold, so the forward approach is preferred.

### Capability probe and fallback

Before building the composer, `post.ts` runs `probePostSupport(renderer)`:

1. Half-float rendering: `renderer.extensions.has('EXT_color_buffer_float')` or `renderer.extensions.has('EXT_color_buffer_half_float')`.
2. Multisampling for the HDR format: `gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES)`. Choose the largest reported count that is at most 4, else 0 (no MSAA).
3. Framebuffer completeness. `EffectComposer.render()` restores the previously bound render target, usually the default framebuffer, so checking the status after a render validates the screen, not the HDR target. Instead, after one render, bind each target explicitly with `renderer.setRenderTarget(target)` and check `gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE` for the composer's two targets and the bloom pass's bright-pass target. Then call `renderer.setRenderTarget(null)`.

If step 1 or 3 fails, `createPostPipeline` disposes the composer, passes, and render targets it created, calls `renderer.setRenderTarget(null)`, drains `gl.getError()` in a loop until it returns `NO_ERROR`, and returns `null`. Draining before the shared guard (shared conventions, section 2) runs keeps a handled probe failure from becoming an `unavailable` error. The scene then uses the direct pipeline. The shader-error recorder does not see framebuffer failures, which is why step 3 exists.

### New module: `app/journey/post.ts`

```ts
export interface PostPipeline {
  render(): void
  setSize(width: number, height: number, pixelRatio: number): void
  setLook(exposure: number, bloomStrength: number): void
  dispose(): void
}

export function createPostPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostPipeline | null // null: probe failed, use the direct pipeline

export function neutralToneMap(rgbLinear: readonly [number, number, number], exposure: number): [number, number, number]
export function skyForDirectPipeline(authoredSrgb: readonly [number, number, number], exposure: number): [number, number, number] // sRGB out
```

Implementation notes:

- Create the composer with a custom render target: `new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples })`, where `samples` comes from the probe. The composer's default target has no multisampling, and the renderer's `antialias` flag only affects the default framebuffer, so edges would alias without this.
- `UnrealBloomPass` parameters: pass the full drawing-buffer size as `resolution`. The stock pass halves it internally (its constructor and `setSize` both divide by 2), so bloom runs at half resolution without any extra halving here. `radius = 0.5`, `threshold = 1.0`, `strength` set per frame by `setLook`.
- `setLook` sets `renderer.toneMappingExposure` and `bloomPass.strength`. When `bloomStrength < 0.01`, set `bloomPass.enabled = false` so day frames skip the bloom cost.
- `dispose()` calls `composer.dispose()` and disposes the custom render target and each pass.
- `setSize` forwards to `composer.setSize` and `composer.setPixelRatio`.

### Exposure and bloom per chapter

Add two fields to `StopState` (follow shared conventions, section 4):

| Chapter | `exposure` | `bloomStrength` |
| --- | --- | --- |
| intro | 1.00 | 0.00 |
| projects | 1.00 | 0.12 |
| skills | 1.10 | 0.28 |
| about | 1.25 | 0.42 |

These are starting values. Tune in screenshots. Exposure rises at night because lit windows and dim ambient light need to read, and it stays within one stop.

### Making bright sources exceed the threshold

The brightness contract uses linear luminance (Rec. 709 weights: 0.2126 R + 0.7152 G + 0.0722 B), the quantity `UnrealBloomPass`'s high-pass filter thresholds. A color multiplier is not luminance: the warm window tint `#ffe1a8` has linear luminance of about 0.78, so a gain of 1.6 gives only 1.25.

Contract: a source that should glow outputs linear luminance of at least 2.0 before fog, and the table sets about 2.1 so rounding does not drop a source below it. The 2.0 target leaves headroom because bloom thresholds the already-fogged, antialiased, downsampled image, and a small window loses brightness to all three. A far window fading into fog correctly stops blooming, which reads as atmospheric depth.

Current emissive sources and their gain (computed for luminance 2.0):

| Source | Owner | Color | Gain |
| --- | --- | --- | --- |
| Facade windows | Spec 01 | `#ffe1a8` (linear luminance 0.779) | 2.7 |
| Market lamp glow (`lampGlow`) | This spec | `#ffdca8` (0.753) | 2.8 |
| Courtyard windows | This spec | `#ffe1a8` (0.779) | 2.7 |

Gains come from `ceil(2.1 / luminance * 10) / 10`, which gives about 5% headroom over 2.0. A gain of 2.6 on the lamp gives only 1.96, below the contract.

This spec changes the two materials it owns by multiplying their `color` by the gain in the table after construction and adds a unit test (see Testing) that computes each color's linear luminance and asserts it is at least 2.0.

### Integration in `scene.ts`

- `createJourneyScene` gains a fourth parameter `options: { lowPower: boolean }`. `JourneyCanvas.vue` computes it from the same `TierInput` it passes to `pickTier`.
- Set `renderer.toneMapping = TONE_MAPPING` for all pipelines. On the composer path, `OutputPass` reads this value and the exposure from the renderer.
- Build the pipeline only when `!options.lowPower`. If `createPostPipeline` returns `null`, keep `renderer.render`.
- In `update`, replace `renderer.render(scene, camera)` with `post ? post.render() : renderer.render(scene, camera)`, then run the shader-error check from shared conventions, section 2. In `apply(state)`, set `renderer.toneMappingExposure` (direct) or call `post.setLook(...)` (composer), and on the direct path write the CPU tone-mapped sky and fog colors (above).
- In `resize`, also call `post?.setSize(width, height, renderer.getPixelRatio())`.
- In `dispose`, call `post?.dispose()` before `renderer.dispose()`.

All new code lives in `post.ts`. `scene.ts` gains about 12 lines.

### Context loss

Render targets and composer passes are recreated by three on the next render after `webglcontextrestored`, because the renderer rebuilds its property cache. The spec still requires an explicit check (see Testing) and, if a pass keeps stale state, a `post.setSize(...)` call in the restore path.

## Files

| File | Change |
| --- | --- |
| `app/journey/post.ts` | New. Pipeline factory, capability probe, tone-map mirror, direct-pipeline sky mapping. |
| `app/journey/scene.ts` | Tone mapping constant, `options.lowPower`, pipeline wiring, brighter lamp and courtyard-window emissives. |
| `app/components/JourneyCanvas.vue` | Compute and pass `lowPower`. |
| `app/journey/stops.ts` | Add `exposure`, `bloomStrength` to type and `STOPS`. |
| `app/journey/interpolate.ts` | Interpolate the two new fields. |
| `tests/journey/interpolate.test.ts` | Assert the new fields at p = 0, 0.5, 1. |
| `tests/journey/post.test.ts` | New. Pure functions. See Testing. |
| `tests/gpu/post.spec.ts` | New. Playwright GPU test. |

## Testing

Unit (Vitest, `tests/journey/`, no GPU):

1. `lerpStop` interpolates `exposure` and `bloomStrength` (shared conventions, section 4).
2. `bloomEnabled(strength)` returns false below 0.01. Test the boundary.
3. `neutralToneMap` matches known values for the three examples in this spec (`#bfdbfe`, `#fbbf9f`, `#1e2340` at the table exposures) to within 1/255, which also pins the mirror to r186's formula. A second test imports the shader chunk text from `three` and asserts the constants used (`0.8 - 0.04`, `0.04`, `0.15`) still appear in it, so a three upgrade that changes the curve fails the test.
4. `skyForDirectPipeline`: for each of the four authored sky and fog colors, at each table exposure and at intermediate exposures (1.05, 1.15, 1.2), the output equals `neutralToneMap` applied in linear space and converted back to sRGB, within 1/255. Outputs stay in [0, 1]. No iteration is involved, so there is no convergence case.
5. Luminance contract: each emissive color in the table above, times its gain, has linear luminance of at least 2.0 (computed from the sRGB hex with Rec. 709 weights).

GPU (Playwright, `tests/gpu/post.spec.ts`, runs the real pipeline):

6. Bloom halo, synthetic: one quad of linear luminance 2.0 on black, `strength = 0.4`: pixels within 3 px of the quad are brighter than black. With `strength = 0`: exactly black. A quad of luminance 0.8 shows no bleed (threshold check).
7. Bloom halo, real: build the actual scene at chapters `skills` and `about` with the facade material from spec 01. Pick a lit window within 10 units of the camera. Its neighbors must be brighter with bloom than without. This catches fog, MSAA coverage, and facade filtering lowering the window below the threshold. Skip this case until spec 01 lands.
8. Pass sizes: after initialization, after `setSize`, and after a pixel-ratio change, assert the bloom pass render targets are half the drawing-buffer size (not a quarter).
9. Probe fallback: force `probePostSupport` to report no half-float support. Assert the scene still renders and uses the direct pipeline.
10. Context restore: render at a non-default state (resized, `exposure = 1.25`, `bloomStrength = 0.42`). Call `loseContext()`, wait for the `webglcontextlost` event, call `restoreContext()`, wait for `webglcontextrestored`, then render through the resumed pipeline. Compare the lit source's center pixel and its adjacent halo pixels to the pre-loss values within a small tolerance. A center-pixel check alone could pass with a broken blur pass.
11. Shader errors: `UnrealBloomPass` is skipped when disabled, and the `intro` chapter disables it, so a warm-up frame at `intro` does not build bloom's fullscreen materials. The warm-up therefore runs two frames: first with `setLook(exposure, 0.5)` to force bloom on, then with the chapter's real look. Assert the recorder is empty after both. A test in `tests/gpu/post.spec.ts` renders with bloom forced on and then with it disabled.
13. Pipeline parity: render the horizon region (sky and fully fogged distance) at each chapter on both pipelines. Per-channel difference is at most 3/255.
12. Tier matrix: run items 6 and 11 for `full`, `reduced` with `lowPower = false`, and `reduced` with `lowPower = true` (expects direct pipeline, no bloom).

Manual verification (screenshots per shared conventions, section 9):

- Sky and fog pixel comparison at each chapter between the two pipelines (3/255), plus a before/after of the day sky to confirm the tone-mapped palette still looks right.
- Halo visible on windows at `skills` and `about`. None at `intro`.
- A mid-transition frame between `projects` and `skills` shows no pop when bloom turns on. Bloom is disabled below 0.01 and strength interpolates, so the transition should be continuous.

Performance: follow shared conventions, section 8. Reference desktop and iPhone model are named in the PR.

## Risks

- **Fill rate**: MSAA 4x on a half-float target plus a multi-mip bloom chain is the costliest feature in the series on integrated GPUs. Mitigation: bloom half resolution, and bloom disabled on `intro`. Fallback: drop `samples` to 2.
- **Sky drift between pipelines**: handled by applying the curve on the CPU for the direct pipeline. The mirror is a TypeScript copy of a three shader chunk, so item 3 in Testing guards against drift when three upgrades. Verify with the GPU parity test (item 13).
- **Reduced motion**: a `reduced` device that is not low-power gets the composer pipeline. Bloom is static and does not conflict with the preference. A `reduced` phone gets the direct pipeline through `lowPower`.
- **Capability gaps**: `EXT_color_buffer_float` is widely supported on WebGL2 but not guaranteed. The probe and fallback cover it. A half-float target with 0 samples renders without MSAA, which is acceptable.
- **Three upgrade**: `UnrealBloomPass` and `OutputPass` live in `three/addons`. Import paths are stable through r186. A major upgrade may move them; the harness test in item 3 will fail first.
- **Bundle size**: composer, bloom, and output pass add roughly 25 KB gzipped to the scene chunk, which already loads lazily through `await import('~/journey/scene')`. Keep the imports inside `post.ts` so `lite` tier users still download it. Measure and, if above 30 KB, load `post.ts` dynamically only when `tier !== 'lite'`.

## Dependencies

- Benefits from spec 01 (bright windows) and spec 07 (lamps). It works without them through the lamp and courtyard changes in this spec.
- Spec 08 (wet road) relies on bloom to catch specular highlights. It does not require this spec.

## Open questions

None. Neutral tone mapping and the exposure table are starting values to tune against screenshots.
