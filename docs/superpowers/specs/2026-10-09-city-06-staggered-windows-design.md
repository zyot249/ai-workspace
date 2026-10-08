# City polish 06: Staggered night windows and dusk glass

Date: 2026-10-09
Status: Draft, pending review and prioritization
Direction: Realistic dusk/dawn skyline
Series: City polish (06 of 08). Read [00 shared conventions](2026-10-09-city-00-shared-conventions.md) first.

## Problem

Spec 01 lights windows with one rule: a window is lit when its hash is below `windowLitRatio`. The result is correct but uniform. Every lit window has the same warm color and brightness, every building has the same share of lit windows, and nothing moves. By day, unlit glass is a flat dark color. Real cities at dusk show buildings with very different occupancy, a mix of light colors, a few flickering screens, and glass that reflects the warm sky.

## Goal

Make the city light up like a real one while the user scrolls, and give daytime glass a sky reflection.

Success criteria:

- Windows turn on one by one as `windowLitRatio` rises, never off. Between chapters the count of lit windows is monotonic in the ratio.
- Over a large sample of windows (a window counts as lit when its fade amount exceeds 0.5), the lit fraction at `windowLitRatio` 0.05, 0.3, 0.65, and 0.9 is about 2%, 28%, 63%, and 87%, within the ranges in Testing.
- Buildings differ: at `windowLitRatio` 0.65, the expected lit fraction per building (the formula's own value, before sampling noise) has a standard deviation of at least 0.08 across buildings. Today's formula gives about 0.094, ranging from 0.50 to 0.83.
- About 70% of lit windows are warm, 20% neutral, and 10% cool. At most 4% of lit windows flicker, on `full` and not under `reduced` motion.
- A fully lit, unfiltered window (fade amount 1) at chapters with bloom enabled (`windowLitRatio >= 0.3`) has linear luminance of at least 2.0 before fog, so it passes spec 02's threshold with margin. Windows part-way through their fade-in, windows filtered by distance, and flickering windows are dimmer. The minimum flicker multiplier, 0.6, still leaves about 1.22, above the bloom threshold of 1.0 before fog.
- By day, unlit glass shows a sky tint and a sun glint on sun-facing walls (needs spec 04's uniforms).
- Cost: at most +0.2 ms on the named reference desktop and +0.2 ms on a physical iPhone (shared conventions, section 8).

## Non-goals

- Window geometry, frames, interior depth, or curtains.
- Reflections of other buildings. Spec 08 handles the road reflection.
- Time-of-day driven by real clock time. The scroll chapter drives everything.
- Sound or UI. None.

## Current state (after spec 01)

- The facade shader lights a window when `hash(cell, seed) < uLit` and adds `warmColor * EMISSIVE_GAIN` (gain 2.7, luminance about 2.1) to the emissive term.
- All lit windows use the same `warmColor` (`#ffe1a8`).
- Unlit glass is `mix(wallColor, uSkyTint * 0.35, 0.6)`, with no Fresnel and no sun term.
- `update(chapter, progress, _t, pointer)` receives time `_t` but ignores it.

## Design

All changes extend the facade fragment shader from spec 01. They land in `facade-material.ts`; the new pure helpers go in a new `window-look.ts` that holds constants shared with the shader and tests. If `facade-material.ts` grows past about 400 lines, move the GLSL strings into `facade-glsl.ts`.

### Part A: per-window threshold with building occupancy

Replace `lit = h < uLit` with:

```glsl
float k    = mix(1.25, 0.75, hash11(vSeed));    // per-building scale (vSeed is aSeed)
float t    = hash13(vec3(cell, vSeed)) * k;
float lit  = smoothstep(t, t + 0.06, uLit);     // 0..1, fades in over 6% of the ratio range
```

- `k` is a per-building threshold scale between 0.75 and 1.25. A building with `k` near 1.25 (an office tower) lights late and stays partly dark, with about 50% lit at `windowLitRatio` 0.65. A building with `k` near 0.75 (apartments) lights early and reaches about 83%. The earlier draft's narrower range (1.0 to 1.15) gave a spread of only 0.04, which does not meet the 0.08 goal.
- The smoothstep band makes each window fade in over a short span of scroll instead of snapping. Because `t` is fixed per window and `uLit` only rises with the chapters, a window never turns off as the user scrolls forward. Scrolling back reverses it symmetrically.
- Use a float hash that stays stable at `highp`: `hash13(p) { vec3 p3 = fract(p * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }` (Dave Hoskins style). Avoid `fract(sin(...))`, which bands on some mobile GPUs. Declare `precision highp float;` explicitly in the fragment patch.
- `window-look.ts` exports a TypeScript mirror: `windowLitAmount(cellHash, buildingHash, uLit): number`, using the same formula, so tests can run without a GPU.

### Part B: tints, brightness, and flicker

A second hash selects the window class:

| Class | Weight | Color (sRGB) | Notes |
| --- | --- | --- | --- |
| warm | 70% | `#ffc983` | Incandescent and LED warm |
| neutral | 20% | `#ffe9c4` | Fluorescent |
| cool | 10% | `#bfe0ff` | Screens and TVs |

- Each class has its own gain, computed with `gainFor(srgb, targetLuminance)`: `targetLuminance / linearLuminance(color)`. The target is `EMISSIVE_TARGET = 2.3`. Linear luminance is 0.647 for `#ffc983`, 0.835 for `#ffe9c4`, and 0.716 for `#bfe0ff`, so the gains are about 3.56, 2.75, and 3.21. Per-window brightness varies by a factor in `[0.92, 1.2]` from a third hash. The lowest value is `2.3 * 0.92 = 2.12`.
- The gains replace spec 01's single `EMISSIVE_GAIN` (`#ffe1a8` times 2.7) on both variants. The `lowPower` variant uses the warm class only: color `#ffc983`, gain 3.56, brightness factor fixed at 1.0, and the same `uEmissiveScale` below. Its luminance is 2.3 at full scale.
- Chapter scale. Lit windows are barely visible in daylight. Multiply emissive by `uEmissiveScale = 0.35 + 0.65 * smoothstep(0.0, 0.35, windowLitRatio)`. It is 0.39 at `intro`, 0.96 at `projects`, and 1.0 from `skills`. At `projects` the lowest fully lit window has luminance `2.3 * 0.92 * 0.96 = 2.03`, so the 2.0 contract holds for fully lit, unfiltered windows wherever bloom is on.
- Flicker (`full` variant). Windows of the cool class with a fourth hash below 0.4 (4% of all lit windows) multiply their emissive by `mix(1.0, 0.8 + 0.2 * sin(uTime * 6.3 + phase) * sin(uTime * 2.1 + phase * 1.7), uFlicker)`, where `phase = hash * 6.2832`. The inner value stays in [0.6, 1.0]. `uFlicker` is 1 normally and 0 under reduced motion, so the multiplier is exactly 1 and the window keeps full brightness when flicker is off. Setting `uTime` to 0 alone would leave the phase-dependent value between 0.6 and 1.0 and freeze some windows dim, so the explicit gate is required. The lowest flicker output, `2.03 * 0.6 = 1.22`, stays above the bloom threshold before fog, so flicker changes the halo strength without making it vanish.
- `uTime` comes from `update(chapter, progress, t, pointer)`. Write `uTime = t % 1000` (keeps `float` precision). Write `uFlicker = tier === 'reduced' ? 0 : 1`.

### Part C: dusk glass (needs spec 04 for the sun uniforms)

For unlit windows, replace spec 01's glass color with a reflection:

```glsl
vec3 N = normalize(vWorldNormal);
vec3 V = normalize(cameraPosition - vWorldPos);
float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
vec3  R = reflect(-V, N);
float glint = pow(max(dot(R, uSunDir), 0.0), 24.0) * uSunVisibility;
vec3 glass = mix(glassDark, uSkyTint, 0.35 + 0.45 * fres) + uSunColor * glint * 0.8;
```

- `vWorldNormal` and the world position varying come from spec 04's vertex additions (add `vWorldPos` if absent).
- `glassDark` is a local: `vec3 glassDark = wallColor * 0.25;`, where `wallColor` is `diffuseColor.rgb` after `<color_fragment>`. Wall albedo varies per instance (instance tint), so it cannot be a uniform. `uSkyTint` is the mid-sky color from the stop (`skyColor`), converted to linear per shared conventions, section 1. In the snippet above, replace `uGlassDark` with `glassDark`.
- `uSunDir`, `uSunColor`, and `uSunVisibility` are the spec 04 and spec 05 uniforms (`sky.sunDirection`, `sky.sunVisibility` after spec 05; the approximation from spec 04 before it).
- If spec 04 has not landed, skip the glint and Fresnel and keep spec 01's flat tint. The `full` variant only: `lowPower` keeps the flat tint.
- Glass is added to `diffuseColor` after the instance tint, as in spec 01 (no multiplication by wall color beyond `uGlassDark`).

### Uniforms

New on `FacadeUniforms`: `uTime` (float), `uFlicker` (float), `uEmissiveScale` (float). Part C also needs `uSunVisibility` (float). A pure function `windowLookFor(state, t, tier)` in `window-look.ts` returns `{ uEmissiveScale, uTime, uFlicker }` so the mapping is testable:

- `uEmissiveScale = 0.35 + 0.65 * smoothstep(0, 0.35, state.windowLitRatio)`
- `uTime = t % 1000`
- `uFlicker = tier === 'reduced' ? 0 : 1`

### Tier behavior

| Situation | Behavior |
| --- | --- |
| full | Parts A, B (tints, variation, flicker), and C. |
| lowPower | Part A, warm class only (`#ffc983`, gain 3.56, fixed brightness), no flicker code, flat glass tint (no Part C). |
| reduced | Variant follows `lowPower`. `uFlicker = 0`, so no flicker, whichever variant. |

The `lite` variant is a separate `customProgramCacheKey`, as in spec 01.

## Files

| File | Change |
| --- | --- |
| `app/journey/facade-material.ts` (and `facade-glsl.ts` if split) | Parts A, B, C in the fragment patch. |
| `app/journey/window-look.ts` | New. Tints, gains, mirror functions, uniform mapping. |
| `app/journey/scene.ts` | Pass `t` into the uniform update. |
| `tests/journey/window-look.test.ts` | New. |
| `tests/gpu/windows.spec.ts` | New. |

## Testing

Unit (Vitest, `tests/journey/`):

1. `windowLitAmount` is monotonic non-decreasing in `uLit` for 1000 random (cell, building) pairs, and a window never goes from lit to unlit as `uLit` rises.
2. Lit fraction over 20,000 cells with buildings drawn uniformly from the `k` range, counting a window as lit when `windowLitAmount > 0.5` (which equals `cellHash * k < uLit - 0.03`): at `uLit` 0.05 in [0.005, 0.04]; at 0.3 in [0.257, 0.297]; at 0.65 in [0.614, 0.654]; at 0.9 in [0.85, 0.89]. The analytic values are 0.0205, 0.2767, 0.6344, and 0.8706.
3. Building spread, noise-free: compute each building's expected lit fraction `clamp((uLit - 0.03) / k, 0, 1)` for 2000 evenly spaced `k` values. At `uLit = 0.65` the standard deviation is at least 0.08 (about 0.094), the minimum is below 0.55, and the maximum is above 0.78. Then check the mirror with large samples: for three `k` values, 4000 windows each give fractions within 0.03 of the analytic value. A sample of 40 windows per building would add about 0.075 of binomial noise and is not used.
4. `gainFor`: each class's gain times its color's linear luminance equals `EMISSIVE_TARGET` within 1e-3 (gains about 3.56, 2.75, 3.21). A fully lit, unfiltered window's minimum luminance across brightness variation and the `projects` emissive scale is at least 2.0 (`2.3 * 0.92 * 0.96 = 2.03`). The `lowPower` warm window at full scale has luminance 2.3.
5. `windowLookFor`: `uEmissiveScale` is 0.39, 0.96, 1.0, 1.0 at the four stops (within 0.01). `uFlicker` is 0 for `reduced` and 1 otherwise. `uTime` is `t % 1000`.
6. Class split: over 10,000 hashes, warm/neutral/cool shares are 70/20/10 within 2 points, and flicker eligibility is 4% of all lit windows within 1 point.
7. Flicker gate: `flickerMultiplier(phase, uTime, uFlicker)` (TypeScript mirror) returns exactly 1 for every phase and time when `uFlicker = 0`, stays within [0.6, 1.0] when `uFlicker = 1`, and `2.03 * 0.6` is above 1.0.

GPU (Playwright, `tests/gpu/windows.spec.ts`):

8. Per-building agreement, then aggregate. A fixed building has a fixed occupancy, and 20 random buildings give a standard error of about 0.02 at `uLit = 0.65`, which is as large as the aggregate tolerance, so a random-seed aggregate is not a reliable test. Instead: render 40 walls with different seeds, each with at least 4000 window cells and `uFlicker = 0`. For each wall, compute its expected lit fraction `clamp((uLit - 0.03) / k, 0, 1)` using the TypeScript mirror of `hash11` to get `k` from the seed. The measured fraction (cells whose emissive value exceeds half of a fully lit cell, matching `windowLitAmount > 0.5`) is within 0.03 of the expected value for every wall, at `uLit` 0.05, 0.3, 0.65, 0.9. The aggregate ranges of item 2 are checked in the unit test, where the sample is large and stratified. Because this test depends on the mirror matching the shader, also render 100 sample cells and assert the shader's lit decision equals the mirror's for every one.
9. Tints: at `uLit = 0.9`, sampled lit cell colors cluster into three hue groups with shares near 70/20/10 (within 6 points, since the sample is small).
10. Flicker: render the same cell at `t = 0, 0.1, ... 1.0` in a flicker-eligible window and assert its luminance changes by at least 5%. With `uFlicker = 0`, it stays identical and equals the non-flickering brightness (not a dimmed value).
11. Glint: at `intro`, an unlit window on a wall facing the sun is brighter than the same window with the sun direction rotated 90 degrees away. Fresnel: a grazing view (above 75 degrees from the normal) is brighter than a head-on view. The `lowPower` variant shows neither.
12. Shader errors for the `full` and `lowPower` variants; after `loseContext()` and `restoreContext()` the lit pattern is identical to before.

Manual verification (shared conventions, section 9): the four chapters on desktop and iPhone emulation, plus a scrub through the whole range in 20 steps. Check for pops (windows appear smoothly), for patterns (the hash must not show diagonal stripes on any building), and for loss of silhouette in dark theme.

Performance: shared conventions, section 8. Budget 0.2 ms each.

## Risks

- **Hash patterns**: a poor hash shows stripes along facades. Test by screenshot at close range and with the hash replaced by a known-good alternative if banding appears.
- **Bloom clutter**: more bright, varied lights may over-bloom at `about`. Tune `EMISSIVE_TARGET` and bloom strength together with spec 02.
- **Instance seed range**: `occ` uses `aSeed`. Spec 03 gives all parts of one building the same seed, so all parts share an occupancy. Equipment parts have no windows (`aWindowed = 0`), so there is no issue.
- **Per-frame time uniform**: writes one float per frame. Negligible.
- **Part C cost**: a few more ALU and a normalized vector per fragment, `full` variant only. Measure before enabling it on phones.

## Dependencies

- Requires spec 01.
- Part C requires spec 04 (sun uniforms and world normal varying). It improves with spec 05 (`sky.sunVisibility`).
- Spec 02: the emissive contract (luminance 2.0) is preserved; the tints use `gainFor` to meet it.

## Open questions

None. Class weights, occupancy range, and flicker share are starting values for tuning.
