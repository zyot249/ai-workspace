# City polish 00: Shared conventions

Date: 2026-10-09
Status: Draft, pending review
Applies to: specs 01 to 09 of the City polish series

This file holds rules that every spec in the series follows. Each spec links here instead of repeating them.

## 1. Color space

`StopState` colors (`skyColor`, `fogColor`, and any new `Vec3` color) are sRGB values produced by `hexToRgb`. `THREE.Color.setRGB(r, g, b)` defaults to the linear working space. Always pass the space explicitly:

```ts
color.setRGB(state.skyColor[0], state.skyColor[1], state.skyColor[2], THREE.SRGBColorSpace)
```

Colors written as hex in code (`new THREE.Color(0xffe1a8)`) are converted by three. Colors written into shader uniforms as raw numbers are not, so convert them first.

## 2. Shader patching and failure path

- Patch built-in materials with `onBeforeCompile` and `replaceOrThrow(source, marker, replacement)` from `app/journey/shader-utils.ts`. Never use a bare `String.replace` on shader source, because a missing marker would fail silently.
- Three calls `onBeforeCompile` at the first render that needs the program, not at scene creation. Three also logs GLSL compile and link errors instead of throwing, and `renderer.compile()` does not reliably surface them, because r186 defers error reporting until the program's uniforms or attributes are first read.
- The guard therefore uses real renders:
  1. At the start of `createJourneyScene`, set `renderer.debug.onShaderError` to a recorder that stores the first error.
  2. At the end of `createJourneyScene`, first apply the initial state: call `apply(current)`, `resize(...)` with the canvas size, and position the camera. Then run warm-up frames through the real pipeline (`post.render()` when a post pipeline exists, otherwise `renderer.render`). With a post pipeline, run the frame twice: once with every optional pass forced on (for example bloom strength above 0), then with the chapter's real state. A pass that is disabled in the initial chapter is skipped by `EffectComposer`, so its fullscreen materials would otherwise not compile until later. These materials are not part of `scene`. Applying state first matters: instances keep identity matrices until the first `apply`, and r186 caches an `InstancedMesh` bounding sphere on its first render, which `setMatrixAt` does not invalidate. Set `frustumCulled = false` on every `InstancedMesh` whose matrices change over time (all building, window, car, and lamp meshes in this series). They surround the camera, so culling gains nothing. Then check the recorder and `gl.getError()`. On any error, dispose and throw. `JourneyCanvas.vue` already catches creation errors and emits `unavailable`.
  3. `scene.update(...)` checks the recorder after every render and throws if it holds an error. This covers programs rebuilt after a context restore.
- `JourneyCanvas.vue` `render()` wraps `scene.update(...)` in `try`/`catch`. On error it stops the loop, disposes the scene, and emits `unavailable`. Spec 01 introduces this change. Later specs rely on it.
- Additive materials need fog attenuated toward black, not mixed toward the fog color: `attenuateAdditiveFog(material)` in `shader-utils.ts` (introduced in spec 07). Any additive object added by a later change uses it.
- When two variants of a patched material exist (for example per tier), `customProgramCacheKey` includes the variant name.

## 3. Tiers

`pickTier` returns `full`, `lite`, `reduced`, or `none` (`app/journey/tier.ts`). Each spec states its behavior per tier using this meaning:

| Tier | Who gets it | Budget stance |
| --- | --- | --- |
| full | Desktop, fine pointer, width 768 px or more | May use extra passes and higher counts. |
| lite | Coarse pointer or width under 768 px (phones, tablets), without reduced motion | No extra render passes. Lower counts. Cheaper shader variants. |
| reduced | `prefers-reduced-motion` | Static look per chapter. No time-driven animation. Cost and detail follow `lowPower`, so `reduced` + `lowPower` behaves like `lite` without motion. |
| none | No WebGL | Hero gradient fallback. Not touched by this series. |

`pickTier` checks reduced motion before device class, so a phone with reduced motion enabled gets `reduced`, not `lite`. Motion preference and device power are separate questions. The series adds a second flag, `lowPower`, computed in `JourneyCanvas.vue` from the same `TierInput` (`coarsePointer || width < LITE_MAX_WIDTH`) and passed to `createJourneyScene` as an option.

Rule for every spec: `tier === 'reduced'` decides motion (no time-driven animation, no flicker, static look). `lowPower` decides cost and detail: extra render passes, MSAA render targets, shader variants, instance counts, and archetype sets. A `reduced` phone therefore gets the cheap rendering and no animation. Today, such a phone gets desktop-size counts. The change is deliberate and applies from spec 01 onward (`lite` in a table below means `lowPower`).

Phones had WebGL context loss in October 2026 (see commits 7323e76 and 83a0b07). Anything that allocates GPU resources must survive a lost and restored context.

## 4. New `StopState` fields

Spec 09 splits `StopState` into two parts (`StopState = PathState & LookState`). Every new field belongs to exactly one of them:

- **Path field:** where the camera is or how the city is laid out (camera distance and height, look target, building density and height). It does not change with the theme.
- **Look field:** anything visual that changes with the time of day (sky, fog, sun, clouds, lights, stars, windows, exposure, bloom, wetness). It has a value per theme.

A new **look field** requires all four of these changes in the same commit:

1. The field on the `LookState` type in `app/journey/stops.ts`.
2. A value in each of the eight `LOOKS` entries (`LOOKS.light` and `LOOKS.dark`, four chapters each). Pick the light value deliberately; do not copy the dark value by default.
3. A line in `lerpLook` in `app/journey/interpolate.ts`. `lerpLook` lists every field by name, so a missed field breaks the scroll arc and the theme blend silently. Angles use `lerpAngle`.
4. An assertion in `tests/journey/interpolate.test.ts` that the field interpolates at p = 0, 0.5, and 1, and that `target(c, p, 0)` and `target(c, p, 1)` return the light and dark values.

A new **path field** requires the same four changes against `PathState`, the four `PATH_STOPS` entries, `lerpPath`, and an interpolation test. It must not depend on `themeMix`.

**Before spec 09 lands**, the old rule applies: add the field to `StopState`, to each of the four `STOPS`, to `lerpStop`, and to `interpolate.test.ts`. Spec 09's implementation moves every such field into `PathState` or `LookState`.

## 5. File size and module layout

`scene.ts` is 692 lines, near the 800-line soft ceiling in `.claude/rules/common/coding-style.md`. New feature code goes in new modules under `app/journey/`. `scene.ts` keeps only wiring: creating objects, adding them to the scene, and calling their `update` in `apply`.

## 6. World anchors

| Item | World Y |
| --- | --- |
| Building base | -1 |
| Road surface | -1 |
| Road center line | -0.99 |
| Ground plane | -1.01 |
| Camera height | 0.2 to 0.8 |

Road half width is 3 (`ROAD_HALF_WIDTH`). The path is 100 units long (`PATH_TOTAL_LENGTH`) and turns 90 degrees twice.

## 7. Dispose and context loss

- Anything with GPU resources (geometry, material, texture, render target, composer) is disposed in `JourneyScene.dispose()`. The existing `scene.traverse` disposes meshes, points, and instanced meshes. Textures, render targets, and composers are not reached by it, so each spec lists what it disposes by hand.
- Test the lost-and-restored path with the `WEBGL_lose_context` extension (`loseContext()` then `restoreContext()`) after each spec's implementation. Confirm the scene resumes with the correct chapter state.

## 8. Verification harness

Test locations:

- Unit tests (Vitest, Node, no GPU) live in `tests/journey/*.test.ts`. `vitest.config.ts` only discovers `tests/**/*.test.ts`, so tests placed under `app/` would be skipped by `npm test`.
- GPU tests live in `tests/gpu/*.spec.ts` and run with Playwright (Chromium, software WebGL2) through a new script `npm run test:gpu`. They are not part of `npm test`, because they need a browser. Spec 01 adds the Playwright dependency, config, and first test. Specs 02 to 08 add cases to it. A unit test alone cannot prove that GLSL compiles.
- Every GPU test that covers a shader or render pipeline runs the scene for each tier combination it touches (`full`, `lite`, and `reduced` with and without `lowPower`), performs real renders (not only `compile`), and asserts the shader-error recorder is empty.

Performance procedure used by every spec that states a millisecond budget. Display-rate frame deltas cannot show a 4 ms to 7 ms change when both fit in a 16.7 ms frame, so measure render cost directly:

1. Add a temporary build flag that runs an uncapped loop for 10 seconds. Each iteration sets the scene to a fixed chapter state, calls the real render path, then forces a GPU sync with a 1x1 `gl.readPixels`, and records `performance.now()` deltas. Report mean and p95 milliseconds per frame for chapters 0, 2, and 3.
2. Where `EXT_disjoint_timer_query_webgl2` exists (desktop Chrome), also record GPU time with it. Safari on iOS does not expose it, so the sync-based number is the iPhone figure.
3. Run on a physical iPhone and on a named reference desktop, on the commit before and the commit after. Three runs each. Compare medians. Name the device models in the PR description.
4. Resolution means drawing-buffer pixels. "1440p" means a 2560 x 1440 drawing buffer, set explicitly with `renderer.setSize` and pixel ratio 1.
5. Emulated devices use the host GPU and cannot establish phone performance. Use them only for layout and visual checks.

## 9. Visual verification

Each spec lists screenshots to capture. Capture them at the four chapters (`progress` 0 for each) and at one mid-transition frame, on desktop and on the iPhone 14 Pro Max emulation, in light and dark theme. After spec 09, light and dark are two different arcs, so each theme needs its own set, plus one frame halfway through a theme blend (`themeMix` 0.5). Store them in the PR description, not in the repo.
