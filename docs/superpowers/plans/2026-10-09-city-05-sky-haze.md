# City 05: Sky Dome, Haze, and Clouds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build City polish step 3. Replace the flat journey sky with a gradient dome that has a sun glow, a horizon band, and drifting clouds. Add a haze band and two rings of distant silhouettes. Grow the ground so its edge never shows. Drive the sun light from the look.

**Architecture:** Use pure TypeScript modules for the math. `sky-mirror.ts` mirrors the dome fragment shader step by step, so unit tests can pin horizon equality, the luminance cap, and cloud coverage without a GPU. `sky-shader.ts` generates the GLSL from the same constants. `sky.ts` owns the dome mesh and the sun-light math. `skyline-far.ts` owns the ground, the haze, and the silhouette rings. `scene.ts` only creates these objects and calls their `update` from `apply()`. Playwright GPU tests compare rendered pixels against the mirror on both render pipelines.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript (strict, `noUncheckedIndexedAccess`), three r186 (`ShaderMaterial`, `InstancedMesh`, RGBA vertex colors), Vitest 5, Playwright with SwiftShader WebGL2.

**Spec:** `docs/superpowers/specs/2026-10-09-city-05-sky-haze-design.md`, all sections. It is built together with `docs/superpowers/specs/2026-10-09-city-09-theme-sky-design.md`, section 6 (clouds), section 8 (tiers), and the remaining sky tests in section 9. Read `docs/superpowers/specs/2026-10-09-city-00-shared-conventions.md` first. The build order is in `docs/superpowers/specs/2026-10-09-city-polish-index.md` (step 3: "05 Sky dome and haze, then 09 section 6: clouds", one plan).

**Research:** `docs/superpowers/research/2026-10-09-portfolio-overview-research.md`. It was written at commit `ef03e91`, before step 2 (theme arcs) landed, so do not rely on its `scene.ts` line numbers. This plan was checked against HEAD `c6f55a9`:

- `scene.ts` has 752 lines.
- `STOPS` is gone, replaced by `PATH_STOPS`, `LOOKS`, and `targetFor`.
- `apply()` already sets the sun position, color, and intensity, the hemisphere light, and the star opacity from the look.
- `setTheme` blends through `createThemeController`.
- `vite.gpu.config.ts` patches two exact markers in `scene.ts`.

**Decisions made by the user while this plan was written (2026-10-09):**

1. **Cloud coverage on screen.** A Node prototype of the spec's noise (`CLOUD_SCALE` 0.6, light-chapter cameras at 640x360) gives on-screen coverage 0.13 to 0.32 above `cloudCover`. Drift moves it by up to ±0.45. GPU test 12 therefore asserts that the GPU matches the mirror within 0.03 and records the gap from `cloudCover` as a test annotation. The full-sky unit test (spec 09 test 5) still asserts within 0.1. `CLOUD_SCALE` stays 0.6. The 0.1 on-screen criterion is left to screenshot tuning.
2. **Night clouds.** With the authored palette, clouds at dark `about` add up to 41/255 over the clear sky, and spec 09 test 16 allows 8/255. Darkening the colors alone reaches only 14/255. The dark `about` look becomes `cloudLitColor` `#2c3353`, `cloudShadeColor` `#181c35`, `cloudCover` 0.1. The mirror predicts a worst case of 4/255.

## Global Constraints

- All `LookState` colors are sRGB. Convert them with `THREE.SRGBColorSpace`: `color.setRGB(r, g, b, THREE.SRGBColorSpace)`. Shader uniforms take linear values converted on the CPU.
- The dome uses the **authored** `state.fogColor`, never the CPU-mapped `skyForDirectPipeline` value. The dome's tone-mapping chunk maps it on the direct pipeline. Only `scene.fog.color` and `scene.background` take the CPU-mapped value.
- `SKY_MAX_LUMINANCE = 0.92`, below spec 02's bloom threshold of 1.0. The cap runs last: `col *= min(1.0, SKY_MAX_LUMINANCE / max(L, 1e-4))`.
- The dome equals the authored `fogColor` exactly for every direction with `h <= 0.01`. The horizon row matches fog within 2/255 per channel after tone mapping.
- Dome geometry: `SphereGeometry(200, 32, 16)`, or 24 x 12 on `lowPower`. It uses `side: THREE.BackSide`, a `ShaderMaterial` with `fog: false` and `depthWrite: false`, `renderOrder = -1000`, and `frustumCulled = false`. It follows the camera position every frame.
- `camera.far` changes from 120 to 260.
- Sun light: `sun.intensity = max(0.25, smoothstep(-6, 12, sunElevation))`. The light's `position.y` is at least 2. `sunDirection` stays unclamped. `sunVisibility = smoothstep(-0.3, 0, sunDirection.y)`.
- Ground: `260 x 260`, centered on `SCENE_CENTER` (about `(-13, -29)`), at `y = -1.01`. Its edge is at least 80 units from every camera position. The lowest fog density is 0.035.
- Ring A: center distance 100 to 110, 36 boxes, width 5 to 10, depth 5 to 10, height 10 to 26. Top color `mix(fogColor, 0x15182a, 0.22)`.
- Ring B: center distance 116 to 124, 36 boxes (20 on `lowPower`), same widths and depths, height 14 to 34. Top color `mix(fogColor, 0x15182a, 0.10)`.
- Both rings: `InstancedMesh` with `MeshBasicMaterial` (`fog: false`, `vertexColors: true`, white material color). Bottom vertices take the horizon color. Do not call `setColorAt`.
- Haze: `CylinderGeometry(136, 136, 40, 64, 1, true)` (32 radial segments on `lowPower`), centered on `SCENE_CENTER` at `y = -1 + 20`, with `side: BackSide`. It has an RGBA `color` attribute (`itemSize` 4) with RGB 1, alpha 0.85 at the bottom and 0 at the top. Material: `transparent: true`, `depthWrite: false`, `fog: false`, `vertexColors: true`, tinted with the authored fog color. `renderOrder = -900`.
- Stars: `renderOrder = -999`. Opacity follows `state.starOpacity`.
- Draw calls: the dome, the haze, and the two rings add exactly 4 on every tier.
- Clouds: `CLOUD_SCALE = 0.6`, `CLOUD_SOFTNESS = 0.18`, `CLOUD_OPACITY = 0.95`, `CLOUD_WIND = (0.010, 0.004)`, `CLOUD_TIME_WRAP = 3600`.
- `full` uses 4 octaves plus self-shadow. `lite` (`lowPower`) uses 2 octaves and no self-shadow.
- Cloud envelope: `smoothstep(0.02, 0.15, h)`. The `reduced` tier keeps the offset at `(0, 0)`. The fragment shader declares `precision highp float`.
- `customProgramCacheKey` includes the variant. No shader program compiles during a theme blend.
- Every chapter-based test runs for both themes. Horizon equality and the luminance cap also hold at intermediate theme mixes.
- Render cost: at most +0.4 ms (spec 05) plus +0.3 ms (spec 09) on the reference desktop and on a physical iPhone.
- `scene.ts` stays under 800 lines. New feature code goes in new modules (shared conventions, section 5).
- `scene.ts` must keep the two GPU harness markers exactly: `const recorder = createShaderErrorRecorder(renderer)` and `setTheme(isDark, themeOptions) {`.
- `JourneyScene.dispose()` already disposes every mesh it reaches through `scene.traverse`. Do not dispose these meshes a second time: `tests/gpu/component-probe.ts` asserts every geometry and material is disposed exactly once.
- Unit tests go in `tests/journey/*.test.ts`. GPU tests go in `tests/gpu/*.spec.ts`. Run all commands from `repos/portfolio`.
- Do not stage `repos/portfolio/package-lock.json`. It has an unrelated local change.

## Deviations from the spec text, and why

- `skyGradient(direction, params, variant)` takes a direction, not `h`, because the glow and the clouds depend on the azimuth.
- `createSky(variant, reduced)` takes `reduced` so it can call `cloudOffsetAt(t, reduced)` itself. `Sky` has no `dispose()`, because the scene's traverse already disposes the dome.
- `COVER_THRESHOLDS` has one 5-point table per variant, because 2-octave and 4-octave noise have different distributions. Both tables come from the spec's test-5 grid at offset `(0, 0)`.
- Spec 05 test 6a hides the haze band and the far rings. At a wall top's elevation (`h` near 0.1) the haze intentionally tints the sky, and ring B stands behind it.
- Spec 05 test 4b's continuity check (0.01 steps under 0.05) holds for the gradient term. The sun glow's envelope rises over `h` 0.01 to 0.05. At dark `intro` it can add about 0.17 in one 0.01 step. The full sky without clouds is therefore checked at 0.0005 steps. Clouds are excluded because their edges are sharp by design.
- GPU test 6 checks the ground pixels whose ray lands on the ground at least 80 units away. Across all views at least one such pixel must exist. Not every single view's 640x360 grid contains one.

## Review Focus

1. **Direct-pipeline horizon (`lowPower`, phones).** If the dome gets the CPU-mapped fog color, the direct pipeline tone-maps it twice and the horizon seam shows on phones. Task 2's unit test asserts the authored color. Task 5's horizon test runs on the direct pipeline.
2. **Mid-blend horizon and cap.** A visitor who toggles the theme sees `themeMix` 0.25 to 0.75. The horizon must still equal fog, and the cap must still hold. Task 1 tests every mix in `{0, .25, .5, .75, 1}`. Task 5 renders a `mid` theme.
3. **Portrait phones.** `fovForAspect` widens the vertical FOV up to 100 degrees, so more ground edge and more sky are in view. Task 5's ground-edge test runs at 360x640 as well as 640x360.
4. **Long sessions.** A tab left open for hours must not lose cloud precision. Task 2 tests `cloudOffsetAt` at `t = 1e7`: the offset is finite and below `CLOUD_WIND * 3600`.
5. **Context restore.** After a lost and restored WebGL context, the dome must recompile and render the same sky. Task 6's restore test runs on `full` and `lowPower`.

Known gap, not covered by an automated test (decision 1): on-screen cloud coverage drifts from `cloudCover`, so the light sky can look overcast or clear for minutes. Task 7 lists it as a manual check.

---

### Task 1: Sky mirror math and the night-cloud retune

**Files:**
- Create: `repos/portfolio/app/journey/sky-mirror.ts`
- Create: `repos/portfolio/tests/gpu/sky-expect.ts` (display helpers shared by unit and GPU tests)
- Create: `repos/portfolio/tests/journey/sky-mirror.test.ts`
- Modify: `repos/portfolio/app/journey/stops.ts` (`LOOKS.dark.about` cloud fields)
- Modify: `repos/portfolio/tests/journey/stops.test.ts`

**Interfaces:**
- Consumes: `LookState`, `Vec3`, `LOOKS`, `CHAPTER_IDS`, `hexToRgb` (`stops.ts`); `clamp01`, `lerp` (`interpolate.ts`); `targetFor(chapter, progress, themeMix, reduced)` (`target.ts`); `neutralToneMap(rgbLinear, exposure)` (`post.ts`).
- Produces (`sky-mirror.ts`):
  - `type SkyVariant = 'full' | 'lite'`, `type CloudOffset = readonly [number, number]`
  - constants `SKY_MAX_LUMINANCE`, `HORIZON_FLAT`, `CLOUD_SCALE`, `CLOUD_SOFTNESS`, `CLOUD_OPACITY`, `CLOUD_WIND: CloudOffset`, `CLOUD_TIME_WRAP`, `CLOUD_OCTAVE_SHIFT: CloudOffset`, `CLOUD_OCTAVES: Record<SkyVariant, number>`, `COVER_STOPS: readonly number[]`, `COVER_THRESHOLDS: Record<SkyVariant, readonly number[]>`
  - `normalize3(v: Vec3): Vec3`, `luminance(c: Vec3): number`, `toLinear(srgb: Vec3): Vec3`, `smoothstep(edge0, edge1, x): number`, `skyCurve(x): number`
  - `sunDirectionFor(elevationDeg, azimuthDeg): Vec3`, `sunVisibilityFor(sunY): number`
  - `cloudHash(x, y)`, `cloudNoise(x, y)`, `cloudFbm(x, y, octaves)`, `cloudUv(dir: Vec3, offset: CloudOffset): [number, number]`, `coverThreshold(cover, variant)`, `cloudDensity(noise, h, cover, variant)`
  - `interface SkyParams { horizon; mid; zenith; sunDir; sunColor: Vec3; sunGlow: number; cloudCover: number; cloudLit; cloudShade: Vec3; cloudOffset: CloudOffset }` (colors are linear)
  - `skyParamsFor(look: LookState, cloudOffset: CloudOffset): SkyParams`
  - `gradientAt(h, p): Vec3`; `interface SkyLayers { base: Vec3; glow: Vec3; cloud: Vec3; density: number }`; `skyLayers(direction, p, variant): SkyLayers`; `composeSky(layers, density?): Vec3`; `skyGradient(direction, p, variant): Vec3`
- Produces (`tests/gpu/sky-expect.ts`): `displayBytes(linear: Vec3, exposure: number): number[]`, `maxChannelDelta(a, b): number`, `byteLuminance(p): number`, `colorDistance(a, b): number`

- [ ] **Step 1: Write the failing tests**

Create `repos/portfolio/tests/gpu/sky-expect.ts`:

```ts
import * as THREE from 'three'
import { neutralToneMap } from '../../app/journey/post'
import type { Vec3 } from '../../app/journey/stops'

// Displayed 8-bit sRGB for a linear scene colour, as both pipelines show it:
// Neutral tone mapping at `exposure`, then sRGB encoding.
export function displayBytes(linear: Vec3, exposure: number): number[] {
  const mapped = neutralToneMap(linear, exposure)
  const encoded = new THREE.Color().setRGB(mapped[0], mapped[1], mapped[2])
    .getRGB(new THREE.Color(), THREE.SRGBColorSpace)
  return [encoded.r, encoded.g, encoded.b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255))
}

export function maxChannelDelta(a: readonly number[], b: readonly number[]): number {
  return Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!), Math.abs(a[2]! - b[2]!))
}

export function byteLuminance(p: readonly number[]): number {
  return 0.2126 * p[0]! + 0.7152 * p[1]! + 0.0722 * p[2]!
}

export function colorDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
}
```

Create `repos/portfolio/tests/journey/sky-mirror.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LOOKS, type LookState, type Vec3 } from '../../app/journey/stops'
import { targetFor } from '../../app/journey/target'
import {
  CLOUD_OCTAVES, CLOUD_SOFTNESS, COVER_THRESHOLDS, SKY_MAX_LUMINANCE, cloudDensity, cloudFbm, cloudUv,
  composeSky, gradientAt, luminance, skyCurve, skyGradient, skyLayers, skyParamsFor, sunDirectionFor,
  sunVisibilityFor, toLinear, type SkyVariant,
} from '../../app/journey/sky-mirror'
import { displayBytes, maxChannelDelta } from '../gpu/sky-expect'

const VARIANTS: readonly SkyVariant[] = ['full', 'lite']
const MIXES = [0, .25, .5, .75, 1]

function dirAt(h: number, azimuthDeg: number): Vec3 {
  const a = azimuthDeg * Math.PI / 180, r = Math.sqrt(Math.max(0, 1 - h * h))
  return [r * Math.cos(a), h, r * Math.sin(a)]
}

// Every chapter of both arcs and three blends between them.
function allLooks(): LookState[] {
  const looks: LookState[] = []
  for (let chapter = 0; chapter < 4; chapter++) for (const mix of MIXES) looks.push(targetFor(chapter, 0, mix, false))
  return looks
}

// Spec 09 test 5 grid: h in [0.15, 1] in 0.01 steps, 64 azimuths.
const COVERAGE_GRID: Vec3[] = Array.from({ length: 86 }, (_, i) => .15 + i * .01)
  .flatMap(h => Array.from({ length: 64 }, (_, a) => dirAt(h, a / 64 * 360)))
const noiseAt = (dir: Vec3, variant: SkyVariant) => cloudFbm(...cloudUv(dir, [0, 0]), CLOUD_OCTAVES[variant])

describe('sun', () => {
  it('builds unit directions from elevation and azimuth', () => {
    for (const [e, a] of [[0, 0], [38, -60], [-22, 10], [90, 45]] as const) {
      const d = sunDirectionFor(e, a)
      expect(Math.hypot(...d)).toBeCloseTo(1, 12)
    }
    sunDirectionFor(90, 0).forEach((v, i) => expect(v).toBeCloseTo([0, 1, 0][i]!, 12))
    sunDirectionFor(0, 0).forEach((v, i) => expect(v).toBeCloseTo([0, 0, -1][i]!, 12))
    sunDirectionFor(0, 90).forEach((v, i) => expect(v).toBeCloseTo([-1, 0, 0][i]!, 12))
    expect(sunDirectionFor(-22, 10)[1]).toBeLessThan(0)
  })

  it('fades sun visibility below the horizon', () => {
    expect(sunVisibilityFor(sunDirectionFor(7, 0)[1])).toBe(1)
    expect(sunVisibilityFor(sunDirectionFor(-3, 0)[1])).toBeCloseTo(.92, 2)
    expect(sunVisibilityFor(sunDirectionFor(-22, 0)[1])).toBe(0)
  })
})

describe('gradient', () => {
  it('pins the curve', () => {
    expect(skyCurve(.05)).toBeLessThan(.005)
    expect(skyCurve(0)).toBe(0)
    expect(skyCurve(1)).toBe(1)
  })

  it('reaches the zenith colour exactly at h = 1', () => {
    for (const look of allLooks()) {
      const p = skyParamsFor(look, [0, 0])
      expect(gradientAt(1, p)).toEqual(p.zenith)
    }
  })

  it('equals the authored fog colour at and below the horizon in every look and blend', () => {
    let worst = 0
    for (const look of allLooks()) for (const offset of [[0, 0], [12.3, -4.5]] as const) for (const variant of VARIANTS) {
      const p = skyParamsFor(look, offset), fog = toLinear(look.fogColor)
      for (let i = 0; i <= 8; i++) for (let a = 0; a < 360; a += 22.5) {
        const c = skyGradient(dirAt(Math.min(-.03 + i * .005, .01), a), p, variant)
        worst = Math.max(worst, ...c.map((v, k) => Math.abs(v - fog[k]!)))
      }
    }
    expect(worst).toBeLessThan(1e-6)
  })

  it('never exceeds SKY_MAX_LUMINANCE, including looking into the sun', () => {
    let worst = 0
    for (const look of allLooks()) for (const variant of VARIANTS) {
      const p = skyParamsFor(look, [0, 0])
      const dirs: Vec3[] = [p.sunDir]
      for (let h = -.1; h <= 1; h += .02) for (let a = 0; a < 360; a += 11.25) dirs.push(dirAt(Math.min(h, 1), a))
      for (const d of dirs) worst = Math.max(worst, luminance(skyGradient(d, p, variant)))
    }
    expect(worst).toBeLessThanOrEqual(SKY_MAX_LUMINANCE + 1e-9)
  })

  it('is continuous: the gradient in 0.01 steps, the cloudless sky in 0.0005 steps', () => {
    let gradientStep = 0, skyStep = 0
    for (const look of allLooks()) {
      const p = { ...skyParamsFor(look, [0, 0]), cloudCover: 0 }
      for (let i = 0; i < 104; i++) {
        const a = gradientAt(-.05 + i * .01, p), b = gradientAt(-.05 + (i + 1) * .01, p)
        gradientStep = Math.max(gradientStep, ...a.map((v, k) => Math.abs(v - b[k]!)))
      }
      for (let az = 0; az < 360; az += 30) for (let i = 0; i < 2100; i++) {
        const a = skyGradient(dirAt(-.05 + i * .0005, az), p, 'lite')
        const b = skyGradient(dirAt(-.05 + (i + 1) * .0005, az), p, 'lite')
        skyStep = Math.max(skyStep, ...a.map((v, k) => Math.abs(v - b[k]!)))
      }
    }
    expect(gradientStep).toBeLessThan(.05)
    expect(skyStep).toBeLessThan(.05)
  })

  it('adds no sun terms at dark about', () => {
    const p = skyParamsFor(LOOKS.dark.about, [0, 0])
    let worst = 0
    for (let h = -.1; h <= 1; h += .02) for (let a = 0; a < 360; a += 15) {
      worst = Math.max(worst, ...skyLayers(dirAt(Math.min(h, 1), a), p, 'full').glow)
    }
    expect(worst).toBeLessThan(1 / 255)
  })
})

describe('clouds', () => {
  it.each(VARIANTS)('cover thresholds are measured from the %s mirror', variant => {
    const sorted = COVERAGE_GRID.map(d => noiseAt(d, variant)).sort((a, b) => a - b)
    const table = COVER_THRESHOLDS[variant]
    expect(table[0]).toBe(1)
    expect(table[4]).toBe(-.2)
    expect(sorted.at(-1)!).toBeLessThan(table[0]!)
    expect(sorted[0]!).toBeGreaterThan(table[4]! + CLOUD_SOFTNESS)
    ;[.25, .5, .75].forEach((cover, k) => {
      const measured = sorted[Math.floor((1 - cover) * sorted.length)]! - CLOUD_SOFTNESS / 2
      expect(Math.abs(table[k + 1]! - measured)).toBeLessThan(1e-3)
    })
  })

  it.each(VARIANTS)('covers the upper sky to within 0.1 of cloudCover: %s', variant => {
    for (const cover of [.25, .45, .55, .65]) {
      const covered = COVERAGE_GRID.filter(d => cloudDensity(noiseAt(d, variant), d[1], cover, variant) > .5).length
      expect(Math.abs(covered / COVERAGE_GRID.length - cover)).toBeLessThanOrEqual(.1)
    }
    expect(COVERAGE_GRID.every(d => cloudDensity(noiseAt(d, variant), d[1], 0, variant) === 0)).toBe(true)
  })

  it.each(VARIANTS)('keeps clouds off the horizon: %s', variant => {
    for (const h of [-.2, 0, .01, .02]) for (const noise of [0, .5, 1]) {
      expect(cloudDensity(noise, h, 1, variant)).toBe(0)
    }
  })

  it('keeps night clouds within 8/255 of the clear sky at dark about', () => {
    const look = LOOKS.dark.about
    let worst = 0
    for (const variant of VARIANTS) for (const offset of [[0, 0], [7.3, 2.1], [19.7, -4.4], [-11, 14]] as const) {
      const p = skyParamsFor(look, offset)
      for (let i = 0; i <= 98; i++) for (let a = 0; a < 64; a++) {
        const layers = skyLayers(dirAt(.02 + i * .01, a / 64 * 360), p, variant)
        worst = Math.max(worst, maxChannelDelta(displayBytes(composeSky(layers), look.exposure),
          displayBytes(composeSky(layers, 0), look.exposure)))
      }
    }
    expect(worst).toBeLessThanOrEqual(8)
  })
})
```

Add to the end of `repos/portfolio/tests/journey/stops.test.ts`:

```ts
it('keeps night clouds faint (spec 09 test 16, retuned 2026-10-09)', () => {
  expect(LOOKS.dark.about.cloudCover).toBe(.1)
  expect(LOOKS.dark.about.cloudLitColor).toEqual(hexToRgb('#2c3353'))
  expect(LOOKS.dark.about.cloudShadeColor).toEqual(hexToRgb('#181c35'))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd repos/portfolio && npx vitest run tests/journey/sky-mirror.test.ts tests/journey/stops.test.ts`
Expected: FAIL. `sky-mirror.test.ts` fails to import `../../app/journey/sky-mirror`, and the new `stops.test.ts` case fails (`expected 0.25 to be 0.1`).

- [ ] **Step 3: Write the mirror**

Create `repos/portfolio/app/journey/sky-mirror.ts`:

```ts
import * as THREE from 'three'
import { clamp01, lerp } from './interpolate'
import type { LookState, Vec3 } from './stops'

// TypeScript mirror of the sky dome fragment shader (sky-shader.ts). Unit
// tests run against this file, so keep every step in the same order as the GLSL.

export type SkyVariant = 'full' | 'lite'
export type CloudOffset = readonly [number, number]

export const SKY_MAX_LUMINANCE = 0.92
export const HORIZON_FLAT = 0.01
export const CLOUD_SCALE = 0.6
export const CLOUD_SOFTNESS = 0.18
export const CLOUD_OPACITY = 0.95
export const CLOUD_WIND: CloudOffset = [0.01, 0.004]
export const CLOUD_TIME_WRAP = 3600
export const CLOUD_OCTAVE_SHIFT: CloudOffset = [17.3, 9.1]
export const CLOUD_OCTAVES: Readonly<Record<SkyVariant, number>> = { full: 4, lite: 2 }
export const COVER_STOPS: readonly number[] = [0, 0.25, 0.5, 0.75, 1]
// Noise value that each cover fraction of the spec 09 test-5 grid exceeds,
// minus half the softness, measured from cloudFbm at offset (0, 0); see
// sky-mirror.test.ts. Cover 0 and 1 are anchors outside the noise range.
export const COVER_THRESHOLDS: Readonly<Record<SkyVariant, readonly number[]>> = {
  full: [1, 0.4916, 0.3589, 0.2156, -0.2],
  lite: [1, 0.5175, 0.3393, 0.1659, -0.2],
}

const LUMA: Vec3 = [0.2126, 0.7152, 0.0722]
const MIN_LUMINANCE = 1e-4
const MIN_HORIZONTAL = 1e-4
const MIN_CLOUD_LIFT = 0.05

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const fract = (x: number): number => x - Math.floor(x)

export function normalize3(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2])
  return [v[0] / length, v[1] / length, v[2] / length]
}

export function luminance(c: Vec3): number {
  return dot3(c, LUMA)
}

export function toLinear(srgb: Vec3): Vec3 {
  const c = new THREE.Color().setRGB(srgb[0], srgb[1], srgb[2], THREE.SRGBColorSpace)
  return [c.r, c.g, c.b]
}

// Same formula as GLSL smoothstep.
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export function skyCurve(x: number): number {
  return smoothstep(0, 1, clamp01(x)) ** 1.2
}

// Azimuth 0 points toward -Z and positive angles turn toward -X.
export function sunDirectionFor(elevationDeg: number, azimuthDeg: number): Vec3 {
  const e = elevationDeg * Math.PI / 180
  const a = azimuthDeg * Math.PI / 180
  return [-Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]
}

export function sunVisibilityFor(sunY: number): number {
  return smoothstep(-0.3, 0, sunY)
}

// Hash without sine (Dave Hoskins), stable in 32-bit floats on the GPU.
export function cloudHash(x: number, y: number): number {
  let a = fract(x * 0.1031)
  let b = fract(y * 0.1031)
  let c = fract(x * 0.1031)
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33)
  a += d
  b += d
  c += d
  return fract((a + b) * c)
}

export function cloudNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  return lerp(
    lerp(cloudHash(ix, iy), cloudHash(ix + 1, iy), ux),
    lerp(cloudHash(ix, iy + 1), cloudHash(ix + 1, iy + 1), ux),
    uy,
  )
}

// Value-noise fbm normalized to 0..1.
export function cloudFbm(x: number, y: number, octaves: number): number {
  let sum = 0, amplitude = 0.5, norm = 0, px = x, py = y
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * cloudNoise(px, py)
    norm += amplitude
    px = px * 2 + CLOUD_OCTAVE_SHIFT[0]
    py = py * 2 + CLOUD_OCTAVE_SHIFT[1]
    amplitude *= 0.5
  }
  return sum / norm
}

// Projects a unit direction onto a cloud ceiling: dividing by height makes
// clouds shrink and bunch toward the horizon.
export function cloudUv(dir: Vec3, offset: CloudOffset): [number, number] {
  const lift = Math.max(dir[1], MIN_CLOUD_LIFT)
  return [dir[0] / lift * CLOUD_SCALE + offset[0], dir[2] / lift * CLOUD_SCALE + offset[1]]
}

export function coverThreshold(cover: number, variant: SkyVariant): number {
  const table = COVER_THRESHOLDS[variant]
  const c = clamp01(cover) * (COVER_STOPS.length - 1)
  const i = Math.min(COVER_STOPS.length - 2, Math.floor(c))
  return lerp(table[i]!, table[i + 1]!, c - i)
}

export function cloudDensity(noise: number, h: number, cover: number, variant: SkyVariant): number {
  const threshold = coverThreshold(cover, variant)
  return smoothstep(threshold, threshold + CLOUD_SOFTNESS, noise) * smoothstep(0.02, 0.15, h)
}

export interface SkyParams {
  horizon: Vec3
  mid: Vec3
  zenith: Vec3
  sunDir: Vec3
  sunColor: Vec3
  sunGlow: number
  cloudCover: number
  cloudLit: Vec3
  cloudShade: Vec3
  cloudOffset: CloudOffset
}

// Linear uniform values for a look. `fogColor` is the authored horizon colour.
export function skyParamsFor(look: LookState, cloudOffset: CloudOffset): SkyParams {
  return {
    horizon: toLinear(look.fogColor),
    mid: toLinear(look.skyColor),
    zenith: toLinear(look.skyZenith),
    sunDir: sunDirectionFor(look.sunElevation, look.sunAzimuth),
    sunColor: toLinear(look.sunColor),
    sunGlow: look.sunGlow,
    cloudCover: look.cloudCover,
    cloudLit: toLinear(look.cloudLitColor),
    cloudShade: toLinear(look.cloudShadeColor),
    cloudOffset,
  }
}

// Shader step 1. Exactly the horizon colour for h <= HORIZON_FLAT.
export function gradientAt(h: number, p: SkyParams): Vec3 {
  const hh = Math.max(h - HORIZON_FLAT, 0) / (1 - HORIZON_FLAT)
  const low = mix3(p.horizon, p.mid, skyCurve(hh / 0.4))
  return mix3(low, p.zenith, skyCurve((hh - 0.25) / 0.75))
}

function horizontalOf(v: Vec3): [number, number] {
  const length = Math.max(Math.hypot(v[0], v[2]), MIN_HORIZONTAL)
  return [v[0] / length, v[2] / length]
}

export interface SkyLayers {
  base: Vec3
  glow: Vec3
  cloud: Vec3
  density: number
}

// Shader steps 1 to 5 and the cloud terms of spec 09 section 6.
export function skyLayers(direction: Vec3, p: SkyParams, variant: SkyVariant): SkyLayers {
  const dir = normalize3(direction)
  const h = dir[1]
  const vis = sunVisibilityFor(p.sunDir[1])
  const env = smoothstep(0.01, 0.05, h)
  const s = Math.max(dot3(dir, p.sunDir), 0)
  const glow = (s ** 8 * 0.5 + s ** 64 * 0.8) * p.sunGlow * vis * env
  const [hx, hz] = horizontalOf(dir)
  const [sx, sz] = horizontalOf(p.sunDir)
  const bandX = (h - 0.07) / 0.07
  const band = 0.25 * p.sunGlow * vis * env * Math.exp(-bandX * bandX) * (0.5 + 0.5 * (hx * sx + hz * sz))
  const [u, v] = cloudUv(dir, p.cloudOffset)
  const noise = cloudFbm(u, v, CLOUD_OCTAVES[variant])
  let cloud = mix3(p.cloudLit, p.cloudShade, smoothstep(0.55, 1, noise))
  if (variant === 'full') {
    const shadowNoise = cloudFbm(u + p.sunDir[0] * 0.08, v + p.sunDir[2] * 0.08, 2)
    cloud = mix3(cloud, p.cloudShade, 0.5 * clamp01((shadowNoise - noise) * 4))
  }
  return {
    base: gradientAt(h, p),
    glow: scale3(p.sunColor, glow + band),
    cloud,
    density: cloudDensity(noise, h, p.cloudCover, variant),
  }
}

// Composite and bloom cap (spec 09 section 6 step 6, spec 05 step 7).
// `density` overrides the cloud density for tests.
export function composeSky(layers: SkyLayers, density = layers.density): Vec3 {
  const col = mix3(add3(layers.base, layers.glow), add3(layers.cloud, scale3(layers.glow, 0.4)), density * CLOUD_OPACITY)
  return scale3(col, Math.min(1, SKY_MAX_LUMINANCE / Math.max(luminance(col), MIN_LUMINANCE)))
}

export function skyGradient(direction: Vec3, p: SkyParams, variant: SkyVariant): Vec3 {
  return composeSky(skyLayers(direction, p, variant))
}
```

- [ ] **Step 4: Run the tests to see that only the night-cloud cases fail**

Run: `cd repos/portfolio && npx vitest run tests/journey/sky-mirror.test.ts tests/journey/stops.test.ts`
Expected: every case passes except `keeps night clouds within 8/255 of the clear sky at dark about` (worst about 40 to 60) and the `stops.test.ts` pin. If any other case fails, compare the mirror with the code above. The `COVER_THRESHOLDS` values were measured from exactly this hash, noise, and fbm.

- [ ] **Step 5: Retune the dark `about` clouds**

In `repos/portfolio/app/journey/stops.ts`, in the `dark.about` entry, replace:

```ts
      sunElevation: -22, sunAzimuth: 10, sunColor: hexToRgb('#7a8cc4'), sunGlow: 0, cloudCover: .25,
      cloudLitColor: hexToRgb('#3a4266'), cloudShadeColor: hexToRgb('#12152a'), hemiIntensity: .5, starOpacity: 1,
```

with:

```ts
      // Night clouds stay within 8/255 of the clear sky (spec 09 test 16); retuned 2026-10-09.
      sunElevation: -22, sunAzimuth: 10, sunColor: hexToRgb('#7a8cc4'), sunGlow: 0, cloudCover: .1,
      cloudLitColor: hexToRgb('#2c3353'), cloudShadeColor: hexToRgb('#181c35'), hemiIntensity: .5, starOpacity: 1,
```

- [ ] **Step 6: Run the full unit suite**

Run: `cd repos/portfolio && npm test`
Expected: PASS, every file. The night-cloud worst case is about 4/255. If it is above 8, stop and report the number. Do not tune further without the user.

- [ ] **Step 7: Commit**

```bash
git add repos/portfolio/app/journey/sky-mirror.ts repos/portfolio/app/journey/stops.ts \
  repos/portfolio/tests/gpu/sky-expect.ts repos/portfolio/tests/journey/sky-mirror.test.ts \
  repos/portfolio/tests/journey/stops.test.ts
git commit -m "feat: add sky shader mirror and faint night clouds"
```

---

### Task 2: Dome shader and `Sky` module

**Files:**
- Modify: `repos/portfolio/app/journey/shader-utils.ts` (add `glslFloat`, `glslVec3`)
- Modify: `repos/portfolio/app/journey/facade-material.ts:15-16` (use the shared helpers)
- Create: `repos/portfolio/app/journey/sky-shader.ts`
- Create: `repos/portfolio/app/journey/sky.ts`
- Modify: `repos/portfolio/tests/journey/shader-utils.test.ts`
- Create: `repos/portfolio/tests/journey/sky.test.ts`

**Interfaces:**
- Consumes: everything `sky-mirror.ts` produces (Task 1); `StopState`, `LookState`, `Vec3` (`stops.ts`).
- Produces:
  - `shader-utils.ts`: `glslFloat(n: number): string`, `glslVec3(rgb: readonly number[]): string`
  - `sky-shader.ts`: `SKY_VERTEX_SHADER: string`, `skyFragmentShader(variant: SkyVariant): string`
  - `sky.ts`: `SKY_NAME = 'journey-sky-dome'`, `SKY_RADIUS = 200`, `CAMERA_FAR = 260`, `interface SunLight { position: Vec3; intensity: number }`, `lightFromStop(look: Pick<LookState, 'sunElevation' | 'sunAzimuth'>): SunLight`, `cloudOffsetAt(t: number, reduced: boolean): CloudOffset`, `interface Sky { readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>; readonly sunDirection: THREE.Vector3; readonly sunVisibility: number; update(state: StopState, cameraPosition: THREE.Vector3, t: number): void }`, `createSky(variant: SkyVariant, reduced: boolean): Sky`
  - Dome uniforms (names used by GPU tests): `uHorizon`, `uMid`, `uZenith`, `uSunDir`, `uSunColor` (`THREE.Vector3`, linear), `uSunGlow`, `uCloudCover` (`number`), `uCloudLit`, `uCloudShade` (`THREE.Vector3`), `uCloudOffset` (`THREE.Vector2`). Material name `journey-sky`.

- [ ] **Step 1: Write the failing tests**

Add to `repos/portfolio/tests/journey/shader-utils.test.ts`. Extend the existing import from `../../app/journey/shader-utils` with `glslFloat, glslVec3`, then add:

```ts
it('formats GLSL float and vec3 literals', () => {
  expect(glslFloat(1)).toBe('1.0')
  expect(glslFloat(-1)).toBe('-1.0')
  expect(glslFloat(0.92)).toBe('0.920000000000')
  expect(glslVec3([1, .5, 0])).toBe('vec3(1.0, 0.500000000000, 0.0)')
})
```

Create `repos/portfolio/tests/journey/sky.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { glslFloat } from '../../app/journey/shader-utils'
import { CAMERA_FAR, SKY_NAME, SKY_RADIUS, cloudOffsetAt, createSky, lightFromStop } from '../../app/journey/sky'
import {
  CLOUD_SCALE, CLOUD_TIME_WRAP, CLOUD_WIND, COVER_THRESHOLDS, SKY_MAX_LUMINANCE, sunDirectionFor,
  sunVisibilityFor, toLinear,
} from '../../app/journey/sky-mirror'
import { LOOKS, PATH_STOPS } from '../../app/journey/stops'

const darkAbout = { ...PATH_STOPS.about, ...LOOKS.dark.about }

describe('sun light', () => {
  it('keeps a moonlight floor from above while the sun direction stays unclamped', () => {
    const light = lightFromStop(LOOKS.dark.about)
    expect(light.intensity).toBe(.25)
    expect(light.position[1]).toBeGreaterThanOrEqual(2)
    const direction = sunDirectionFor(-22, 10)
    expect(direction[1]).toBeLessThan(0)
    // Moonlight does not feed the rim or the glow.
    expect(sunVisibilityFor(direction[1])).toBe(0)
  })

  it('gives full light to a high sun and places it along the sun direction', () => {
    const light = lightFromStop(LOOKS.light.skills)
    expect(light.intensity).toBe(1)
    sunDirectionFor(55, -10).forEach((v, i) => expect(light.position[i]).toBeCloseTo(v * 10, 12))
  })

  it('uses the floor and the height clamp just after sunset', () => {
    const light = lightFromStop(LOOKS.dark.projects)
    expect(light.intensity).toBe(.25)
    expect(light.position[1]).toBe(2)
  })
})

describe('cloud drift', () => {
  it('stays still on the reduced tier', () => {
    for (const t of [0, 5, 1e6]) expect(cloudOffsetAt(t, true)).toEqual([0, 0])
  })

  it('moves continuously within an hour and wraps once an hour', () => {
    const a = cloudOffsetAt(100, false), b = cloudOffsetAt(100 + 1 / 60, false)
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThan(1e-3)
    expect(cloudOffsetAt(CLOUD_TIME_WRAP, false)).toEqual([0, 0])
  })

  it('stays finite and bounded in a long session', () => {
    const limit = Math.hypot(CLOUD_WIND[0], CLOUD_WIND[1]) * CLOUD_TIME_WRAP
    for (const t of [0, 1799.5, 3599.9, 1e7, Number.NaN]) {
      const [x, y] = cloudOffsetAt(t, false)
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
      expect(Math.hypot(x, y)).toBeLessThan(limit)
    }
  })
})

describe('dome', () => {
  it.each(['full', 'lite'] as const)('builds the %s program and mesh', variant => {
    const sky = createSky(variant, false)
    const m = sky.mesh.material
    expect(m.customProgramCacheKey()).toBe(`sky-${variant}`)
    expect(m.name).toBe('journey-sky')
    expect(sky.mesh.geometry.parameters).toMatchObject(variant === 'full'
      ? { radius: SKY_RADIUS, widthSegments: 32, heightSegments: 16 }
      : { radius: SKY_RADIUS, widthSegments: 24, heightSegments: 12 })
    expect(SKY_RADIUS).toBeLessThan(CAMERA_FAR)
    expect(m.side).toBe(THREE.BackSide)
    expect(m.depthWrite).toBe(false)
    expect(m.fog).toBe(false)
    expect(m.transparent).toBe(false)
    expect(sky.mesh.name).toBe(SKY_NAME)
    expect(sky.mesh.renderOrder).toBe(-1000)
    expect(sky.mesh.frustumCulled).toBe(false)
    const source = m.fragmentShader
    expect(source.startsWith('precision highp float;')).toBe(true)
    expect(source).toContain(`#define CLOUD_OCTAVES ${variant === 'full' ? 4 : 2}`)
    expect(source).toContain(`#define CLOUD_SELF_SHADOW ${variant === 'full' ? 1 : 0}`)
    expect(source).toContain(`#define SKY_MAX_LUMINANCE ${glslFloat(SKY_MAX_LUMINANCE)}`)
    expect(source).toContain(`#define CLOUD_SCALE ${glslFloat(CLOUD_SCALE)}`)
    for (const threshold of COVER_THRESHOLDS[variant]) expect(source).toContain(glslFloat(threshold))
    // GLSL pow() is undefined for a negative base; the band uses x * x.
    expect(source).not.toMatch(/pow\(\s*\(h/)
    expect(source.indexOf('#include <tonemapping_fragment>')).toBeGreaterThan(source.indexOf('SKY_MAX_LUMINANCE / max('))
    expect(source.indexOf('#include <colorspace_fragment>')).toBeGreaterThan(source.indexOf('#include <tonemapping_fragment>'))
  })

  it('feeds authored linear colours, follows the camera and exposes the sun', () => {
    const sky = createSky('full', false)
    const camera = new THREE.Vector3(3, .5, -20)
    sky.update(darkAbout, camera, 10)
    const u = sky.mesh.material.uniforms
    expect(u.uHorizon!.value.toArray()).toEqual([...toLinear(darkAbout.fogColor)])
    expect(u.uMid!.value.toArray()).toEqual([...toLinear(darkAbout.skyColor)])
    expect(u.uZenith!.value.toArray()).toEqual([...toLinear(darkAbout.skyZenith)])
    expect(u.uSunColor!.value.toArray()).toEqual([...toLinear(darkAbout.sunColor)])
    expect(u.uCloudLit!.value.toArray()).toEqual([...toLinear(darkAbout.cloudLitColor)])
    expect(u.uCloudShade!.value.toArray()).toEqual([...toLinear(darkAbout.cloudShadeColor)])
    expect(u.uSunGlow!.value).toBe(darkAbout.sunGlow)
    expect(u.uCloudCover!.value).toBe(darkAbout.cloudCover)
    expect(u.uCloudOffset!.value.toArray()).toEqual([...cloudOffsetAt(10, false)])
    expect(sky.mesh.position.toArray()).toEqual([3, .5, -20])
    expect(sky.sunDirection.toArray()).toEqual([...sunDirectionFor(-22, 10)])
    expect(sky.sunVisibility).toBe(0)
  })

  it('holds the clouds still on the reduced tier', () => {
    const sky = createSky('lite', true)
    sky.update(darkAbout, new THREE.Vector3(), 500)
    expect(sky.mesh.material.uniforms.uCloudOffset!.value.toArray()).toEqual([0, 0])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd repos/portfolio && npx vitest run tests/journey/sky.test.ts tests/journey/shader-utils.test.ts`
Expected: FAIL. `sky.test.ts` cannot import `../../app/journey/sky`, and `glslFloat` is not exported.

- [ ] **Step 3: Add the shared GLSL formatters**

Append to `repos/portfolio/app/journey/shader-utils.ts`:

```ts
// GLSL float literal: integers keep a ".0", others use 12 significant digits.
export function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : n.toPrecision(12)
}

export function glslVec3(rgb: readonly number[]): string {
  return `vec3(${rgb.map(glslFloat).join(', ')})`
}
```

In `repos/portfolio/app/journey/facade-material.ts`, replace:

```ts
import { replaceOrThrow } from './shader-utils'
```

with:

```ts
import { glslFloat, glslVec3, replaceOrThrow } from './shader-utils'
```

and replace:

```ts
const glsl = (n: number) => (Number.isInteger(n) ? `${n}.0` : n.toPrecision(12))
const glsl3 = (rgb: readonly number[]) => `vec3(${rgb.map(glsl).join(', ')})`
```

with:

```ts
const glsl = glslFloat
const glsl3 = glslVec3
```

- [ ] **Step 4: Write the shader source**

Create `repos/portfolio/app/journey/sky-shader.ts`:

```ts
import {
  CLOUD_OCTAVE_SHIFT, CLOUD_OCTAVES, CLOUD_OPACITY, CLOUD_SCALE, CLOUD_SOFTNESS, COVER_THRESHOLDS,
  HORIZON_FLAT, SKY_MAX_LUMINANCE, type SkyVariant,
} from './sky-mirror'
import { glslFloat } from './shader-utils'

// The dome mesh is unrotated and centred on the camera, so the local vertex
// position is the view direction.
export const SKY_VERTEX_SHADER = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Mirrors sky-mirror.ts step by step; change both together.
export function skyFragmentShader(variant: SkyVariant): string {
  const t = COVER_THRESHOLDS[variant].map(glslFloat)
  const shift = `vec2(${glslFloat(CLOUD_OCTAVE_SHIFT[0])}, ${glslFloat(CLOUD_OCTAVE_SHIFT[1])})`
  return `precision highp float;
#define CLOUD_OCTAVES ${CLOUD_OCTAVES[variant]}
#define CLOUD_SELF_SHADOW ${variant === 'full' ? 1 : 0}
#define SKY_MAX_LUMINANCE ${glslFloat(SKY_MAX_LUMINANCE)}
#define HORIZON_FLAT ${glslFloat(HORIZON_FLAT)}
#define CLOUD_SCALE ${glslFloat(CLOUD_SCALE)}
#define CLOUD_SOFTNESS ${glslFloat(CLOUD_SOFTNESS)}
#define CLOUD_OPACITY ${glslFloat(CLOUD_OPACITY)}
uniform vec3 uHorizon;
uniform vec3 uMid;
uniform vec3 uZenith;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunGlow;
uniform float uCloudCover;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec2 uCloudOffset;
varying vec3 vDir;

float skyCurve(float x) {
  return pow(smoothstep(0.0, 1.0, clamp(x, 0.0, 1.0)), 1.2);
}

float cloudHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float cloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = cloudHash(i);
  float b = cloudHash(i + vec2(1.0, 0.0));
  float c = cloudHash(i + vec2(0.0, 1.0));
  float d = cloudHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float cloudFbm2(vec2 p) {
  float sum = 0.5 * cloudNoise(p);
  p = p * 2.0 + ${shift};
  sum += 0.25 * cloudNoise(p);
  return sum / 0.75;
}

#if CLOUD_OCTAVES == 4
float cloudFbm(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amplitude * cloudNoise(p);
    p = p * 2.0 + ${shift};
    amplitude *= 0.5;
  }
  return sum / 0.9375;
}
#else
float cloudFbm(vec2 p) {
  return cloudFbm2(p);
}
#endif

float coverThreshold(float cover) {
  float c = clamp(cover, 0.0, 1.0) * 4.0;
  float i = min(3.0, floor(c));
  float f = c - i;
  if (i < 1.0) return mix(${t[0]}, ${t[1]}, f);
  if (i < 2.0) return mix(${t[1]}, ${t[2]}, f);
  if (i < 3.0) return mix(${t[2]}, ${t[3]}, f);
  return mix(${t[3]}, ${t[4]}, f);
}

vec2 horizontalOf(vec3 v) {
  return v.xz / max(length(v.xz), 1e-4);
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float hh = max(h - HORIZON_FLAT, 0.0) / (1.0 - HORIZON_FLAT);
  vec3 low = mix(uHorizon, uMid, skyCurve(hh / 0.4));
  vec3 base = mix(low, uZenith, skyCurve((hh - 0.25) / 0.75));

  float vis = smoothstep(-0.3, 0.0, uSunDir.y);
  float env = smoothstep(0.01, 0.05, h);
  float s = max(dot(dir, uSunDir), 0.0);
  float glow = (pow(s, 8.0) * 0.5 + pow(s, 64.0) * 0.8) * uSunGlow * vis * env;
  float bandX = (h - 0.07) / 0.07;
  float facing = 0.5 + 0.5 * dot(horizontalOf(dir), horizontalOf(uSunDir));
  float band = 0.25 * uSunGlow * vis * env * exp(-bandX * bandX) * facing;
  vec3 glowTerm = uSunColor * (glow + band);

  vec2 uv = dir.xz / max(h, 0.05) * CLOUD_SCALE + uCloudOffset;
  float n = cloudFbm(uv);
  float threshold = coverThreshold(uCloudCover);
  float density = smoothstep(threshold, threshold + CLOUD_SOFTNESS, n) * smoothstep(0.02, 0.15, h);
  vec3 cloud = mix(uCloudLit, uCloudShade, smoothstep(0.55, 1.0, n));
#if CLOUD_SELF_SHADOW == 1
  float shadowNoise = cloudFbm2(uv + uSunDir.xz * 0.08);
  cloud = mix(cloud, uCloudShade, 0.5 * clamp((shadowNoise - n) * 4.0, 0.0, 1.0));
#endif

  vec3 col = mix(base + glowTerm, cloud + glowTerm * 0.4, density * CLOUD_OPACITY);
  float luminance = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= min(1.0, SKY_MAX_LUMINANCE / max(luminance, 1e-4));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
}
```

- [ ] **Step 5: Write the `Sky` module**

Create `repos/portfolio/app/journey/sky.ts`:

```ts
import * as THREE from 'three'
import {
  CLOUD_TIME_WRAP, CLOUD_WIND, skyParamsFor, smoothstep, sunDirectionFor, sunVisibilityFor,
  type CloudOffset, type SkyVariant,
} from './sky-mirror'
import { SKY_VERTEX_SHADER, skyFragmentShader } from './sky-shader'
import type { LookState, StopState, Vec3 } from './stops'

export const SKY_NAME = 'journey-sky-dome'
export const SKY_RADIUS = 200
// The dome follows the camera at SKY_RADIUS. The scene-centred haze and far
// rings reach about 185 units from the camera at the path ends.
export const CAMERA_FAR = 260

const SKY_RENDER_ORDER = -1000
const SKY_SEGMENTS: Readonly<Record<SkyVariant, readonly [number, number]>> = { full: [32, 16], lite: [24, 12] }
const SUN_LIGHT_DISTANCE = 10
const MOONLIGHT_MIN_HEIGHT = 2
const MOONLIGHT_FLOOR = 0.25
const SUN_DARK_ELEVATION = -6
const SUN_FULL_ELEVATION = 12

export interface SunLight {
  position: Vec3
  intensity: number
}

export function lightFromStop(look: Pick<LookState, 'sunElevation' | 'sunAzimuth'>): SunLight {
  const [x, y, z] = sunDirectionFor(look.sunElevation, look.sunAzimuth)
  return {
    // The height clamp keeps a below-horizon sun lighting from above as moonlight.
    position: [x * SUN_LIGHT_DISTANCE, Math.max(MOONLIGHT_MIN_HEIGHT, y * SUN_LIGHT_DISTANCE), z * SUN_LIGHT_DISTANCE],
    intensity: Math.max(MOONLIGHT_FLOOR, smoothstep(SUN_DARK_ELEVATION, SUN_FULL_ELEVATION, look.sunElevation)),
  }
}

// The CPU wraps time, so the shader never sees a large offset; clouds jump once an hour.
export function cloudOffsetAt(t: number, reduced: boolean): CloudOffset {
  if (reduced || !Number.isFinite(t)) return [0, 0]
  const wrapped = ((t % CLOUD_TIME_WRAP) + CLOUD_TIME_WRAP) % CLOUD_TIME_WRAP
  return [CLOUD_WIND[0] * wrapped, CLOUD_WIND[1] * wrapped]
}

export interface Sky {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  readonly sunDirection: THREE.Vector3
  readonly sunVisibility: number
  update(state: StopState, cameraPosition: THREE.Vector3, t: number): void
}

// The scene's dispose() traverses the dome like any other mesh, so Sky has no dispose of its own.
export function createSky(variant: SkyVariant, reduced: boolean): Sky {
  const uniforms = {
    uHorizon: { value: new THREE.Vector3() },
    uMid: { value: new THREE.Vector3() },
    uZenith: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Vector3() },
    uSunGlow: { value: 0 },
    uCloudCover: { value: 0 },
    uCloudLit: { value: new THREE.Vector3() },
    uCloudShade: { value: new THREE.Vector3() },
    uCloudOffset: { value: new THREE.Vector2() },
  }
  const material = new THREE.ShaderMaterial({
    name: 'journey-sky',
    uniforms,
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: skyFragmentShader(variant),
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
  material.customProgramCacheKey = () => `sky-${variant}`
  const [widthSegments, heightSegments] = SKY_SEGMENTS[variant]
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, widthSegments, heightSegments), material)
  mesh.name = SKY_NAME
  mesh.renderOrder = SKY_RENDER_ORDER
  mesh.frustumCulled = false
  const sunDirection = new THREE.Vector3(0, 1, 0)
  let sunVisibility = 1

  return {
    mesh,
    sunDirection,
    get sunVisibility() { return sunVisibility },
    update(state, cameraPosition, t) {
      const p = skyParamsFor(state, cloudOffsetAt(t, reduced))
      uniforms.uHorizon.value.set(...p.horizon)
      uniforms.uMid.value.set(...p.mid)
      uniforms.uZenith.value.set(...p.zenith)
      uniforms.uSunDir.value.set(...p.sunDir)
      uniforms.uSunColor.value.set(...p.sunColor)
      uniforms.uSunGlow.value = p.sunGlow
      uniforms.uCloudCover.value = p.cloudCover
      uniforms.uCloudLit.value.set(...p.cloudLit)
      uniforms.uCloudShade.value.set(...p.cloudShade)
      uniforms.uCloudOffset.value.set(...p.cloudOffset)
      sunDirection.copy(uniforms.uSunDir.value)
      sunVisibility = sunVisibilityFor(p.sunDir[1])
      mesh.position.copy(cameraPosition)
    },
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd repos/portfolio && npx vitest run tests/journey/sky.test.ts tests/journey/shader-utils.test.ts tests/journey/facade-material.test.ts`
Expected: PASS. The facade tests show that the helper move did not change the facade shader.

- [ ] **Step 7: Commit**

```bash
git add repos/portfolio/app/journey/shader-utils.ts repos/portfolio/app/journey/facade-material.ts \
  repos/portfolio/app/journey/sky-shader.ts repos/portfolio/app/journey/sky.ts \
  repos/portfolio/tests/journey/shader-utils.test.ts repos/portfolio/tests/journey/sky.test.ts
git commit -m "feat: add gradient sky dome with sun glow and clouds"
```

---

### Task 3: Ground, haze band, and far silhouette rings

**Files:**
- Create: `repos/portfolio/app/journey/random.ts`
- Create: `repos/portfolio/app/journey/skyline-far.ts`
- Modify: `repos/portfolio/app/journey/scene.ts` (move `seeded` to `random.ts`; export `CORNER_BLOCKS`, `LAYERS`, `Building`, `layerPlacements`)
- Create: `repos/portfolio/tests/journey/skyline-far.test.ts`

**Interfaces:**
- Consumes: `toLinear` (Task 1); `CAMERA_FAR`, `SKY_RADIUS` (Task 2); `WAYPOINTS`, `pathPointAt`, `PATH_TOTAL_LENGTH` (`path.ts`); `lerp` (`interpolate.ts`); `hexToRgb`, `Vec3`, `LOOKS` (`stops.ts`).
- Produces:
  - `random.ts`: `seeded(index: number): number`
  - `skyline-far.ts`: `SCENE_CENTER: { x: number; z: number }`, `GROUND_NAME = 'journey-ground'`, `GROUND_HALF_SIZE = 130`, `GROUND_Y = -1.01`, `HAZE_NAME = 'journey-haze'`, `HAZE_RADIUS = 136`, `HAZE_HEIGHT = 40`, `HAZE_BASE_Y = -1`, `HAZE_BOTTOM_ALPHA = 0.85`, `interface RingConfig`, `RINGS: { a: RingConfig; b: RingConfig }` (names `journey-far-ring-a`, `journey-far-ring-b`), `interface SilhouetteBox { x; z; distance; width; depth; height; rotation }`, `silhouetteLayout(ring, count, seed): SilhouetteBox[]`, `farColor(horizon: Vec3, amount: number): Vec3`, `createGround(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>`, `createHazeMesh(radialSegments: number): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>`, `interface FarSkyline { readonly objects: readonly THREE.Object3D[]; update(fogColor: Vec3): void }`, `createFarSkyline(lowPower: boolean): FarSkyline`
  - `scene.ts`: `export const CORNER_BLOCKS`, `export const LAYERS`, `export interface Building { x; z; width; baseHeight }`, `export function layerPlacements(config: (typeof LAYERS)[number], layerIndex: number, count: number): Building[]`

- [ ] **Step 1: Write the failing tests**

Create `repos/portfolio/tests/journey/skyline-far.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { PATH_TOTAL_LENGTH, pathPointAt } from '../../app/journey/path'
import { seeded } from '../../app/journey/random'
import { CORNER_BLOCKS, LAYERS, layerPlacements } from '../../app/journey/scene'
import { CAMERA_FAR, SKY_RADIUS } from '../../app/journey/sky'
import { toLinear } from '../../app/journey/sky-mirror'
import {
  createFarSkyline, createGround, createHazeMesh, farColor, GROUND_HALF_SIZE, GROUND_NAME, GROUND_Y,
  HAZE_BASE_Y, HAZE_HEIGHT, HAZE_NAME, HAZE_RADIUS, RINGS, SCENE_CENTER, silhouetteLayout,
} from '../../app/journey/skyline-far'
import { LOOKS, type Vec3 } from '../../app/journey/stops'

// Every camera position: the path in 0.5-unit steps, plus the full-tier pointer tilt (±0.3 sideways).
const CAMERAS = Array.from({ length: Math.ceil(PATH_TOTAL_LENGTH * 2) + 1 }, (_, i) => pathPointAt(i / 2))
  .flatMap(p => [-.3, 0, .3].map(tilt => ({ x: p.x + p.rightX * tilt, z: p.z + p.rightZ * tilt })))
const CAMERA_MAX_Y = 1 // highest cameraHeight 0.8 plus the pointer tilt 0.2
const MIN_EDGE_DISTANCE = 80

const halfDiagonal = (width: number, depth: number) => Math.hypot(width, depth) / 2
function cornerDistances(x: number, z: number, halfX: number, halfZ: number): number[] {
  return [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) =>
    Math.hypot(x + sx! * halfX - SCENE_CENTER.x, z + sz! * halfZ - SCENE_CENTER.z))
}

describe('layout', () => {
  it('centres the backdrop on the path bounding box', () => {
    expect(SCENE_CENTER).toEqual({ x: -13, z: -29 })
  })

  it('keeps the legacy seeded sequence', () => {
    for (const i of [0, 5, 1234]) {
      const x = Math.sin(i * 12.9898) * 43758.5453
      expect(seeded(i)).toBe(x - Math.floor(x))
      expect(seeded(i)).toBeGreaterThanOrEqual(0)
      expect(seeded(i)).toBeLessThan(1)
    }
  })

  it('lays a 260 x 260 ground whose edge is always at least 80 units away', () => {
    const ground = createGround()
    expect(ground.name).toBe(GROUND_NAME)
    expect(ground.geometry.parameters).toMatchObject({ width: 260, height: 260 })
    expect(ground.position.toArray()).toEqual([SCENE_CENTER.x, GROUND_Y, SCENE_CENTER.z])
    expect(ground.rotation.x).toBeCloseTo(-Math.PI / 2, 12)
    for (const c of CAMERAS) {
      const edge = Math.min(GROUND_HALF_SIZE - Math.abs(c.x - SCENE_CENTER.x), GROUND_HALF_SIZE - Math.abs(c.z - SCENE_CENTER.z))
      expect(edge).toBeGreaterThanOrEqual(MIN_EDGE_DISTANCE)
    }
  })

  it('keeps every backdrop object inside the camera far plane', () => {
    expect(SKY_RADIUS).toBeLessThan(CAMERA_FAR)
    const ringReach = Math.max(...Object.values(RINGS).map(r => r.maxDistance + halfDiagonal(10, 10)))
    const ringTop = Math.max(...Object.values(RINGS).map(r => r.maxHeight)) - 1
    for (const c of CAMERAS) {
      const fromCenter = Math.hypot(c.x - SCENE_CENTER.x, c.z - SCENE_CENTER.z)
      expect(Math.hypot(fromCenter + HAZE_RADIUS, HAZE_BASE_Y + HAZE_HEIGHT + CAMERA_MAX_Y)).toBeLessThan(CAMERA_FAR)
      expect(Math.hypot(fromCenter + ringReach, ringTop + CAMERA_MAX_Y)).toBeLessThan(CAMERA_FAR)
      const corner = Math.hypot(GROUND_HALF_SIZE + Math.abs(c.x - SCENE_CENTER.x), GROUND_HALF_SIZE + Math.abs(c.z - SCENE_CENTER.z))
      expect(corner).toBeLessThan(CAMERA_FAR)
    }
  })

  it.each(['a', 'b'] as const)('places ring %s inside its band, behind the haze, and repeatably', key => {
    const ring = RINGS[key]
    const boxes = silhouetteLayout(ring, ring.fullCount, ring.seed)
    expect(boxes).toHaveLength(ring.fullCount)
    expect(silhouetteLayout(ring, ring.fullCount, ring.seed)).toEqual(boxes)
    for (const box of boxes) {
      expect(Math.hypot(box.x - SCENE_CENTER.x, box.z - SCENE_CENTER.z)).toBeCloseTo(box.distance, 9)
      expect(box.distance).toBeGreaterThanOrEqual(ring.minDistance)
      expect(box.distance).toBeLessThanOrEqual(ring.maxDistance)
      expect(box.height).toBeGreaterThanOrEqual(ring.minHeight)
      expect(box.height).toBeLessThanOrEqual(ring.maxHeight)
      for (const size of [box.width, box.depth]) {
        expect(size).toBeGreaterThanOrEqual(5)
        expect(size).toBeLessThanOrEqual(10)
      }
      expect(box.distance + halfDiagonal(box.width, box.depth)).toBeLessThan(HAZE_RADIUS)
    }
  })

  it('keeps ring A at least 30 units outside the city', () => {
    const cityOuterRadius = Math.max(
      ...LAYERS.flatMap((config, i) => layerPlacements(config, i, config.count))
        .filter(b => b.width > 0)
        .flatMap(b => cornerDistances(b.x, b.z, b.width / 2, b.width / 2)),
      ...CORNER_BLOCKS.flatMap(b => cornerDistances(b.x, b.z, b.width / 2, b.depth / 2)),
    )
    expect(cityOuterRadius).toBeGreaterThan(30)
    for (const box of silhouetteLayout(RINGS.a, RINGS.a.fullCount, RINGS.a.seed)) {
      expect(box.distance - halfDiagonal(box.width, box.depth)).toBeGreaterThanOrEqual(cityOuterRadius + 30)
    }
  })
})

describe('colours', () => {
  it('mixes far colours toward the ink and stays in range', () => {
    for (const look of [LOOKS.light.intro, LOOKS.dark.about]) {
      expect(farColor(look.fogColor, 0)).toEqual(look.fogColor)
      for (const amount of [.1, .22, 1]) for (const v of farColor(look.fogColor, amount)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it.each([false, true])('paints the rings with a vertex gradient only (lowPower %s)', lowPower => {
    const far = createFarSkyline(lowPower)
    const fog: Vec3 = LOOKS.dark.projects.fogColor
    far.update(fog)
    const rings = far.objects.filter((o): o is THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> =>
      o instanceof THREE.InstancedMesh)
    expect(rings.map(r => [r.name, r.count])).toEqual([
      [RINGS.a.name, lowPower ? RINGS.a.liteCount : RINGS.a.fullCount],
      [RINGS.b.name, lowPower ? RINGS.b.liteCount : RINGS.b.fullCount],
    ])
    expect(lowPower ? [RINGS.a.liteCount, RINGS.b.liteCount] : [RINGS.a.fullCount, RINGS.b.fullCount])
      .toEqual(lowPower ? [36, 20] : [36, 36])
    for (const [i, ring] of rings.entries()) {
      const config = i === 0 ? RINGS.a : RINGS.b
      expect(ring.material.color.toArray()).toEqual([1, 1, 1])
      expect(ring.material.vertexColors).toBe(true)
      expect(ring.material.fog).toBe(false)
      expect(ring.instanceColor).toBeNull()
      const position = ring.geometry.getAttribute('position'), color = ring.geometry.getAttribute('color')
      expect(color.itemSize).toBe(3)
      const bottom = toLinear(fog), top = toLinear(farColor(fog, config.inkMix))
      for (let v = 0; v < position.count; v++) {
        const want = position.getY(v) < 0 ? bottom : top
        ;[color.getX(v), color.getY(v), color.getZ(v)].forEach((c, k) => expect(c).toBeCloseTo(want[k]!, 6))
      }
    }
  })
})

describe('haze', () => {
  it('fades its RGBA vertex alpha from 0.85 at the bottom to 0 at the top', () => {
    const haze = createHazeMesh(64)
    expect(haze.name).toBe(HAZE_NAME)
    expect(haze.geometry.parameters).toMatchObject({ radiusTop: 136, radiusBottom: 136, height: 40,
      radialSegments: 64, heightSegments: 1, openEnded: true })
    const position = haze.geometry.getAttribute('position'), color = haze.geometry.getAttribute('color')
    expect(color.itemSize).toBe(4)
    for (let v = 0; v < position.count; v++) {
      expect([color.getX(v), color.getY(v), color.getZ(v)]).toEqual([1, 1, 1])
      expect(color.getW(v)).toBeCloseTo(position.getY(v) < 0 ? .85 : 0, 6)
    }
    expect(haze.material.vertexColors).toBe(true)
    expect(haze.material.transparent).toBe(true)
    expect(haze.material.depthWrite).toBe(false)
    expect(haze.material.fog).toBe(false)
    expect(haze.material.side).toBe(THREE.BackSide)
    expect(haze.renderOrder).toBe(-900)
    expect(haze.position.toArray()).toEqual([SCENE_CENTER.x, -1 + 20, SCENE_CENTER.z])
  })

  it.each([false, true])('tints the haze with the authored fog colour (lowPower %s)', lowPower => {
    const far = createFarSkyline(lowPower)
    const haze = far.objects.find(o => o.name === HAZE_NAME) as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
    expect(haze.geometry.parameters.radialSegments).toBe(lowPower ? 32 : 64)
    far.update(LOOKS.light.skills.fogColor)
    haze.material.color.toArray().forEach((v, i) => expect(v).toBeCloseTo(toLinear(LOOKS.light.skills.fogColor)[i]!, 6))
    expect(far.objects).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd repos/portfolio && npx vitest run tests/journey/skyline-far.test.ts`
Expected: FAIL. The imports of `../../app/journey/random` and `../../app/journey/skyline-far` cannot be resolved.

- [ ] **Step 3: Move `seeded` and export the placement data from `scene.ts`**

Create `repos/portfolio/app/journey/random.ts`:

```ts
// Deterministic pseudo-random in [0, 1), seeded by index so layout is stable across renders.
export function seeded(index: number): number {
  const x = Math.sin(index * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
```

In `repos/portfolio/app/journey/scene.ts`:

1. Add an import after `import { createPostPipeline, ... } from './post'`:

```ts
import { seeded } from './random'
```

2. Delete these lines:

```ts
// Deterministic pseudo-random in [0, 1), seeded by index so layout is stable across renders.
function seeded(index: number): number {
  const x = Math.sin(index * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
```

3. Replace `const CORNER_BLOCKS = [` with `export const CORNER_BLOCKS = [`. Replace `const LAYERS = [` with `export const LAYERS = [`. Replace `interface Building {` with `export interface Building {`.

4. In `createBuildingLayer`, replace:

```ts
  const buildings: Building[] = []
  const seedBase = layerIndex * 1000
  for (let i = 0; i < count; i++) {
    const building = placeBuilding(seedBase + i, config.sideSpread)
    buildings.push(
      building
        ? { ...building, baseHeight: config.baseHeight * (0.5 + seeded(seedBase + i + 200)) }
        : { x: 0, z: 0, width: 0, baseHeight: 0 },
    )
  }
  return { mesh, buildings }
}
```

with:

```ts
  return { mesh, buildings: layerPlacements(config, layerIndex, count) }
}

// Seeded placements for one layer. Instance i always gets the same seed, so a
// lowPower layer's placements are a prefix of the full layer's.
export function layerPlacements(config: (typeof LAYERS)[number], layerIndex: number, count: number): Building[] {
  const seedBase = layerIndex * 1000
  return Array.from({ length: count }, (_, i) => {
    const building = placeBuilding(seedBase + i, config.sideSpread)
    return building
      ? { ...building, baseHeight: config.baseHeight * (0.5 + seeded(seedBase + i + 200)) }
      : { x: 0, z: 0, width: 0, baseHeight: 0 }
  })
}
```

- [ ] **Step 4: Write `skyline-far.ts`**

Create `repos/portfolio/app/journey/skyline-far.ts`:

```ts
import * as THREE from 'three'
import { lerp } from './interpolate'
import { WAYPOINTS } from './path'
import { seeded } from './random'
import { toLinear } from './sky-mirror'
import { hexToRgb, type Vec3 } from './stops'

const xs = WAYPOINTS.map(w => w.x)
const zs = WAYPOINTS.map(w => w.z)
// Centre of the path's bounding box, about (-13, -29). The ground, haze and far
// rings are centred here, not on the camera: the path is 100 units long, so a
// camera-centred ring would cut through buildings near the far end.
export const SCENE_CENTER = {
  x: (Math.min(...xs) + Math.max(...xs)) / 2,
  z: (Math.min(...zs) + Math.max(...zs)) / 2,
} as const

export const GROUND_NAME = 'journey-ground'
export const GROUND_HALF_SIZE = 130
export const GROUND_Y = -1.01
export const HAZE_NAME = 'journey-haze'
export const HAZE_RADIUS = 136
export const HAZE_HEIGHT = 40
export const HAZE_BASE_Y = -1
export const HAZE_BOTTOM_ALPHA = 0.85

const HAZE_RENDER_ORDER = -900
const HAZE_SEGMENTS = { full: 64, lite: 32 } as const
const SILHOUETTE_INK = hexToRgb('#15182a')
const SILHOUETTE_BASE_Y = -1
const FOOTPRINT_MIN = 5
const FOOTPRINT_MAX = 10
const GROUND_COLOR = 0x14141a

export interface RingConfig {
  name: string
  minDistance: number
  maxDistance: number
  minHeight: number
  maxHeight: number
  inkMix: number
  fullCount: number
  liteCount: number
  seed: number
}

export const RINGS: Readonly<Record<'a' | 'b', RingConfig>> = {
  a: { name: 'journey-far-ring-a', minDistance: 100, maxDistance: 110, minHeight: 10, maxHeight: 26,
    inkMix: 0.22, fullCount: 36, liteCount: 36, seed: 9100 },
  b: { name: 'journey-far-ring-b', minDistance: 116, maxDistance: 124, minHeight: 14, maxHeight: 34,
    inkMix: 0.1, fullCount: 36, liteCount: 20, seed: 9300 },
}

export interface SilhouetteBox {
  x: number
  z: number
  distance: number
  width: number
  depth: number
  height: number
  rotation: number
}

// One box per equal angular slice, jittered within its slice, so the ring has no gaps or clumps.
export function silhouetteLayout(ring: RingConfig, count: number, seed: number): SilhouetteBox[] {
  return Array.from({ length: count }, (_, i) => {
    const s = seed + i * 7
    const angle = (i + seeded(s)) / count * Math.PI * 2
    const distance = lerp(ring.minDistance, ring.maxDistance, seeded(s + 1))
    return {
      x: SCENE_CENTER.x + Math.cos(angle) * distance,
      z: SCENE_CENTER.z + Math.sin(angle) * distance,
      distance,
      width: lerp(FOOTPRINT_MIN, FOOTPRINT_MAX, seeded(s + 2)),
      depth: lerp(FOOTPRINT_MIN, FOOTPRINT_MAX, seeded(s + 3)),
      height: lerp(ring.minHeight, ring.maxHeight, seeded(s + 4)),
      rotation: -angle,
    }
  })
}

// sRGB horizon colour mixed toward the silhouette ink.
export function farColor(horizon: Vec3, amount: number): Vec3 {
  const channel = (i: 0 | 1 | 2) => Math.min(1, Math.max(0, lerp(horizon[i], SILHOUETTE_INK[i], amount)))
  return [channel(0), channel(1), channel(2)]
}

// One plane under the whole bent path, centred on the scene. At 130 units from
// the centre its edge is at least 80 units from every camera position, where
// the thinnest fog (density 0.035) leaves about 4e-4 of the ground colour. Past
// the edge the dome shows the same fog colour, so the edge disappears.
export function createGround(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_HALF_SIZE * 2, GROUND_HALF_SIZE * 2),
    new THREE.MeshStandardMaterial({ color: GROUND_COLOR, roughness: 1 }),
  )
  ground.name = GROUND_NAME
  ground.rotation.x = -Math.PI / 2
  ground.position.set(SCENE_CENTER.x, GROUND_Y, SCENE_CENTER.z)
  return ground
}

// A backdrop beyond the ground edge and both rings. Alpha comes from the RGBA
// vertex colour (r186 reads it with vertexColors); the material colour tints it.
export function createHazeMesh(radialSegments: number): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> {
  const geometry = new THREE.CylinderGeometry(HAZE_RADIUS, HAZE_RADIUS, HAZE_HEIGHT, radialSegments, 1, true)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 4)
  for (let i = 0; i < position.count; i++) {
    const t = (position.getY(i) + HAZE_HEIGHT / 2) / HAZE_HEIGHT
    colors.set([1, 1, 1, HAZE_BOTTOM_ALPHA * (1 - t)], i * 4)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = HAZE_NAME
  mesh.renderOrder = HAZE_RENDER_ORDER
  mesh.position.set(SCENE_CENTER.x, HAZE_BASE_Y + HAZE_HEIGHT / 2, SCENE_CENTER.z)
  return mesh
}

interface Ring {
  mesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>
  inkMix: number
}

function createRing(config: RingConfig, lowPower: boolean): Ring {
  const boxes = silhouetteLayout(config, lowPower ? config.liteCount : config.fullCount, config.seed)
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const vertexCount = geometry.getAttribute('position').count
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3))
  // White material: r186 multiplies material, vertex and instance colour, so the
  // vertex gradient carries the whole colour. Never call setColorAt here. Fog is
  // off on purpose: at these distances FogExp2 would hide the boxes entirely.
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, fog: false })
  const mesh = new THREE.InstancedMesh(geometry, material, boxes.length)
  mesh.name = config.name
  const up = new THREE.Vector3(0, 1, 0)
  boxes.forEach((box, i) => {
    mesh.setMatrixAt(i, new THREE.Matrix4().compose(
      new THREE.Vector3(box.x, SILHOUETTE_BASE_Y + box.height / 2, box.z),
      new THREE.Quaternion().setFromAxisAngle(up, box.rotation),
      new THREE.Vector3(box.width, box.height, box.depth),
    ))
  })
  mesh.instanceMatrix.needsUpdate = true
  return { mesh, inkMix: config.inkMix }
}

// Bottom vertices take the horizon colour so the base melts into the haze line.
function writeRingColors(geometry: THREE.BufferGeometry, bottom: Vec3, top: Vec3): void {
  const position = geometry.getAttribute('position')
  const color = geometry.getAttribute('color') as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) color.setXYZ(i, ...(position.getY(i) < 0 ? bottom : top))
  color.needsUpdate = true
}

export interface FarSkyline {
  readonly objects: readonly THREE.Object3D[]
  update(fogColor: Vec3): void
}

export function createFarSkyline(lowPower: boolean): FarSkyline {
  const haze = createHazeMesh(lowPower ? HAZE_SEGMENTS.lite : HAZE_SEGMENTS.full)
  const rings = [createRing(RINGS.a, lowPower), createRing(RINGS.b, lowPower)]
  return {
    objects: [haze, ...rings.map(ring => ring.mesh)],
    // `fogColor` is the authored sRGB horizon colour, never the CPU-mapped one:
    // these materials are tone-mapped like the dome.
    update(fogColor) {
      haze.material.color.setRGB(fogColor[0], fogColor[1], fogColor[2], THREE.SRGBColorSpace)
      const bottom = toLinear(fogColor)
      for (const ring of rings) writeRingColors(ring.mesh.geometry, bottom, toLinear(farColor(fogColor, ring.inkMix)))
    },
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd repos/portfolio && npx vitest run tests/journey/skyline-far.test.ts tests/journey/hall.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full unit suite and the type check**

Run: `cd repos/portfolio && npm test && npm run typecheck`
Expected: PASS. `scene.ts` behaves as before; only its exports changed.

- [ ] **Step 7: Commit**

```bash
git add repos/portfolio/app/journey/random.ts repos/portfolio/app/journey/skyline-far.ts \
  repos/portfolio/app/journey/scene.ts repos/portfolio/tests/journey/skyline-far.test.ts
git commit -m "feat: add far skyline rings, haze band and wide ground"
```

---

### Task 4: Wire the sky into the scene

**Files:**
- Modify: `repos/portfolio/app/journey/scene.ts`
- Create: `repos/portfolio/tests/gpu/sky.spec.ts`
- Modify: `repos/portfolio/tests/gpu/facade.spec.ts:57-58` (draw-call counts)
- Modify: `repos/portfolio/tests/gpu/post-probe-checks.ts` (`opaqueMeshes`)
- Modify: `repos/portfolio/tests/gpu/theme-component.spec.ts` (background equals the fog color)
- Modify: `repos/portfolio/tests/gpu/component-probe.ts` (sky shader fault)
- Modify: `repos/portfolio/tests/gpu/shader-failure.spec.ts`

**Interfaces:**
- Consumes: `createSky`, `CAMERA_FAR`, `lightFromStop`, `SKY_NAME` (Task 2); `createFarSkyline`, `createGround`, `GROUND_NAME`, `HAZE_NAME`, `RINGS` (Task 3).
- Produces: `scene.ts` exports `STARS_NAME = 'journey-stars'`. The scene contains objects named `journey-sky-dome`, `journey-haze`, `journey-far-ring-a`, `journey-far-ring-b`, `journey-ground`, and `journey-stars` (not on `lowPower`). `scene.background` holds the fallback horizon color, which equals `scene.fog.color`. `mountComponent` accepts `failure: 'sky-creation'`.

- [ ] **Step 1: Write the failing GPU tests**

Create `repos/portfolio/tests/gpu/sky.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import type * as THREE from 'three'
import { STARS_NAME } from '../../app/journey/scene'
import { SKY_NAME } from '../../app/journey/sky'
import { GROUND_NAME, HAZE_NAME, RINGS } from '../../app/journey/skyline-far'

const NAMES = { dome: SKY_NAME, haze: HAZE_NAME, ground: GROUND_NAME, ringA: RINGS.a.name, ringB: RINGS.b.name, stars: STARS_NAME }
const COMBINATIONS = [
  { tier: 'full', lowPower: false }, { tier: 'lite', lowPower: true },
  { tier: 'reduced', lowPower: false }, { tier: 'reduced', lowPower: true },
] as const

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})
test.afterEach(async ({ page }) => { await page.evaluate(() => window.cityGpu.dispose()) })

for (const input of COMBINATIONS) {
  test(`backdrop is wired ${input.tier}/${input.lowPower}`, async ({ page }) => {
    const r = await page.evaluate(({ input, names }) => {
      window.cityGpu.mountJourney({ ...input, width: 320, height: 180 })
      const d = window.cityGpu.renderJourney({ chapter: 1, frames: 2 })
      const { scene, camera } = window.cityGpu.getJourneyContext()
      const dome = scene.getObjectByName(names.dome) as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | undefined
      const haze = scene.getObjectByName(names.haze)
      const rings = [names.ringA, names.ringB].map(name => scene.getObjectByName(name) as THREE.InstancedMesh | undefined)
      const ground = scene.getObjectByName(names.ground) as THREE.Mesh<THREE.PlaneGeometry> | undefined
      const stars = scene.getObjectByName(names.stars)
      return {
        d, far: camera.far, camera: camera.position.toArray(),
        dome: dome ? {
          order: dome.renderOrder, culled: dome.frustumCulled, depthWrite: dome.material.depthWrite,
          side: dome.material.side, key: dome.material.customProgramCacheKey(),
          segments: dome.geometry.parameters.widthSegments, position: dome.position.toArray(),
        } : null,
        hazeOrder: haze?.renderOrder ?? null,
        rings: rings.map(ring => ring?.count ?? null),
        groundSize: ground?.geometry.parameters.width ?? null,
        starsOrder: stars?.renderOrder ?? null,
        background: (scene.background as THREE.Color).toArray(),
        fog: (scene.fog as THREE.FogExp2).color.toArray(),
      }
    }, { input, names: NAMES })
    expect(r.far).toBe(260)
    expect(r.dome).toEqual({ order: -1000, culled: false, depthWrite: false, side: 1,
      key: input.lowPower ? 'sky-lite' : 'sky-full', segments: input.lowPower ? 24 : 32, position: r.camera })
    expect(r.hazeOrder).toBe(-900)
    expect(r.rings).toEqual(input.lowPower ? [36, 20] : [36, 36])
    expect(r.groundSize).toBe(260)
    expect(r.starsOrder).toBe(input.lowPower ? null : -999)
    expect(r.background).toEqual(r.fog)
    expect(r.d.shaderError).toBeNull()
    expect(r.d.glError).toBe(0)
  })
}
```

Add to `repos/portfolio/tests/gpu/shader-failure.spec.ts`:

```ts
test('sky shader failure during creation emits unavailable', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
  await page.evaluate(() => window.cityGpu.mountComponent({ failure: 'sky-creation' }))
  await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().unavailable)).toBe(1)
  expect(await page.evaluate(() => window.cityGpu.componentStatus().visible)).toBe(false)
  await page.evaluate(() => window.cityGpu.unmountComponent())
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd repos/portfolio && npx playwright test --config playwright.config.ts tests/gpu/sky.spec.ts tests/gpu/shader-failure.spec.ts`
Expected: FAIL. `STARS_NAME` is not exported, so `sky.spec.ts` fails to load. Once it exists, the backdrop tests fail with `expected 120 to be 260`. The sky-fault test times out with `unavailable` still 0, because `mountComponent` ignores `'sky-creation'` until Step 3.

- [ ] **Step 3: Add the sky fault to the component probe**

In `repos/portfolio/tests/gpu/component-probe.ts`:

1. Replace `let creationFault: 'glsl' | 'missing-marker' | null = null` with:

```ts
type ShaderFault = 'glsl' | 'missing-marker'
let creationFault: { fault: ShaderFault; prefix: string } | null = null
```

2. Replace the signature line `function breakFacadeShader(scene: THREE.Scene, fault: 'glsl' | 'missing-marker' = 'glsl') {` with:

```ts
function breakFacadeShader(scene: THREE.Scene, fault: ShaderFault = 'glsl', prefix = 'journey-facade-') {
```

and inside it replace `if (!material.name.startsWith('journey-facade-')) continue` with `if (!material.name.startsWith(prefix)) continue`.

3. In `mountComponent`, change the options type to `failure: 'none' | 'creation' | 'missing-marker' | 'sky-creation'` and replace:

```ts
  creationFault = options.failure === 'creation' ? 'glsl' : options.failure === 'missing-marker' ? 'missing-marker' : null
```

with:

```ts
  creationFault = options.failure === 'creation' ? { fault: 'glsl', prefix: 'journey-facade-' }
    : options.failure === 'missing-marker' ? { fault: 'missing-marker', prefix: 'journey-facade-' }
      : options.failure === 'sky-creation' ? { fault: 'glsl', prefix: 'journey-sky' }
        : null
```

4. In the render wrapper, replace:

```ts
      if (creationFault) {
        const fault = creationFault
        creationFault = null
        breakFacadeShader(capturedScene, fault)
      }
```

with:

```ts
      if (creationFault) {
        const { fault, prefix } = creationFault
        creationFault = null
        breakFacadeShader(capturedScene, fault, prefix)
      }
```

- [ ] **Step 4: Wire `scene.ts`**

In `repos/portfolio/app/journey/scene.ts`:

1. Add imports after `import { seeded } from './random'`:

```ts
import { CAMERA_FAR, createSky, lightFromStop } from './sky'
import { createFarSkyline, createGround } from './skyline-far'
```

2. Replace `const STAR_COUNT = 800` with:

```ts
const STAR_COUNT = 800
export const STARS_NAME = 'journey-stars'
// After the dome (-1000) and before the haze (-900). The dome writes no depth,
// so stars inside it stay visible. Stars sit within about 110 units of any
// camera, inside the dome radius of 200.
const STARS_RENDER_ORDER = -999
```

3. In `createStars`, replace:

```ts
  const material = new THREE.PointsMaterial({ size: 0.025, color: 0xffffff, transparent: true, opacity: 0, fog: false })
  return new THREE.Points(geometry, material)
}
```

with:

```ts
  const material = new THREE.PointsMaterial({ size: 0.025, color: 0xffffff, transparent: true, opacity: 0, fog: false })
  const stars = new THREE.Points(geometry, material)
  stars.name = STARS_NAME
  stars.renderOrder = STARS_RENDER_ORDER
  return stars
}
```

4. Delete the whole `function createGround(): THREE.Mesh { ... }` block (the version sized to the waypoint bounds plus margins). `createGround` now comes from `skyline-far.ts`.

5. Replace `const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 120)` with `const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, CAMERA_FAR)`.

6. Replace:

```ts
  const sky = new THREE.Color(0xbfdbfe)
  scene.background = sky
```

with:

```ts
  // The dome covers the background. The background stays at the horizon colour
  // as a fallback in case the dome does not draw.
  const horizonFallback = new THREE.Color(0xbfdbfe)
  scene.background = horizonFallback
```

7. Replace:

```ts
  const stars = !lowPower ? createStars() : null
  if (stars) scene.add(stars)
```

with:

```ts
  const stars = !lowPower ? createStars() : null
  if (stars) scene.add(stars)
  const sky = createSky(lowPower ? 'lite' : 'full', tier === 'reduced')
  const farSkyline = createFarSkyline(lowPower)
  scene.add(sky.mesh, ...farSkyline.objects)
```

8. In `apply`, replace:

```ts
    // The composer tone-maps the whole frame, so sky and fog stay authored. The
    // direct path tone-maps only object pixels, so map sky and fog on the CPU.
    if (post) post.setLook(state.exposure, state.bloomStrength)
    else renderer.toneMappingExposure = state.exposure
    const skyRgb = post ? state.skyColor : skyForDirectPipeline(state.skyColor, state.exposure)
    const fogRgb = post ? state.fogColor : skyForDirectPipeline(state.fogColor, state.exposure)
    sky.setRGB(skyRgb[0], skyRgb[1], skyRgb[2], THREE.SRGBColorSpace)
    fog.color.setRGB(fogRgb[0], fogRgb[1], fogRgb[2], THREE.SRGBColorSpace)
```

with:

```ts
    // The composer tone-maps the whole frame, so fog stays authored. The direct
    // path tone-maps only object pixels, so map fog and the fallback background
    // on the CPU. The dome and far skyline tone-map themselves, so they always
    // take the authored colours.
    if (post) post.setLook(state.exposure, state.bloomStrength)
    else renderer.toneMappingExposure = state.exposure
    const fogRgb = post ? state.fogColor : skyForDirectPipeline(state.fogColor, state.exposure)
    horizonFallback.setRGB(fogRgb[0], fogRgb[1], fogRgb[2], THREE.SRGBColorSpace)
    fog.color.setRGB(fogRgb[0], fogRgb[1], fogRgb[2], THREE.SRGBColorSpace)
```

9. In `apply`, replace:

```ts
    sun.color.setRGB(...state.sunColor, THREE.SRGBColorSpace)
    sun.intensity = Math.max(0.25, THREE.MathUtils.smoothstep(state.sunElevation, -6, 12))
    const elevation = THREE.MathUtils.degToRad(state.sunElevation)
    const azimuth = THREE.MathUtils.degToRad(state.sunAzimuth)
    // Azimuth 0 points toward -Z and positive angles turn toward -X; the
    // height clamp keeps a below-horizon sun acting as moonlight.
    sun.position.set(-Math.sin(azimuth) * Math.cos(elevation) * 10,
      Math.max(2, Math.sin(elevation) * 10), -Math.cos(azimuth) * Math.cos(elevation) * 10)
```

with:

```ts
    const light = lightFromStop(state)
    sun.color.setRGB(...state.sunColor, THREE.SRGBColorSpace)
    sun.intensity = light.intensity
    sun.position.set(...light.position)
```

10. In `apply`, replace:

```ts
    if (stars) stars.material.opacity = state.starOpacity
```

with:

```ts
    if (stars) stars.material.opacity = state.starOpacity
    farSkyline.update(state.fogColor)
```

11. In `apply`, replace:

```ts
    camera.lookAt(lookAt)
    options.onStateApplied?.(state)
```

with:

```ts
    camera.lookAt(lookAt)
    sky.update(state, camera.position, lastTime)
    options.onStateApplied?.(state)
```

`update()` sets `lastTime = t` before it calls `apply`, and `setTheme` reuses the last time, so the clouds never jump on a theme snap.

12. Keep `scene.add(createGround())` unchanged. It now calls the imported function.

Run `wc -l repos/portfolio/app/journey/scene.ts`. Expected: below 800 (about 740).

- [ ] **Step 5: Update the GPU tests that the dome changes**

In `repos/portfolio/tests/gpu/facade.spec.ts`, replace:

```ts
    // Parent be4b857 at 640x360, one exhibit: full 58/26/15 and lite 57/25/14 calls.
    // Reduced desktop adds one static star draw while the old reduced path omitted it.
    const expectedCalls = lowPower ? [56, 24, 13] : [57, 25, 14]
```

with:

```ts
    // Parent be4b857 at 640x360, one exhibit: full 58/26/15 and lite 57/25/14 calls.
    // Reduced desktop adds one static star draw while the old reduced path omitted it.
    // City 05 adds four backdrop draws on every tier: dome, haze and two far rings.
    const expectedCalls = lowPower ? [60, 28, 17] : [61, 29, 18]
```

If the measured counts differ from these, stop and find out which backdrop object is culled or drawn twice. Do not just copy the new numbers in.

In `repos/portfolio/tests/gpu/post-probe-checks.ts`:

1. Add imports:

```ts
import { SKY_NAME } from '../../app/journey/sky'
import { RINGS } from '../../app/journey/skyline-far'
```

2. Add above `function opaqueMeshes`:

```ts
// The dome and far rings are backdrop. The parity and window checks sample real
// surfaces, and a ray that hits only backdrop counts as sky.
const BACKDROP = new Set([SKY_NAME, RINGS.a.name, RINGS.b.name])
```

3. In `opaqueMeshes`, replace `if (!mesh.isMesh) return` with `if (!mesh.isMesh || BACKDROP.has(mesh.name)) return`.

In `repos/portfolio/tests/gpu/theme-component.spec.ts`, the canvas background is now the horizon (fog) color. Replace:

```ts
    const expected = LOOKS[dark ? 'dark' : 'light'].intro.skyColor
```

with:

```ts
    // The background is the dome's fallback: the horizon (fog) colour.
    const expected = LOOKS[dark ? 'dark' : 'light'].intro.fogColor
```

and replace `return distance(status.sky!, LOOKS.dark.intro.skyColor)` with `return distance(status.sky!, LOOKS.dark.intro.fogColor)`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd repos/portfolio && npx playwright test --config playwright.config.ts tests/gpu/sky.spec.ts tests/gpu/shader-failure.spec.ts`
Expected: PASS.

Run: `cd repos/portfolio && npm test && npm run typecheck && npm run test:gpu`
Expected: PASS for every suite, including `facade.spec.ts` with the new counts, `post.spec.ts` actual-parity, `theme-scene.spec.ts` (no program compiles during a blend, now with the dome; restore mid-blend), and `theme-component.spec.ts`. The full GPU run takes several minutes.

- [ ] **Step 7: Commit**

```bash
git add repos/portfolio/app/journey/scene.ts repos/portfolio/tests/gpu/sky.spec.ts \
  repos/portfolio/tests/gpu/facade.spec.ts repos/portfolio/tests/gpu/post-probe-checks.ts \
  repos/portfolio/tests/gpu/theme-component.spec.ts repos/portfolio/tests/gpu/component-probe.ts \
  repos/portfolio/tests/gpu/shader-failure.spec.ts
git commit -m "feat: render the sky dome, haze and far skyline in the journey"
```

---

### Task 5: GPU checks for the horizon, building tops, bloom, and the ground edge

These tests check behavior that Tasks 1 to 4 built, so they should pass on the first run. A failure means a real defect: use `superpowers:systematic-debugging`. Do not widen a tolerance without writing the reason into the test, as step 2 did for `theme-component.spec.ts`.

**Files:**
- Create: `repos/portfolio/tests/gpu/sky-probe.ts`
- Modify: `repos/portfolio/tests/gpu/harness.ts` (register `sky`)
- Modify: `repos/portfolio/tests/gpu/sky.spec.ts`

**Interfaces:**
- Consumes: `window.cityGpu.mountJourney`, `renderJourney`, `stepJourney`, `setJourneyTheme`, `journeyState`, `getJourneyContext` (harness); `createPostPipeline` (`post.ts`); `SKY_NAME` (Task 2); `createHazeMesh`, `GROUND_NAME`, `HAZE_NAME`, `HAZE_BASE_Y`, `HAZE_HEIGHT`, `HAZE_RADIUS`, `RINGS`, `GROUND_HALF_SIZE`, `GROUND_Y`, `SCENE_CENTER` (Task 3); `skyParamsFor`, `skyGradient`, `toLinear`, `sunDirectionFor` (Task 1); `cloudOffsetAt` (Task 2); `displayBytes`, `maxChannelDelta`, `byteLuminance` (Task 1).
- Produces: `window.cityGpu.sky = { mount, settle, view, hazeAlpha }` with these types (from `tests/gpu/sky-probe.ts`):
  - `mount(input: { tier: 'full' | 'lite' | 'reduced'; lowPower: boolean; width?: number; height?: number }): void`
  - `settle(input: { theme: 'light' | 'dark' | 'mid'; chapter: number; progress?: number }): void`. `mid` leaves `themeMix` at 0.5. Do not use `mid` on the `reduced` tier, which snaps.
  - `view(input: SkyViewInput): SkyViewResult`. See the code for the fields.
  - `hazeAlpha(): { bottom: number; middle: number; top: number; shaderError: string | null; glError: number }` (used in Task 6)

- [ ] **Step 1: Write the probe**

Create `repos/portfolio/tests/gpu/sky-probe.ts`:

```ts
import * as THREE from 'three'
import { createPostPipeline } from '../../app/journey/post'
import { SKY_NAME } from '../../app/journey/sky'
import type { SkyVariant } from '../../app/journey/sky-mirror'
import { createHazeMesh, GROUND_NAME, HAZE_BASE_Y, HAZE_HEIGHT, HAZE_NAME, HAZE_RADIUS, RINGS } from '../../app/journey/skyline-far'
import type { StopState } from '../../app/journey/stops'
import { createTestRenderer, readPixel } from './gpu-utils'

const SETTLE_FRAMES = 160 // damping 0.08 leaves (0.92)^160, about 2e-6, of any change
const MID_BLEND_FRAMES = 36 // 0.6 s of 1/60 s steps: themeMix 0.5
const BACKDROP = new Set([SKY_NAME, HAZE_NAME, GROUND_NAME, RINGS.a.name, RINGS.b.name])
const WALL_WIDTH = 20
const WALL_DEPTH = 1
const WALL_COLOR = 0x303040
const WALL_SAMPLE_OFFSET = 3 // pixels above and below the wall's top edge
const INTERIOR_OFFSET = 1.5 // pixels; MSAA blends silhouette edges, so city samples must be interior
const HAZE_PROBE_HEIGHT = 400

export type SkyTheme = 'light' | 'dark' | 'mid'
export interface SkyMountInput { tier: 'full' | 'lite' | 'reduced'; lowPower: boolean; width?: number; height?: number }
export interface SkySampling { xStride: number; yStride: number; minH: number; maxH: number; column?: number }
export interface SkyViewInput {
  view?: { position?: [number, number, number]; direction: [number, number, number] }
  only?: string[]
  hide?: string[]
  bloom?: number
  domeUniforms?: Record<string, number>
  wall?: { distance: number; height: number }
  sampling?: SkySampling
  cityMask?: boolean
}
export interface SkySamples { x: number[]; y: number[]; rgb: number[]; dir: number[]; city: boolean[] }
export interface SkyWallSample { sky: number[]; top: number[]; skyDir: number[] }
export interface SkyViewResult {
  pipeline: 'composer' | 'direct'; variant: SkyVariant; reduced: boolean; width: number; height: number
  state: StopState; exposure: number; time: number
  cameraPosition: number[]; sunDirection: number[]
  samples: SkySamples; wall: SkyWallSample | null
  shaderError: string | null; glError: number
}

let mounted: SkyMountInput | null = null
let time = 0

function mount(input: SkyMountInput): void {
  window.cityGpu.mountJourney({ tier: input.tier, lowPower: input.lowPower, initialDark: false,
    width: input.width ?? 320, height: input.height ?? 180 })
  mounted = input
  time = 0
}

function settle(input: { theme: SkyTheme; chapter: number; progress?: number }): void {
  const { chapter } = input
  const progress = input.progress ?? 0
  const dark = input.theme === 'dark'
  // Two snaps: the second always changes the target, so it always applies,
  // whatever the previous settle left behind.
  window.cityGpu.setJourneyTheme(!dark, { animate: false })
  window.cityGpu.setJourneyTheme(dark, { animate: false })
  time = 0
  window.cityGpu.renderJourney({ chapter, progress, time, frames: SETTLE_FRAMES })
  if (input.theme !== 'mid') return
  window.cityGpu.setJourneyTheme(true)
  for (let f = 1; f <= MID_BLEND_FRAMES; f++) window.cityGpu.stepJourney({ chapter, progress, time: f / 60 })
  time = MID_BLEND_FRAMES / 60
  window.cityGpu.renderJourney({ chapter, progress, time, frames: SETTLE_FRAMES })
}

function rayThrough(camera: THREE.PerspectiveCamera, width: number, height: number, x: number, y: number,
  target: THREE.Vector3): THREE.Vector3 {
  return target.set((x + 0.5) / width * 2 - 1, (y + 0.5) / height * 2 - 1, 0.5)
    .unproject(camera).sub(camera.position).normalize()
}

function cityHitTest(scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number) {
  const meshes: THREE.Object3D[] = []
  scene.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || BACKDROP.has(mesh.name)) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.some(m => m.transparent)) return
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).computeBoundingSphere()
    meshes.push(mesh)
  })
  const raycaster = new THREE.Raycaster()
  const ray = new THREE.Vector3()
  const hits = (x: number, y: number) => {
    raycaster.set(camera.position, rayThrough(camera, width, height, x, y, ray))
    return raycaster.intersectObjects(meshes, false).length > 0
  }
  const offsets = [[0, 0], [INTERIOR_OFFSET, 0], [-INTERIOR_OFFSET, 0], [0, INTERIOR_OFFSET], [0, -INTERIOR_OFFSET]]
  return (x: number, y: number) => offsets.every(([dx, dy]) => hits(x + dx!, y + dy!))
}

function collect(frame: Uint8Array, width: number, height: number, camera: THREE.PerspectiveCamera,
  sampling: SkySampling | undefined, city: ((x: number, y: number) => boolean) | null): SkySamples {
  const out: SkySamples = { x: [], y: [], rgb: [], dir: [], city: [] }
  if (!sampling) return out
  const ray = new THREE.Vector3()
  const xs = sampling.column !== undefined
    ? [sampling.column]
    : Array.from({ length: Math.ceil(width / sampling.xStride) }, (_, i) => i * sampling.xStride)
  for (let y = 0; y < height; y += sampling.yStride) for (const x of xs) {
    rayThrough(camera, width, height, x, y, ray)
    if (ray.y < sampling.minH || ray.y > sampling.maxH) continue
    const o = (y * width + x) * 4
    out.x.push(x)
    out.y.push(y)
    out.rgb.push(frame[o]!, frame[o + 1]!, frame[o + 2]!)
    out.dir.push(ray.x, ray.y, ray.z)
    out.city.push(city ? city(x, y) : false)
  }
  return out
}

function addWall(scene: THREE.Scene, camera: THREE.PerspectiveCamera, wall: { distance: number; height: number }) {
  const forward = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(WALL_WIDTH, wall.height, WALL_DEPTH),
    new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 1 }))
  mesh.position.copy(camera.position).addScaledVector(forward, wall.distance).setY(-1 + wall.height / 2)
  mesh.lookAt(camera.position.x, mesh.position.y, camera.position.z)
  mesh.updateMatrixWorld()
  scene.add(mesh)
  // Front face, top edge: the point nearest the camera on the wall's top line.
  const topEdge = camera.position.clone().addScaledVector(forward, wall.distance - WALL_DEPTH / 2).setY(-1 + wall.height)
  return { mesh, topEdge }
}

function wallSample(frame: Uint8Array, width: number, height: number, camera: THREE.PerspectiveCamera,
  topEdge: THREE.Vector3): SkyWallSample {
  const clip = topEdge.clone().project(camera)
  const x = Math.min(width - 1, Math.max(0, Math.round((clip.x * 0.5 + 0.5) * width - 0.5)))
  const yTop = Math.round((clip.y * 0.5 + 0.5) * height - 0.5)
  const pixel = (y: number) => Array.from(frame.subarray((y * width + x) * 4, (y * width + x) * 4 + 3))
  const skyY = yTop + WALL_SAMPLE_OFFSET
  return { sky: pixel(skyY), top: pixel(yTop - WALL_SAMPLE_OFFSET),
    skyDir: rayThrough(camera, width, height, x, skyY, new THREE.Vector3()).toArray() }
}

function view(input: SkyViewInput): SkyViewResult {
  if (!mounted) throw new Error('Mount a sky view first')
  const { scene, camera, renderer } = window.cityGpu.getJourneyContext()
  const dome = scene.getObjectByName(SKY_NAME) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined
  if (!dome) throw new Error('sky dome missing')
  const { state } = window.cityGpu.journeyState()
  const undo: (() => void)[] = []
  const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), dome: dome.position.clone() }
  undo.push(() => {
    camera.position.copy(saved.position)
    camera.quaternion.copy(saved.quaternion)
    dome.position.copy(saved.dome)
    camera.updateMatrixWorld()
  })
  if (input.view) {
    if (input.view.position) camera.position.set(...input.view.position)
    camera.lookAt(camera.position.clone().add(new THREE.Vector3(...input.view.direction)))
    dome.position.copy(camera.position)
  }
  camera.updateMatrixWorld()
  for (const child of scene.children) {
    if (child instanceof THREE.Light) continue
    const hidden = (input.only && !input.only.includes(child.name)) || input.hide?.includes(child.name)
    if (!hidden) continue
    const was = child.visible
    child.visible = false
    undo.push(() => { child.visible = was })
  }
  for (const [key, value] of Object.entries(input.domeUniforms ?? {})) {
    const uniform = dome.material.uniforms[key]
    if (!uniform) throw new Error(`unknown dome uniform ${key}`)
    const was = uniform.value
    uniform.value = value
    undo.push(() => { uniform.value = was })
  }
  const wall = input.wall ? addWall(scene, camera, input.wall) : null
  if (wall) undo.push(() => { scene.remove(wall.mesh); wall.mesh.geometry.dispose(); wall.mesh.material.dispose() })
  try {
    const gl = renderer.getContext()
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight
    const frame = new Uint8Array(width * height * 4)
    let pipeline: 'composer' | 'direct' = 'direct'
    if (!mounted.lowPower) {
      const post = createPostPipeline(renderer, scene, camera)
      if (!post) throw new Error('composer pipeline unavailable')
      try {
        post.setLook(state.exposure, input.bloom ?? 0)
        post.render()
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, frame)
      } finally { post.dispose() }
      pipeline = 'composer'
    } else {
      renderer.setRenderTarget(null)
      renderer.render(scene, camera)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, frame)
    }
    const city = input.cityMask ? cityHitTest(scene, camera, width, height) : null
    const d = window.cityGpu.diagnostics()
    return {
      pipeline, variant: mounted.lowPower ? 'lite' : 'full', reduced: mounted.tier === 'reduced', width, height,
      state, exposure: state.exposure, time, cameraPosition: camera.position.toArray(),
      sunDirection: (dome.material.uniforms.uSunDir!.value as THREE.Vector3).toArray(),
      samples: collect(frame, width, height, camera, input.sampling, city),
      wall: wall ? wallSample(frame, width, height, camera, wall.topEdge) : null,
      shaderError: d.shaderError, glError: d.glError,
    }
  } finally {
    for (const step of undo.reverse()) step()
  }
}

// Renders only the haze, white, over black, with linear output, so each
// pixel's red channel is the haze alpha at that height.
function hazeAlpha(): { bottom: number; middle: number; top: number; shaderError: string | null; glError: number } {
  const gpu = createTestRenderer({ width: 16, height: HAZE_PROBE_HEIGHT })
  const { renderer, recorder } = gpu
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  const haze = createHazeMesh(64)
  haze.material.color.setRGB(1, 1, 1)
  haze.position.set(0, HAZE_BASE_Y + HAZE_HEIGHT / 2, 0)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0)
  scene.add(haze)
  const camera = new THREE.OrthographicCamera(-1, 1, HAZE_BASE_Y + HAZE_HEIGHT, HAZE_BASE_Y, 0.1, HAZE_RADIUS * 2)
  camera.position.set(0, 0, 0)
  camera.lookAt(0, 0, -1)
  try {
    renderer.render(scene, camera)
    recorder.assertClean()
    const at = (row: number) => readPixel(renderer, 8, row)[0]! / 255
    return { bottom: at(0), middle: at(HAZE_PROBE_HEIGHT / 2 - 1), top: at(HAZE_PROBE_HEIGHT - 1),
      shaderError: recorder.error?.message ?? null, glError: renderer.getContext().getError() }
  } finally {
    haze.geometry.dispose()
    haze.material.dispose()
    gpu.dispose()
  }
}

export const skyProbe = { mount, settle, view, hazeAlpha }
```

In `repos/portfolio/tests/gpu/harness.ts`, add `import { skyProbe } from './sky-probe'` after the `measureRenderCost` import, and add `sky: skyProbe,` as the first property of `const cityGpu = {`.

- [ ] **Step 2: Add the horizon, building-top, bloom, and ground-edge tests**

In `repos/portfolio/tests/gpu/sky.spec.ts`, extend the imports:

```ts
import { WAYPOINTS } from '../../app/journey/path'
import { cloudOffsetAt } from '../../app/journey/sky'
import { skyGradient, skyParamsFor, sunDirectionFor, toLinear } from '../../app/journey/sky-mirror'
import { GROUND_HALF_SIZE, GROUND_Y, SCENE_CENTER } from '../../app/journey/skyline-far'
import { CHAPTER_IDS, LOOKS, type Vec3 } from '../../app/journey/stops'
import type { SkySamples, SkyViewResult } from './sky-probe'
import { byteLuminance, displayBytes, maxChannelDelta } from './sky-expect'
```

Add these helpers below `COMBINATIONS`:

```ts
const PIPELINES = [
  { name: 'composer', mount: { tier: 'full', lowPower: false } },
  { name: 'direct', mount: { tier: 'lite', lowPower: true } },
] as const
const rgbAt = (s: SkySamples, k: number) => s.rgb.slice(k * 3, k * 3 + 3)
const dirAt = (s: SkySamples, k: number): Vec3 => [s.dir[k * 3]!, s.dir[k * 3 + 1]!, s.dir[k * 3 + 2]!]
const fogBytes = (r: SkyViewResult) => displayBytes(toLinear(r.state.fogColor), r.exposure)
const paramsOf = (r: SkyViewResult) => skyParamsFor(r.state, cloudOffsetAt(r.time, r.reduced))
const expectedSky = (r: SkyViewResult, dir: Vec3) => displayBytes(skyGradient(dir, paramsOf(r), r.variant), r.exposure)
function expectClean(r: { shaderError: string | null; glError: number }) {
  expect(r.shaderError).toBeNull()
  expect(r.glError).toBe(0)
}
function worstAgainst(s: SkySamples, expected: (k: number) => readonly number[]): number {
  let worst = 0
  for (let k = 0; k < s.x.length; k++) worst = Math.max(worst, maxChannelDelta(rgbAt(s, k), expected(k)))
  return worst
}
function sunView(theme: 'light' | 'dark', chapter: number): [number, number, number] {
  const look = LOOKS[theme][CHAPTER_IDS[chapter]!]
  // Keep the camera above the horizon for a set sun; the glow sits just above it.
  const d = sunDirectionFor(Math.max(look.sunElevation, 5), look.sunAzimuth)
  return [d[0], d[1], d[2]]
}

const TURN_PROGRESS = [.3, .4, .5, .6, .7]
const HORIZON_VIEWS = [
  ...CHAPTER_IDS.map((_, chapter) => ({ chapter, progress: 0 })),
  ...[1, 2].flatMap(chapter => TURN_PROGRESS.map(progress => ({ chapter, progress }))),
]
const HORIZON_SAMPLING = { xStride: 16, yStride: 1, minH: -0.03, maxH: 0.01 }
const FULL_FOG_DISTANCE = 80

// Samples whose ray lands on the ground plane at least 80 units away.
function farGround(r: SkyViewResult): number[][] {
  const out: number[][] = []
  const [cx, cy, cz] = r.cameraPosition as [number, number, number]
  for (let k = 0; k < r.samples.x.length; k++) {
    const d = dirAt(r.samples, k)
    if (d[1] >= 0) continue
    const t = (GROUND_Y - cy) / d[1]
    const x = cx + d[0] * t, z = cz + d[2] * t
    const onGround = Math.abs(x - SCENE_CENTER.x) <= GROUND_HALF_SIZE && Math.abs(z - SCENE_CENTER.z) <= GROUND_HALF_SIZE
    if (onGround && Math.hypot(x - cx, z - cz) >= FULL_FOG_DISTANCE) out.push(rgbAt(r.samples, k))
  }
  return out
}
```

Add the tests:

```ts
// Spec 05 test 6 and spec 09 test 13.
for (const pipeline of PIPELINES) for (const theme of ['light', 'dark', 'mid'] as const) {
  test(`horizon row equals fully fogged ground: ${pipeline.name} ${theme}`, async ({ page }) => {
    test.setTimeout(300_000)
    const views = await page.evaluate(({ mount, theme, views, names, sampling }) => {
      window.cityGpu.sky.mount({ ...mount, width: 640, height: 360 })
      return views.map(v => {
        window.cityGpu.sky.settle({ theme, ...v })
        return {
          sky: window.cityGpu.sky.view({ only: [names.dome, names.haze], sampling }),
          ground: window.cityGpu.sky.view({ only: [names.dome, names.haze, names.ground], sampling }),
        }
      })
    }, { mount: pipeline.mount, theme, views: HORIZON_VIEWS, names: NAMES, sampling: HORIZON_SAMPLING })
    let groundHits = 0
    for (const [i, { sky, ground }] of views.entries()) {
      const fog = fogBytes(sky)
      expect(sky.samples.x.length, `view ${i}`).toBeGreaterThan(0)
      expect(worstAgainst(sky.samples, () => fog), `view ${i} sky`).toBeLessThanOrEqual(2)
      const far = farGround(ground)
      groundHits += far.length
      for (const rgb of far) expect(maxChannelDelta(rgb, fog), `view ${i} ground`).toBeLessThanOrEqual(2)
      expectClean(sky)
      expectClean(ground)
    }
    expect(groundHits).toBeGreaterThan(0)
  })
}

// Spec 05 test 6a. The haze and rings are hidden: the haze tints the sky at a
// wall top's height on purpose, and ring B stands behind it.
for (const pipeline of PIPELINES) {
  test(`fogged building tops silhouette against the expected sky: ${pipeline.name}`, async ({ page }) => {
    test.setTimeout(300_000)
    const results = await page.evaluate(({ mount, names }) => {
      window.cityGpu.sky.mount({ ...mount, width: 640, height: 360 })
      const out = []
      for (const theme of ['light', 'dark'] as const) for (let chapter = 0; chapter < 4; chapter++) {
        window.cityGpu.sky.settle({ theme, chapter })
        out.push(window.cityGpu.sky.view({ only: [names.dome, names.ground], wall: { distance: 60, height: 7 } }))
      }
      return out
    }, { mount: pipeline.mount, names: NAMES })
    for (const [i, r] of results.entries()) {
      expect(r.wall, `case ${i}`).not.toBeNull()
      expect(maxChannelDelta(r.wall!.sky, expectedSky(r, r.wall!.skyDir as unknown as Vec3)), `case ${i} sky`).toBeLessThanOrEqual(3)
      expect(maxChannelDelta(r.wall!.top, fogBytes(r)), `case ${i} top`).toBeLessThanOrEqual(3)
      expectClean(r)
    }
  })
}

// Spec 05 test 6b and spec 09 test 15.
for (const theme of ['light', 'dark'] as const) {
  test(`sky never blooms looking at the sun: ${theme} projects`, async ({ page }) => {
    const r = await page.evaluate(({ names, direction, theme }) => {
      window.cityGpu.sky.mount({ tier: 'full', lowPower: false, width: 320, height: 180 })
      window.cityGpu.sky.settle({ theme, chapter: 1 })
      const sampling = { xStride: 2, yStride: 2, minH: 0, maxH: 1 }
      const only = [names.dome, names.haze, names.ground]
      return {
        on: window.cityGpu.sky.view({ view: { direction }, only, bloom: .5, sampling }),
        off: window.cityGpu.sky.view({ view: { direction }, only, bloom: 0, sampling }),
      }
    }, { names: NAMES, direction: sunView(theme, 1), theme })
    expect(r.on.pipeline).toBe('composer')
    expect(r.on.samples.x.length).toBeGreaterThan(1000)
    expect(worstAgainst(r.on.samples, k => rgbAt(r.off.samples, k))).toBeLessThanOrEqual(2)
    expectClean(r.on)
    expectClean(r.off)
  })
}

// Spec 05 test 7, landscape and portrait. The camera stands at its lowest
// height at every waypoint and looks at each ground edge.
const EDGE_DIRECTIONS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
const EDGE_CAMERA_Y = 0.2
for (const pipeline of PIPELINES) for (const theme of ['light', 'dark'] as const) {
  test(`ground edge never shows a step: ${pipeline.name} ${theme}`, async ({ page }) => {
    test.setTimeout(240_000)
    const results = await page.evaluate(({ mount, theme, names, positions, directions }) => {
      const out = []
      for (const [width, height] of [[640, 360], [360, 640]] as const) {
        window.cityGpu.sky.mount({ ...mount, width, height })
        window.cityGpu.sky.settle({ theme, chapter: 0 })
        for (const position of positions) for (const direction of directions) {
          out.push(window.cityGpu.sky.view({ view: { position, direction }, only: [names.dome, names.haze, names.ground],
            sampling: { xStride: 1, yStride: 1, minH: -0.015, maxH: 0.01, column: Math.floor(width / 2) } }))
        }
      }
      return out
    }, { mount: pipeline.mount, theme, names: NAMES, directions: EDGE_DIRECTIONS,
      positions: WAYPOINTS.map(w => [w.x, EDGE_CAMERA_Y, w.z] as [number, number, number]) })
    let worstStep = 0
    for (const r of results) {
      expect(r.samples.x.length).toBeGreaterThan(1)
      for (let k = 1; k < r.samples.x.length; k++) {
        worstStep = Math.max(worstStep, Math.abs(byteLuminance(rgbAt(r.samples, k)) - byteLuminance(rgbAt(r.samples, k - 1))))
      }
      expectClean(r)
    }
    expect(worstStep).toBeLessThanOrEqual(3)
  })
}
```

- [ ] **Step 3: Run the new tests**

Run: `cd repos/portfolio && npx playwright test --config playwright.config.ts tests/gpu/sky.spec.ts`
Expected: PASS. These tests check finished behavior. If one fails, debug it before you go on. Common causes:

- The dome gets the CPU-mapped fog color: the direct pipeline is off by several bytes.
- A sample row lands on haze over something that is not fog-colored.
- The wall top is not fully fogged at a light look.

- [ ] **Step 4: Commit**

```bash
git add repos/portfolio/tests/gpu/sky-probe.ts repos/portfolio/tests/gpu/harness.ts repos/portfolio/tests/gpu/sky.spec.ts
git commit -m "test: pin sky horizon, building tops, bloom and ground edge on GPU"
```

---

### Task 6: GPU checks for glow, sorting, clouds, stars, and context restore

As in Task 5, these tests should pass on the first run. A failure is a defect to debug.

**Files:**
- Modify: `repos/portfolio/tests/gpu/sky.spec.ts`

**Interfaces:**
- Consumes: `window.cityGpu.sky` (Task 5), `window.cityGpu.loseAndRestore`, `window.cityGpu.resizeJourney` (harness); `skyLayers`, `composeSky` (Task 1); `colorDistance` (Task 1).
- Produces: GPU coverage for spec 05 tests 8, 9, and 10 and spec 09 tests 12 and 16. No new interfaces.

- [ ] **Step 1: Add the tests**

In `repos/portfolio/tests/gpu/sky.spec.ts`, extend the `sky-mirror` import with `composeSky, skyLayers`, and the `sky-expect` import with `colorDistance`. Then add:

```ts
const NIGHT_VIEW: [number, number, number] = [0, .8, -1] // ahead along the last leg (-Z), pitched up

// Spec 05 test 8.
for (const pipeline of PIPELINES) {
  test(`sun glow centres on the sun and vanishes at night: ${pipeline.name}`, async ({ page }) => {
    test.setTimeout(180_000)
    const cases = [
      { theme: 'light', chapter: 1 }, { theme: 'dark', chapter: 1 }, { theme: 'dark', chapter: 3 },
    ] as const
    const results = await page.evaluate(({ mount, names, cases }) => {
      window.cityGpu.sky.mount({ ...mount, width: 320, height: 180 })
      return cases.map(c => {
        window.cityGpu.sky.settle({ theme: c.theme, chapter: c.chapter })
        const sampling = { xStride: 2, yStride: 2, minH: -1, maxH: 1 }
        return {
          glow: window.cityGpu.sky.view({ view: { direction: c.direction }, only: [names.dome], sampling }),
          none: window.cityGpu.sky.view({ view: { direction: c.direction }, only: [names.dome], sampling, domeUniforms: { uSunGlow: 0 } }),
        }
      })
    }, { mount: pipeline.mount, names: NAMES, cases: cases.map(c => ({ ...c, direction: sunView(c.theme, c.chapter) })) })
    for (const [i, { glow, none }] of results.entries()) {
      const night = cases[i]!.chapter === 3
      if (night) {
        expect(worstAgainst(glow.samples, k => rgbAt(none.samples, k)), `case ${i}`).toBeLessThanOrEqual(2)
      } else {
        let best = -1, bestDiff = 0
        for (let k = 0; k < glow.samples.x.length; k++) {
          const diff = byteLuminance(rgbAt(glow.samples, k)) - byteLuminance(rgbAt(none.samples, k))
          if (diff > bestDiff) { bestDiff = diff; best = k }
        }
        expect(bestDiff, `case ${i} glow visible`).toBeGreaterThan(2)
        const d = dirAt(glow.samples, best), s = glow.sunDirection
        const angle = Math.acos(Math.min(1, d[0] * s[0]! + d[1] * s[1]! + d[2] * s[2]!)) * 180 / Math.PI
        expect(angle, `case ${i}`).toBeLessThanOrEqual(25)
      }
      expectClean(glow)
      expectClean(none)
    }
  })
}

// Spec 05 test 9: sorting, haze alpha and stars.
test('buildings occlude the far rings and the haze leaves the city untinted', async ({ page }) => {
  test.setTimeout(240_000)
  const results = await page.evaluate(({ names }) => {
    window.cityGpu.sky.mount({ tier: 'full', lowPower: false, width: 320, height: 180 })
    const out = []
    for (const theme of ['light', 'dark'] as const) for (const chapter of [1, 3]) {
      window.cityGpu.sky.settle({ theme, chapter })
      const sampling = { xStride: 4, yStride: 4, minH: -1, maxH: 1 }
      out.push({
        all: window.cityGpu.sky.view({ sampling, cityMask: true }),
        bare: window.cityGpu.sky.view({ sampling, hide: [names.ringA, names.ringB, names.haze] }),
      })
    }
    return out
  }, { names: NAMES })
  for (const [i, { all, bare }] of results.entries()) {
    let cityPixels = 0, worst = 0
    for (let k = 0; k < all.samples.x.length; k++) {
      if (!all.samples.city[k]) continue
      cityPixels++
      worst = Math.max(worst, maxChannelDelta(rgbAt(all.samples, k), rgbAt(bare.samples, k)))
    }
    expect(cityPixels, `case ${i}`).toBeGreaterThan(50)
    expect(worst, `case ${i}`).toBeLessThanOrEqual(1)
    expectClean(all)
    expectClean(bare)
  }
})

test('haze alpha ramps from 0.85 at the bottom to 0 at the top', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.sky.hazeAlpha())
  expect(Math.abs(r.bottom - .85)).toBeLessThanOrEqual(.03)
  expect(Math.abs(r.middle - .43)).toBeLessThanOrEqual(.03)
  expect(Math.abs(r.top)).toBeLessThanOrEqual(.03)
  expectClean(r)
})

test('stars show above the dome at dark about', async ({ page }) => {
  const r = await page.evaluate(({ names, direction }) => {
    window.cityGpu.sky.mount({ tier: 'full', lowPower: false, width: 320, height: 180 })
    window.cityGpu.sky.settle({ theme: 'dark', chapter: 3 })
    const sampling = { xStride: 1, yStride: 1, minH: .05, maxH: 1 }
    return {
      stars: window.cityGpu.sky.view({ view: { direction }, sampling }),
      none: window.cityGpu.sky.view({ view: { direction }, sampling, hide: [names.stars] }),
    }
  }, { names: NAMES, direction: NIGHT_VIEW })
  let visible = 0
  for (let k = 0; k < r.stars.samples.x.length; k++) {
    if (maxChannelDelta(rgbAt(r.stars.samples, k), rgbAt(r.none.samples, k)) > 8) visible++
  }
  expect(visible).toBeGreaterThan(0)
  expectClean(r.stars)
})

test('both far rings show behind the city at projects and skills', async ({ page }) => {
  test.setTimeout(180_000)
  const results = await page.evaluate(({ names }) => {
    window.cityGpu.sky.mount({ tier: 'full', lowPower: false, width: 320, height: 180 })
    const out = []
    for (const theme of ['light', 'dark'] as const) for (const chapter of [1, 2]) {
      window.cityGpu.sky.settle({ theme, chapter })
      const sampling = { xStride: 2, yStride: 2, minH: -.05, maxH: .6 }
      out.push({
        all: window.cityGpu.sky.view({ sampling }),
        noA: window.cityGpu.sky.view({ sampling, hide: [names.ringA] }),
        noB: window.cityGpu.sky.view({ sampling, hide: [names.ringB] }),
      })
    }
    return out
  }, { names: NAMES })
  for (const [i, { all, noA, noB }] of results.entries()) {
    const changed = (other: SkyViewResult) => all.samples.x.filter((_, k) =>
      maxChannelDelta(rgbAt(all.samples, k), rgbAt(other.samples, k)) > 2).length
    expect(changed(noA), `case ${i} ring A`).toBeGreaterThan(20)
    expect(changed(noB), `case ${i} ring B`).toBeGreaterThan(20)
    expectClean(all)
  }
})

// Spec 05 test 10: shader errors and context restore, both variants.
for (const input of [{ tier: 'full', lowPower: false }, { tier: 'lite', lowPower: true }] as const) {
  test(`sky survives a context restore: ${input.tier}`, async ({ page }) => {
    const r = await page.evaluate(async ({ input, names }) => {
      window.cityGpu.sky.mount({ ...input, width: 320, height: 180 })
      window.cityGpu.sky.settle({ theme: 'dark', chapter: 1 })
      const sampling = { xStride: 4, yStride: 4, minH: -1, maxH: 1 }
      const before = window.cityGpu.sky.view({ only: [names.dome, names.haze], sampling })
      await window.cityGpu.loseAndRestore()
      window.cityGpu.resizeJourney(320, 180)
      window.cityGpu.sky.settle({ theme: 'dark', chapter: 1 })
      const after = window.cityGpu.sky.view({ only: [names.dome, names.haze], sampling })
      return { before, after }
    }, { input, names: NAMES })
    expect(r.after.samples.x.length).toBe(r.before.samples.x.length)
    expect(worstAgainst(r.after.samples, k => rgbAt(r.before.samples, k))).toBeLessThanOrEqual(2)
    expectClean(r.before)
    expectClean(r.after)
  })
}

// Spec 09 test 12, as decided on 2026-10-09: the GPU must match the mirror's
// cloud pixels. The gap from cloudCover is recorded, not asserted.
for (const pipeline of PIPELINES) {
  test(`cloud pixels match the mirror in every light chapter: ${pipeline.name}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000)
    const results = await page.evaluate(({ mount, names }) => {
      window.cityGpu.sky.mount({ ...mount, width: 320, height: 180 })
      return [0, 1, 2, 3].map(chapter => {
        window.cityGpu.sky.settle({ theme: 'light', chapter })
        const sampling = { xStride: 2, yStride: 2, minH: .15, maxH: 1 }
        return {
          sky: window.cityGpu.sky.view({ only: [names.dome], sampling }),
          clear: window.cityGpu.sky.view({ only: [names.dome], sampling, domeUniforms: { uCloudCover: 0 } }),
        }
      })
    }, { mount: pipeline.mount, names: NAMES })
    for (const [chapter, { sky, clear }] of results.entries()) {
      const params = paramsOf(sky)
      const n = sky.samples.x.length
      expect(n, `chapter ${chapter}`).toBeGreaterThan(500)
      let gpuClouds = 0, mirrorClouds = 0, worstClear = 0
      for (let k = 0; k < n; k++) {
        const layers = skyLayers(dirAt(sky.samples, k), params, sky.variant)
        const cloudy = displayBytes(composeSky(layers, 1), sky.exposure)
        const mirrorClear = displayBytes(composeSky(layers, 0), sky.exposure)
        const mirror = displayBytes(composeSky(layers), sky.exposure)
        const gpu = rgbAt(sky.samples, k), gpuClear = rgbAt(clear.samples, k)
        worstClear = Math.max(worstClear, maxChannelDelta(gpuClear, mirrorClear))
        if (colorDistance(gpu, cloudy) < colorDistance(gpu, gpuClear)) gpuClouds++
        if (colorDistance(mirror, cloudy) < colorDistance(mirror, mirrorClear)) mirrorClouds++
      }
      testInfo.annotations.push({ type: 'cloud-cover',
        description: `${pipeline.name} ${CHAPTER_IDS[chapter]}: on screen ${(gpuClouds / n).toFixed(3)}, cloudCover ${sky.state.cloudCover}` })
      expect(worstClear, `chapter ${chapter} clear sky`).toBeLessThanOrEqual(3)
      expect(Math.abs(gpuClouds - mirrorClouds) / n, `chapter ${chapter} clouds`).toBeLessThanOrEqual(.03)
      expectClean(sky)
      expectClean(clear)
    }
  })
}

// Spec 09 test 16: night clouds stay faint over the clear sky.
for (const pipeline of PIPELINES) {
  test(`night clouds stay within 8/255 at dark about: ${pipeline.name}`, async ({ page }) => {
    const r = await page.evaluate(({ mount, names, direction }) => {
      window.cityGpu.sky.mount({ ...mount, width: 320, height: 180 })
      window.cityGpu.sky.settle({ theme: 'dark', chapter: 3 })
      const sampling = { xStride: 2, yStride: 2, minH: .02, maxH: 1 }
      return {
        sky: window.cityGpu.sky.view({ view: { direction }, only: [names.dome], sampling }),
        clear: window.cityGpu.sky.view({ view: { direction }, only: [names.dome], sampling, domeUniforms: { uCloudCover: 0 } }),
      }
    }, { mount: pipeline.mount, names: NAMES, direction: NIGHT_VIEW })
    expect(r.sky.samples.x.length).toBeGreaterThan(1000)
    expect(worstAgainst(r.sky.samples, k => rgbAt(r.clear.samples, k))).toBeLessThanOrEqual(8)
    expectClean(r.sky)
  })
}
```

- [ ] **Step 2: Run the tests**

Run: `cd repos/portfolio && npx playwright test --config playwright.config.ts tests/gpu/sky.spec.ts`
Expected: PASS. The `cloud-cover` annotations appear in the report (`npx playwright show-report`). Copy them into the final handoff.

- [ ] **Step 3: Commit**

```bash
git add repos/portfolio/tests/gpu/sky.spec.ts
git commit -m "test: pin sun glow, sorting, clouds, stars and restore on GPU"
```

---

### Task 7: Specs, index, and final acceptance

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-city-05-sky-haze-design.md`
- Modify: `docs/superpowers/specs/2026-10-09-city-09-theme-sky-design.md`

**Interfaces:**
- Consumes: the finished branch.
- Produces: specs that match what was built, and a verification handoff.

- [ ] **Step 1: Update spec 05**

In `docs/superpowers/specs/2026-10-09-city-05-sky-haze-design.md`:

1. Replace the `Status:` line with:

```markdown
Status: Built in series step 3 (plan `docs/superpowers/plans/2026-10-09-city-05-sky-haze.md`). Palette, clouds, and stars follow [spec 09](2026-10-09-city-09-theme-sky-design.md).
```

2. In testing item 4b, replace `at \`intro\` the glow adds a small nonzero amount at the zenith (sun elevation 38 degrees), which is expected.` with `at light \`skills\` the glow adds a small nonzero amount near the zenith (sun elevation 55 degrees), which is expected.`, and replace `It is continuous: adjacent samples 0.01 apart in \`h\` differ by less than 0.05 per channel.` with `It is continuous: the gradient term changes by less than 0.05 per channel between samples 0.01 apart in \`h\`, and the cloudless sky changes by less than 0.05 between samples 0.0005 apart (the glow envelope rises over \`h\` 0.01 to 0.05).`

3. In testing item 6a, add this sentence at the end: `The haze band and the far rings are hidden for this check: the haze tints the sky at a wall top's height on purpose, and ring B stands behind it.`

- [ ] **Step 2: Update spec 09**

In `docs/superpowers/specs/2026-10-09-city-09-theme-sky-design.md`:

1. In the dark-arc palette table, change the `about` row's `cloudCover` from `0.25` to `0.1`, its `cloudLitColor` from `` `#3a4266` `` to `` `#2c3353` ``, and its `cloudShadeColor` from `` `#12152a` `` to `` `#181c35` ``. Add this line under the table: `The dark \`about\` clouds were retuned on 2026-10-09 so test 16 holds (worst case 4/255). The authored values gave 41/255.`

2. Under the success criterion that starts `In light mode, every chapter shows a blue sky`, add: `Status 2026-10-09: with \`CLOUD_SCALE\` 0.6, on-screen coverage at the chapter cameras is 0.13 to 0.32 above \`cloudCover\`, and drift moves it further. GPU test 12 checks the GPU against the mirror; the 0.1 criterion is left to screenshot tuning.`

- [ ] **Step 3: Run the automated verification**

Run each command from `repos/portfolio` and confirm that it passes:

- `npm test`
- `npm run test:gpu`
- `npm run typecheck`
- `npm run build`

Also run `wc -l app/journey/scene.ts`. Expected: below 800.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-09-city-05-sky-haze-design.md docs/superpowers/specs/2026-10-09-city-09-theme-sky-design.md
git commit -m "docs: record built sky dome and cloud retune in city specs"
```

- [ ] **Step 5: Hand off with both checklists**

Do not tick step 3's `Done` column in `docs/superpowers/specs/2026-10-09-city-polish-index.md` until the branch is merged into `master`.

**Automated verification** (the agent runs these, and each must pass):

- [ ] `npm test`
- [ ] `npm run test:gpu`
- [ ] `npm run typecheck`
- [ ] `npm run build`

Report the `cloud-cover` annotations from the GPU run with these results.

**Manual verification** (only a person can do these; leave each unchecked until the user confirms it):

- [ ] All eight chapter and theme pairs on desktop and in iPhone 14 Pro Max emulation, in portrait and landscape, light and dark. In portrait, the sun glow stays in view or leaves it cleanly.
- [ ] At each chapter's two turns (the heading changes by 90 degrees), there is no visible ring seam in the haze or the silhouettes.
- [ ] Toggle the theme at each chapter and mid-scroll between chapters, including a double toggle. Check frames at `themeMix` 0.5 for a muddy grey sky.
- [ ] Load the page with dark saved and with light saved, and watch the first second for an unwanted blend.
- [ ] Watch the clouds drift for 30 seconds on the `full` tier: no tiling, banding, or shimmer near the horizon. Note how far the light sky drifts toward overcast or clear (decision 1).
- [ ] The dark `about` night does not look brighter than on `master`, despite the 0.25 moonlight floor. The faint night clouds read as clouds.
- [ ] The light `skills` midday (sun at 55 degrees, glow mostly out of view) still reads as sunny.
- [ ] The silhouettes do not look sparse or regular. Tune the count and size in screenshots if they do.
- [ ] Light-mode panels keep WCAG AA text contrast over the brighter sky.
- [ ] Render cost (shared conventions, section 8): use the uncapped, GPU-synced loop on a physical iPhone and on the named reference desktop, for the commit before and after this branch, three runs each. The budget is +0.7 ms (0.4 for spec 05 plus 0.3 for spec 09) on both. If the iPhone is over budget, first cut the `lite` clouds to 1 octave with a sharper threshold.
- [ ] Screenshots for the PR description, at the four chapters, one mid-transition frame, and one `themeMix` 0.5 frame, on desktop and iPhone emulation, in both themes.
