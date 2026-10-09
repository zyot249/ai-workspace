# City 02: Tone mapping and selective bloom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Neutral tone mapping, interpolated chapter exposure, and HDR bloom on capable desktops, with a matching direct rendering path on low-power devices and capability failure.

**Architecture:** Keep tone-map math, HDR capability probing, composer lifetime, and look controls in `post.ts`; `scene.ts` only supplies state and owns the pipeline. Use the installed Three r186 `RenderPass -> UnrealBloomPass -> OutputPass` chain with linear half-float input and output conversion exactly once. Reuse spec 01's low-power flag, shader recorder, scene warm-up/failure handling, and browser harness; integrate shared scene edits after that foundation lands.

**Tech Stack:** Existing Nuxt 4/Vue 3/TypeScript, Three `^0.186.0` (installed r186), Vitest 5, and spec 01's Playwright/Vite WebGL2 harness; no other runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-09-city-02-tonemap-bloom-design.md`; also read `docs/superpowers/specs/2026-10-09-city-00-shared-conventions.md`.

## Global Constraints

- “`StopState` colors (`skyColor`, `fogColor`, and any new `Vec3` color) are sRGB values produced by `hexToRgb`.” Always declare `THREE.SRGBColorSpace` when writing authored colors to Three colors.
- “`tier === 'reduced'` decides motion (no time-driven animation, no flicker, static look). `lowPower` decides cost and detail.” Composer is enabled by `!lowPower` plus capability, including reduced desktop.
- “A new field on `StopState` requires all four of these changes in the same commit”: type, four stop values, `lerpStop`, and interpolation assertions at p = 0, 0.5, 1.
- “New feature code goes in new modules under `app/journey/`.” Keep `scene.ts` below the 800-line soft ceiling; do not relocate unrelated scene code.
- “Anything with GPU resources (geometry, material, texture, render target, composer) is disposed in `JourneyScene.dispose()`.” Reuse the existing context loss and restore flow and verify it with real renders.
- “Unit tests (Vitest, Node, no GPU) live in `tests/journey/*.test.ts`”; “GPU tests live in `tests/gpu/*.spec.ts` and run with Playwright (Chromium, software WebGL2) through a new script `npm run test:gpu`.”
- “Resolution means drawing-buffer pixels. ‘1440p’ means a 2560 x 1440 drawing buffer, set explicitly with `renderer.setSize` and pixel ratio 1.” Performance is mean/p95 render cost with GPU synchronization, three physical-device runs before and after, comparing medians.
- “Capture them at the four chapters (`progress` 0 for each) and at one mid-transition frame, on desktop and on the iPhone 14 Pro Max emulation, in light and dark theme. Store them in the PR description, not in the repo.”
- `radius = 0.5`, `threshold = 1.0`, bloom disabled strictly below `0.01`; intro/projects/skills/about exposure = `1.00/1.00/1.10/1.25`, bloom = `0.00/0.12/0.28/0.42`.
- HDR samples: largest reported sample count at most `4`; empty supported-count list means `0` samples and is valid. No half-float support, query failure, or incomplete HDR/MSAA framebuffer means direct fallback.
- Emissive source contract: pre-fog linear Rec. 709 luminance at least `2.0`; this plan changes only `lampGlow` (`#ffdca8`, gain `2.8`) and courtyard windows (`#ffe1a8`, gain `2.7`). Facade gains and staggered-window shaders belong to specs 01/06.
- Plans only in this planning session: the checkboxes below are future execution work, not evidence that code, GPU tests, screenshots, physical performance, or commits already exist.

## Review Focus

1. Half-float exists but RGBA16F samples are unsupported or a multisample framebuffer is incomplete: fall back, leave no resource leak or pending handled GL error (Task 2).
2. Odd canvas sizes and DPR changes: bright-pass size equals `round(full drawing-buffer / 2)` once, and subsequent mips halve that result (Tasks 2/4).
3. Context restoration after resized night state: center and adjacent halo pixels recover, shader recorder remains empty, and sizing/exposure remain correct (Task 4).
4. Color conversion order and intermediate exposures: direct and composer agree for sky and fully fogged horizon; authored sRGB is neither double-linearized nor double-tone-mapped (Tasks 1/4).
5. Bloom disabled at intro followed by a night chapter: warm-up compiles every optional fullscreen program, and zero/subthreshold bloom creates no halo or pop (Tasks 2/3/4).

---

## Repository facts, dependencies, and decisions

All `Run:` and commit commands execute from `repos/portfolio` under the workspace root. File paths in **Files** are workspace-relative; import paths and Git pathspecs in commands are relative to that command working directory. Existing tests use Vitest's Node environment and discover only `tests/**/*.test.ts`; no GPU runner currently exists before spec 01.

Read the installed sources before implementation: `node_modules/three/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js`, `ShaderLib/meshbasic.glsl.js`, `webgl/WebGLMaterials.js`, `WebGLRenderer.js`, and `examples/jsm/postprocessing/{EffectComposer,UnrealBloomPass,OutputPass}.js`. Inspection for this plan confirmed:

- Neutral's offset is `x < 0.08 ? x - 6.25*x*x : 0.04`, compression starts at `0.8 - 0.04`, desaturation is `0.15`; the three spec example output hexes match r186.
- Built-in direct shaders perform tone mapping and sRGB conversion before fog. `WebGLMaterials` uploads fog in the unlit output color space, so supplying a CPU-mapped **sRGB** fog color using `setRGB(..., SRGBColorSpace)` achieves the intended fully fogged limit. Partially fogged object pixels need not match: blending before versus after a nonlinear curve differs.
- Render targets suppress built-in material tone mapping; keep `renderer.toneMapping = NeutralToneMapping` and let `OutputPass` read it. Keep `renderer.outputColorSpace = SRGBColorSpace` and target texture color space linear/default; do not switch renderer output space or set materials `toneMapped = false` to work around double processing.
- Supplying a target to `EffectComposer` makes the composer own that target and its clone. Its constructor treats supplied target dimensions as logical dimensions even though its DPR comes from the renderer; normalize the composer to DPR `1` immediately and use actual integer drawing-buffer dimensions for every composer resize. The public `setSize(width,height,pixelRatio)` still takes logical sizes/DPR, multiplying and flooring once internally. Passing full physical dimensions and retaining renderer DPR would scale twice.
- `composer.dispose()` frees its two targets and internal copy pass, but not user passes. `UnrealBloomPass.dispose()` frees its mip/bright targets, blur/composite/blend/basic materials and fullscreen quad, **but r186 omits `materialHighPassFilter`**; dispose that material explicitly. Do not dispose the original composer target twice merely because the spec prose mentions it separately.

Prerequisite ownership is strict. Spec 01 introduces `JourneySceneOptions` as the fourth `createJourneyScene(canvas, tier, projectItems, options = {})` argument, `lowPowerFor(input: TierInput): boolean`, `createShaderErrorRecorder(renderer)` / `getShaderErrorRecorder(renderer)`, initialized-instancing warm-up, runtime `unavailable` handling, and Playwright config/dependency/scripts. Its renderer observer `onRenderer?: (renderer: THREE.WebGLRenderer) => void` and post-warm-up `onSceneReady?: ({scene: THREE.Scene, camera: THREE.PerspectiveCamera}) => void` let the browser harness observe actual rendering resources. Do not recreate these in this plan or remove the existing third `ExhibitItem[]` argument.

Shared GPU foundation: `tests/gpu/harness.html`, `harness.ts`, `gpu-utils.ts`, `vite.gpu.config.ts`, browser `window.cityGpu`, and exported `createTestRenderer({width?, height?} = {}) -> {renderer, recorder, canvas, dispose}` from `gpu-utils.ts`. `cityGpu.mountJourney({tier,lowPower,width?,height?}, observers?: Pick<JourneySceneOptions,'onRenderer'|'onSceneReady'>)`, `renderJourney({chapter,progress?,time?,frames?})`, `getJourneyContext(): {scene: THREE.Scene,camera: THREE.PerspectiveCamera,renderer: THREE.WebGLRenderer}`, `diagnostics()`, `readFrame()`, `loseAndRestore()`, and `dispose()` remain facade-owned. Observer callbacks run after internal capture; onRenderer runs before any render and onSceneReady after validated warm-up. Diagnostics have `{shaderError: string|null, glError: number, calls: number, width: number, height: number, geometries: number, textures: number}`. Read the browser `getJourneyContext` method; never import `harness.ts` from a probe. Use a separate post feature module registered by the harness; keep helper imports acyclic. The scene observer supplies real near-building mesh/camera access; spec 01 names the meshes `journey-building-near/mid/far`.

Foundation component host methods on `cityGpu`: `mountComponent({failure:'none'|'creation',beforeMount?:()=>void}):Promise<void>`, `breakRestoredComponent(options?:{beforeRestore?:()=>void}):Promise<void>`, `componentStatus():{unavailable:number,visible:boolean,updatesAfterFailure:number,disposed:number}`, `unmountComponent():void`. A supplied restore callback replaces the facade fault; it must not inject two failing shaders. Post uses browser-local callbacks to install its own fullscreen fault. Foundation owns loading the actual Vue SFC and component disposal/RAF observations through a GPU-only Vite scene transform immediately after recorder creation; it captures/wraps actual renderer instance methods, never nonexistent renderer prototype methods. Shared `renderJourney` caches its frame bytes immediately after its final synchronous render; use that safe cache for later `cityGpu.readFrame()` calls, and always read post-fixture pixels in the same task as rendering.

Parallelism: Task 1 and the isolated factory/synthetic-fixture parts of Task 2 may start alongside spec 01 and spec 06's window-look helpers, in isolated branches. Tasks 3 and 4 require spec 01's shader recorder, options, warm-up, and GPU harness. Resolve shared `scene.ts`, `JourneyCanvas.vue`, and harness registration edits after spec 01 lands, serializing those integrations with spec 06; parallel planning does not make shared-file implementation conflict-free. Spec 06 extends facade uniforms; preserve its scene wiring when merging, and keep this plan's exposure/bloom fields as additions to the existing complete `StopState`.

The design's “all new code lives in post.ts” and “scene.ts gains about 12 lines” are organizational estimates, not literal line limits: required tests, two material multipliers, safe warm-up ordering, and context resize wiring require additional small edits. The bundle contingency's `tier !== 'lite'` condition conflicts with `lowPower`; use the shared low-power classification if the contingency is needed. A dynamic import would make today's synchronous scene factory asynchronous; do not silently change that interface. Measure the added lazy scene chunk; if over 30 KB gzip, record this unresolved architecture tradeoff for review and make an explicit separately reviewed loading change before claiming that bundle contingency is satisfied.

## File map

| File | Responsibility |
| --- | --- |
| `repos/portfolio/app/journey/post.ts` | Pure Neutral/color functions, owned lamp/courtyard constants, probe, composer factory/lifetime. |
| `repos/portfolio/app/journey/stops.ts` | Exposure/bloom state and chapter values. |
| `repos/portfolio/app/journey/interpolate.ts` | Explicit field interpolation. |
| `repos/portfolio/app/journey/scene.ts` | Renderer policy, initial-state-before-probe ordering, per-frame look, resize/disposal, two material gains. |
| `repos/portfolio/app/components/JourneyCanvas.vue` | Reuse foundation lowPower options; reapply resize on context restore. |
| `repos/portfolio/tests/journey/interpolate.test.ts` | Atomic state additions and exact interpolation tests. |
| `repos/portfolio/tests/journey/post.test.ts` | CPU curve/space/boundary/luminance and capability tests. |
| `repos/portfolio/tests/gpu/post-probe.ts` | Synthetic and actual-scene browser feature fixtures, pixels, target observation, faults, restoration. |
| `repos/portfolio/tests/gpu/post.spec.ts` | Browser assertions and tier matrix. |
| `repos/portfolio/tests/gpu/harness.ts` | One post extension import/registration, preserving foundation exports. |

### Task 1: Atomic exposure/bloom state and pure color contract

**Files:**
- Modify: `repos/portfolio/app/journey/stops.ts` (`StopState`, four `STOPS`).
- Modify: `repos/portfolio/app/journey/interpolate.ts` (`lerpStop`).
- Create: `repos/portfolio/app/journey/post.ts`.
- Modify: `repos/portfolio/tests/journey/interpolate.test.ts` (`state` helper and interpolation cases).
- Create: `repos/portfolio/tests/journey/post.test.ts`.

**Interfaces:**
- Consumes: `Vec3 = readonly [number, number, number]`, `hexToRgb(hex: string): Vec3`, `STOPS`, `lerpStop(a: StopState,b: StopState,p: number): StopState`.
- Produces: `StopState.exposure: number`, `StopState.bloomStrength: number`; `TONE_MAPPING = THREE.NeutralToneMapping`; `bloomEnabled(strength: number): boolean`; `neutralToneMap(rgbLinear: Vec3, exposure: number): [number,number,number]`; `skyForDirectPipeline(authoredSrgb: Vec3, exposure: number): [number,number,number]`; `POST_EMISSIVES` readonly lamp/courtyard hex/gain records.

- [ ] **Step 1: Write failing state, boundary, curve, and luminance tests.** Append the following concrete assertions; update the existing `state` helper to destructure/return `exposure` and `bloomStrength` alongside all existing fields.

```ts
// tests/journey/interpolate.test.ts
it('interpolates exposure and bloom at all required points', () => {
  expect(STOPS.map(s => [s.exposure, s.bloomStrength])).toEqual([
    [1, 0], [1, 0.12], [1.1, 0.28], [1.25, 0.42],
  ])
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i]!, b = STOPS[i + 1]!
    for (const p of [0, 0.5, 1]) {
      const got = lerpStop(a, b, p)
      expect(got.exposure).toBeCloseTo(a.exposure * (1 - p) + b.exposure * p, 12)
      expect(got.bloomStrength).toBeCloseTo(a.bloomStrength * (1 - p) + b.bloomStrength * p, 12)
    }
  }
  expect(dampState(STOPS[0]!, STOPS[3]!, 1).exposure).toBe(1.25)
})
```

```ts
// tests/journey/post.test.ts
import { describe, expect, it } from 'vitest'
import { Color, ShaderChunk, SRGBColorSpace } from 'three'
import { STOPS, hexToRgb } from '../../app/journey/stops'
import { bloomEnabled, neutralToneMap, POST_EMISSIVES, skyForDirectPipeline } from '../../app/journey/post'

describe('post color contract', () => {
  it('disables bloom strictly below the boundary', () => {
    expect(bloomEnabled(0)).toBe(false)
    expect(bloomEnabled(0.009999)).toBe(false)
    expect(bloomEnabled(0.01)).toBe(true)
    expect(bloomEnabled(0.42)).toBe(true)
  })
  it.each([
    ['#bfdbfe', 1, '#b2cdef'], ['#fbbf9f', 1, '#eeb393'], ['#1e2340', 1.25, '#05133f'],
  ] as const)('maps %s at exposure %s', (input, exposure, output) => {
    const got = skyForDirectPipeline(hexToRgb(input), exposure)
    const expected = hexToRgb(output)
    got.forEach((v, i) => expect(Math.abs(v - expected[i]!)).toBeLessThanOrEqual(1 / 255))
  })
  it('pins the mirror to the installed shader curve', () => {
    const shader = ShaderChunk.tonemapping_pars_fragment
    for (const text of ['vec3 NeutralToneMapping', '0.8 - 0.04', 'Desaturation = 0.15',
      'x < 0.08 ? x - 6.25 * x * x : 0.04', 'color *= toneMappingExposure']) {
      expect(shader).toContain(text)
    }
  })
  it('uses linear input, forward mapping, and sRGB output at every exposure', () => {
    for (const stop of STOPS) for (const rgb of [stop.skyColor, stop.fogColor]) {
      for (const exposure of [...STOPS.map(s => s.exposure), 1.05, 1.15, 1.2]) {
        const linear = new Color().setRGB(...rgb, SRGBColorSpace).toArray() as [number, number, number]
        const output = new Color()
        new Color().setRGB(...neutralToneMap(linear, exposure)).getRGB(output, SRGBColorSpace)
        const expected = output.toArray()
        skyForDirectPipeline(rgb, exposure).forEach((v, i) => {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(1)
          expect(Math.abs(v - expected[i]!)).toBeLessThanOrEqual(1 / 255)
        })
      }
    }
    expect(neutralToneMap([0, 0, 0], 1.25)).toEqual([0, 0, 0])
    expect(neutralToneMap([0.08, 0.08, 0.08], 1)).toEqual([0.04, 0.04, 0.04])
    neutralToneMap([10, 5, 2], 1.25).forEach(v => expect(Number.isFinite(v)).toBe(true))
  })
  it('owned source gains satisfy pre-fog linear luminance, and facade contract remains compatible', () => {
    for (const source of [...Object.values(POST_EMISSIVES), { hex: 0xffe1a8, gain: 2.7 }]) {
      const c = new Color(source.hex).multiplyScalar(source.gain)
      expect(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b).toBeGreaterThanOrEqual(2)
    }
  })
})
```

- [ ] **Step 2: Run to prove these assertions fail before implementation.**

Run: `npm test -- tests/journey/interpolate.test.ts tests/journey/post.test.ts`
Expected: missing `post.ts` exports and missing exposure/bloom fields; existing tests continue to be discovered.

- [ ] **Step 3: Add both fields everywhere in the same change, then implement the exact CPU mirror.**

```ts
// Add to StopState:
exposure: number
bloomStrength: number
// Add respectively to intro/projects/skills/about objects:
// exposure: 1, bloomStrength: 0
// exposure: 1, bloomStrength: 0.12
// exposure: 1.1, bloomStrength: 0.28
// exposure: 1.25, bloomStrength: 0.42
// Add inside lerpStop's existing return object:
exposure: lerp(a.exposure, b.exposure, p),
bloomStrength: lerp(a.bloomStrength, b.bloomStrength, p),
```

```ts
// app/journey/post.ts
import * as THREE from 'three'
import type { Vec3 } from './stops'
export const TONE_MAPPING = THREE.NeutralToneMapping
export const POST_EMISSIVES = {
  lamp: { hex: 0xffdca8, gain: 2.8 },
  courtyard: { hex: 0xffe1a8, gain: 2.7 },
} as const
export function bloomEnabled(strength: number): boolean { return strength >= 0.01 }
export function neutralToneMap(rgbLinear: Vec3, exposure: number): [number, number, number] {
  let c = rgbLinear.map(v => v * exposure) as [number, number, number]
  const x = Math.min(...c)
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04
  c = c.map(v => v - offset) as [number, number, number]
  const peak = Math.max(...c)
  const start = 0.8 - 0.04
  if (peak < start) return c
  const d = 1 - start
  const newPeak = 1 - d * d / (peak + d - start)
  const g = 1 - 1 / (0.15 * (peak - newPeak) + 1)
  return c.map(v => (v * newPeak / peak) * (1 - g) + newPeak * g) as [number, number, number]
}
export function skyForDirectPipeline(authoredSrgb: Vec3, exposure: number): [number, number, number] {
  const linear = new THREE.Color().setRGB(...authoredSrgb, THREE.SRGBColorSpace)
  const mapped = neutralToneMap([linear.r, linear.g, linear.b], exposure)
  const color = new THREE.Color().setRGB(...mapped)
  const output = color.getRGB(new THREE.Color(), THREE.SRGBColorSpace)
  return [output.r, output.g, output.b]
}
```

CPU color helpers allocate only a few colors per frame; first meet the phone render-cost budget, then optimize allocations if measurement requires it. Do not alter the curve or authored hex values to force old pixels; the intended palette is `T(authored)`.

- [ ] **Step 4: Verify all Node tests and type checking.**

Run: `npm test` then `npm run typecheck`.
Expected: new assertions and existing endpoint/state tests pass; every `StopState` producer satisfies the complete type.

- [ ] **Step 5: Commit the atomic state/math deliverable.**

```bash
git add app/journey/stops.ts app/journey/interpolate.ts app/journey/post.ts tests/journey/interpolate.test.ts tests/journey/post.test.ts
git commit -m "feat: add chapter exposure and neutral tone mapping math"
```

### Task 2: HDR composer, concrete capability fallback, and lifetime

**Files:**
- Modify: `repos/portfolio/app/journey/post.ts`.
- Modify: `repos/portfolio/tests/journey/post.test.ts`.
- Create: `repos/portfolio/tests/gpu/post-probe.ts`.
- Create: `repos/portfolio/tests/gpu/post.spec.ts`.
- Modify: `repos/portfolio/tests/gpu/harness.ts` (extension registration only, after foundation).

**Interfaces:**
- Consumes: Task 1 exports; foundation `getShaderErrorRecorder(renderer): ShaderErrorRecorder | undefined`, `ShaderErrorRecorder.assertClean(): void`; `createTestRenderer` from `tests/gpu/gpu-utils.ts`.
- Produces: `PostPipeline { render(): void; setSize(width: number,height: number,pixelRatio: number): void; setLook(exposure: number,bloomStrength: number): void; dispose(): void }`; `PostSupport = {samples: number} | null`; `probePostSupport(renderer: THREE.WebGLRenderer): PostSupport`; `PostTargets = {composer: EffectComposer,bloom: UnrealBloomPass,output: OutputPass}`; `PostPipelineOptions = {probeSupport?: typeof probePostSupport,onTargets?: (targets: PostTargets) => void}`; `createPostPipeline(renderer,scene,camera,options?: PostPipelineOptions): PostPipeline | null`.
- Browser extension: `window.cityPost.synthetic({width,height,pixelRatio,luminance,strength,exposure?,fault?: 'half-float'|'samples'|'framebuffer'})` returns `{pipeline:'composer'|'direct',center:number[],adjacent:number[],sizes:{full:[number,number],bright:[number,number],mips:[number,number][]}|null, shaderError:string|null,glError:number}`; fixture disposes everything after reading. `cityPost.lifetime()` returns `{counts:number[],expected:RendererState,created:RendererState,rendered:RendererState,thrown:RendererState,baselineTextures:number,remainingTextures:number,shaderError:string|null,glError:number}`; `RendererState = {targetRestored:boolean,color:number,alpha:number,auto:boolean,viewport:number[],scissor:number[],scissorTest:boolean}`. `cityPost.restoreSynthetic()` and `cityPost.actualChapter(...)` are added in Task 4.

- [ ] **Step 1: Add failing sample and browser fixture assertions.** Node tests use a narrow fake renderer only for the GL query, never for rendering:

```ts
// Add probePostSupport to the post imports.
it('chooses only supported RGBA16F sample counts <= 4 and accepts none', () => {
  function renderer(counts: number[]) {
    return {
      extensions: { has: () => true },
      getContext: () => ({ RENDERBUFFER: 0x8d41, RGBA16F: 0x881a, SAMPLES: 0x80a9,
        getInternalformatParameter: () => new Int32Array(counts) }),
    } as unknown as import('three').WebGLRenderer
  }
  expect(probePostSupport(renderer([8, 4, 2]))).toEqual({ samples: 4 })
  expect(probePostSupport(renderer([8, 2]))).toEqual({ samples: 2 })
  expect(probePostSupport(renderer([]))).toEqual({ samples: 0 })
})
it('rejects missing half-float extension and a failed sample query', () => {
  expect(probePostSupport({extensions:{has:()=>false}} as unknown as import('three').WebGLRenderer)).toBeNull()
  expect(probePostSupport({extensions:{has:()=>true},getContext:()=>({
    getInternalformatParameter:()=>{throw new Error('query unavailable')},
  })} as unknown as import('three').WebGLRenderer)).toBeNull()
})
```

```ts
// tests/gpu/post.spec.ts
import { expect, test } from '@playwright/test'
test.beforeEach(async ({ page }) => { await page.goto('/tests/gpu/harness.html') })
test('HDR threshold, zero-strength halo, exact half sizes, and handled fallback', async ({ page }) => {
  const run = (luminance: number, strength: number, fault?: 'half-float'|'samples'|'framebuffer') =>
    page.evaluate(async ({luminance,strength,fault}) => window.cityPost.synthetic({
      width:321, height:181, pixelRatio:2, luminance, strength, fault,
    }), {luminance,strength,fault})
  const on = await run(2, 0.4)
  expect(on.pipeline).toBe('composer')
  expect(on.sizes!.full).toEqual([642,362])
  expect(on.sizes!.bright).toEqual([321,181])
  expect(Math.max(...on.adjacent.slice(0,3))).toBeGreaterThan(0)
  const off = await run(2, 0)
  expect(off.adjacent.slice(0,3)).toEqual([0,0,0])
  const dim = await run(0.8, 0.4)
  expect(dim.adjacent.slice(0,3)).toEqual([0,0,0])
  for (const fault of ['half-float','samples','framebuffer'] as const) {
    const failed = await run(2, 0.4, fault)
    expect(failed.pipeline).toBe('direct')
    expect(failed.center.slice(0,3).some(v => v > 0)).toBe(true)
    expect(failed.adjacent.slice(0,3)).toEqual([0,0,0])
    expect(failed.glError).toBe(0)
    expect(failed.shaderError).toBeNull()
  }
  for (const result of [on,off,dim]) {
    expect(result.glError).toBe(0)
    expect(result.shaderError).toBeNull()
  }
})
```

- [ ] **Step 2: Run the failing tests.**

Run: `npm test -- tests/journey/post.test.ts`, then (after foundation harness exists) `npm run test:gpu -- tests/gpu/post.spec.ts`.
Expected: missing probe/factory/export or browser extension. A runner/harness absence before spec 01 lands is a prerequisite, not a verified red rendering test.

- [ ] **Step 3: Implement query, target checks, ownership, and render-state restoration.** Add addon imports for `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `OutputPass`, and the foundation recorder lookup. Use these definitions:

```ts
export interface PostPipeline {
  render(): void
  setSize(width: number, height: number, pixelRatio: number): void
  setLook(exposure: number, bloomStrength: number): void
  dispose(): void
}
export type PostSupport = { samples: number } | null
export interface PostTargets { composer: EffectComposer; bloom: UnrealBloomPass; output: OutputPass }
export interface PostPipelineOptions {
  probeSupport?: typeof probePostSupport
  onTargets?: (targets: PostTargets) => void
}
export function probePostSupport(renderer: THREE.WebGLRenderer): PostSupport {
  if (!(renderer.extensions.has('EXT_color_buffer_float') ||
    renderer.extensions.has('EXT_color_buffer_half_float'))) return null
  try {
    const gl = renderer.getContext() as WebGL2RenderingContext
    const counts = Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES) as Int32Array)
    const samples = Math.max(0, ...counts.filter(n => Number.isInteger(n) && n > 0 && n <= 4))
    return { samples }
  } catch { return null }
}
function drainProbeErrors(gl: WebGL2RenderingContext): void {
  if (gl.isContextLost()) throw new Error('[journey] context lost during post probe')
  while (gl.getError() !== gl.NO_ERROR) {
    if (gl.isContextLost()) throw new Error('[journey] context lost during post probe')
  }
}
```

The factory owns all allocation from the instant it begins. Capture and restore clear color/alpha, `autoClear`, logical viewport/scissor, scissor-test flag, and incoming target (including cube face/mip) in `finally` around both probe rendering and normal `render()`. This protects against addons whose normal return restores state but whose exception path does not. Fallback deliberately binds `null`, as specified, after freeing HDR resources; scene use always starts on the default framebuffer. Successful creation/render restores the caller's previous target.

```ts
export function createPostPipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene,
  camera: THREE.Camera, options: PostPipelineOptions = {}): PostPipeline | null {
  const gl = renderer.getContext() as WebGL2RenderingContext
  const recorder = getShaderErrorRecorder(renderer)
  recorder?.assertClean()
  if (gl.isContextLost()) throw new Error('[journey] context lost before post probe')
  if (gl.getError() !== gl.NO_ERROR) throw new Error('[journey] GL error before post probe')
  const support = (options.probeSupport ?? probePostSupport)(renderer)
  if (!support) { renderer.setRenderTarget(null); drainProbeErrors(gl); return null }
  const drawing = renderer.getDrawingBufferSize(new THREE.Vector2())
  const target = new THREE.WebGLRenderTarget(Math.max(1,drawing.x), Math.max(1,drawing.y), {
    type: THREE.HalfFloatType, samples: support.samples,
  })
  let composer: EffectComposer | undefined
  let bloom: UnrealBloomPass | undefined
  let output: OutputPass | undefined
  let renderPass: RenderPass | undefined
  let disposed = false
  function cleanup() {
    if (disposed) return
    disposed = true
    output?.dispose()
    if (bloom) { bloom.materialHighPassFilter.dispose(); bloom.dispose() }
    renderPass?.dispose()
    if (composer) composer.dispose() // owns target + clone + copyPass
    else target.dispose()
  }
  function preservingState<T>(action: () => T): T {
    const saved = {
      target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
      color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), auto: renderer.autoClear,
      viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()),
      scissorTest: renderer.getScissorTest(),
    }
    try { return action() } finally {
      renderer.setClearColor(saved.color, saved.alpha); renderer.autoClear = saved.auto
      renderer.setRenderTarget(saved.target, saved.face, saved.mip)
      renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor)
      renderer.setScissorTest(saved.scissorTest)
    }
  }
  try {
    composer = new EffectComposer(renderer, target)
    composer.setPixelRatio(1)
    composer.setSize(drawing.x, drawing.y)
    renderPass = new RenderPass(scene,camera)
    bloom = new UnrealBloomPass(drawing,0.5,0.5,1)
    output = new OutputPass()
    composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(output)
    const chain = composer, glow = bloom
    let complete = true
    preservingState(() => {
      chain.render() // forced bloom; caller has already applied instance matrices/camera
      recorder?.assertClean() // shader failure is never a capability fallback
      for (const rt of [chain.renderTarget1,chain.renderTarget2,glow.renderTargetBright]) {
        renderer.setRenderTarget(rt)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) complete = false
      }
      // Bloom mips use the same format but validate these allocations too.
      for (const rt of [...glow.renderTargetsHorizontal,...glow.renderTargetsVertical]) {
        renderer.setRenderTarget(rt)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) complete = false
      }
      if (gl.getError() !== gl.NO_ERROR) complete = false
    })
    if (!complete) { cleanup(); renderer.setRenderTarget(null); drainProbeErrors(gl); return null }
    options.onTargets?.({composer:chain,bloom:glow,output})
    return {
      render() { preservingState(() => chain.render()) },
      setSize(w,h,dpr) {
        // Match renderer's integer drawing-buffer allocation at fractional DPR.
        chain.setPixelRatio(1)
        chain.setSize(Math.max(1,Math.floor(w*dpr)),Math.max(1,Math.floor(h*dpr)))
      },
      setLook(exposure,strength) {
        renderer.toneMappingExposure = exposure
        glow.strength = strength; glow.enabled = bloomEnabled(strength)
      },
      dispose: cleanup,
    }
  } catch (error) {
    cleanup(); renderer.setRenderTarget(null)
    // Explicit shader/program/JS failures propagate to shared unavailable guard.
    throw error
  }
}
```

Do not call `composer.render()` and then check the default framebuffer: explicitly binding each actual target above checks HDR/MSAA allocation. Empty sample support is accepted; a sample-query exception or GL query error is handled as probe failure. If allocation throws before the addons can be fully constructed, dispose every successfully created resource and propagate the JS error; only identified capability failure is drained/converted to `null`. The inherited Three constructor's partial-allocation exception is not claimed as recoverable without evidence.

- [ ] **Step 4: Implement the synthetic browser fixture and attach it once.** `post-probe.ts` imports `createTestRenderer` from `gpu-utils.ts`, the factory, and Three. A black scene uses `OrthographicCamera(-1,1,1,-1,0.1,10)`, camera z = 2, and a `0.4 x 0.4` `PlaneGeometry` with `MeshBasicMaterial({color:new Color().setRGB(luminance,luminance,luminance)})`. Set renderer DPR/size and tone mapping/output space. Use `onTargets` to capture the actual target objects; on direct fallback call `renderer.render(scene,camera)`. A probe failure is injected via the factory's `probeSupport`; a framebuffer failure is injected by wrapping `gl.checkFramebufferStatus` for the factory call and restoring it in `finally`.

```ts
// Core of synthetic({width,height,pixelRatio,luminance,strength,exposure = 1,fault})
const fixture = createTestRenderer({width,height})
const {renderer,recorder} = fixture
renderer.setPixelRatio(pixelRatio); renderer.setSize(width,height,false)
renderer.toneMapping = TONE_MAPPING; renderer.outputColorSpace = THREE.SRGBColorSpace
const scene = new THREE.Scene(); scene.background = new THREE.Color(0)
const camera = new THREE.OrthographicCamera(-1,1,1,-1,0.1,10); camera.position.z = 2
const geometry = new THREE.PlaneGeometry(0.4,0.4)
const material = new THREE.MeshBasicMaterial({color:new THREE.Color().setRGB(luminance,luminance,luminance)})
scene.add(new THREE.Mesh(geometry,material))
let resources: PostTargets | undefined
const gl = renderer.getContext() as WebGL2RenderingContext
const originalStatus = gl.checkFramebufferStatus.bind(gl)
if (fault === 'framebuffer') gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_UNSUPPORTED
let post: PostPipeline | null = null
try {
  post = createPostPipeline(renderer,scene,camera,{
    probeSupport: fault === 'half-float' ? () => null : probePostSupport,
    onTargets: targets => {resources = targets},
  })
  post?.setLook(exposure,strength); renderer.toneMappingExposure = exposure
  if (post) post.render(); else renderer.render(scene,camera)
  recorder.assertClean()
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
  function pixel(x: number,y: number): number[] {
    const out = new Uint8Array(4)
    gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,out)
    return Array.from(out)
  }
  // Quad right edge is x = .6*w. Three pixels outside avoids raster coverage.
  return {pipeline:post?'composer':'direct', center:pixel(Math.floor(w/2),Math.floor(h/2)),
    adjacent:pixel(Math.ceil(w*0.6)+3,Math.floor(h/2)),
    sizes:resources?{full:[resources.composer.renderTarget1.width,resources.composer.renderTarget1.height],
      bright:[resources.bloom.renderTargetBright.width,resources.bloom.renderTargetBright.height],
      mips:resources.bloom.renderTargetsHorizontal.map(t=>[t.width,t.height])}:null,
    shaderError:recorder.error?.message??null, glError:gl.getError()}
} finally {
  gl.checkFramebufferStatus = originalStatus
  post?.dispose(); geometry.dispose(); material.dispose(); fixture.dispose()
}
```

Add explicit fixture input/return TypeScript types matching the Interfaces block and `declare global { interface Window { cityPost: typeof cityPost } }`. Register `window.cityPost = { synthetic }` from `post-probe.ts`; harness imports this feature registration after its common helper extraction, avoiding a harness/probe import cycle. Supply actual query-error GPU injection too: for `fault === 'samples'`, wrap `gl.getInternalformatParameter` to throw for RGBA16F and restore it in `finally`, then use the real `probePostSupport`. This proves query handling rather than only forcing `null`.

- [ ] **Step 5: Add lifetime and state restoration assertions and verify.** Extend the fixture with disposal event counters on original target, clone, all bloom targets, and high-pass/output/blur materials; assert each receives exactly one event across `post.dispose(); post.dispose()`. Count allocations with a clean fixture baseline, render again after cleanup to flush renderer bookkeeping, and compare `renderer.info.memory.textures` rather than claiming an absolute global GPU-memory measurement. Set a sentinel nondefault target, clear color/alpha, `autoClear=false`, viewport/scissor/test flag before successful factory creation and a successful/throwing render; assert they are restored. Inject a throwing `output.render` for the exception test and restore it in `finally`; assert the exception propagates and `dispose()` still works. Capability fallback expects the default target and zero GL error. Check the recorder before and after both enabled and disabled synthetic renders.

```ts
// Browser feature implementation, using imports already in post-probe.ts.
function lifetime() {
  const fixture = createTestRenderer({width:128,height:128})
  const {renderer,recorder} = fixture
  renderer.toneMapping = TONE_MAPPING
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50,1,0.1,10)
  camera.position.z = 2
  const sentinel = new THREE.WebGLRenderTarget(128,128)
  renderer.setRenderTarget(sentinel)
  const baselineTextures = renderer.info.memory.textures
  renderer.setClearColor(0x123456,0.4); renderer.autoClear = false
  renderer.setViewport(2,3,100,90); renderer.setScissor(4,5,80,70); renderer.setScissorTest(true)
  function state(): RendererState {
    return {targetRestored:renderer.getRenderTarget()===sentinel,
      color:renderer.getClearColor(new THREE.Color()).getHex(),alpha:renderer.getClearAlpha(),auto:renderer.autoClear,
      viewport:renderer.getViewport(new THREE.Vector4()).toArray(),scissor:renderer.getScissor(new THREE.Vector4()).toArray(),
      scissorTest:renderer.getScissorTest()}
  }
  const expected = state(), counts: number[] = []
  let targets: PostTargets | undefined, post: PostPipeline | null = null
  try {
    post = createPostPipeline(renderer,scene,camera,{onTargets:t=>{targets=t}})
    if (!post || !targets) throw new Error('lifetime test requires supported composer')
    const t = targets
    const owned = new Set([
      t.composer.renderTarget1,t.composer.renderTarget2,t.bloom.renderTargetBright,
      ...t.bloom.renderTargetsHorizontal,...t.bloom.renderTargetsVertical,
      t.output.material,t.bloom.materialHighPassFilter,...t.bloom.separableBlurMaterials,
      t.bloom.compositeMaterial,t.bloom.blendMaterial,
    ])
    for (const resource of owned) {
      const index = counts.push(0)-1
      resource.addEventListener('dispose',()=>{counts[index] = counts[index]!+1})
    }
    const created = state()
    post.setLook(1.25,0.42); post.render(); const rendered = state()
    const original = t.output.render
    t.output.render = () => {throw new Error('fixture output render failure')}
    let propagated = false
    try {post.render()} catch (error) {propagated = String(error).includes('fixture output render failure')}
    finally {t.output.render = original}
    if (!propagated) throw new Error('render exception was swallowed')
    const thrown = state()
    post.dispose(); post.dispose()
    renderer.setRenderTarget(sentinel); renderer.render(scene,camera)
    return {counts,expected,created,rendered,thrown,baselineTextures,
      remainingTextures:renderer.info.memory.textures,shaderError:recorder.error?.message??null,
      glError:renderer.getContext().getError()}
  } finally {post?.dispose(); sentinel.dispose(); fixture.dispose()}
}
```

```ts
test('owns each HDR resource once and restores renderer state on success and exception',async({page})=>{
  const r = await page.evaluate(()=>window.cityPost.lifetime())
  expect(r.counts.length).toBeGreaterThan(10)
  expect(r.counts.every(n=>n===1)).toBe(true)
  expect(r.created).toEqual(r.expected); expect(r.rendered).toEqual(r.expected); expect(r.thrown).toEqual(r.expected)
  expect(r.remainingTextures).toBe(r.baselineTextures)
  expect(r.glError).toBe(0); expect(r.shaderError).toBeNull()
})
```

Run: `npm test -- tests/journey/post.test.ts`, `npm run test:gpu -- tests/gpu/post.spec.ts`, `npm run typecheck`.
Expected: samples/fallback/threshold/pixels/sizes/disposal/state assertions pass on the real renderer; no GLSL errors. If software WebGL2 lacks required half-float support, report that environment limitation and obtain a supported browser run; do not label composer assertions as passing through skips.

- [ ] **Step 6: Commit the isolated rendering module and synthetic browser verification.**

```bash
git add app/journey/post.ts tests/journey/post.test.ts tests/gpu/post-probe.ts tests/gpu/post.spec.ts tests/gpu/harness.ts
git commit -m "feat: add probed HDR bloom pipeline with direct fallback"
```

### Task 3: Integrate actual scene look, owned source brightness, and warm-up

**Files:**
- Modify: `repos/portfolio/app/journey/scene.ts` (imports, market/courtyard materials, factory initialization/apply/update/resize/dispose).
- Modify: `repos/portfolio/app/components/JourneyCanvas.vue` (`onContextRestored` resize; reuse spec 01 mount options).
- Modify: `repos/portfolio/tests/gpu/post-probe.ts` (observed real-scene mounting/fallback cases).
- Modify: `repos/portfolio/tests/gpu/post.spec.ts`.

**Interfaces:**
- Consumes: spec 01 fourth `JourneySceneOptions` argument, `lowPowerFor`, recorder and existing guarded render loop; Task 2 `PostPipeline`/factory; complete interpolated `StopState`.
- Produces: same existing `JourneyScene` API (`update`, `resize`, `setTheme`, `dispose`), selecting composer only when `!lowPower` and capability succeeds. Existing lazy scene import remains synchronous after import. Both CPU/direct and composer honor the same chapter state.
- Browser observer fixture: `cityPost.mountActual({tier: Exclude<Tier,'none'>,lowPower:boolean,forceNoHalfFloat?:boolean,width:number,height:number}): void` captures renderer through `onRenderer` and scene/camera through `onSceneReady`; `cityPost.actualDiagnostics()` reports renderer output/exposure and shared diagnostics. `cityPost.disposeActual(): void` calls journey disposal once.

- [ ] **Step 1: Write failing integration tests for all device combinations and shader guard behavior.** Use actual-scene fixture with options below; observe real factory calls/targets only inside the browser test module, and count pipeline rendering through renderer calls instead of assuming the tier equals power class.

```ts
for (const input of [
  {tier:'full',lowPower:false,composer:true}, {tier:'lite',lowPower:true,composer:false},
  {tier:'reduced',lowPower:false,composer:true}, {tier:'reduced',lowPower:true,composer:false},
] as const) {
  test(`actual scene tone mapping and warm-up: ${input.tier}/${input.lowPower}`, async ({page}) => {
    const result = await page.evaluate(input => {
      window.cityPost.mountActual({...input,width:640,height:360})
      const states = [0,1,2,3].map(chapter => window.cityGpu.renderJourney({chapter,frames:180}))
      const actual = window.cityPost.actualDiagnostics()
      window.cityPost.disposeActual()
      return {states,actual}
    },input)
    result.states.forEach(d => {expect(d.shaderError).toBeNull();expect(d.glError).toBe(0)})
    expect(result.actual.toneMapping).toBe(result.actual.expectedToneMapping)
    expect(result.actual.exposure).toBeCloseTo(1.25,4)
    expect(result.actual.composer).toBe(input.composer)
  })
}
test('actual scene capability fallback remains renderable', async ({page}) => {
  const d = await page.evaluate(() => {
    window.cityPost.mountActual({tier:'full',lowPower:false,forceNoHalfFloat:true,width:640,height:360})
    window.cityGpu.renderJourney({chapter:3,frames:180})
    return window.cityPost.actualDiagnostics()
  })
  expect(d.composer).toBe(false); expect(d.glError).toBe(0); expect(d.shaderError).toBeNull()
})
```

Avoid hard-coding the enum `7` in the actual finished test if harness exports `TONE_MAPPING` in its diagnostic expected value; the assertion must compare the observed renderer setting with the installed Three enum. For actual pipeline detection, wrap captured renderer's `render` and count fullscreen renders with `material.name === 'OutputShader'` or inspect an OutputPass material's `NEUTRAL_TONE_MAPPING` define after rendering; direct scene rendering has no such output pass. Do not infer composition from a boolean input alone.

- [ ] **Step 2: Run the browser tests to prove current actual scene lacks tone mapping/composer.**

Run: `npm run test:gpu -- tests/gpu/post.spec.ts`.
Expected: real renderer/pipeline assertions fail until wiring; foundation recorder tests themselves remain passing.

- [ ] **Step 3: Add only scene wiring and the two owned material gains.** Keep facade uniforms driven by authored state sky. In `createMarket`/`createCourtyard` use shared tested source records:

```ts
const lampGlow = new THREE.MeshBasicMaterial({ color: POST_EMISSIVES.lamp.hex })
lampGlow.name = 'journey-lamp-glow'
lampGlow.color.multiplyScalar(POST_EMISSIVES.lamp.gain)
const windowMaterial = new THREE.MeshBasicMaterial({ color: POST_EMISSIVES.courtyard.hex })
windowMaterial.name = 'journey-courtyard-window'
windowMaterial.color.multiplyScalar(POST_EMISSIVES.courtyard.gain)
```

At renderer creation set `renderer.toneMapping = TONE_MAPPING` and `renderer.outputColorSpace = THREE.SRGBColorSpace`. Preserve low-power pixel ratio/count policy supplied by spec 01. Define `let post: PostPipeline | null = null` before `apply` or any initialization render. In `apply` use:

```ts
if (post) post.setLook(state.exposure,state.bloomStrength)
else renderer.toneMappingExposure = state.exposure
const skyRgb = post ? state.skyColor : skyForDirectPipeline(state.skyColor,state.exposure)
const fogRgb = post ? state.fogColor : skyForDirectPipeline(state.fogColor,state.exposure)
sky.setRGB(...skyRgb,THREE.SRGBColorSpace)
fog.color.setRGB(...fogRgb,THREE.SRGBColorSpace)
// Existing hemi and facade uSkyTint remain authored colors:
hemi.color.setRGB(...state.skyColor,THREE.SRGBColorSpace)
```

Extract the existing `resize` body into a local function used by creation and returned API; clamp positive sizes to avoid zero height/aspect from hidden initialization, and call `post?.setSize(w,h,renderer.getPixelRatio())` after renderer sizing. Before the factory's first probe render: apply current, resize the canvas to a positive initial logical size, and ensure camera position/look direction and changing instance matrices are initialized. Foundation's `frustumCulled=false` policy remains in force. Then create post only if `!lowPower`, reapply the current state (switching CPU-mapped colors back to authored HDR if composer succeeded), and perform the shared guarded warm-up:

```ts
apply(current)
resize(Math.max(1,canvas.clientWidth || window.innerWidth),Math.max(1,canvas.clientHeight || window.innerHeight))
post = lowPower ? null : createPostPipeline(renderer,scene,camera)
apply(current)
if (post) {
  post.setLook(current.exposure,0.5)
  post.render()
  recorder.assertClean()
  apply(current)
  post.render()
} else renderer.render(scene,camera)
recorder.assertClean()
if (renderer.getContext().getError() !== renderer.getContext().NO_ERROR) {
  throw new Error('[journey] WebGL warm-up failed')
}
```

Wrap allocation/initialization in the foundation scene cleanup path so probe or either warm-up failure disposes post, scene resources, recorder, and renderer before rethrow. Call foundation `options.onSceneReady` only after successful warm-up. In `update` render via `post ? post.render() : renderer.render(scene,camera)`, then the existing recorder check. In `dispose` run `post?.dispose()` before renderer disposal/context release, preserving foundation idempotence. Add `onResize()` after restore flags/timers are reset and before `start()` in `JourneyCanvas.vue`; retain current visible-time restore budget and event/listener cleanup.

- [ ] **Step 4: Implement actual fixture observation and verify runtime failures.** Capture renderer/scene/camera through the foundation callbacks when delegating `cityGpu.mountJourney`. For `forceNoHalfFloat`, replace only the captured renderer's extension `has` method for the two float extension names before factory probing, restore it in `finally` after mount (including failed mount), and check actual direct pixels/calls. Instrument output-pass execution only in the harness with a temporary renderer-render wrapper restored by fixture teardown. Warm-up test must observe a forced enabled bloom frame followed by disabled intro frame; inject an invalid fullscreen shader only in the browser fixture, ensure the recorder detects it on the forced frame, and creation fails through the same cleanup/unavailable path. A synthetic missing extension is a fallback; a shader error is a surfaced failure. Include a post-restore bad-shader runtime test through foundation error handling.

```ts
// post-probe.ts: mountActual and actualDiagnostics implementations.
let sawOutput = false
let restoreActualRenderer: (() => void) | undefined
function mountActual(input: {tier:'full'|'lite'|'reduced';lowPower:boolean;forceNoHalfFloat?:boolean;width:number;height:number}) {
  sawOutput = false
  let restoreExtension: (()=>void) | undefined
  try {
    window.cityGpu.mountJourney(input,{
      onRenderer(renderer) {
        const oldHas = renderer.extensions.has
        if (input.forceNoHalfFloat) {
          renderer.extensions.has = name => ['EXT_color_buffer_float','EXT_color_buffer_half_float'].includes(name)
            ? false : oldHas.call(renderer.extensions,name)
          restoreExtension = () => {renderer.extensions.has = oldHas}
        }
        const oldRender = renderer.render
        renderer.render = function(object,camera) {
          const mesh = object as THREE.Mesh
          const material = mesh.material
          if (mesh.isMesh && !Array.isArray(material) && material?.name === 'OutputShader') sawOutput = true
          return oldRender.call(renderer,object,camera)
        }
        restoreActualRenderer = () => {renderer.render = oldRender}
      },
    })
  } finally {restoreExtension?.()}
}
function actualDiagnostics() {
  const {renderer} = window.cityGpu.getJourneyContext()
  return {...window.cityGpu.diagnostics(),composer:sawOutput,toneMapping:renderer.toneMapping,
    exposure:renderer.toneMappingExposure,expectedToneMapping:TONE_MAPPING}
}
function disposeActual() {restoreActualRenderer?.(); restoreActualRenderer = undefined; window.cityGpu.dispose()}
```

Add source material luminance observation to `actualDiagnostics`: traverse actual meshes, collect each unique material named `journey-lamp-glow` or `journey-courtyard-window`, compute `0.2126*c.r+0.7152*c.g+0.0722*c.b`, return `{ownedLuminance:number[]}`. Assert exactly two unique records and all >=2 in the integration test. Compare `toneMapping` to `expectedToneMapping` in its test, replacing the illustrative literal enum.

Fullscreen shader faults must target a real OutputPass program, not facade programs. Three r186 creates `renderer.render` as an instance method; do not monkey-patch `WebGLRenderer.prototype.render`. RawShaderMaterial inherits `Material.prototype.onBeforeCompile`, which is an effective narrow test injection seam. Patch that callback for `this.name === 'OutputShader'` and leave other materials alone, then restore it after observed failure in `finally`:

```ts
let originalPostCompile: THREE.Material['onBeforeCompile'] | undefined
function installPostFault(stage: 'output'|'bloom' = 'output') {
  if (originalPostCompile) throw new Error('post fault already installed')
  const original = THREE.Material.prototype.onBeforeCompile
  originalPostCompile = original
  THREE.Material.prototype.onBeforeCompile = function(this: THREE.Material,shader,renderer) {
    original.call(this,shader,renderer)
    const isBloom = 'uniforms' in this && Boolean((this as THREE.ShaderMaterial).uniforms.luminosityThreshold)
    if ((stage === 'output' && this.name === 'OutputShader') || (stage === 'bloom' && isBloom)) {
      shader.fragmentShader += '\ninvalid_post_fullscreen_token;\n'
    }
  }
}
function restorePostFault() {
  if (originalPostCompile) THREE.Material.prototype.onBeforeCompile = originalPostCompile
  originalPostCompile = undefined
}
```

```ts
test('actual component emits unavailable for a post warm-up shader failure',async({page})=>{
  try {
    await page.evaluate(()=>window.cityGpu.mountComponent({failure:'none',beforeMount:()=>window.cityPost.installPostFault('bloom')}))
    await expect.poll(()=>page.evaluate(()=>window.cityGpu.componentStatus().unavailable)).toBe(1)
    const r = await page.evaluate(()=>window.cityGpu.componentStatus())
    expect(r.visible).toBe(false); expect(r.disposed).toBe(1); expect(r.updatesAfterFailure).toBe(0)
  } finally {
    await page.evaluate(()=>{window.cityPost.restorePostFault();window.cityGpu.unmountComponent()})
  }
})
test('actual component stops on post-program failure after restore',async({page})=>{
  try {
    await page.evaluate(()=>window.cityGpu.mountComponent({failure:'none'}))
    await expect.poll(()=>page.evaluate(()=>window.cityGpu.componentStatus().visible)).toBe(true)
    await page.evaluate(()=>window.cityGpu.breakRestoredComponent({beforeRestore:()=>window.cityPost.installPostFault('output')}))
    await expect.poll(()=>page.evaluate(()=>window.cityGpu.componentStatus().unavailable)).toBe(1)
    const first = await page.evaluate(()=>window.cityGpu.componentStatus())
    await page.waitForTimeout(100)
    const later = await page.evaluate(()=>window.cityGpu.componentStatus())
    expect(first.visible).toBe(false); expect(first.disposed).toBe(1)
    expect(later.updatesAfterFailure).toBe(first.updatesAfterFailure)
  } finally {
    await page.evaluate(()=>{window.cityPost.restorePostFault();window.cityGpu.unmountComponent()})
  }
})
```

Declare these post feature methods in the `cityPost` exported object so browser Window typing matches actual registration. Run fault cases with a desktop viewport/fine pointer and available half-float support; direct phones do not construct OutputPass and cannot exercise this negative case.

Run: `npm test`, `npm run test:gpu -- tests/gpu/post.spec.ts tests/gpu/facade.spec.ts`, `npm run typecheck`.
Expected: foundation and new scene paths pass without shader errors; reduced phones use direct, reduced desktops use composer, intro compiles bloom but renders with it disabled, and actual material gains retain >=2 luminance. Do not claim the invalid-shader negative case has an empty recorder: assert its expected recorded error and surfaced fallback.

- [ ] **Step 5: Commit the scene integration.**

```bash
git add app/journey/scene.ts app/components/JourneyCanvas.vue tests/gpu/post-probe.ts tests/gpu/post.spec.ts
git commit -m "feat: integrate chapter tone mapping and desktop selective bloom"
```

### Task 4: Pixel parity, actual facade halo, resize/context restoration, and evidence

**Files:**
- Modify: `repos/portfolio/tests/gpu/post-probe.ts`.
- Modify: `repos/portfolio/tests/gpu/post.spec.ts`.
- Modify only if measured tuning is required: `repos/portfolio/app/journey/stops.ts` (and matching asserted values); `repos/portfolio/app/journey/post.ts` (samples policy only if desktop budget fails).
- Review: `repos/portfolio/.output/public/_nuxt` after build; screenshots/physical measurements belong in the future PR, not source control.

**Interfaces:**
- Consumes: Task 2 target observations; Task 3 actual scene/camera observers; foundation `cityGpu.loseAndRestore()` and real-scene diagnostics/frames.
- Produces browser operations: `cityPost.parity({sky:Vec3,fog:Vec3,exposure:number}): {skyDelta:number[],fogDelta:number[],directSky:number[],composerSky:number[]}`; `cityPost.resizeSynthetic(): {sizes:[number,number][],expected:[number,number][]}`; `cityPost.restoreSynthetic(): Promise<{before:number[][],after:number[][],shaderError:string|null,glError:number}>`; `cityPost.actualChapter({chapter:2|3}): {windowDistance:number,on:number[][],off:number[][],shaderError:string|null,glError:number}`. Every operation owns and disposes its fixture.

- [ ] **Step 1: Add failing GPU parity, resizing, and restoration assertions.**

```ts
// Import STOPS at the Node test module top from '../../app/journey/stops'.
test('sky and fully fogged pixels agree at authored and intermediate exposures', async ({page}) => {
  const inputs = STOPS.flatMap(stop => [stop.exposure,1.05,1.15,1.2].map(exposure =>
    ({sky:stop.skyColor,fog:stop.fogColor,exposure})))
  const deltas = await page.evaluate(inputs => inputs.map(input => window.cityPost.parity(input)),inputs)
  for (const p of deltas) for (const delta of [...p.skyDelta,...p.fogDelta]) expect(delta).toBeLessThanOrEqual(3)
})
test('initial, odd resize, and DPR change retain half-sized bright pass', async ({page}) => {
  const r = await page.evaluate(() => window.cityPost.resizeSynthetic())
  expect(r.sizes).toEqual(r.expected)
})
test('night halo and center survive real context loss after resize', async ({page}) => {
  const r = await page.evaluate(() => window.cityPost.restoreSynthetic())
  for (let p = 0; p < r.before.length; p++) for (let c = 0; c < 3; c++) {
    expect(Math.abs(r.before[p]![c]! - r.after[p]![c]!)).toBeLessThanOrEqual(3)
  }
  expect(Math.max(...r.before[1]!.slice(0,3))).toBeGreaterThan(0)
  expect(Math.max(...r.after[1]!.slice(0,3))).toBeGreaterThan(0)
  expect(r.shaderError).toBeNull(); expect(r.glError).toBe(0)
})
for (const chapter of [2,3] as const) test(`real near facade halo in chapter ${chapter}`, async ({page}) => {
  const r = await page.evaluate(chapter => window.cityPost.actualChapter({chapter}),chapter)
  expect(r.windowDistance).toBeLessThanOrEqual(10)
  expect(r.on[1]!.slice(0,3).reduce((a,b)=>a+b,0)).toBeGreaterThan(r.off[1]!.slice(0,3).reduce((a,b)=>a+b,0))
  expect(r.shaderError).toBeNull(); expect(r.glError).toBe(0)
})
```

Run all synthetic enabled/disabled shader/halo cases for `full`, `lite`, `reduced + lowPower=false`, `reduced + lowPower=true`; direct cases expect no halo. Run the actual-scene chapter matrix as well. Low-power alone is not a rendering tier; retain both inputs in names and observations.

- [ ] **Step 2: Run to verify unimplemented operations fail.**

Run: `npm run test:gpu -- tests/gpu/post.spec.ts`.
Expected: missing parity/resize/restore/actualChapter fixture operations fail; existing synthetic/integration tests still pass.

- [ ] **Step 3: Implement deterministic parity and sizing operations using real rendering.** For parity, use a small orthographic fixture: background authored sky; plane filling the lower half at camera view depth 9 with `FogExp2(authoredFog,1)` (fog factor effectively 1), material luminance 0.2, upper half unobstructed. Render composer with bloom disabled and authored sky/fog; capture upper/lower center pixels. Dispose composer, write CPU-mapped sky/fog with explicit sRGB, render direct, capture same pixels, return absolute RGB byte differences. Compare composer sky to `skyForDirectPipeline` bytes within 3 as a separate assertion, ensuring two wrong pipelines cannot agree with each other.

```ts
const expectedSky = skyForDirectPipeline(sky,exposure).map(v=>Math.round(v*255))
const skyDelta = composerSky.slice(0,3).map((v,i)=>Math.abs(v-directSky[i]!))
const fogDelta = composerFog.slice(0,3).map((v,i)=>Math.abs(v-directFog[i]!))
if (composerSky.slice(0,3).some((v,i)=>Math.abs(v-expectedSky[i]!)>3)) {
  throw new Error('OutputPass differs from CPU Neutral reference')
}
```

Use the actual chapter fixture too: settle 180 frames at each chapter, read an unobstructed sky pixel and a verified far opaque/fully fogged pixel; render directly with CPU-mapped colors on the **same** observed scene/camera, save/restore those colors, compare within 3. Pick points by depth/scene projection, not a hardcoded screen coordinate that can land on a building; require coverage of all four chapters. For partially fogged surfaces document the expected order-dependent difference rather than enforcing impossible universal pixel parity.

For `resizeSynthetic`, initialize at `(320,180,DPR1)`, then renderer and post setSize `(321,181,DPR1)`, then `(321,181,DPR2)`, then `(257,129,DPR1.5)`. Always read actual `gl.drawingBufferWidth/Height`; `Math.floor(logical*DPR)` determines renderer size and target integer conversion. Expected bright dimensions are `Math.round(actual drawing/2)` in each axis. Task 2 keeps composer DPR1 and feeds the allocated full integer drawing-buffer dimensions, so bloom halves that once rather than a fractional pre-allocation size.

- [ ] **Step 4: Implement context restore and actual facade selection; never substitute synthetic for real scene coverage.** Register one-shot lost/restored event promises **before** calling the extension, preventDefault on loss, call `restoreContext` after the lost event, await restored event, reapply renderer/post size, then `post.setLook(1.25,0.42)` and render. Capture source center and three neighboring halo samples before and after at resized `(321,181,DPR2)`; verify both amplitude and persistence. For direct fixture, repeat with no post; include actual `cityGpu.loseAndRestore` runs in both power paths and ensure retained chapter exposure after resize. If `WEBGL_lose_context` is absent, record unsupported coverage and run in a browser where it exists before completion.

Actual facade halo requires spec 01. Select `scene.getObjectByName('journey-building-near')` as an `InstancedMesh`, iterate active `mesh.count` instances, get instance/world transforms, and enumerate side-face window centers using the real `CELL=[0.16,0.22]`, local window center `[0.5,0.5]`. Restrict to world distance <=10 and viewport-visible centers. Verify projection visibility with a raycast that hits the same near mesh/instance; never choose the brightest whole-screen pixel, which can be a lamp. Determine lit status from the actual direct-rendered center and nearby wall pixel (center is brighter by at least 30 RGB-byte luminance and has total RGB >=300), rather than inventing a production hash helper or assuming spec 01's `hash < ratio` still describes spec 06's occupancy. This follows the real shader when spec 06 is integrated and requires no undeclared uniform/hash exports. Freeze chapter/time while comparing. Derive the outside-neighbor pixel by projecting the window rectangle edge and moving 1–3 physical pixels outside it; require a point on the wall outside the window, not a fixed offset inside a large window. Compare that neighbor under composer and direct on the same scene/camera and same state; record candidate distance/cell/instance/sample coordinates on failure. If no near/visible/lit source meets the predicate, fail with diagnostics; after foundation lands this is required, not a permanent skip.

```ts
// Candidate construction in actualChapter, after observing scene/camera/renderer.
const near = scene.getObjectByName('journey-building-near') as THREE.InstancedMesh
if (!near?.isInstancedMesh) throw new Error('actual near facade mesh missing')
near.computeBoundingSphere() // explicit current bounds for raycasts, not rendering culling
const transform = new THREE.Matrix4(), world = new THREE.Matrix4(), scale = new THREE.Vector3()
const ray = new THREE.Raycaster()
for (let instance = 0; instance < near.count; instance++) {
  near.getMatrixAt(instance,transform); world.multiplyMatrices(near.matrixWorld,transform)
  scale.setFromMatrixScale(transform)
  for (const face of ['x','z'] as const) for (const sign of [-1,1]) {
    const width = face === 'x' ? scale.z : scale.x
    for (let cellX = Math.ceil(-width / 2 / 0.16); cellX < width / 2 / 0.16 - 0.5; cellX++) {
      for (let cellY = 0; (cellY+0.82)*0.22 < scale.y; cellY++) {
        const u = (cellX+0.5)*0.16, y = (cellY+0.5)*0.22
        const local = face === 'x'
          ? new THREE.Vector3(sign*0.5,y/scale.y-0.5,u/scale.z)
          : new THREE.Vector3(u/scale.x,y/scale.y-0.5,sign*0.5)
        const point = local.clone().applyMatrix4(world)
        if (point.distanceTo(camera.position)>10) continue
        const clip = point.clone().project(camera)
        if (Math.abs(clip.x)>0.95 || Math.abs(clip.y)>0.95 || Math.abs(clip.z)>1) continue
        ray.setFromCamera(new THREE.Vector2(clip.x,clip.y),camera)
        const hit = ray.intersectObjects(scene.children,true)[0]
        if (hit?.object !== near || hit.instanceId !== instance) continue
        // Store this geometric cell candidate; center/wall pixels from the
        // direct reference decide whether its real shader output is lit.
        candidates.push({instance,face,sign,cellX,cellY,point,world:world.clone(),scale:scale.clone()})
      }
    }
  }
}
```

Define `candidates` locally with the explicit shape shown by the object literal; test nonempty and report candidate count on failure. Recompute current bounding spheres for every instanced mesh before selecting with raycasts, since disabling render culling does not update raycast bounds. Filter raycast occluders to opaque meshes; star Points cannot block a facade. For wall sample use cell-local `u=0.05` (outside `[0.2,0.8]`) and y=0.5; for halo neighbor use projected right window edge at local u=0.8, then step outward 1–3 pixels only if raycast still identifies the same instance wall. Read bytes immediately after each render. Save/restore authored sky/fog in `finally`. Capturing on/off with identical matrices/light state isolates bloom; keep `uTime` identical through any integrated spec 06 flicker. The deterministic lit predicate is:

```ts
function byteLuminance(pixel: readonly number[]): number {
  return 0.2126*pixel[0]! + 0.7152*pixel[1]! + 0.0722*pixel[2]!
}
function isObservedLitWindow(center: readonly number[],wall: readonly number[]): boolean {
  return center[0]!+center[1]!+center[2]! >= 300 && byteLuminance(center)-byteLuminance(wall) >= 30
}
```

- [ ] **Step 5: Finish automated checks and capture review evidence.**

Run: `npm test`, `npm run test:gpu`, `npm run typecheck`, `npm run build`.
Expected: complete CPU and real-GPU suites, typecheck, and production build succeed; no recorder/GL errors in positive cases. Check initial/day/night pass sizes and compiled optional passes in logged browser diagnostics. Compare added composer/bloom/output imports in lazy scene output using gzip sizes against the pre-feature commit, recording the actual delta and 30 KB contingency.

Capture before/after intro tone-mapped palette, all four chapters and one projects-to-skills midpoint on desktop/iPhone 14 Pro Max emulation in both themes; compare horizon pixels and verify only emissive halos, none on intro/sky/walls. Report artifact paths/PR attachments and authored values actually used. Retune exposure/strength only if screenshots justify it, updating interpolation expected values atomically; do not change facade emissive ownership.

For performance reuse spec 01's development-only `tests/gpu/render-cost.ts` and `cityGpu.measureJourney({chapter,durationMs?:number}):Promise<RenderCost>` instead of introducing another benchmark. It times the actual update/render path plus 1x1 sync readback, excluding adapter diagnostics from each sample, and includes optional GPU queries. Collect mean/p95 for chapters 0/2/3, rejecting disjoint GPU samples. Set **drawing buffer** 2560x1440, DPR1 on a named desktop. Measure actual physical iPhone direct path; run before/after three times each and compare medians: composer <= +2 ms, phone direct <= +0.5 ms. Emulator/SwiftShader results cannot satisfy these budgets. If unavailable, record physical performance as outstanding verification; do not claim measured success. If desktop cost fails, try max samples `2` with the same completeness probe, then rerun pixels/performance and document the measured tradeoff. The shared benchmark remains harness-only and excluded from production builds.

```ts
// Browser console on the development harness, once on each before/after checkout.
window.cityGpu.mountJourney({tier:'full',lowPower:false,width:2560,height:1440})
const desktopRuns = []
for (const chapter of [0,2,3]) for (let run=0;run<3;run++) {
  desktopRuns.push({chapter,run,...await window.cityGpu.measureJourney({chapter,durationMs:10000})})
}
console.table(desktopRuns)
// On the physical phone choose its real logical dimensions with renderer DPR1
// in this harness and record the resulting drawing-buffer size in the report.
window.cityGpu.mountJourney({tier:'lite',lowPower:true,width:window.innerWidth,height:window.innerHeight})
const phoneRuns = []
for (const chapter of [0,2,3]) for (let run=0;run<3;run++) {
  phoneRuns.push({chapter,run,...await window.cityGpu.measureJourney({chapter,durationMs:10000})})
}
console.table(phoneRuns)
```

- [ ] **Step 6: Commit browser coverage and any evidence-based tuning.**

```bash
git add tests/gpu/post-probe.ts tests/gpu/post.spec.ts
git commit -m "test: verify bloom parity resize and context recovery"
```

If production tuning changed state or sample policy, commit those named production/test files with their matching updated tests as a separate reviewed `perf:` or `fix:` change; do not stage generated `.output` or screenshots.

## Self-review performed for this plan

- Coverage mapped: tone curve/palette/exposure/interpolation and owned source luminance -> Task 1; float/MSAA/FBO selection, fallback, half bloom sizing, addon ownership/state -> Task 2; shared flag, initialized scene, optional-pass warm-up/runtime failure, apply/resize/dispose and restore resizing -> Task 3; synthetic/real halos, threshold/tier matrix, direct/composer sky/fully fogged parity, restore, screenshot/build/bundle/physical budgets -> Task 4.
- Interface review: synchronous scene factory and its third project argument preserved; foundation has one owner; new post factory observer and probe injection are explicitly defined; four PostPipeline methods match the spec; complete StopState changes land atomically while shared scene integration preserves plan 06's facade uniform wiring.
- Five Review Focus conditions each have concrete owning assertions. Real GPU tests inspect actual passes and pixels; CPU tests make no GLSL-compilation claim.
- Execution evidence remains future work. Physical device performance, screenshot palette approval, real near-window selection, and bundle contingency depend on the execution environment; the plan records them as gates, not fabricated successes.
