# City 09: Theme Arcs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement series step 2: a light morning-to-afternoon arc and a dark sunset-to-night arc, with a reversible 1.2-second theme blend and correct saved-theme startup.

**Architecture:** Separate immutable path data from theme-dependent look data, and put target calculation and the blend controller in small pure modules. `scene.ts` consumes these modules, updates its existing flat background, fog, lights, windows, and stars, and preserves the existing post pipeline. Populate the full spec 09 look contract now so the next sky/haze/cloud stage consumes these palettes directly.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, installed Three.js r186, Vitest 5, existing Playwright/Vite WebGL harness.

**Spec:** `docs/superpowers/specs/2026-10-09-city-09-theme-sky-design.md`, sections 1–5, plus section 7's compatibility edits. Read `docs/superpowers/specs/2026-10-09-city-00-shared-conventions.md` and the build order in `docs/superpowers/specs/2026-10-09-city-polish-index.md`.

## Global Constraints

- `StopState = PathState & LookState`.
- `PATH_STOPS` keeps today's camera and building values.
- `lerpLook` interpolates every numeric field linearly and every `Vec3` per channel, except `sunAzimuth`.
- The result is normalized to `[-180, 180)`.
- `THEME_BLEND_SECONDS = 1.2`.
- `dt` is clamped to `0..0.1 s` so a backgrounded tab does not skip the blend in one frame.
- Both functions return new objects.
- The first call after creation always snaps, whatever `animate` says.
- A call whose theme equals the current blend target does nothing.
- It snaps when `animate` is `false` or the tier is `reduced`.
- `fogDensity >= 0.035` in every look.
- Every light look has `bloomStrength` 0 and `starOpacity` 0.
- No shader program compiles during a theme blend.
- `StopState` colors (`skyColor`, `fogColor`, and any new `Vec3` color) are sRGB values produced by `hexToRgb`.
- `tier === 'reduced'` decides motion; `lowPower` decides cost and detail.
- Unit tests live in `tests/journey/*.test.ts`; GPU tests live in `tests/gpu/*.spec.ts`.
- Step 3 owns the dome, horizon equality, luminance cap, clouds, haze, silhouettes, and the +0.3 ms cloud budget on top of spec 05. Step 2 acceptance covers theme/state behavior and the current flat background only.

## Review Focus

1. Saved dark theme with an initial false Vue prop must show the dark arc before the canvas becomes visible; Task 4 tests the DOM class, subsequent prop synchronization, and the first visible look.
2. A reversal or repeated toggle while scrolling must preserve the current blend amount and camera trajectory; Tasks 2/3 test reversal, repeated targets, and all path fields independently of theme.
3. A hidden tab, repeated timestamp, or restored context must preserve the blend without a large time jump; Tasks 2/3 test bounded elapsed time, unchanged timestamps, and restoration at a fixed frame time.
4. Reduced motion on a phone must snap the complete look while retaining the cheap pipeline; Tasks 2/3 exercise `reduced` with both `lowPower` values, including no residual damping after a snap.
5. Switching bloom from zero to positive must use the programs warmed at startup, and migrated tests must explicitly choose an arc; Tasks 1/3 test both palettes, real program identity/count, the direct path, and the composer path.

---

## Scope and execution prerequisites

The user selected **step 2: theme arcs**. This plan has five tasks. It produces a working theme-dependent flat sky and city look; the approved step 3 will build spec 05's sky/haze and spec 09's section 6 clouds together. Cloud coverage, drift, sky pixel classification, horizon matching, and cloud performance tests belong to that later plan.

Authoring baseline: local `master` has specs 01/02 integrated, `scene.ts` is about 725 lines, and `sky.ts`, `sky-mirror.ts`, and `window-look.ts` do not exist yet. The index requires spec 06 Parts A/B to land before execution of this plan. Execute `2026-10-09-city-06-staggered-windows.md` Tasks 1–4 first; Part C waits for spec 04. If step 1 has not landed, retain this plan as ready for that dependency rather than implementing windows inside it.

At execution, create an isolated worktree using `superpowers:using-git-worktrees`, then reread this plan and the spec against that checkout. Preserve spec 06's `applyWindowLook(current, t)`, uniforms, hash constants, and reduced-motion gate. Check all `STOPS`/`lerpStop` users, including any music work that has since introduced `Theme`; keep one `Theme` export from `stops.ts` and update its consumers.

All paths below are workspace-relative. Run npm commands from `repos/portfolio`; run git commands at the worktree root. Commit commands belong to implementation, not plan authoring. Do not install packages: the necessary tools already exist in the lockfile.

## File map and interfaces

| File | Responsibility |
| --- | --- |
| `repos/portfolio/app/journey/stops.ts` | `Theme`, `PathState`, `LookState`, `StopState`, four path entries and eight authored looks. |
| `repos/portfolio/app/journey/interpolate.ts` | Explicit field interpolation, shortest-angle interpolation, existing damping/easing. |
| `repos/portfolio/app/journey/target.ts` | Clamped chapter lookup, theme selection, scroll/theme target calculation. |
| `repos/portfolio/app/journey/theme-blend.ts` | Immutable blend primitives and a small stateful controller with first-call and clock rules. |
| `repos/portfolio/app/journey/scene.ts` | Existing render wiring, applied look, controller, light and star updates. |
| `repos/portfolio/app/components/JourneyCanvas.vue` | Initial DOM-theme snap before exposing the canvas. |
| `repos/portfolio/tests/journey/stops.test.ts` | Authored palette and path invariants. |
| `repos/portfolio/tests/journey/interpolate.test.ts` | Every field, endpoints, angles, and retained clamp/damp/easing behavior. |
| `repos/portfolio/tests/journey/target.test.ts` | Chapter bounds, scroll interpolation, and theme-independent path fields. |
| `repos/portfolio/tests/journey/theme-blend.test.ts` | Blend duration, reversals, repeated calls, snapping, and bounded clock. |
| `repos/portfolio/tests/journey/window-look.test.ts` | Spec 06 palette migration and dark-to-light reverse occupancy. |
| `repos/portfolio/tests/journey/post.test.ts` | Existing color mapping exercised across both arcs. |
| `repos/portfolio/tests/gpu/harness.ts` | Explicit fixture theme, applied-state snapshot, real-time stepping and theme setter. |
| `repos/portfolio/tests/gpu/theme-scene.spec.ts` | Actual lights/stars/background, no blend compilation, camera stability, restoration. |
| `repos/portfolio/tests/gpu/component-probe.ts` | Reactive theme prop, captured initial calls and visible-look snapshot. |
| `repos/portfolio/tests/gpu/theme-component.spec.ts` | Saved-theme startup and prop synchronization in the real Vue component. |
| `repos/portfolio/vite.gpu.config.ts` | Test-only theme-call observer alongside existing renderer observer. |
| `repos/portfolio/tests/gpu/post.spec.ts` | Existing parity samples expanded to both arcs. |
| `repos/portfolio/tests/gpu/post-probe-checks.ts` | Use the selected dark look for actual-scene bloom strength. |
| `repos/portfolio/tests/gpu/windows.spec.ts` | Spec 06 consumers migrated to named looks. |
| `docs/superpowers/specs/2026-10-09-city-05-sky-haze-design.md` | Superseded palette/cloud/star/light/fog wording. |
| `docs/superpowers/specs/2026-10-09-city-06-staggered-windows-design.md` | Explicit dark-to-light reverse-order exception. |
| `docs/superpowers/specs/2026-10-09-city-polish-index.md` | Step 2 completion only after integration. |

`target.ts` is needed because the scene factory is too large to unit-test target math directly. The controller belongs in `theme-blend.ts`, rather than another module. Keep the optional state observer compatible with the existing `onRenderer`/`onSceneReady` test hooks; no new user-facing settings are introduced.

### Task 1: Split stop data and migrate every state consumer atomically

**Files:** Modify `stops.ts`, `interpolate.ts`, `scene.ts` imports/target near lines 4–6, 92–98, 619–628; create `target.ts`, `stops.test.ts`, `target.test.ts`; update `interpolate.test.ts`, `post.test.ts`, `post.spec.ts`, `post-probe-checks.ts`, `window-look.test.ts`, `windows.spec.ts` at the exact paths in the file map.

**Interfaces:**
- Consumes: existing `ChapterId`, `Vec3`, `CHAPTER_IDS`, `hexToRgb`, `easeInOut`, `Tier`.
- Produces: `Theme = 'light' | 'dark'`; `PathState`, `LookState`, `StopState = PathState & LookState`; `PATH_STOPS`, `LOOKS`; `lerpPath(a: PathState,b: PathState,p:number):PathState`; `lerpLook(a:LookState,b:LookState,p:number):LookState`; `lerpAngle(a:number,b:number,p:number):number`; `chapterIdAt(index:number):ChapterId`; `stopFor(index:number,themeMix:number):StopState`; `targetFor(chapter:number,progress:number,themeMix:number,reduced:boolean):StopState`.
- Consumes spec 06: `windowLookFor(state:Pick<StopState,'windowLitRatio'>,t:number,tier:Exclude<Tier,'none'>):{uEmissiveScale:number;uTime:number;uFlicker:number}`, `windowHashes(cell:readonly[number,number],seed:number)` returning `{cell:number;building:number;tint:number;brightness:number;flicker:number}`, and `windowLitAmount(cellHash:number,buildingHash:number,uLit:number):number`.
- Retains: `clamp01`, `easeInOut`, `lerp`, `damp`, `dampState` signatures. Removes: `Stop`, `STOPS`, `lerpStop`, private `stopAt`.

- [ ] **Step 1: Write palette/path and interpolation/target tests.**

Create `stops.test.ts`:

```ts
import { Color, SRGBColorSpace } from 'three'
import { expect, it } from 'vitest'
import { CHAPTER_IDS, hexToRgb, LOOKS, PATH_STOPS } from '../../app/journey/stops'

it('retains all authored path values and exactly four chapters', () => {
  expect(Object.keys(PATH_STOPS)).toEqual([...CHAPTER_IDS])
  expect(Object.values(PATH_STOPS)).toEqual([
    { cameraDistance: 0, cameraHeight: .2, lookAheadDistance: 8, lookHeight: 0, buildingDensity: .35, buildingHeight: .6 },
    { cameraDistance: 8, cameraHeight: .6, lookAheadDistance: 8, lookHeight: .3, buildingDensity: .6, buildingHeight: .85 },
    { cameraDistance: 40, cameraHeight: .8, lookAheadDistance: 9, lookHeight: .4, buildingDensity: .85, buildingHeight: 1.15 },
    { cameraDistance: 72, cameraHeight: .3, lookAheadDistance: 9, lookHeight: .2, buildingDensity: 1, buildingHeight: 1 },
  ])
})
it('enforces both palettes and light-only constraints', () => {
  for (const theme of ['light', 'dark'] as const) {
    expect(Object.keys(LOOKS[theme])).toEqual([...CHAPTER_IDS])
    const angles = CHAPTER_IDS.map(id => LOOKS[theme][id].sunAzimuth)
    expect(Math.max(...angles) - Math.min(...angles)).toBeLessThanOrEqual(120)
    for (const id of CHAPTER_IDS) {
      const look = LOOKS[theme][id]
      expect(look.fogDensity).toBeGreaterThanOrEqual(.035)
      for (const value of Object.values(look)) {
        for (const n of Array.isArray(value) ? value : [value]) expect(Number.isFinite(n)).toBe(true)
        if (Array.isArray(value)) value.forEach(n => {
          expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1)
        })
      }
      for (const key of ['windowLitRatio', 'starOpacity', 'sunGlow', 'cloudCover'] as const) {
        expect(look[key]).toBeGreaterThanOrEqual(0); expect(look[key]).toBeLessThanOrEqual(1)
      }
      if (theme === 'light') {
        expect(look.bloomStrength).toBe(0); expect(look.starOpacity).toBe(0)
        const hsl = { h: 0, s: 0, l: 0 }
        new Color().setRGB(...look.skyZenith, SRGBColorSpace).getHSL(hsl, SRGBColorSpace)
        expect(hsl.h * 360).toBeGreaterThanOrEqual(200)
        expect(hsl.h * 360).toBeLessThanOrEqual(230)
      }
    }
  }
  expect(CHAPTER_IDS.map(id => LOOKS.dark[id].windowLitRatio)).toEqual([.3, .55, .75, .9])
  expect(CHAPTER_IDS.map(id => LOOKS.dark[id].bloomStrength)).toEqual([.12, .25, .35, .42])
  expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0])
})
```

In `interpolate.test.ts`, retain existing `clamp01`, `easeInOut`, `lerp`, and `damp` tests; replace the old `STOPS`, `lerpStop`, `state()` helper and hardcoded exposure/bloom tests with:

```ts
import { CHAPTER_IDS, LOOKS, PATH_STOPS } from '../../app/journey/stops'
import { dampState, lerpAngle, lerpLook, lerpPath } from '../../app/journey/interpolate'

it('interpolates every named path and look field', () => {
  for (let i = 0; i < CHAPTER_IDS.length - 1; i++) {
    const aId = CHAPTER_IDS[i]!, bId = CHAPTER_IDS[i + 1]!
    for (const theme of ['light', 'dark'] as const) for (const p of [0, .5, 1]) {
      const a = LOOKS[theme][aId], b = LOOKS[theme][bId]
      const out = lerpLook(a, b, p)
      expect(Object.keys(out).sort()).toEqual(Object.keys(a).sort())
      for (const key of Object.keys(a) as (keyof typeof a)[]) {
        const av = a[key], bv = b[key], actual = out[key]
        if (Array.isArray(av)) {
          expect(actual).toEqual(av.map((v, j) => v * (1 - p) + (bv as readonly number[])[j]! * p))
        } else expect(actual).toBeCloseTo(key === 'sunAzimuth'
          ? lerpAngle(av as number, bv as number, p) : (av as number) * (1 - p) + (bv as number) * p, 12)
      }
      if (p === 0) expect(out).toEqual(a)
      if (p === 1) expect(out).toEqual(b)
      const pa = PATH_STOPS[aId], pb = PATH_STOPS[bId], path = lerpPath(pa, pb, p)
      expect(Object.keys(path).sort()).toEqual(Object.keys(pa).sort())
      for (const key of Object.keys(pa) as (keyof typeof pa)[])
        expect(path[key]).toBeCloseTo(pa[key] * (1 - p) + pb[key] * p, 12)
      if (p === 0) expect(path).toEqual(pa)
      if (p === 1) expect(path).toEqual(pb)
      const sa = { ...pa, ...a }, sb = { ...pb, ...b }
      expect(dampState(sa, sb, 1)).toEqual(sb)
    }
  }
})
it('takes the shortest angle and normalizes it', () => {
  expect(lerpAngle(170, -170, .5)).toBe(-180)
  expect(lerpAngle(-60, 30, .5)).toBe(-15)
  for (const a of [-540, -180, 170, 540]) for (const b of [-540, -170, 180, 540])
    for (const p of [0, .25, .5, .75, 1]) {
      const angle = lerpAngle(a, b, p)
      expect(angle).toBeGreaterThanOrEqual(-180); expect(angle).toBeLessThan(180)
    }
})
```

Create `target.test.ts`:

```ts
import { expect, it } from 'vitest'
import { CHAPTER_IDS, LOOKS, PATH_STOPS } from '../../app/journey/stops'
import { easeInOut, lerpLook, lerpPath } from '../../app/journey/interpolate'
import { chapterIdAt, stopFor, targetFor } from '../../app/journey/target'

it('selects each arc and interpolates scrolling before theme easing', () => {
  for (let c = 0; c < 4; c++) for (const p of [0, .25, .5, 1]) for (const reduced of [false, true]) {
    const a = CHAPTER_IDS[c]!, b = CHAPTER_IDS[Math.min(3, c + 1)]!
    const q = reduced ? 0 : easeInOut(p)
    const path = lerpPath(PATH_STOPS[a], PATH_STOPS[b], q)
    for (const mix of [0, .25, .5, .75, 1]) {
      const look = lerpLook(lerpLook(LOOKS.light[a], LOOKS.light[b], q),
        lerpLook(LOOKS.dark[a], LOOKS.dark[b], q), easeInOut(mix))
      expect(targetFor(c, p, mix, reduced)).toEqual({ ...path, ...look })
      for (const key of Object.keys(path) as (keyof typeof path)[])
        expect(targetFor(c, p, mix, reduced)[key]).toBe(path[key])
    }
    expect(targetFor(c, p, 0, reduced)).toEqual({ ...path, ...lerpLook(LOOKS.light[a], LOOKS.light[b], q) })
    expect(targetFor(c, p, 1, reduced)).toEqual({ ...path, ...lerpLook(LOOKS.dark[a], LOOKS.dark[b], q) })
  }
})
it('clamps chapter ends and terminal scrolling', () => {
  expect(chapterIdAt(-1)).toBe('intro'); expect(chapterIdAt(99)).toBe('about')
  expect(chapterIdAt(1.9)).toBe('projects'); expect(chapterIdAt(NaN)).toBe('intro')
  expect(targetFor(3, 1, 1, false)).toEqual(stopFor(3, 1))
  expect(targetFor(99, .5, 0, false)).toEqual(stopFor(3, 0))
  expect(targetFor(1, -1, 0, false)).toEqual(stopFor(1, 0))
  expect(targetFor(1, 2, 1, false)).toEqual(stopFor(2, 1))
})
```

- [ ] **Step 2: Run the focused tests and observe the missing exports/modules.**

```bash
cd repos/portfolio && npm test -- tests/journey/stops.test.ts tests/journey/interpolate.test.ts tests/journey/target.test.ts
```

Expected: FAIL for missing `LOOKS`, `lerpLook`, or `target.ts`; preserve the existing working tests as regression coverage.

- [ ] **Step 3: Replace the stop data with the complete spec 09 contract.**

Keep the existing `Vec3`, `ChapterId`, `CHAPTER_IDS`, and `hexToRgb` declarations. Replace `StopState`, `Stop`, and `STOPS` with:

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
  skyZenith: Vec3
  skyColor: Vec3
  fogColor: Vec3
  fogDensity: number
  sunElevation: number
  sunAzimuth: number
  sunColor: Vec3
  sunGlow: number
  cloudCover: number
  cloudLitColor: Vec3
  cloudShadeColor: Vec3
  hemiIntensity: number
  starOpacity: number
  windowLitRatio: number
  exposure: number
  bloomStrength: number
}
export type StopState = PathState & LookState
export const PATH_STOPS: Readonly<Record<ChapterId, PathState>> = {
  intro: { cameraDistance: 0, cameraHeight: .2, lookAheadDistance: 8, lookHeight: 0, buildingDensity: .35, buildingHeight: .6 },
  projects: { cameraDistance: 8, cameraHeight: .6, lookAheadDistance: 8, lookHeight: .3, buildingDensity: .6, buildingHeight: .85 },
  skills: { cameraDistance: 40, cameraHeight: .8, lookAheadDistance: 9, lookHeight: .4, buildingDensity: .85, buildingHeight: 1.15 },
  about: { cameraDistance: 72, cameraHeight: .3, lookAheadDistance: 9, lookHeight: .2, buildingDensity: 1, buildingHeight: 1 },
}
export const LOOKS: Readonly<Record<Theme, Readonly<Record<ChapterId, LookState>>>> = {
  light: {
    intro: { skyZenith: hexToRgb('#4f86d6'), skyColor: hexToRgb('#9cc3ee'), fogColor: hexToRgb('#dce8f6'), fogDensity: .04,
      sunElevation: 12, sunAzimuth: -60, sunColor: hexToRgb('#ffe7c4'), sunGlow: .35, cloudCover: .55,
      cloudLitColor: hexToRgb('#ffffff'), cloudShadeColor: hexToRgb('#b8c6dc'), hemiIntensity: .9, starOpacity: 0,
      windowLitRatio: .05, exposure: 1, bloomStrength: 0 },
    projects: { skyZenith: hexToRgb('#3b78d4'), skyColor: hexToRgb('#8bbbf0'), fogColor: hexToRgb('#d4e5f7'), fogDensity: .035,
      sunElevation: 25, sunAzimuth: -40, sunColor: hexToRgb('#fff1dc'), sunGlow: .25, cloudCover: .65,
      cloudLitColor: hexToRgb('#ffffff'), cloudShadeColor: hexToRgb('#aebfd8'), hemiIntensity: .9, starOpacity: 0,
      windowLitRatio: .03, exposure: 1, bloomStrength: 0 },
    skills: { skyZenith: hexToRgb('#2f6bcf'), skyColor: hexToRgb('#7fb2ee'), fogColor: hexToRgb('#cfe1f5'), fogDensity: .035,
      sunElevation: 55, sunAzimuth: -10, sunColor: hexToRgb('#fffaf0'), sunGlow: .15, cloudCover: .6,
      cloudLitColor: hexToRgb('#ffffff'), cloudShadeColor: hexToRgb('#b3c3da'), hemiIntensity: .9, starOpacity: 0,
      windowLitRatio: .02, exposure: 1, bloomStrength: 0 },
    about: { skyZenith: hexToRgb('#3c72c4'), skyColor: hexToRgb('#95bbe4'), fogColor: hexToRgb('#e6e4df'), fogDensity: .04,
      sunElevation: 28, sunAzimuth: 30, sunColor: hexToRgb('#ffe9c7'), sunGlow: .3, cloudCover: .5,
      cloudLitColor: hexToRgb('#ffffff'), cloudShadeColor: hexToRgb('#bcbcc8'), hemiIntensity: .9, starOpacity: 0,
      windowLitRatio: .05, exposure: 1, bloomStrength: 0 },
  },
  dark: {
    intro: { skyZenith: hexToRgb('#6f7fb8'), skyColor: hexToRgb('#fbbf9f'), fogColor: hexToRgb('#f3a683'), fogDensity: .05,
      sunElevation: 4, sunAzimuth: 5, sunColor: hexToRgb('#ffb27a'), sunGlow: .85, cloudCover: .45,
      cloudLitColor: hexToRgb('#ffc29a'), cloudShadeColor: hexToRgb('#7a6a8f'), hemiIntensity: .7, starOpacity: 0,
      windowLitRatio: .3, exposure: 1, bloomStrength: .12 },
    projects: { skyZenith: hexToRgb('#2e2a5c'), skyColor: hexToRgb('#7c6aa8'), fogColor: hexToRgb('#6b5b95'), fogDensity: .05,
      sunElevation: -3, sunAzimuth: 10, sunColor: hexToRgb('#c97aa8'), sunGlow: .45, cloudCover: .4,
      cloudLitColor: hexToRgb('#d79ab8'), cloudShadeColor: hexToRgb('#3d3560'), hemiIntensity: .6, starOpacity: .3,
      windowLitRatio: .55, exposure: 1.1, bloomStrength: .25 },
    skills: { skyZenith: hexToRgb('#151834'), skyColor: hexToRgb('#3a3768'), fogColor: hexToRgb('#2e2a52'), fogDensity: .055,
      sunElevation: -12, sunAzimuth: 10, sunColor: hexToRgb('#8a86c4'), sunGlow: .15, cloudCover: .3,
      cloudLitColor: hexToRgb('#5d5a8a'), cloudShadeColor: hexToRgb('#1f1e3a'), hemiIntensity: .55, starOpacity: .7,
      windowLitRatio: .75, exposure: 1.15, bloomStrength: .35 },
    about: { skyZenith: hexToRgb('#0a0d22'), skyColor: hexToRgb('#1e2340'), fogColor: hexToRgb('#141833'), fogDensity: .065,
      sunElevation: -22, sunAzimuth: 10, sunColor: hexToRgb('#7a8cc4'), sunGlow: 0, cloudCover: .25,
      cloudLitColor: hexToRgb('#3a4266'), cloudShadeColor: hexToRgb('#12152a'), hemiIntensity: .5, starOpacity: 1,
      windowLitRatio: .9, exposure: 1.25, bloomStrength: .42 },
  },
}
```

- [ ] **Step 4: Implement explicit interpolation and the pure target module.**

Add `PathState` and `LookState` to `interpolate.ts`'s type import. Keep `lerp3` private and retain the other existing scalar helpers. Replace `lerpStop` with:

```ts
export function lerpAngle(a: number, b: number, p: number): number {
  const normalize = (v: number) => ((v + 180) % 360 + 360) % 360 - 180
  return normalize(a + normalize(b - a) * p)
}
export function lerpPath(a: PathState, b: PathState, p: number): PathState {
  return {
    cameraDistance: lerp(a.cameraDistance, b.cameraDistance, p),
    cameraHeight: lerp(a.cameraHeight, b.cameraHeight, p),
    lookAheadDistance: lerp(a.lookAheadDistance, b.lookAheadDistance, p),
    lookHeight: lerp(a.lookHeight, b.lookHeight, p),
    buildingDensity: lerp(a.buildingDensity, b.buildingDensity, p),
    buildingHeight: lerp(a.buildingHeight, b.buildingHeight, p),
  }
}
export function lerpLook(a: LookState, b: LookState, p: number): LookState {
  return {
    skyZenith: lerp3(a.skyZenith, b.skyZenith, p),
    skyColor: lerp3(a.skyColor, b.skyColor, p),
    fogColor: lerp3(a.fogColor, b.fogColor, p),
    fogDensity: lerp(a.fogDensity, b.fogDensity, p),
    sunElevation: lerp(a.sunElevation, b.sunElevation, p),
    sunAzimuth: lerpAngle(a.sunAzimuth, b.sunAzimuth, p),
    sunColor: lerp3(a.sunColor, b.sunColor, p),
    sunGlow: lerp(a.sunGlow, b.sunGlow, p),
    cloudCover: lerp(a.cloudCover, b.cloudCover, p),
    cloudLitColor: lerp3(a.cloudLitColor, b.cloudLitColor, p),
    cloudShadeColor: lerp3(a.cloudShadeColor, b.cloudShadeColor, p),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, p),
    starOpacity: lerp(a.starOpacity, b.starOpacity, p),
    windowLitRatio: lerp(a.windowLitRatio, b.windowLitRatio, p),
    exposure: lerp(a.exposure, b.exposure, p),
    bloomStrength: lerp(a.bloomStrength, b.bloomStrength, p),
  }
}
export function dampState(current: StopState, target: StopState, factor: number): StopState {
  return { ...lerpPath(current, target, factor), ...lerpLook(current, target, factor) }
}
```

Create `target.ts`:

```ts
import { CHAPTER_IDS, LOOKS, PATH_STOPS, type ChapterId, type StopState } from './stops'
import { easeInOut, lerpLook, lerpPath } from './interpolate'
export function chapterIdAt(index: number): ChapterId {
  const n = Number.isNaN(index) ? 0 : Math.trunc(index)
  return CHAPTER_IDS[Math.min(CHAPTER_IDS.length - 1, Math.max(0, n))]!
}
export function stopFor(index: number, themeMix: number): StopState {
  const id = chapterIdAt(index)
  return { ...PATH_STOPS[id], ...lerpLook(LOOKS.light[id], LOOKS.dark[id], easeInOut(themeMix)) }
}
export function targetFor(chapter: number, progress: number, themeMix: number, reduced: boolean): StopState {
  const a = chapterIdAt(chapter), b = chapterIdAt(chapter + 1)
  const p = reduced ? 0 : easeInOut(progress)
  return {
    ...lerpPath(PATH_STOPS[a], PATH_STOPS[b], p),
    ...lerpLook(lerpLook(LOOKS.light[a], LOOKS.light[b], p),
      lerpLook(LOOKS.dark[a], LOOKS.dark[b], p), easeInOut(themeMix)),
  }
}
```

For this atomic data migration, update `scene.ts` to import `targetFor`, remove `stopAt` and unused `Stop`/`STOPS`/`lerpStop`/`easeInOut` imports, and use the dark arc until Task 3 installs the actual controller:

```ts
function target(chapter: number, progress: number): StopState {
  return targetFor(chapter, progress, 1, tier === 'reduced')
}
```

This temporary scene adapter keeps the existing night-oriented GPU fixtures valid during the migration. Task 3 replaces it in the same branch before delivery.

- [ ] **Step 5: Migrate existing post/window test inputs and add reverse-occupancy coverage.**

In `post.test.ts` and `post.spec.ts`, replace the `STOPS` import with `CHAPTER_IDS, LOOKS` and add:

```ts
const allLooks = (['light', 'dark'] as const).flatMap(theme => CHAPTER_IDS.map(id => LOOKS[theme][id]))
```

Use `allLooks` for the existing palette loops (`STOPS`, `.map`, `.flatMap`); leave the three explicit hex tone-map regression cases unchanged. In `post-probe-checks.ts`, import `CHAPTER_IDS, LOOKS` from `stops` and replace the actual-scene halo strength selection with:

```ts
const strength = LOOKS.dark[CHAPTER_IDS[chapter]!].bloomStrength
```
 In `window-look.test.ts` and `windows.spec.ts`, replace stop references by `LOOKS.dark.intro`, `.projects`, `.skills`, `.about` and use `CHAPTER_IDS.map(id => LOOKS.dark[id])` for their ordered loops. The spec 06 emission mapping has changed inputs: replace the four hardcoded scale expectations with this independent formula and add both-theme coverage:

```ts
it('maps all eight theme looks without changing window gains', () => {
  for (const theme of ['light', 'dark'] as const) for (const id of CHAPTER_IDS) {
    const s = LOOKS[theme][id], x = Math.max(0, Math.min(1, s.windowLitRatio / .35))
    for (const tier of ['full', 'lite', 'reduced'] as const) {
      const look = windowLookFor(s, 1234.125, tier)
      expect(look.uEmissiveScale).toBeCloseTo(.35 + .65 * x * x * (3 - 2 * x), 12)
      expect(look.uTime).toBeCloseTo(234.125, 10)
      expect(look.uFlicker).toBe(tier === 'reduced' ? 0 : 1)
    }
  }
})
it('turns windows off monotonically during the dark-to-light blend', () => {
  for (const id of CHAPTER_IDS) for (let i = 0; i < 400; i++) {
    const h = windowHashes([i % 40, Math.floor(i / 40)], Math.fround((i + .5) / 400))
    let previous = 1
    for (let frame = 0; frame <= 72; frame++) {
      const look = lerpLook(LOOKS.light[id], LOOKS.dark[id], easeInOut(1 - frame / 72))
      const amount = windowLitAmount(h.cell, h.building, look.windowLitRatio)
      expect(amount).toBeLessThanOrEqual(previous + 1e-12)
      previous = amount
    }
  }
})
```

Imports for these additions: `CHAPTER_IDS, LOOKS` from `stops`, `easeInOut, lerpLook` from `interpolate`, existing `windowLookFor, windowHashes, windowLitAmount` from `window-look`. Keep tests of explicit ratios such as `.3`, `.65`, or `.9` that exercise the window algorithm itself; only palette-derived expectations change.

- [ ] **Step 6: Run the migrated suite and commit this complete data transition.**

```bash
cd repos/portfolio && npm test
cd repos/portfolio && npm run typecheck
rg -n '\b(STOPS|lerpStop|stopAt)\b' repos/portfolio/app repos/portfolio/tests
```

Expected: tests/typecheck PASS; search has no matches. Preserve the existing spec 06 shader code and all six path values. Commit:

```bash
git add repos/portfolio/app/journey/stops.ts repos/portfolio/app/journey/interpolate.ts repos/portfolio/app/journey/target.ts repos/portfolio/app/journey/scene.ts repos/portfolio/tests/journey repos/portfolio/tests/gpu/post.spec.ts repos/portfolio/tests/gpu/post-probe-checks.ts repos/portfolio/tests/gpu/windows.spec.ts
git commit -m "refactor: separate journey paths from theme looks"
```

### Task 2: Implement reversible blend timing and first-call rules

**Files:** Create `repos/portfolio/app/journey/theme-blend.ts` and `repos/portfolio/tests/journey/theme-blend.test.ts`.

**Interfaces:**
- Consumes: `clamp01` from `interpolate.ts`.
- Produces: `THEME_BLEND_SECONDS`, `ThemeBlend {mix:number;target:0|1}`, `advanceBlend(blend:ThemeBlend,dt:number):ThemeBlend`, `retarget(blend:ThemeBlend,isDark:boolean,snap:boolean):ThemeBlend`.
- Produces: `ThemeController {readonly mix:number;readonly target:0|1;setTheme(isDark:boolean,options?:{animate?:boolean}):{changed:boolean;snapped:boolean};advance(t:number):number}` and `createThemeController(reduced:boolean):ThemeController`. `advance` takes absolute seconds, matching `JourneyScene.update`.

- [ ] **Step 1: Write the failing pure/controller tests.**

```ts
import { expect, it } from 'vitest'
import { advanceBlend, createThemeController, retarget, THEME_BLEND_SECONDS } from '../../app/journey/theme-blend'

it('takes 1.2 seconds, caps dt, preserves input, and reverses continuously', () => {
  expect(THEME_BLEND_SECONDS).toBe(1.2)
  const start = Object.freeze({ mix: 0, target: 1 as const })
  let value = start as { mix: number; target: 0 | 1 }
  for (let i = 0; i < 36; i++) value = advanceBlend(value, 1 / 60)
  expect(value.mix).toBeCloseTo(.5, 12)
  for (let i = 0; i < 36; i++) value = advanceBlend(value, 1 / 60)
  expect(value.mix).toBe(1)
  expect(start.mix).toBe(0)
  expect(advanceBlend(start, 5).mix).toBeCloseTo(.1 / 1.2, 12)
  expect(advanceBlend(start, -1).mix).toBe(0)
  expect(advanceBlend(start, NaN).mix).toBe(0)
  const mid = Object.freeze({ mix: .4, target: 1 as const })
  const reversed = retarget(mid, false, false)
  expect(reversed).toEqual({ mix: .4, target: 0 })
  expect(advanceBlend(reversed, .06).mix).toBeCloseTo(.35, 12)
  expect(retarget(mid, false, true)).toEqual({ mix: 0, target: 0 })
  expect(retarget(mid, true, true)).toEqual({ mix: 1, target: 1 })
  expect(mid).toEqual({ mix: .4, target: 1 })
})
it('first call snaps even when animate is true; repeated targets do nothing', () => {
  const c = createThemeController(false)
  expect(c.setTheme(true, { animate: true })).toEqual({ changed: true, snapped: true })
  expect(c.mix).toBe(1)
  expect(c.setTheme(false)).toEqual({ changed: true, snapped: false })
  c.advance(0); c.advance(.06)
  const before = c.mix
  expect(c.setTheme(false, { animate: false })).toEqual({ changed: false, snapped: false })
  expect(c.mix).toBe(before)
  expect(c.setTheme(true)).toEqual({ changed: true, snapped: false })
  expect(c.mix).toBe(before)
  expect(c.advance(.12)).toBe(1)
})
it('uses absolute time, clamps gaps, and treats repeated/backward timestamps as zero elapsed', () => {
  const c = createThemeController(false)
  c.setTheme(false); c.setTheme(true)
  expect(c.advance(100)).toBe(0)
  expect(c.advance(100)).toBe(0)
  expect(c.advance(99)).toBe(0)
  expect(c.advance(105)).toBeCloseTo(.1 / 1.2, 12)
  for (let i = 1; i <= 11; i++) c.advance(105 + i / 10)
  expect(c.mix).toBe(1)
})
it('snaps later calls on reduced and when animation is disabled', () => {
  for (const reduced of [false, true]) {
    const c = createThemeController(reduced)
    c.setTheme(true)
    expect(c.setTheme(false, reduced ? undefined : { animate: false }).snapped).toBe(true)
    expect(c.mix).toBe(0)
    expect(c.advance(5)).toBe(0)
  }
})
```

- [ ] **Step 2: Verify the missing-module failure.**

```bash
cd repos/portfolio && npm test -- tests/journey/theme-blend.test.ts
```

Expected: FAIL because `theme-blend.ts` is absent.

- [ ] **Step 3: Write the complete module.**

```ts
import { clamp01 } from './interpolate'
export const THEME_BLEND_SECONDS = 1.2
export interface ThemeBlend { mix: number; target: 0 | 1 }
export function advanceBlend(blend: ThemeBlend, dt: number): ThemeBlend {
  const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(.1, dt)) : 0
  const next = blend.mix + (blend.target === 1 ? 1 : -1) * elapsed / THEME_BLEND_SECONDS
  const mix = clamp01(next)
  return { mix: Math.abs(mix - blend.target) < 1e-12 ? blend.target : mix, target: blend.target }
}
export function retarget(blend: ThemeBlend, isDark: boolean, snap: boolean): ThemeBlend {
  const target = isDark ? 1 : 0
  return { mix: snap ? target : blend.mix, target }
}
export interface ThemeController {
  readonly mix: number
  readonly target: 0 | 1
  setTheme(isDark: boolean, options?: { animate?: boolean }): { changed: boolean; snapped: boolean }
  advance(t: number): number
}
export function createThemeController(reduced: boolean): ThemeController {
  let blend: ThemeBlend = { mix: 0, target: 0 }
  let initialized = false
  let previousTime: number | null = null
  return {
    get mix() { return blend.mix },
    get target() { return blend.target },
    setTheme(isDark, options) {
      const target = isDark ? 1 : 0
      if (initialized && target === blend.target) return { changed: false, snapped: false }
      const snapped = !initialized || reduced || options?.animate === false
      initialized = true
      blend = retarget(blend, isDark, snapped)
      if (snapped) previousTime = null
      return { changed: true, snapped }
    },
    advance(t) {
      if (!Number.isFinite(t)) return blend.mix
      const dt = previousTime === null ? 0 : Math.max(0, t - previousTime)
      previousTime = previousTime === null ? t : Math.max(previousTime, t)
      blend = advanceBlend(blend, dt)
      return blend.mix
    },
  }
}
```

The primitive's return is immutable; the controller owns its private state. Repeated targets intentionally preserve an in-flight blend even if a later repeat passes `animate:false`, following rule 2. A snapped call resets the clock; the first subsequent frame establishes a new time origin. Context restore keeps the same controller instance.

- [ ] **Step 4: Run focused and full unit tests, then commit.**

```bash
cd repos/portfolio && npm test -- tests/journey/theme-blend.test.ts
cd repos/portfolio && npm test
```

Expected: PASS, including 72-frame completion and reversal from the same amount.

```bash
git add repos/portfolio/app/journey/theme-blend.ts repos/portfolio/tests/journey/theme-blend.test.ts
git commit -m "feat: add reversible journey theme blending"
```

### Task 3: Wire the scene and prove both arcs with real renders

**Files:** Modify `repos/portfolio/app/journey/scene.ts` interface near lines 16–28 and factory near lines 613–717; modify `repos/portfolio/tests/gpu/harness.ts`; create `repos/portfolio/tests/gpu/theme-scene.spec.ts`.

**Interfaces:**
- Consumes: `targetFor`, `lerpLook`, `dampState`, `createThemeController`, spec 06's local `applyWindowLook(state:StopState,t:number):void` helper, existing `post.setLook`, `skyForDirectPipeline`.
- Produces: `JourneyScene.setTheme(isDark:boolean,options?:{animate?:boolean}):void`.
- Adds optional diagnostics: `JourneySceneOptions.onStateApplied?: (state:Readonly<StopState>)=>void`. Existing factory arguments and renderer/scene observer signatures remain compatible.
- Harness produces: `setJourneyTheme(isDark:boolean,options?:{animate?:boolean}):void`; `stepJourney(input:{chapter?:number;progress?:number;time:number}):GpuDiagnostics`; `journeyState():{state:StopState;camera:number[];sunIntensity:number;sunPosition:number[];sunColor:number[];hemiIntensity:number;hemiColor:number[];starOpacity:number|null;programs:number[]}`.
- Harness `mountJourney` additionally accepts `initialDark?:boolean`; its default is **true for existing night fixtures**, while production defaults are determined by the DOM in Task 4.

- [ ] **Step 1: Write real-render endpoint and blend tests before adding runtime/harness methods.**

Create `theme-scene.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { Color, SRGBColorSpace, MathUtils } from 'three'
import { LOOKS, CHAPTER_IDS } from '../../app/journey/stops'
import { targetFor } from '../../app/journey/target'

const combinations = [
  { tier: 'full', lowPower: false }, { tier: 'lite', lowPower: true },
  { tier: 'reduced', lowPower: false }, { tier: 'reduced', lowPower: true },
] as const
const linear = (rgb: readonly [number, number, number]) => new Color().setRGB(...rgb, SRGBColorSpace).toArray()
test.beforeEach(async ({ page }) => { await page.goto('/tests/gpu/harness.html') })
test.afterEach(async ({ page }) => { await page.evaluate(() => window.cityGpu.dispose()) })

for (const input of combinations) {
  test(`theme endpoints and lights ${input.tier}/${input.lowPower}`, async ({ page }) => {
    await page.evaluate(input => window.cityGpu.mountJourney({ ...input, initialDark: false, width: 320, height: 180 }), input)
    for (const dark of [false, true]) for (let chapter = 0; chapter < 4; chapter++) {
      const result = await page.evaluate(({ dark, chapter }) => {
        window.cityGpu.setJourneyTheme(dark, { animate: false })
        const d = window.cityGpu.renderJourney({ chapter, time: 0, frames: 240 })
        return { d, snapshot: window.cityGpu.journeyState() }
      }, { dark, chapter })
      const look = LOOKS[dark ? 'dark' : 'light'][CHAPTER_IDS[chapter]!]
      const expected = targetFor(chapter, 0, dark ? 1 : 0, input.tier === 'reduced')
      for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
        const actual = result.snapshot.state[key], wanted = expected[key]
        if (Array.isArray(wanted)) wanted.forEach((v, i) => expect((actual as number[])[i]).toBeCloseTo(v, 6))
        else expect(actual).toBeCloseTo(wanted as number, 6)
      }
      expect(result.snapshot.sunIntensity).toBeCloseTo(Math.max(.25, MathUtils.smoothstep(look.sunElevation, -6, 12)), 6)
      expect(result.snapshot.sunPosition[1]).toBeGreaterThanOrEqual(2)
      linear(look.sunColor).forEach((v, i) => expect(result.snapshot.sunColor[i]).toBeCloseTo(v, 6))
      expect(result.snapshot.hemiIntensity).toBeCloseTo(look.hemiIntensity, 6)
      const hemi = new Color().setRGB(...look.skyZenith, SRGBColorSpace)
        .lerp(new Color().setRGB(...look.skyColor, SRGBColorSpace), .5).toArray()
      hemi.forEach((v, i) => expect(result.snapshot.hemiColor[i]).toBeCloseTo(v, 6))
      if (input.lowPower) expect(result.snapshot.starOpacity).toBeNull()
      else expect(result.snapshot.starOpacity).toBeCloseTo(look.starOpacity, 6)
      expect(result.d.shaderError).toBeNull(); expect(result.d.glError).toBe(0)
    }
  })
  test(`no compilation or camera movement during toggles ${input.tier}/${input.lowPower}`, async ({ page }) => {
    await page.evaluate(input => window.cityGpu.mountJourney({ ...input, initialDark: false, width: 320, height: 180 }), input)
    for (let chapter = 0; chapter < 4; chapter++) {
      const result = await page.evaluate(chapter => {
        window.cityGpu.setJourneyTheme(false, { animate: false })
        const baseTime = chapter * 3
        window.cityGpu.renderJourney({ chapter, time: baseTime, frames: 240 })
        const before = window.cityGpu.journeyState()
        const snapshots = []
        const endpoints = []
        for (const dark of [true, false]) {
          window.cityGpu.setJourneyTheme(dark)
          for (let frame = 0; frame <= 72; frame++) {
            const time = baseTime + (dark ? 0 : 1.2) + frame / 60
            const d = window.cityGpu.stepJourney({ chapter, time })
            snapshots.push({ d, s: window.cityGpu.journeyState() })
          }
          window.cityGpu.renderJourney({ chapter, time: baseTime + (dark ? 1.2 : 2.4), frames: 240 })
          endpoints.push(window.cityGpu.journeyState())
        }
        return { before, snapshots, endpoints, after: window.cityGpu.journeyState() }
      }, chapter)
      for (const { d, s } of result.snapshots) {
        expect(s.programs).toEqual(result.before.programs)
        s.camera.forEach((v, i) => expect(v).toBeCloseTo(result.before.camera[i]!, 6))
        expect(d.shaderError).toBeNull(); expect(d.glError).toBe(0)
      }
      expect(result.endpoints[0]!.state.bloomStrength).toBeCloseTo(LOOKS.dark[CHAPTER_IDS[chapter]!].bloomStrength, 6)
      expect(result.after.state.bloomStrength).toBeCloseTo(0, 6)
      expect(result.after.state.starOpacity).toBeCloseTo(0, 6)
    }
  })
}
```

- [ ] **Step 2: Run these tests and verify that the absent harness methods cause the failure.**

```bash
cd repos/portfolio && npm run test:gpu -- tests/gpu/theme-scene.spec.ts
```

Expected: FAIL at `setJourneyTheme`/`journeyState`; this must exercise the browser, not merely a shader source assertion.

- [ ] **Step 3: Update scene target, time, snapping, lights, and stars.**

Update the two interfaces exactly as listed above. Name the existing lights `journey-sun` and `journey-hemi`. Add the reusable hemisphere scratch color, controller, and remembered frame inputs before `current`:

```ts
import { lerpLook } from './interpolate'
import { createThemeController } from './theme-blend'
// Keep damp/dampState imports and targetFor from Task 1.

sun.name = 'journey-sun'
hemi.name = 'journey-hemi'
const hemiMid = new THREE.Color()
const themes = createThemeController(tier === 'reduced')
let lastChapter = 0
let lastProgress = 0
let lastTime = 0
let current: StopState = target(0, 0)
function target(chapter: number, progress: number): StopState {
  return targetFor(chapter, progress, themes.mix, tier === 'reduced')
}
```

Inside `apply`, retain the entire background/fog color-space path, facade tint/occupancy, building transforms, and camera placement. Replace the hemisphere/star intensity wiring and add sunlight:

```ts
hemi.color.setRGB(...state.skyZenith, THREE.SRGBColorSpace)
  .lerp(hemiMid.setRGB(...state.skyColor, THREE.SRGBColorSpace), .5)
hemi.intensity = state.hemiIntensity
sun.color.setRGB(...state.sunColor, THREE.SRGBColorSpace)
sun.intensity = Math.max(.25, THREE.MathUtils.smoothstep(state.sunElevation, -6, 12))
const elevation = THREE.MathUtils.degToRad(state.sunElevation)
const azimuth = THREE.MathUtils.degToRad(state.sunAzimuth)
sun.position.set(-Math.sin(azimuth) * Math.cos(elevation) * 10,
  Math.max(2, Math.sin(elevation) * 10), -Math.cos(azimuth) * Math.cos(elevation) * 10)
if (stars) stars.material.opacity = state.starOpacity
// At the end of apply, after camera.lookAt:
options.onStateApplied?.(state)
```

This adopts spec 05's light behavior required by spec 09 section 5 without creating its dome. Azimuth 0 points toward -Z, and positive angles turn toward -X. The future dome will expose the unclamped sun direction; only the actual light position has the moonlight clamp.

Replace the `update` state/time lines and the returned `setTheme` body:

```ts
update(chapter, progress, t, pointer) {
  lastChapter = chapter
  lastProgress = progress
  lastTime = t
  themes.advance(t)
  current = tier === 'reduced' ? target(chapter, progress)
    : dampState(current, target(chapter, progress), DAMPING)
  if (tier === 'full') {
    tilt.x = damp(tilt.x, pointer.x * .3, DAMPING)
    tilt.y = damp(tilt.y, pointer.y * .2, DAMPING)
  }
  apply(current)
  applyWindowLook(current, t)
  renderFrame()
},
setTheme(isDark, themeOptions) {
  const result = themes.setTheme(isDark, themeOptions)
  if (!result.changed || !result.snapped) return
  const selected = target(lastChapter, lastProgress)
  current = { ...current, ...lerpLook(selected, selected, 0) }
  apply(current)
  applyWindowLook(current, lastTime)
  if (!renderer.getContext().isContextLost()) renderFrame()
},
```

Use the actual `applyWindowLook` helper landed by spec 06; its call must happen in snapped renders as well as normal updates. Merge imports instead of introducing duplicate declarations. A snap overwrites **every look field** while keeping the currently damped path; an animated retarget only changes the controller until the next `update`. `renderFrame()` on a snap removes the old warm-up pixels before the canvas is exposed. Theme changes during a lost context still update CPU state; a restored update renders it.

Keep startup warm-up unchanged: bloom is forced on once, then the real initial look is reapplied and rendered. Do not set any material `needsUpdate`, replace materials, change defines, or re-create post targets on a toggle.

- [ ] **Step 4: Extend the harness with explicit theme control and elapsed-time stepping.**

Import `StopState` and declare `let appliedState: StopState | null = null`. Extend the observer `Pick` in `mountJourney` to include `'onStateApplied'`, and add this callback alongside `onRenderer`/`onSceneReady`:

```ts
onStateApplied(state) {
  appliedState = state
  observers?.onStateApplied?.(state)
},
```

Extend the mount options with `initialDark?:boolean`; after its existing `journey.resize(...)`, call:

```ts
journey.setTheme(options.initialDark ?? true, { animate: false })
```

Add these methods to `cityGpu`, alongside `renderJourney`:

```ts
setJourneyTheme(isDark: boolean, options?: { animate?: boolean }) {
  if (!journey) throw new Error('Mount a journey first')
  journey.setTheme(isDark, options)
  latestFrame = rendererFrame(requireRenderer())
},
stepJourney(input: { chapter?: number; progress?: number; time: number }) {
  return cityGpu.renderJourney({ chapter: input.chapter ?? last.chapter,
    progress: input.progress ?? last.progress, time: input.time, frames: 1 })
},
journeyState() {
  if (!appliedState) throw new Error('Journey has not applied a state')
  const { scene, camera, renderer } = cityGpu.getJourneyContext()
  const sun = scene.getObjectByName('journey-sun') as THREE.DirectionalLight
  const hemi = scene.getObjectByName('journey-hemi') as THREE.HemisphereLight
  const stars = scene.children.find(object => object instanceof THREE.Points) as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | undefined
  return { state: appliedState, camera: camera.position.toArray(),
    sunIntensity: sun.intensity, sunPosition: sun.position.toArray(), sunColor: sun.color.toArray(),
    hemiIntensity: hemi.intensity, hemiColor: hemi.color.toArray(), starOpacity: stars?.material.opacity ?? null,
    programs: (renderer.info.programs ?? []).map(program => program.id).sort((a, b) => a - b) }
},
```

Clear `appliedState` in `dispose()`. Keep `renderJourney`'s fixed-time settling behavior; the new `stepJourney` advances absolute time one frame at a time. Keeping the fixture default dark preserves existing post/exposure/halo tests and spec 06 night tests. New light tests must explicitly supply `initialDark:false`.

- [ ] **Step 5: Add snap, bounded-gap, scroll reversal, restore, and palette parity cases.**

Append to `theme-scene.spec.ts`:

```ts
for (const input of combinations) {
  test(`snap is visible immediately ${input.tier}/${input.lowPower}`, async ({ page }) => {
    const result = await page.evaluate(input => {
      window.cityGpu.mountJourney({ ...input, initialDark: true, width: 320, height: 180 })
      window.cityGpu.renderJourney({ chapter: 3, frames: 240, time: 0 })
      const before = window.cityGpu.journeyState()
      window.cityGpu.setJourneyTheme(false, input.tier === 'reduced' ? undefined : { animate: false })
      return { before, after: window.cityGpu.journeyState(), d: window.cityGpu.diagnostics() }
    }, input)
    expect(result.after.state.starOpacity).toBe(0)
    expect(result.after.state.bloomStrength).toBe(0)
    expect(result.after.state.skyColor).toEqual(LOOKS.light.about.skyColor)
    expect(result.after.camera).toEqual(result.before.camera)
    expect(result.d.shaderError).toBeNull(); expect(result.d.glError).toBe(0)
  })
}
test('bounded background gap and reversal keep the scrolling path', async ({ page }) => {
  const result = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'lite', lowPower: true, initialDark: false, width: 320, height: 180 })
    window.cityGpu.renderJourney({ chapter: 1, progress: .5, time: 0 })
    window.cityGpu.setJourneyTheme(true)
    window.cityGpu.stepJourney({ time: 0 })
    window.cityGpu.renderJourney({ chapter: 1, progress: .5, time: 5, frames: 240 })
    const gap = window.cityGpu.journeyState()
    window.cityGpu.setJourneyTheme(false)
    const atReversal = window.cityGpu.journeyState()
    window.cityGpu.renderJourney({ chapter: 1, progress: .5, time: 5.06, frames: 240 })
    return { gap, atReversal, reversed: window.cityGpu.journeyState(), d: window.cityGpu.diagnostics() }
  })
  const expected = targetFor(1, .5, .1 / 1.2, false)
  expect(result.gap.state.windowLitRatio).toBeCloseTo(expected.windowLitRatio, 6)
  expect(result.atReversal.state).toEqual(result.gap.state)
  expect(result.reversed.state.windowLitRatio).toBeLessThan(result.gap.state.windowLitRatio)
  for (const key of ['cameraDistance', 'cameraHeight', 'lookAheadDistance', 'lookHeight', 'buildingDensity', 'buildingHeight'] as const)
    expect(result.reversed.state[key]).toBeCloseTo(expected[key], 6)
  expect(result.d.shaderError).toBeNull(); expect(result.d.glError).toBe(0)
})
for (const input of [combinations[0], combinations[1]]) {
  test(`restore mid-blend retains the final rendered look ${input.tier}`, async ({ page }) => {
    const result = await page.evaluate(async input => {
      window.cityGpu.mountJourney({ ...input, initialDark: false, width: 320, height: 180 })
      const begin = () => {
        window.cityGpu.setJourneyTheme(false, { animate: false })
        window.cityGpu.renderJourney({ chapter: 3, time: 0, frames: 240 })
        window.cityGpu.setJourneyTheme(true)
        window.cityGpu.stepJourney({ time: 0 })
      }
      begin()
      for (let f = 1; f <= 72; f++) window.cityGpu.stepJourney({ time: f / 60 })
      window.cityGpu.renderJourney({ chapter: 3, time: 1.2, frames: 240 })
      const reference = window.cityGpu.readFrame()
      begin()
      for (let f = 1; f <= 36; f++) window.cityGpu.stepJourney({ time: f / 60 })
      window.cityGpu.renderJourney({ chapter: 3, time: .6, frames: 240 })
      const midpoint = window.cityGpu.journeyState()
      await window.cityGpu.loseAndRestore()
      window.cityGpu.resizeJourney(320, 180)
      window.cityGpu.renderJourney({ chapter: 3, time: .6, frames: 240 })
      const restoredMidpoint = window.cityGpu.journeyState()
      for (let f = 37; f <= 72; f++) window.cityGpu.stepJourney({ time: f / 60 })
      const d = window.cityGpu.renderJourney({ chapter: 3, time: 1.2, frames: 240 })
      const after = window.cityGpu.readFrame()
      let maxDelta = 0
      for (let i = 0; i < reference.length; i++) maxDelta = Math.max(maxDelta, Math.abs(reference[i]! - after[i]!))
      return { midpoint, restoredMidpoint, final: window.cityGpu.journeyState(), maxDelta, d }
    }, input)
    expect(result.restoredMidpoint.state.windowLitRatio).toBeCloseTo(result.midpoint.state.windowLitRatio, 6)
    expect(result.final.state.starOpacity).toBeCloseTo(1, 6)
    expect(result.final.state.exposure).toBeCloseTo(1.25, 6)
    expect(result.maxDelta).toBeLessThanOrEqual(3)
    expect(result.d.shaderError).toBeNull(); expect(result.d.glError).toBe(0)
  })
}
```

Context restore may rebuild shader programs; the no-compilation assertion applies to ordinary blends after warm-up. Compare the same scene, chapter, pointer, absolute time, and drawing-buffer size so random star positions and window flicker do not contaminate restoration checks.

The Task 1 `allLooks` migration makes existing `cityPost.parity` cover all eight authored sky/fog/exposure inputs. Retain all existing direct/composer/fallback tests; these distinguish authored colors from CPU-mapped direct-path colors. No sky dome/horizon equality assertion belongs to this stage.

- [ ] **Step 6: Run relevant browser tests, unit tests, and typecheck; commit.**

```bash
cd repos/portfolio && npm run test:gpu -- tests/gpu/theme-scene.spec.ts tests/gpu/post.spec.ts tests/gpu/windows.spec.ts
cd repos/portfolio && npm test
cd repos/portfolio && npm run typecheck
```

Expected: PASS for all four tier/power combinations. Check `scene.ts` stays below the 800-line soft ceiling; target and timing logic are already outside it. Do not restructure geometry while meeting this gate.

```bash
git add repos/portfolio/app/journey/scene.ts repos/portfolio/tests/gpu/harness.ts repos/portfolio/tests/gpu/theme-scene.spec.ts
git commit -m "feat: apply journey theme arcs to the city scene"
```

### Task 4: Snap the DOM theme before showing the canvas

**Files:** Modify `repos/portfolio/app/components/JourneyCanvas.vue` creation/startup near lines 162–183; modify `repos/portfolio/tests/gpu/component-probe.ts`, `repos/portfolio/tests/gpu/harness.ts`, `repos/portfolio/vite.gpu.config.ts`; create `repos/portfolio/tests/gpu/theme-component.spec.ts`.

**Interfaces:**
- Consumes: `JourneyScene.setTheme(isDark,options)` from Task 3 and existing `<html class="dark">` set by `nuxt.config.ts`'s head script.
- Produces: initial `setTheme(document.documentElement.classList.contains('dark'),{animate:false})` while the canvas is hidden, followed by the existing prop watcher for real toggles.
- Fixture `mountComponent` additionally accepts `chapter?:number;initialDark?:boolean`; produces `setComponentDark(isDark:boolean):Promise<void>` and `componentThemeStatus():{calls:{isDark:boolean;animate:boolean|undefined}[];sky:number[]|null}`.
- Test-only `Window.__cityGpuThemeObserver?: (isDark:boolean,options?:{animate?:boolean})=>void`; no production global observer.

- [ ] **Step 1: Write the saved-theme tests against the real component.**

```ts
import { expect, test } from '@playwright/test'
import { LOOKS } from '../../app/journey/stops'

test.beforeEach(async ({ page }) => { await page.goto('/tests/gpu/harness.html') })
test.afterEach(async ({ page }) => {
  await page.evaluate(() => { window.cityGpu.unmountComponent(); document.documentElement.classList.remove('dark') })
})
for (const dark of [false, true]) {
  test(`DOM ${dark ? 'dark' : 'light'} wins over stale initial props`, async ({ page }) => {
    await page.evaluate(dark => {
      document.documentElement.classList.toggle('dark', dark)
      return window.cityGpu.mountComponent({ failure: 'none', chapter: 0, initialDark: !dark })
    }, dark)
    await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().visible)).toBe(true)
    const first = await page.evaluate(() => window.cityGpu.componentThemeStatus())
    expect(first.calls).toEqual([{ isDark: dark, animate: false }])
    const expected = LOOKS[dark ? 'dark' : 'light'].intro.skyColor
    expected.forEach((v, i) => expect(first.sky![i]).toBeCloseTo(v, 6))
    await page.evaluate(dark => window.cityGpu.setComponentDark(dark), dark)
    // Allow real RAF updates after the plugin-equivalent prop synchronization.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const synced = await page.evaluate(() => window.cityGpu.componentThemeStatus())
    expect(synced.calls).toEqual([{ isDark: dark, animate: false }, { isDark: dark, animate: undefined }])
    expected.forEach((v, i) => expect(synced.sky![i]).toBeCloseTo(v, 6))
    expect(await page.evaluate(() => window.cityGpu.componentStatus().unavailable)).toBe(0)
  })
}
test('a later actual toggle animates at the current chapter', async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    return window.cityGpu.mountComponent({ failure: 'none', chapter: 0, initialDark: false })
  })
  await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().visible)).toBe(true)
  const before = await page.evaluate(() => window.cityGpu.componentThemeStatus())
  await page.evaluate(() => { document.documentElement.classList.add('dark'); return window.cityGpu.setComponentDark(true) })
  const justToggled = await page.evaluate(() => window.cityGpu.componentThemeStatus())
  expect(justToggled.calls.at(-1)).toEqual({ isDark: true, animate: undefined })
  const distance = (a: number[], b: readonly number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0)
  expect(distance(justToggled.sky!, before.sky!)).toBeLessThan(.1)
  await expect.poll(async () => {
    const status = await page.evaluate(() => window.cityGpu.componentThemeStatus())
    return distance(status.sky!, LOOKS.dark.intro.skyColor)
  }, { timeout: 2500 }).toBeLessThan(.01)
})
```

The plugin synchronization legitimately calls the watcher with the same target; Task 2 proves that this call is a no-op. The acceptance condition is one initial snapping call, zero light-to-dark transition on load, and no false-theme call. The prop watcher stays active for real toggles.

- [ ] **Step 2: Run the test and verify the missing fixture methods or old startup call fail.**

```bash
cd repos/portfolio && npm run test:gpu -- tests/gpu/theme-component.spec.ts
```

Expected: FAIL before the component snap and fixture updates.

- [ ] **Step 3: Put the initial snap inside the existing creation try block.**

Immediately after `createJourneyScene(...)`, before the creation `catch`, add:

```ts
scene.setTheme(document.documentElement.classList.contains('dark'), { animate: false })
```

Remove the later `scene.setTheme(props.isDark)` call. Preserve `active.value = true` and `onResize()` after the `try` block, so startup snap failures receive the same teardown and `unavailable` fallback as creation failures. Keep the existing watcher exactly:

```ts
watch(() => props.isDark, isDark => scene?.setTheme(isDark))
```

Leave the head script, dark-mode plugin, toggle, page CSS, and fallback gradient intact.

- [ ] **Step 4: Add the test-only observer and reactive component fixture.**

In `vite.gpu.config.ts`, inside its existing `scene.ts` transform, keep the renderer-observer replacement and apply a guarded second replacement:

```ts
const themeMarker = 'setTheme(isDark, themeOptions) {'
if (!source.includes(themeMarker)) throw new Error('GPU theme observer marker missing')
const withRendererObserver = source.replace(marker, marker + '\nwindow.__cityGpuRendererObserver?.(renderer)')
return withRendererObserver.replace(themeMarker,
  themeMarker + '\nwindow.__cityGpuThemeObserver?.(isDark, themeOptions)')
```

In `component-probe.ts`, import `ref` from Vue and add:

```ts
let componentDark = ref(false)
let previousThemeObserver: Window['__cityGpuThemeObserver']
let themeCalls: { isDark: boolean; animate: boolean | undefined }[] = []
```

Extend `mountComponent`'s options type with `chapter?:number;initialDark?:boolean`. After its `unmountComponent()`, set up the new state/observer:

```ts
componentDark = ref(options.initialDark ?? false)
themeCalls = []
previousThemeObserver = window.__cityGpuThemeObserver
window.__cityGpuThemeObserver = (isDark, themeOptions) => {
  themeCalls.push({ isDark, animate: themeOptions?.animate })
  previousThemeObserver?.(isDark, themeOptions)
}
```

In its existing `h(JourneyCanvas,...)`, replace only `chapter:3` and `isDark:false` by:

```ts
chapter: options.chapter ?? 3, progress: 0, isDark: componentDark.value,
```

Add exports:

```ts
export async function setComponentDark(isDark: boolean): Promise<void> {
  componentDark.value = isDark
  await nextTick()
}
export function componentThemeStatus() {
  const sky = capturedScene?.background
  const rgb = sky instanceof THREE.Color ? sky.getRGB(new THREE.Color(), THREE.SRGBColorSpace).toArray() : null
  return { calls: [...themeCalls], sky: rgb }
}
```

Restore `window.__cityGpuThemeObserver = previousThemeObserver` in `unmountComponent()` along with the existing renderer observer. Add `setComponentDark` and `componentThemeStatus` to the existing component import and `cityGpu` object in `harness.ts`; extend its global `Window` declaration with the observer signature listed in this task. This instrumentation is served only by the GPU Vite configuration.

- [ ] **Step 5: Verify startup, fallback, and resource disposal, then commit.**

```bash
cd repos/portfolio && npm run test:gpu -- tests/gpu/theme-component.spec.ts tests/gpu/shader-failure.spec.ts
cd repos/portfolio && npm run typecheck
```

Expected: PASS, including existing creation/render failure fallback and idempotent disposal tests. Saved dark sees the authored dark introductory look at first visibility, and plugin synchronization preserves it.

```bash
git add repos/portfolio/app/components/JourneyCanvas.vue repos/portfolio/tests/gpu/component-probe.ts repos/portfolio/tests/gpu/harness.ts repos/portfolio/tests/gpu/theme-component.spec.ts repos/portfolio/vite.gpu.config.ts
git commit -m "fix: initialize journey from the saved DOM theme"
```

### Task 5: Reconcile dependent specs and verify the complete stage

**Files:** Modify `docs/superpowers/specs/2026-10-09-city-05-sky-haze-design.md`, `docs/superpowers/specs/2026-10-09-city-06-staggered-windows-design.md`, `docs/superpowers/specs/2026-10-09-city-polish-index.md`; track execution results in the canonical claude-mem work-state list. No new runtime interface.

**Interfaces:**
- Consumes: all four prior task deliverables; the installed `npm test`, `test:gpu`, `typecheck`, `build` scripts.
- Produces: a verified step 2 branch, accurate scope/dependency documentation, and a reviewable visual record. Step 3 reads `LOOKS`, `targetFor`, and the theme controller produced here.

- [ ] **Step 1: Update superseded spec 05 wording and the spec 06 exception.**

Make these exact scoped edits in spec 05:

1. Replace the status line with `Status: Draft. Palette, clouds, and stars superseded by spec 09; theme arcs implemented in series step 2, dome/haze/clouds scheduled for step 3.` Keep links to spec 09.
2. Replace the heading ``### New `StopState` fields`` and its section, including its obsolete palette table, with:

```markdown
### Look fields and palettes

The five sky/sun fields are part of `LookState` in spec 09 section 1. Use the eight `LOOKS` entries from spec 09 section 4. `PATH_STOPS` owns the camera and building fields. New visual fields follow shared conventions section 4: type, eight look values, explicit `lerpLook`, and endpoint/midpoint tests.

`fogColor` remains the horizon/fog color; `skyColor` is the mid-sky color; `skyZenith` is straight up. Do not restore the former single-arc palette table or `STOPS`.
```

3. Replace fragment step 6's static streak paragraph with `6. Clouds: use spec 09 section 6 in the combined step 3 implementation, after the gradient/glow/band and before the luminance cap. Both shader variants contain clouds regardless of theme.`
4. Replace the directional light formula/theme-factor sentence with `` `sun.intensity = max(0.25, smoothstep(-6, 12, sunElevation))`. There is no theme multiplier; the interpolated look controls light levels. `` Add `` `hemi.intensity = state.hemiIntensity` `` to the hemisphere rule.
5. Replace the statements that stars remain unchanged/follow `windowLitRatio` with `` Existing Points geometry/count/tier policy is retained; opacity follows `state.starOpacity`. ``
6. Replace references to fog values from `STOPS` with `LOOKS`. Replace the lowest-density ground-edge arithmetic with `` Minimum fog density is 0.035; at depth 80, exp(-(0.035 * 80)^2) is about 4e-4. `` Retain the existing larger ground/ring/camera-far design for step 3.
7. Add beneath success criteria: `Every chapter-based success criterion and test runs for both themes. Horizon equality and SKY_MAX_LUMINANCE also hold at intermediate theme mixes.` Update the chapter appearance prose to follow spec 09: light projects is morning; dark intro is sunset and dark projects is dusk.

In spec 06, immediately after the rule that windows turn on one by one and never off, add:

```markdown
Exception: a dark-to-light theme blend turns windows off in reverse threshold order. Scroll-only dark-arc progression remains monotonic; the same staggered thresholds are reused while `windowLitRatio` falls during a theme blend.
```

In the series index, change only step 2's plan cell from `to write` to ``written (`2026-10-09-city-09-theme-arcs.md`)``. Tick step 2's `Done` box only when its verified branch has been merged. Keep step 3 pending and describe its dependency on this plan's `LOOKS`/controller. Do not mark all of spec 09 built while its clouds remain in step 3.

- [ ] **Step 2: Run all required implementation gates.**

```bash
cd repos/portfolio && npm test
cd repos/portfolio && npm run test:gpu
cd repos/portfolio && npm run typecheck
cd repos/portfolio && npm run build
rg -n '\b(STOPS|lerpStop|stopAt)\b' repos/portfolio/app repos/portfolio/tests
```

Expected: all gates PASS and search finds no obsolete symbols. Verify the original warm-up still compiles bloom once, theme toggles allocate no new materials/targets, and the production build does not include GPU observer instrumentation or harness pages. Report actual execution counts/results, rather than the authoring baseline counts.

- [ ] **Step 3: Capture the stage's visual matrix and check saved-theme behavior.**

Start the existing Nuxt dev server from `repos/portfolio`:

```bash
npm run dev -- --host 127.0.0.1 --port 3000
```

At `http://127.0.0.1:3000`, capture each chapter at progress 0, one scroll midpoint, and a theme-blend midpoint, in both themes. Use desktop plus iPhone 14 Pro Max emulation in portrait and landscape. Store captures outside the repository and attach them to the branch review/PR description. Use the existing browser control skill when automating this check.

At all four chapters and a midpoint between them, toggle both ways and double-toggle during the blend. Confirm the camera keeps moving with scroll, the dark arc has the authored warmer intro and cool night, light chapters remain blue, dark stars grow, light stars vanish, light bloom becomes zero, and reduced motion snaps. Check translucent panels remain readable; flag any contrast regression for palette tuning before delivery. Reload once with `localStorage.theme = 'dark'` and once with `'light'`; the first visible frame must match the saved arc. Measure the transition with the DevTools performance recording: controller endpoints 1.2 s apart, with the spec's accepted damping lag in the visible look. Do not claim cloud/gradient/horizon quality from a flat-sky screenshot.

- [ ] **Step 4: Commit documentation and record the execution outcome.**

```bash
git diff --check
git add docs/superpowers/specs/2026-10-09-city-05-sky-haze-design.md docs/superpowers/specs/2026-10-09-city-06-staggered-windows-design.md docs/superpowers/specs/2026-10-09-city-polish-index.md
git commit -m "docs: align city specs with journey theme arcs"
```

Record tests, screenshots, any palette tuning, branch/worktree, and remaining step 3 acceptance in claude-mem `work_state_write`. The performance budget of +0.3 ms is explicitly relative to an implemented spec 05 baseline, which does not exist at step 2; carry that physical desktop/iPhone measurement into step 3 rather than measuring against the flat sky and claiming it passed. Any earlier user waiver is specific to its original measurement and does not prove this future cloud budget.

## Coverage and handoff

| Requirement | Owning task |
| --- | --- |
| Spec 09 §1, path/look split, all eight values, obsolete state APIs removed | Task 1 |
| §2, explicit interpolation, shortest angle, theme-independent target, easing/damping | Tasks 1–2 |
| §2, immutable primitives, 1.2 s blend, reversal and capped elapsed time | Task 2 |
| §3, first/repeated/reduced/explicit snap rules, rendered snap | Tasks 2–3 |
| §3, DOM class startup, prop synchronization without a load blend | Task 4 |
| §4, palettes, minimum fog, no light bloom/stars, hue/azimuth constraints | Task 1 |
| §5, look-controlled lights, hemisphere and star opacity | Task 3 |
| §7, spec 05 supersession and spec 06 reverse-order exception | Tasks 1/5 |
| §8, tier motion/cost behavior relevant to arcs | Tasks 2–4 |
| Unit tests 1–4, 9–10; component test 11 | Tasks 1–4 |
| GPU test 14, no programs compiled while blending | Task 3 |
| GPU test 17, mid-blend restore/final parity for current scene | Task 3 |
| Manual chapter/theme/viewport/toggle/reload checks for this stage | Task 5 |
| §6 and tests 5–8, 12–13, 15–16: cloud/dome guarantees and physical cloud cost | Combined step 3 plan, deliberately outside the user's selected scope |

Self-review completed at authoring: all six path fields and all sixteen look fields appear in explicit interpolation; controller/target/observer/fixture signatures agree; placeholder scan is clear; all five Review Focus conditions have owning tests. Extracted pure-module snippets were run in an isolated temporary project: four Vitest files, ten tests passed, including palettes, all-field interpolation, target invariance, timing and controller rules. Those extracted files also passed strict TypeScript checking; all 28 TypeScript snippets passed syntax checking. Browser snippets were reviewed against the existing harness and type declarations; their actual WebGL gates run during implementation.

Recommended execution: **Native**, because the five tasks share a small set of tightly coupled state/runtime/harness interfaces, while unit tests and real-render tests provide concrete gates. The writing-plans skill requires plan review and selection of an execution approach before implementation starts. With Native chosen, use `superpowers:executing-plans`; with Subagent-driven chosen, use `superpowers:subagent-driven-development`.
