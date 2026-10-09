# City polish 09: Theme-aware sky with clouds

Date: 2026-10-09
Status: Draft, approved in conversation, pending written review
Series: City polish (09). Read [00 shared conventions](2026-10-09-city-00-shared-conventions.md) first.
Builds on: [05 Sky dome and haze](2026-10-09-city-05-sky-haze-design.md). This spec replaces 05's palette table, its cloud streak term, and its star rule. Build 05 and 09 together.

## Problem

The journey sky follows one scroll-driven day-to-night arc: daylight at `intro`, sunset at `projects`, dusk at `skills`, night at `about`. The site theme (light or dark) does not change it. `setTheme(isDark)` changes only the directional and hemisphere light intensities (`scene.ts`, `setTheme`). A visitor in light mode scrolls into a night city, and a visitor in dark mode starts in bright daylight.

## Goal

The theme picks the time of day, and scrolling still moves time forward:

- **Light theme:** a morning-to-afternoon arc. Blue sky with many clouds, the sun up, windows dark, no bloom, no stars.
- **Dark theme:** a sunset-to-night arc. Warm sunset glow, then dusk, evening, and full night. Windows light up, bloom grows, and stars appear as you scroll.
- Toggling the theme blends the scene from one arc to the other at the current scroll position over 1.2 seconds.

Success criteria:

- In light mode, every chapter shows a blue sky (zenith hue between 200 and 230 degrees in HSL) with visible clouds. Cloud pixel coverage of the sky above `h = 0.15` is within 0.1 of the chapter's `cloudCover`.
- In dark mode, `intro` shows a sunset glow and `about` shows a dark night sky with stars. Windows and bloom match today's values or exceed them.
- Clicking the theme toggle changes the scene from one arc to the other in 1.2 s (±0.1 s plus the existing damping lag). On the `reduced` tier the change is immediate.
- A visitor whose saved theme is dark sees the dark arc from the first frame. No light-to-dark blend plays on page load.
- Spec 05's guarantees hold in both themes and at every point of a blend: the horizon row equals `fogColor`, and the sky's luminance never exceeds `SKY_MAX_LUMINANCE` (0.92).
- No shader program compiles during a theme blend.
- Render cost on top of spec 05: at most +0.3 ms on the reference desktop and +0.3 ms on a physical iPhone (shared conventions, section 8).

## Non-goals

- Volumetric or 3D clouds, cloud sprites, or parallax between cloud layers. Clouds are painted in the dome shader.
- Following the system clock or real local time.
- Changing page CSS, the theme toggle, or the no-WebGL hero gradient.
- Rain, weather, or a moon disk.

## Terms

- **Arc:** the sequence of four looks a theme passes through as the visitor scrolls from `intro` to `about`.
- **Look:** every visual field of a stop that is not about camera placement or building layout. The `LookState` type below defines it.
- **`themeMix`:** a number from 0 (light arc) to 1 (dark arc). It moves during a theme blend.
- **`h`:** the sky direction's height, `normalize(vDir).y`, as in spec 05.

## Design

### 1. Split `StopState` into path and look

In `app/journey/stops.ts`:

```ts
export type Theme = 'light' | 'dark'

export interface PathState {
  cameraDistance: number
  cameraHeight: number
  lookAheadDistance: number
  lookHeight: number
  buildingDensity: number
  buildingHeight: number
}

export interface LookState {
  skyZenith: Vec3        // sRGB, straight up (from spec 05)
  skyColor: Vec3         // sRGB, mid-sky (unchanged meaning)
  fogColor: Vec3         // sRGB, horizon and fog (unchanged meaning)
  fogDensity: number
  sunElevation: number   // degrees (from spec 05)
  sunAzimuth: number     // degrees, world space (from spec 05)
  sunColor: Vec3         // sRGB (from spec 05)
  sunGlow: number        // 0..1 (from spec 05)
  cloudCover: number     // 0..1, fraction of upper sky covered by cloud
  cloudLitColor: Vec3    // sRGB, sun-facing cloud color
  cloudShadeColor: Vec3  // sRGB, cloud underside color
  hemiIntensity: number
  starOpacity: number    // 0..1
  windowLitRatio: number
  exposure: number
  bloomStrength: number
}

export type StopState = PathState & LookState

export const PATH_STOPS: Readonly<Record<ChapterId, PathState>>
export const LOOKS: Readonly<Record<Theme, Readonly<Record<ChapterId, LookState>>>>
```

`StopState` keeps the same field names, so `apply()` and specs 01, 04, 06, 07, and 08 read it as before. `PATH_STOPS` keeps today's camera and building values. The existing `STOPS` array is removed, and `stopAt(chapter)` is replaced by `stopFor(chapter, themeMix)` (section 2).

`fogDensity` is a look field. A clear day has thinner fog than a night.

### 2. Interpolation and blending

In `app/journey/interpolate.ts`:

- `lerpPath(a, b, p)` and `lerpLook(a, b, p)` replace `lerpStop`. `lerpLook` interpolates every numeric field linearly and every `Vec3` per channel, except `sunAzimuth`.
- `lerpAngle(a, b, p)` interpolates `sunAzimuth` along the shorter way around the circle. The result is normalized to `[-180, 180)`.
- `dampState` keeps its role and calls both functions.

The scene target becomes:

```ts
function target(chapter: number, progress: number, themeMix: number): StopState {
  const p = tier === 'reduced' ? 0 : easeInOut(progress)
  const path = lerpPath(PATH_STOPS[id(chapter)], PATH_STOPS[id(chapter + 1)], p)
  const light = lerpLook(LOOKS.light[id(chapter)], LOOKS.light[id(chapter + 1)], p)
  const dark = lerpLook(LOOKS.dark[id(chapter)], LOOKS.dark[id(chapter + 1)], p)
  return { ...path, ...lerpLook(light, dark, easeInOut(themeMix)) }
}
```

`id(n)` clamps to the last chapter, as `stopAt` does today.

New pure module `app/journey/theme-blend.ts`:

```ts
export const THEME_BLEND_SECONDS = 1.2

export interface ThemeBlend {
  mix: number      // 0..1, current
  target: 0 | 1
}

// Moves mix toward target at 1 / THEME_BLEND_SECONDS per second. dt is clamped to
// 0..0.1 s so a backgrounded tab does not skip the blend in one frame.
export function advanceBlend(blend: ThemeBlend, dt: number): ThemeBlend

// Returns a new blend aimed at the theme. snap = true jumps mix to the target.
export function retarget(blend: ThemeBlend, isDark: boolean, snap: boolean): ThemeBlend
```

`mix` advances linearly. `target()` applies `easeInOut` to it, so the visible change eases in and out. A reversal mid-blend (light, dark, light) continues from the current `mix` without a jump. Both functions return new objects.

The scene stores the blend and the previous frame time. `update(chapter, progress, t, pointer)` computes `dt` from `t` and advances the blend before it computes the target. The existing `dampState` then adds its usual lag of a few frames. That lag is accepted.

### 3. Theme wiring and the load flash

`JourneyScene.setTheme` changes to:

```ts
setTheme(isDark: boolean, options?: { animate?: boolean }): void
```

Rules:

1. The first call after creation always snaps, whatever `animate` says.
2. A call whose theme equals the current blend target does nothing.
3. Otherwise the blend retargets. It snaps when `animate` is `false` or the tier is `reduced`.
4. The hardcoded intensities (`sun.intensity = isDark ? 0.5 : 0.9`, `hemi.intensity = ...`) are removed. Light levels come from the look (section 5).

The trap: `useState('isDark')` is `false` on the server and in the first client render. `plugins/dark-mode.client.ts` sets it to the real value on `app:mounted`. A dark-mode visitor's scene would then receive `false` first and `true` a moment later, and play a light-to-dark blend on every page load.

Fix in `JourneyCanvas.vue`:

- After `createJourneyScene`, call `scene.setTheme(document.documentElement.classList.contains('dark'), { animate: false })`. The head script in `nuxt.config.ts` sets that class before first paint, so it is the true theme.
- The existing `watch(() => props.isDark, isDark => scene?.setTheme(isDark))` stays. When the plugin later flips `isDark` from `false` to `true` for a dark-mode visitor, rule 2 makes that call do nothing. A real toggle click changes the target and animates.

### 4. Palettes

Starting values for tuning in screenshots. The dark `intro` and `projects` looks reuse today's sunset and dusk colors. The dark `about` look is spec 05's night. All colors are sRGB hex, converted per shared conventions, section 1.

**Light arc** (`starOpacity` 0, `exposure` 1, `bloomStrength` 0, `hemiIntensity` 0.9, `cloudLitColor` `#ffffff` in every chapter):

| Chapter | Time | `skyZenith` | `skyColor` | `fogColor` | `fogDensity` | `sunElevation` | `sunAzimuth` | `sunColor` | `sunGlow` | `cloudCover` | `cloudShadeColor` | `windowLitRatio` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| intro | Early morning | `#4f86d6` | `#9cc3ee` | `#dce8f6` | 0.04 | 12 | -60 | `#ffe7c4` | 0.35 | 0.55 | `#b8c6dc` | 0.05 |
| projects | Morning | `#3b78d4` | `#8bbbf0` | `#d4e5f7` | 0.035 | 25 | -40 | `#fff1dc` | 0.25 | 0.65 | `#aebfd8` | 0.03 |
| skills | Midday | `#2f6bcf` | `#7fb2ee` | `#cfe1f5` | 0.035 | 55 | -10 | `#fffaf0` | 0.15 | 0.6 | `#b3c3da` | 0.02 |
| about | Afternoon | `#3c72c4` | `#95bbe4` | `#e6e4df` | 0.04 | 28 | 30 | `#ffe9c7` | 0.3 | 0.5 | `#bcbcc8` | 0.05 |

**Dark arc:**

| Chapter | Time | `skyZenith` | `skyColor` | `fogColor` | `fogDensity` | `sunElevation` | `sunAzimuth` | `sunColor` | `sunGlow` | `cloudCover` | `cloudLitColor` | `cloudShadeColor` | `hemiIntensity` | `starOpacity` | `windowLitRatio` | `exposure` | `bloomStrength` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| intro | Sunset | `#6f7fb8` | `#fbbf9f` | `#f3a683` | 0.05 | 4 | 5 | `#ffb27a` | 0.85 | 0.45 | `#ffc29a` | `#7a6a8f` | 0.7 | 0 | 0.3 | 1 | 0.12 |
| projects | Dusk | `#2e2a5c` | `#7c6aa8` | `#6b5b95` | 0.05 | -3 | 10 | `#c97aa8` | 0.45 | 0.4 | `#d79ab8` | `#3d3560` | 0.6 | 0.3 | 0.55 | 1.1 | 0.25 |
| skills | Evening | `#151834` | `#3a3768` | `#2e2a52` | 0.055 | -12 | 10 | `#8a86c4` | 0.15 | 0.3 | `#5d5a8a` | `#1f1e3a` | 0.55 | 0.7 | 0.75 | 1.15 | 0.35 |
| about | Night | `#0a0d22` | `#1e2340` | `#141833` | 0.065 | -22 | 10 | `#7a8cc4` | 0 | 0.25 | `#3a4266` | `#12152a` | 0.5 | 1 | 0.9 | 1.25 | 0.42 |

Constraints that tests enforce:

- `fogDensity >= 0.035` in every look. Spec 05 puts the ground edge 80 units from every camera. At 0.035 the fog factor there is `exp(-(0.035 * 80)^2)`, about 4e-4, so the ground edge stays fully fogged. Spec 05's ground-edge arithmetic assumed 0.045; update its text to name 0.035 as the lowest density.
- Every light look has `bloomStrength` 0 and `starOpacity` 0.
- Light-arc azimuths stay within 120 degrees of each other, and dark-arc azimuths do too, so scroll interpolation never wraps.

The sun moves through the morning in the light arc (from -60 to 30 degrees azimuth) and sits ahead of the camera in the dark arc, as spec 05 intended. The camera turns twice, so check the sun's screen position per chapter and adjust azimuths while tuning.

### 5. Lights and stars

Spec 05's light rules apply, with these changes:

- `sun.intensity = max(0.25, smoothstep(-6, 12, sunElevation))`. The theme factor from spec 05 is dropped. The light arc's high sun gives full intensity, and the night keeps the 0.25 moonlight floor.
- `hemi.intensity = state.hemiIntensity`.
- `stars.material.opacity = state.starOpacity`. This replaces "stars follow `windowLitRatio`" in today's code and in spec 05.

### 6. Clouds in the dome shader

This replaces spec 05's fragment step 6 (static cloud streaks). The cloud step runs after the gradient, sun glow, and horizon band (spec 05 steps 1 to 5) and before the bloom cap (step 7).

New uniforms: `uCloudCover` (float), `uCloudLit` and `uCloudShade` (linear `vec3`), `uCloudOffset` (`vec2`).

1. **Projection.** `vec2 uv = vDir.xz / max(h, 0.05) * CLOUD_SCALE + uCloudOffset;` with `CLOUD_SCALE = 0.6`. Dividing by height flattens the clouds onto a ceiling, so they shrink and bunch toward the horizon.
2. **Noise.** `float n = fbm(uv);` value-noise fbm normalized to 0..1. The `full` variant uses 4 octaves. The `lowPower` variant uses 2. The octave count is a compile-time `#define`, and `customProgramCacheKey` includes the variant (shared conventions, section 2).
3. **Coverage.** `float threshold = coverThreshold(uCloudCover);` and `float d = smoothstep(threshold, threshold + CLOUD_SOFTNESS, n);` with `CLOUD_SOFTNESS = 0.18`. `coverThreshold` maps cover to the noise value that the given fraction of samples exceeds. It is a 5-point piecewise-linear table, measured once from the CPU mirror of `fbm` (section 9, test 5) and written into both the shader and the TypeScript mirror as constants. With cover 0, `d` is 0 everywhere.
4. **Envelope.** `d *= smoothstep(0.02, 0.15, h);` Clouds are absent for `h <= 0.02` and full strength from `h = 0.15`. Spec 05's exact horizon match covers `h <= 0.01`, so it still holds.
5. **Shading.** `vec3 cloud = mix(uCloudLit, uCloudShade, smoothstep(0.55, 1.0, n));` Thick centers are darker underneath. The `full` variant adds a cheap self-shadow: a 2-octave sample `n2 = fbm2(uv + sunDir.xz * 0.08)`, and `cloud = mix(cloud, uCloudShade, 0.5 * clamp((n2 - n) * 4.0, 0.0, 1.0))`. Clouds on the far side from the sun come out darker.
6. **Sun behind clouds.** Clouds dim the glow without hiding it: `vec3 glowTerm` is the sum of spec 05's steps 4 and 5. The composite is `col = mix(base + glowTerm, cloud + glowTerm * 0.4, d * CLOUD_OPACITY)` with `CLOUD_OPACITY = 0.95`.
7. The bloom cap (spec 05 step 7) then runs on the result, so clouds lit by a strong glow never cross the bloom threshold.

**Drift.** `uCloudOffset = CLOUD_WIND * (t mod CLOUD_TIME_WRAP)` with `CLOUD_WIND = (0.010, 0.004)` uv units per second and `CLOUD_TIME_WRAP = 3600` seconds. The CPU computes the offset, so the shader never sees a large time value. The clouds jump once an hour. That is accepted. On the `reduced` tier the offset stays at `(0, 0)`. The dome fragment shader declares `precision highp float`, because the projected `uv` grows large near the horizon.

**Compile safety.** The cloud code exists in both variants regardless of theme. With cover 0 the noise still runs, so a theme blend never changes the program. Spec 05's warm-up render already compiles the dome.

### 7. Changes to spec 05

Apply these edits to spec 05 when this spec is accepted:

- Status line: "Palette, clouds, and stars superseded by spec 09."
- "New `StopState` fields": the five fields move to `LookState` (spec 09, section 1). The starting-values table is replaced by spec 09, section 4.
- Fragment step 6 (cloud streaks): replaced by spec 09, section 6.
- Light rules: the theme factor is removed (spec 09, section 5).
- Stars: opacity follows `starOpacity` (spec 09, section 5).
- Ground: lowest fog density is 0.035, not 0.045 (spec 09, section 4).
- Every success criterion and test that names a chapter holds for both themes.

Spec 06 ("windows turn on one by one, never off") gains one exception: a dark-to-light theme blend turns windows off in reverse order. The staggered thresholds already make this work, because `windowLitRatio` falls smoothly during the blend.

### 8. Tier behavior

| Tier | Behavior |
| --- | --- |
| full | 4-octave clouds with self-shadow, slow drift, 1.2 s theme blend. |
| lite | 2-octave clouds, no self-shadow, slow drift, 1.2 s theme blend. |
| reduced | Clouds per `lowPower`, no drift, theme change snaps. |
| none | Unchanged hero gradient. |

## Files

| File | Change |
| --- | --- |
| `app/journey/stops.ts` | `Theme`, `PathState`, `LookState`, `PATH_STOPS`, `LOOKS`. Remove `STOPS`. |
| `app/journey/interpolate.ts` | `lerpPath`, `lerpLook`, `lerpAngle`. Remove `lerpStop`. |
| `app/journey/theme-blend.ts` | New. `advanceBlend`, `retarget`, `THEME_BLEND_SECONDS`. |
| `app/journey/sky.ts` | From spec 05, plus cloud uniforms and shader step 6, and `cloudOffsetAt(t, reduced)`. |
| `app/journey/sky-mirror.ts` | New. TypeScript mirror of the dome shader (`skyGradient`, `fbm`, `coverThreshold`) for unit tests. Spec 05's `skyGradient` moves here. |
| `app/journey/scene.ts` | `target(chapter, progress, themeMix)`, blend state in `update`, new `setTheme`, light and star rules. |
| `app/components/JourneyCanvas.vue` | Snap to the `<html>` class after creation. |
| `tests/journey/stops.test.ts` | New. Palette constraints. |
| `tests/journey/interpolate.test.ts` | `lerpPath`, `lerpLook`, `lerpAngle`. |
| `tests/journey/theme-blend.test.ts` | New. |
| `tests/journey/sky.test.ts` | Cloud and horizon cases for both themes. |
| `tests/gpu/sky.spec.ts` | Theme and cloud cases. |
| `docs/superpowers/specs/2026-10-09-city-05-sky-haze-design.md` | Edits from section 7. |

## Testing

Write each test first and watch it fail (`.claude/rules/common/testing.md`).

Unit tests (Vitest):

1. **Palette constraints** (`stops.test.ts`): every look has `fogDensity >= 0.035`. Every light look has `bloomStrength` 0 and `starOpacity` 0. Within each theme, azimuths stay within 120 degrees of each other. Every light `skyZenith` has an HSL hue between 200 and 230 degrees.
2. **`lerpLook`** returns `a` at 0 and `b` at 1 exactly, and the midpoint at 0.5 for every field. **`lerpPath`**, likewise.
3. **`lerpAngle`**: `(170, -170, 0.5)` returns 180 or -180 (the same direction), not 0. `(-60, 30, 0.5)` returns -15. The result is in `[-180, 180)`.
4. **`advanceBlend`**: from 0 toward 1, after 0.6 s of 1/60 s steps `mix` is 0.5 ±0.01, and after 1.2 s it is 1. A single `dt` of 5 s advances at most 0.1 s of progress. Reversing at `mix` 0.4 continues from 0.4. **`retarget`** with `snap` sets `mix` to the target. Neither function mutates its input.
5. **Cloud coverage** (`sky.test.ts`, on `sky-mirror.ts`): sample `fbm` on a grid of sky directions with `h` in `[0.15, 1]` and 64 azimuths. For cover 0.25, 0.45, 0.55, and 0.65, the fraction of samples with `d > 0.5` is within 0.1 of the cover, for both octave counts. Cover 0 gives `d = 0` everywhere. This test also produces the `coverThreshold` table.
6. **Horizon and cap**: for both themes, every chapter, and `themeMix` in {0, 0.25, 0.5, 0.75, 1}, `skyGradient` with clouds returns exactly `toLinear(fogColor)` for `h` in `[-0.03, 0.01]`. Luminance never exceeds 0.92 over a grid of `h` and sun-relative angles.
7. **Envelope**: cloud density is 0 for `h <= 0.02` at cover 1.
8. **Drift**: `cloudOffsetAt(t, reduced: true)` is `(0, 0)` for any `t`. `cloudOffsetAt(t, false)` is continuous within an hour and stays below `CLOUD_WIND * 3600` in magnitude.
9. **Scene theme rules** (on the scene factory with a stub renderer, or on an extracted `ThemeController` if the factory is too heavy to stub): the first `setTheme(true, { animate: true })` snaps to `mix` 1. A repeated call with the same theme does nothing. `setTheme(false)` on the `reduced` tier snaps.
10. **Target**: `target(c, p, 0)` equals the light arc's look and `target(c, p, 1)` equals the dark arc's look. The path fields do not depend on `themeMix`.

Component test (`JourneyCanvas`):

11. With `<html class="dark">` and the prop `isDark` first `false`, then `true`, the scene receives one snapping `setTheme(true)` and no animated blend.

GPU tests (Playwright, `tests/gpu/sky.spec.ts`):

12. **Cloud coverage on screen**: for each light chapter, count sky pixels above `h = 0.15` whose color is closer to the cloud colors than to the clear-sky gradient. The fraction is within 0.1 of `cloudCover`.
13. **Horizon match in both themes**: spec 05's test 6, run at `themeMix` 0, 0.5, and 1.
14. **No compile during blend**: record `renderer.info.programs.length` after warm-up, run a full theme blend in both directions at each chapter, and assert the count is unchanged and the shader-error recorder is empty.
15. **No cloud bloom**: at light `projects` looking toward the sun, the sky pixels with bloom forced to 0.5 and with bloom off differ by at most 2/255.
16. **Dark arc**: at dark `about`, stars are visible and the cloud contribution is below 8/255 over the clear sky.
17. **Context restore**: after a restore mid-blend, the blend finishes, and the final frame matches a frame rendered without the restore.

Manual verification (shared conventions, section 9):

- All eight chapter and theme pairs on desktop and iPhone emulation, in portrait and landscape.
- Toggle the theme at each chapter and mid-scroll between chapters, including a double toggle.
- Load the page with dark saved and with light saved, and watch the first second for a blend.
- Watch the clouds drift for 30 seconds on the `full` tier for visible tiling or banding.

Performance: shared conventions, section 8. Budget +0.3 ms on top of spec 05 on both devices. If the iPhone exceeds it, drop the `lite` variant to 1 octave plus a sharper threshold before changing anything else.

## Risks

- **Clouds look like noise, not cumulus.** Value-noise fbm can read as smoke. Tune `CLOUD_SCALE`, `CLOUD_SOFTNESS`, and the shade curve in screenshots. If it still reads as smoke, switch the base noise to a cheap Worley-fbm blend in the `full` variant only.
- **Horizon banding.** The `1 / h` projection magnifies noise near the horizon, where it can alias. The envelope hides most of it. If shimmer shows during camera movement, raise the envelope's lower edge from 0.02 to 0.05.
- **Mid-blend palettes.** Halfway between morning blue and sunset orange, the linear sRGB mix can look grey. Check frames at `themeMix` 0.5. If they look muddy, interpolate colors in linear space or bias the easing.
- **Light-mode contrast.** A bright sky behind the translucent white panels (`bg-white/75`) lowers text contrast less than the old orange sunset did, but check WCAG AA contrast on each panel in light mode.
- **Sun elevation 55 at midday** puts the glow high and possibly out of view. That is intended at noon. Confirm the scene still reads as sunny from the light and the clouds.
- **iOS precision.** `highp` in fragment shaders is supported on every iPhone that runs WebGL2. If a device lacks it, the compile guard falls back to the hero gradient.

## Dependencies

- Requires spec 05's dome, uniforms, warm-up, and `skyGradient` mirror. Build together.
- Works with spec 02 as spec 05 describes. Light looks set bloom to 0, so the bloom pass is skipped in light mode.
- Specs 01, 04, 06, 07, and 08 read look fields (`windowLitRatio`, `sunVisibility`, `skyColor`). They follow the theme without changes, except for the spec 06 note in section 7.

## Open questions

None. The palettes are starting points for tuning.
