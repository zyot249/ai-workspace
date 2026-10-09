# City 06: Staggered Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement spec 06 Parts A/B: deterministic building occupancy, smoothly revealed windows, calibrated window colors, and reduced-motion-safe flicker; retain spec 01 glass until spec 04 exists.

**Architecture:** Put CPU mirrors, constants, colors, and uniform mapping in `window-look.ts`; extend the real spec 01 facade patch and its existing shared uniforms. Reuse the spec 01 shader recorder and browser harness, and sample the actual production material rather than a substitute hash shader. Part C is a separately gated follow-up that consumes spec 04's sun and world-normal inputs.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Three.js r186, Vitest 5, and the Playwright/Vite GPU harness introduced by spec 01.

**Spec:** `docs/superpowers/specs/2026-10-09-city-06-staggered-windows-design.md`; read `docs/superpowers/specs/2026-10-09-city-00-shared-conventions.md` and the selected specs 01/02 before execution. Part C additionally reads spec 04.

## Global Constraints

- `StopState` colors (`skyColor`, `fogColor`, and any new `Vec3` color) are sRGB values produced by `hexToRgb`.
- Patch built-in materials with `onBeforeCompile` and `replaceOrThrow(source, marker, replacement)` from `app/journey/shader-utils.ts`.
- Rule for every spec: `tier === 'reduced'` decides motion (no time-driven animation, no flicker, static look). `lowPower` decides cost and detail: extra render passes, MSAA render targets, shader variants, instance counts, and archetype sets.
- Unit tests (Vitest, Node, no GPU) live in `tests/journey/*.test.ts`.
- GPU tests live in `tests/gpu/*.spec.ts` and run with Playwright (Chromium, software WebGL2) through a new script `npm run test:gpu`.
- A fully lit, unfiltered window (fade amount 1) at chapters with bloom enabled (`windowLitRatio >= 0.3`) has linear luminance of at least 2.0 before fog, so it passes spec 02's threshold with margin.
- Cost: at most +0.2 ms on the named reference desktop and +0.2 ms on a physical iPhone (shared conventions, section 8).
- If spec 04 has not landed, skip the glint and Fresnel and keep spec 01's flat tint. The `full` variant only: `lowPower` keeps the flat tint.
- No installations, application changes, or commits are performed while authoring this plan. Commit commands below apply only during subsequent authorized implementation.

## Review Focus

1. A Float64 JavaScript hash can disagree with GLSL highp near threshold boundaries; Task 1 rounds every arithmetic intermediate, and Task 3 measures production shader hashes and decision agreement away from discontinuities.
2. A reduced-motion phone selects `reduced` while still being `lowPower`; Task 2 tests all four combinations and Task 3 proves its shader remains warm-only and stationary.
3. Dimming flicker by freezing time can freeze a permanently dim window; Tasks 1/3 assert an explicit zero gate yields exactly the non-flickering brightness at every phase.
4. Changing the light model can bypass the existing distance mask; Tasks 2/3 assert occupancy and emission retain the spec 01 window coverage and distance attenuation, including the lowest luminance exception for filtered windows.
5. A context restore can rebuild the wrong shader variant or lose chapter/time state; Task 3 performs real restore/render cycles at the same fixed state and compares the pattern and shader errors.

---

## Scope, dependencies, and repository findings

The selected batch is specs **01 + 02 + 06**. Spec 04 has not landed. Tasks 1–4 complete the useful, independently verifiable A/B slice. **Full spec 06 Part C remains conditional and incomplete until Task 5's external dependency exists.** Do not implement spec 04, introduce unused sun uniforms, or declare glass/glint acceptance passed in this batch.

Current code is `repos/portfolio/app/journey/scene.ts` (692 lines), with separate window quads and ignored `_t` in `update`. There is no `facade-material.ts`, shader recorder, or GPU harness yet. Spec 01 must supply them before Tasks 2/3 integrate. Three.js is installed at r186; `ShaderLib.standard` has `<color_fragment>`, `<emissivemap_fragment>`, and `<dithering_fragment>`. The r186 fragment initializes `totalEmissiveRadiance` before `<color_fragment>`; `<emissivemap_fragment>` precedes lighting accumulation. Capture diagnostics after `<dithering_fragment>` to avoid tone mapping/fog hiding the raw quantities under test. Vitest only discovers `tests/**/*.test.ts`; `.spec.ts` browser tests are separate.

Task 1 can run concurrently with specs 01/02 in an isolated branch. Shared writes to `facade-material.ts`, `scene.ts`, and `tests/gpu/harness.ts` must serialize after the spec 01 foundation and reconcile spec 02's render path. Spec 06 owns window colors/gains; spec 02 owns tone mapping/bloom and enforces the luminance contract. Do not modify `post.ts`, bloom strengths, exposures, or new stop fields as part of this plan.

All file paths below are **workspace-relative**. Every npm/git command states its working directory explicitly as `repos/portfolio` through `cd repos/portfolio && ...`.

## File structure and shared interfaces

| File | Responsibility |
| --- | --- |
| `repos/portfolio/app/journey/window-look.ts` | Pure hashes, occupancy, palette calibration, flicker mirror, uniform mapping, shared constants. |
| `repos/portfolio/app/journey/facade-material.ts` | Existing production shader patch, new numeric uniforms, variant cache keys, opt-in test diagnostics. |
| `repos/portfolio/app/journey/scene.ts` | Initialize and update the three new uniforms without changing post rendering. |
| `repos/portfolio/tests/journey/window-look.test.ts` | Deterministic CPU statistics, color/luminance, motion mapping. |
| `repos/portfolio/tests/journey/facade-material.test.ts` | Existing real-r186 patch tests, expanded for windows. |
| `repos/portfolio/tests/gpu/windows-probe.ts` | Browser fixture that constructs the production facade material and samples real renders. |
| `repos/portfolio/tests/gpu/windows.spec.ts` | Occupancy, hashes, hues, flicker, filtering, tiers, restore. |
| `repos/portfolio/tests/gpu/harness.ts` | Register the window fixture and opt-in benchmark alongside spec 01 methods. |

Keep `facade-material.ts` below about 400 lines. If the extension exceeds this, move its GLSL strings unchanged to `repos/portfolio/app/journey/facade-glsl.ts` in Task 2 and update that task's imports/tests together; do not restructure unrelated scene code.

Spec 01 interfaces consumed verbatim:

```ts
interface JourneySceneOptions {
  lowPower?: boolean
  onRenderer?: (renderer: THREE.WebGLRenderer) => void
  onSceneReady?: (context: { scene: THREE.Scene; camera: THREE.PerspectiveCamera }) => void
}
createJourneyScene(canvas, tier, projectItems, options): JourneyScene
createFacadeMaterial({ color, uniforms, variant }): THREE.MeshStandardMaterial
type FacadeVariant = 'full' | 'lite'
createShaderErrorRecorder(renderer): {
  readonly error: Error | null
  assertClean(): void
  dispose(): void
}
getShaderErrorRecorder(renderer): ReturnType<typeof createShaderErrorRecorder> | undefined
```

Preserve the existing third `readonly ExhibitItem[]` argument. Spec 01's browser harness lives at `http://127.0.0.1:4175/tests/gpu/harness.html`, served by `npm run test:gpu:serve` with `vite.gpu.config.ts`, and exports:

```ts
window.cityGpu.mountJourney({ tier, lowPower, width?, height? }): void
window.cityGpu.renderJourney({ chapter, progress?, time?, frames? }): GpuDiagnostics
window.cityGpu.diagnostics(): GpuDiagnostics
window.cityGpu.readFrame(): number[]
window.cityGpu.resizeJourney(width:number,height:number):void
window.cityGpu.loseAndRestore(): Promise<GpuDiagnostics>
window.cityGpu.dispose(): void
window.cityGpu.getJourneyContext(): { scene:THREE.Scene; camera:THREE.PerspectiveCamera; renderer:THREE.WebGLRenderer }
window.cityGpu.measureJourney({chapter,durationMs?}): Promise<{
  meanMs:number;p95Ms:number;samples:number;gpuMeanMs:number|null;gpuP95Ms:number|null;disjoint:boolean
}>
// Export from tests/gpu/gpu-utils.ts:
createTestRenderer({ width?, height? } = {}): { renderer, recorder, canvas, dispose }
// GpuDiagnostics fields:
// shaderError: string|null; glError,calls,width,height,geometries,textures: number
```

### Task 1: Define deterministic occupancy and the calibrated window look

**Files:**
- Create: `repos/portfolio/app/journey/window-look.ts`
- Create: `repos/portfolio/tests/journey/window-look.test.ts`

**Interfaces:**
- Consumes: `StopState.windowLitRatio`, `Tier`, and `THREE.Color` conversion from installed r186.
- Produces: `WINDOW`, `WINDOW_PALETTE`, `hash11(seed: number): number`, `hash13(cell: readonly [number, number], seed: number): number`, `windowHashes(cell, seed): { cell: number; building: number; tint: number; brightness: number; flicker: number }`, `windowLitAmount(cellHash: number, buildingHash: number, uLit: number): number`, `gainFor(srgbHex: number, targetLuminance: number): number`, `linearLuminance(rgb: readonly number[]): number`, `windowClass(tintHash: number): 'warm'|'neutral'|'cool'`, `flickerMultiplier(phase: number, time: number, gate: number): number`, and `windowLookFor(state: Pick<StopState,'windowLitRatio'>, t: number, tier: Exclude<Tier,'none'>): {uEmissiveScale:number;uTime:number;uFlicker:number}`.

- [ ] **Step 1: Write failing occupancy/mapping tests with deterministic stratification.**

```ts
import { expect, it } from 'vitest'
import { STOPS } from '../../app/journey/stops'
import {
  WINDOW, WINDOW_PALETTE, windowLitAmount, windowLookFor, windowHashes,
  windowClass, hash11, hash13, linearLuminance, gainFor, flickerMultiplier,
} from '../../app/journey/window-look'

const fraction = (xs: number[]) => xs.filter(x => x > 0.5).length / xs.length
const sd = (xs: number[]) => {
  const mean = xs.reduce((a,b) => a+b,0)/xs.length
  return Math.sqrt(xs.reduce((a,b) => a+(b-mean)**2,0)/xs.length)
}
it('has deterministic stratified occupancy, rather than noisy building samples', () => {
  const cases = [[.05,.005,.04],[.3,.257,.297],[.65,.614,.654],[.9,.85,.89]]
  for (const [ratio, lo, hi] of cases) {
    const amounts: number[] = []
    for (let b=0;b<200;b++) for (let c=0;c<100;c++) {
      // 20,000 cell/building strata; buildingHash produces uniform k.
      amounts.push(windowLitAmount((c+.5)/100,(b+.5)/200,ratio!))
    }
    expect(fraction(amounts)).toBeGreaterThanOrEqual(lo!)
    expect(fraction(amounts)).toBeLessThanOrEqual(hi!)
  }
})
it('has building spread before sampling noise, and three large-sample checks', () => {
  const expected = Array.from({length:2000},(_,i) =>
    Math.min(1, Math.max(0,(.65-.03)/(.75+.5*(i+.5)/2000))))
  expect(sd(expected)).toBeGreaterThanOrEqual(.08)
  expect(Math.min(...expected)).toBeLessThan(.55)
  expect(Math.max(...expected)).toBeGreaterThan(.78)
  for (const k of [.75,1,1.25]) {
    const bh = (1.25-k)/.5
    const actual = fraction(Array.from({length:4000},(_,i) =>
      windowLitAmount((i+.5)/4000,bh,.65)))
    expect(Math.abs(actual-Math.min(1,.62/k))).toBeLessThan(.03)
  }
})
it('is monotonic, continuous and reverses symmetrically', () => {
  for (let i=0;i<1000;i++) {
    const h=windowHashes([i%40,Math.floor(i/40)],Math.fround((i+.5)/1000))
    const values=Array.from({length:101},(_,p)=>windowLitAmount(h.cell,h.building,p/100))
    for(let p=1;p<values.length;p++) expect(values[p]!).toBeGreaterThanOrEqual(values[p-1]!)
    const t=h.cell*(1.25-.5*h.building)
    expect(windowLitAmount(h.cell,h.building,t)).toBe(0)
    expect(windowLitAmount(h.cell,h.building,t+.03)).toBeCloseTo(.5,6)
    expect(windowLitAmount(h.cell,h.building,t+.06)).toBeCloseTo(1,6)
    const backwards=Array.from({length:101},(_,p)=>windowLitAmount(h.cell,h.building,1-p/100))
    for(let p=0;p<101;p++) expect(backwards[p]!).toBeCloseTo(values[100-p]!,12)
  }
  expect(windowLitAmount(.2,.4,-.5)).toBe(0)
  expect(windowLitAmount(.2,.4,1.5)).toBe(1)
})
it('maps actual stops, long-running time, and both reduced variants', () => {
  const targets=[.39,.96,1,1]
  for (const [i,s] of STOPS.entries()) for(const tier of ['full','lite','reduced'] as const) {
    const look=windowLookFor(s,1234.125,tier)
    expect(Math.abs(look.uEmissiveScale-targets[i]!)).toBeLessThan(.01)
    expect(look.uTime).toBe(234.125)
    expect(look.uFlicker).toBe(tier==='reduced'?0:1)
  }
})
it('uses float32 seed semantics, including negative facade coordinates', () => {
  for(const cell of [[-40,0],[0,0],[39,49]] as const) {
    const seed=.123456789123
    expect(hash13(cell,seed)).toBe(hash13(cell,Math.fround(seed)))
    expect(hash13(cell,seed)).toBeGreaterThanOrEqual(0)
    expect(hash13(cell,seed)).toBeLessThan(1)
  }
  expect(hash11(.25)).toBe(0.4783235788345337)
})
```

- [ ] **Step 2: Run the new tests and confirm the missing-module failure.**

Run: `cd repos/portfolio && npm test -- tests/journey/window-look.test.ts`
Expected: FAIL because `app/journey/window-look.ts` does not exist.

- [ ] **Step 3: Implement the pure constants and CPU formulas.**

Use the following complete module. Float32 rounding mirrors each hash intermediate's GLSL operation order, including the attribute seed conversion; `fract` uses floor for negative coordinates. The smoothstep/occupancy and color helpers intentionally use ordinary JavaScript doubles for their mathematical/statistical contracts; their GPU result is compared with a numeric tolerance, not bit identity. GLSL highp is not a promise of bit-identical floating arithmetic across drivers: contraction/reassociation can differ. Task 3 measures actual production results and uses fixed samples away from discontinuities for exact binary decisions. Do not replace the hash's `Math.fround` with double arithmetic or assert that Node alone proves GPU determinism.

```ts
import { Color } from 'three'
import type { StopState } from './stops'
import type { Tier } from './tier'

export const WINDOW = {
  hashMultiplier:.1031, hash13Offset:31.32, hash11Offset:33.33,
  kMin:.75, kMax:1.25, fadeBand:.06, target:2.3,
  warmCut:.7, neutralCut:.9, brightnessMin:.92, brightnessMax:1.2,
  flickerCut:.4, phasePeriod:6.2832, timeWrap:1000,
  tintSalt:[17,43,.137], brightnessSalt:[59,11,.271], flickerSalt:[7,83,.419],
} as const
const f=Math.fround
const add=(a:number,b:number)=>f(f(a)+f(b))
const mul=(a:number,b:number)=>f(f(a)*f(b))
const fract=(x:number)=>f(f(x)-Math.floor(f(x)))
const clamp=(x:number)=>Math.max(0,Math.min(1,x))
const smooth=(a:number,b:number,x:number)=>{
  const s=clamp((x-a)/(b-a)); return s*s*(3-2*s)
}
export function hash11(seed:number):number {
  let p=fract(mul(seed,WINDOW.hashMultiplier))
  p=mul(p,add(p,WINDOW.hash11Offset))
  p=mul(p,add(p,p))
  return fract(p)
}
export function hash13(cell:readonly [number,number],seed:number):number {
  let x=fract(mul(cell[0],WINDOW.hashMultiplier))
  let y=fract(mul(cell[1],WINDOW.hashMultiplier))
  let z=fract(mul(seed,WINDOW.hashMultiplier))
  // p3.zyx + offset, in exactly the GLSL scalar evaluation order.
  const a=mul(x,add(z,WINDOW.hash13Offset))
  const b=mul(y,add(y,WINDOW.hash13Offset))
  const c=mul(z,add(x,WINDOW.hash13Offset))
  const d=add(add(a,b),c)
  x=add(x,d); y=add(y,d); z=add(z,d)
  return fract(mul(add(x,y),z))
}
export function windowHashes(cell:readonly [number,number],seed:number) {
  const salted=(salt:readonly [number,number,number])=>
    hash13([add(cell[0],salt[0]),add(cell[1],salt[1])],add(seed,salt[2]))
  return {cell:hash13(cell,seed),building:hash11(seed),
    tint:salted(WINDOW.tintSalt),brightness:salted(WINDOW.brightnessSalt),
    flicker:salted(WINDOW.flickerSalt)}
}
export function windowLitAmount(cellHash:number,buildingHash:number,uLit:number):number {
  const k=WINDOW.kMax+(WINDOW.kMin-WINDOW.kMax)*buildingHash
  const t=cellHash*k
  return smooth(t,t+WINDOW.fadeBand,uLit)
}
export function linearLuminance(rgb:readonly number[]):number {
  return .2126*rgb[0]!+.7152*rgb[1]!+.0722*rgb[2]!
}
export function gainFor(srgbHex:number,targetLuminance:number):number {
  const c=new Color(srgbHex) // r186 converts hex sRGB to linear working space.
  return targetLuminance/linearLuminance([c.r,c.g,c.b])
}
const palette=(name:'warm'|'neutral'|'cool',hex:number)=>{
  const c=new Color(hex)
  return {name,hex,linear:[c.r,c.g,c.b] as const,gain:gainFor(hex,WINDOW.target)}
}
export const WINDOW_PALETTE=[palette('warm',0xffc983),palette('neutral',0xffe9c4),palette('cool',0xbfe0ff)] as const
export function windowClass(tintHash:number):'warm'|'neutral'|'cool' {
  return tintHash<WINDOW.warmCut?'warm':tintHash<WINDOW.neutralCut?'neutral':'cool'
}
export function flickerMultiplier(phase:number,time:number,gate:number):number {
  if(gate===0) return 1
  const moving=.8+.2*Math.sin(time*6.3+phase)*Math.sin(time*2.1+phase*1.7)
  return 1+(moving-1)*gate
}
export function windowLookFor(state:Pick<StopState,'windowLitRatio'>,t:number,tier:Exclude<Tier,'none'>) {
  return {uEmissiveScale:.35+.65*smooth(0,.35,state.windowLitRatio),
    uTime:t%WINDOW.timeWrap,uFlicker:tier==='reduced'?0:1}
}
```

- [ ] **Step 4: Add gain, class-share, correlation, and flicker tests before changing the shader.**

Append this code to the new unit test. Sample actual salted hashes for class/eligibility tests, restricted to lit cells; otherwise a good uniform-class distribution can conceal a correlation with occupancy.

```ts
it('calibrates each sRGB class in linear space and meets both brightness contracts', () => {
  for(const p of WINDOW_PALETTE) {
    expect(p.gain).toBe(gainFor(p.hex,2.3))
    expect(Math.abs(p.gain*linearLuminance(p.linear)-2.3)).toBeLessThan(1e-3)
  }
  const project=windowLookFor(STOPS[1]!,0,'full').uEmissiveScale
  expect(2.3*.92*project).toBeGreaterThanOrEqual(2)
  expect(2.3*.92*project*.6).toBeGreaterThan(1)
  expect(WINDOW_PALETTE[0].gain*linearLuminance(WINDOW_PALETTE[0].linear)).toBeCloseTo(2.3,6)
})
it('has 70/20/10 class shares and roughly 4% eligible flicker among lit samples', () => {
  const counts={warm:0,neutral:0,cool:0}; let eligible=0,total=0
  // Large deterministic field; take the first 10,000 lit windows.
  for(let i=0;total<10000 && i<30000;i++) {
    const h=windowHashes([i%100,Math.floor(i/100)],Math.fround(((i%97)+.5)/97))
    if(windowLitAmount(h.cell,h.building,.9)<=.5) continue
    const cls=windowClass(h.tint); counts[cls]++; total++
    if(cls==='cool' && h.flicker<.4) eligible++
  }
  expect(total).toBe(10000)
  for(const [cls,target] of [['warm',.7],['neutral',.2],['cool',.1]] as const)
    expect(Math.abs(counts[cls]/total-target)).toBeLessThan(.02)
  expect(Math.abs(eligible/total-.04)).toBeLessThan(.01)
})
it('keeps gate-zero brightness exactly one even across the wrap boundary', () => {
  for(let p=0;p<100;p++) for(const t of [0,.1,1,99,999.9,1000,1000.1]) {
    const phase=p/100*6.2832
    expect(flickerMultiplier(phase,t,0)).toBe(1)
    const a=flickerMultiplier(phase,t,1)
    expect(a).toBeGreaterThanOrEqual(.6); expect(a).toBeLessThanOrEqual(1)
  }
  // The specified modulo reset can change an eligible cell; reduced mode cannot.
  expect(windowLookFor(STOPS[3]!,1000.1,'reduced').uFlicker).toBe(0)
})
```

- [ ] **Step 5: Run the pure suite, review its distributions, and commit this independently useful module.**

Run: `cd repos/portfolio && npm test -- tests/journey/window-look.test.ts`
Expected: all tests pass. If the fixed salted sample misses the distribution bands, inspect decorrelation and hash rounding rather than replacing the sample with random seeds or widening the acceptance bands.

```bash
cd repos/portfolio && git add app/journey/window-look.ts tests/journey/window-look.test.ts
cd repos/portfolio && git commit -m "feat: define deterministic staggered window look"
```

### Task 2: Integrate the look into the production facade and runtime

**Files:**
- Modify: `repos/portfolio/app/journey/facade-material.ts` (`FacadeUniforms`, GLSL patch, cache key)
- Modify: `repos/portfolio/app/journey/scene.ts` (shared uniforms and `update`)
- Modify: `repos/portfolio/tests/journey/facade-material.test.ts`
- Modify: `repos/portfolio/tests/gpu/facade-probe.ts` (initialize new required uniforms)
- Create only if the 400-line boundary is crossed: `repos/portfolio/app/journey/facade-glsl.ts`

**Interfaces:**
- Consumes: Task 1 exports; spec 01 `replaceOrThrow`, facade coordinates/coverage/fade, shared uniform object, `JourneySceneOptions.lowPower`, and shader recorder. Spec 02 can have replaced `renderer.render` with `post.render`; preserve that render call and its failure guard.
- Produces: `FacadeUniforms` additionally requires `uTime:{value:number}`, `uFlicker:{value:number}`, `uEmissiveScale:{value:number}`; factory signature remains unchanged. Shader diagnostic locals are `facadeCellHash`, `facadeBuildingHash`, `facadeTintHash`, `facadeLit`, and `facadeWindowEmission`. Numeric define `FACADE_DEBUG_WINDOW` is absent by default, and optional values 1/2/3 expose production fade/hash/emission respectively only in test fixtures.

- [ ] **Step 1: Add failing real-r186 patch and uniform/variant tests.**

Append to the existing spec 01 facade test (reuse its imports for `THREE`, `createFacadeMaterial`). This calls the production hook, not an imitation string builder.

```ts
function patched(variant:'full'|'lite',debug=0) {
  const uniforms={uLit:{value:.65},uSkyTint:{value:new THREE.Color(0xbfdbfe)},
    uTime:{value:0},uFlicker:{value:0},uEmissiveScale:{value:1}}
  const m=createFacadeMaterial({color:0x353b5c,uniforms,variant})
  if(debug) m.defines={...m.defines,FACADE_DEBUG_WINDOW:debug}
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,
    fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{} as Record<string,THREE.IUniform>}
  m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer)
  return {m,shader,uniforms}
}
it('registers window uniforms and emits the reduced-cost variant separately',()=>{
  const full=patched('full'); const lite=patched('lite')
  for(const key of ['uTime','uFlicker','uEmissiveScale'] as const)
    expect(full.shader.uniforms[key]).toBe(full.uniforms[key])
  expect(full.shader.fragmentShader).toContain('precision highp float;')
  expect(full.shader.fragmentShader).toContain('sin(uTime * 6.3')
  expect(lite.shader.fragmentShader).not.toContain('sin(uTime * 6.3')
  expect(lite.shader.fragmentShader).not.toContain('fwidth(')
  expect(full.m.customProgramCacheKey()).not.toBe(lite.m.customProgramCacheKey())
  expect(full.m.customProgramCacheKey()).not.toBe(patched('full',1).m.customProgramCacheKey())
  expect(full.shader.fragmentShader).toContain('facadeWindowEmission')
  for(const variant of [full,lite]) {
    expect(variant.shader.fragmentShader).toContain('facadeLit')
    expect(variant.shader.fragmentShader).not.toContain('uSunVisibility')
    variant.m.dispose()
  }
})
```

Run: `cd repos/portfolio && npm test -- tests/journey/facade-material.test.ts`
Expected: FAIL at new uniform identity or GLSL assertions.

- [ ] **Step 2: Extend the facade uniforms and generate constants from Task 1.**

```ts
import { WINDOW, WINDOW_PALETTE } from './window-look'
// Extend the spec 01 interface in place, retaining uLit/uSkyTint.
// uTime: { value: number }; uFlicker: { value: number }; uEmissiveScale: { value: number }
const glsl=(n:number)=>Number.isInteger(n)?`${n}.0`:n.toPrecision(12)
const glsl3=(rgb:readonly number[])=>`vec3(${rgb.map(glsl).join(', ')})`
const [warm,neutral,cool]=WINDOW_PALETTE
```

Insert explicit `precision highp float;` with the fragment globals. Set `material.precision='highp'`; do not rely only on default renderer precision. Register the same three uniform wrapper objects on every material's shader with `Object.assign(shader.uniforms, uniforms)` as in spec 01. Do not clone uniforms per layer.

Update **every** existing spec 01 factory caller now that these fields are required. In `tests/gpu/facade-probe.ts` and both existing `tests/journey/facade-material.test.ts` initializer sites, retain existing `uLit/uSkyTint` and append these exact wrappers:

```ts
uTime:{value:0},uFlicker:{value:0},uEmissiveScale:{value:1},
```

These fixed fixture values preserve the existing grid/roof/filter assertions and disable time dependence. Search all actual callers before typechecking:

Run: `cd repos/portfolio && rg -n 'createFacadeMaterial|FacadeUniforms|uSkyTint:' app tests`

Keep existing grid, roof, filtering, and uniform-identity coverage. Update the old literal program-key assertion to this versioned key, retaining the separate full/lite uniqueness assertion:

```ts
expect(material.customProgramCacheKey()).toBe(`facade-${variant}-windows-ab-0`)
```

Do not introduce `uFloorBias` or make the new fields optional to hide missing callers.

- [ ] **Step 3: Replace the occupancy/hash/emission block with these production functions.**

The string interpolations below refer to the TypeScript variables defined in Step 2. Use `replaceOrThrow` for each r186 marker. Replace the existing occupancy/emission patch as a unit; do not stack a second `<color_fragment>` replacement whose marker was already consumed. Keep spec 01's base-anchored `facadeCell`/`facadeLocal`, face rejection, diffuse glass, floor line, `distanceFade`, and average-facade blend. Its exact shared mask is `windowCoverage`, already `rect*(1.0-distanceFade)`; multiply it once. Retain existing main-block locals `facadeCellHash`, `facadeBuildingHash`, `facadeLit`, and `facadeWindowEmission`, initialized before the side-face branch. Remove spec 01's unused `facadeHash13` declaration when replacing it with the new hash functions below.

```glsl
precision highp float;
uniform float uTime;
uniform float uFlicker;
uniform float uEmissiveScale;
float windowHash11(float p) {
  p = fract(p * ${glsl(WINDOW.hashMultiplier)});
  p *= p + ${glsl(WINDOW.hash11Offset)};
  p *= p + p;
  return fract(p);
}
float windowHash13(vec3 p) {
  vec3 p3 = fract(p * ${glsl(WINDOW.hashMultiplier)});
  vec3 q = p3.zyx + ${glsl(WINDOW.hash13Offset)};
  float a = p3.x * q.x;
  float b = p3.y * q.y;
  float c = p3.z * q.z;
  float d = (a + b) + c;
  p3 += d;
  return fract((p3.x + p3.y) * p3.z);
}
```

Beside spec 01's existing main-body diagnostic locals, add the tint local and replace the building-hash initialization. Do not redeclare the existing locals:

```glsl
float facadeTintHash = 0.0;
facadeBuildingHash = windowHash11(vSeed);
```

Inside the side-face branch, after existing `facadeCell = floor(uv/CELL)` and `windowCoverage` computation:

```glsl
facadeCellHash = windowHash13(vec3(facadeCell, vSeed));
float k = mix(${glsl(WINDOW.kMax)}, ${glsl(WINDOW.kMin)}, facadeBuildingHash);
float threshold = facadeCellHash * k;
facadeLit = smoothstep(threshold, threshold + ${glsl(WINDOW.fadeBand)}, uLit);
```

For the **full** GLSL string only, append:

```glsl
facadeTintHash = windowHash13(vec3(facadeCell + vec2(${WINDOW.tintSalt.slice(0,2).map(glsl).join(', ')}), vSeed + ${glsl(WINDOW.tintSalt[2])}));
float brightnessHash = windowHash13(vec3(facadeCell + vec2(${WINDOW.brightnessSalt.slice(0,2).map(glsl).join(', ')}), vSeed + ${glsl(WINDOW.brightnessSalt[2])}));
float flickerHash = windowHash13(vec3(facadeCell + vec2(${WINDOW.flickerSalt.slice(0,2).map(glsl).join(', ')}), vSeed + ${glsl(WINDOW.flickerSalt[2])}));
vec3 lightColor = ${glsl3(warm.linear)};
float lightGain = ${glsl(warm.gain)};
if (facadeTintHash >= ${glsl(WINDOW.neutralCut)}) {
  lightColor = ${glsl3(cool.linear)}; lightGain = ${glsl(cool.gain)};
} else if (facadeTintHash >= ${glsl(WINDOW.warmCut)}) {
  lightColor = ${glsl3(neutral.linear)}; lightGain = ${glsl(neutral.gain)};
}
float brightness = mix(${glsl(WINDOW.brightnessMin)}, ${glsl(WINDOW.brightnessMax)}, brightnessHash);
float flicker = 1.0;
if (facadeTintHash >= ${glsl(WINDOW.neutralCut)} && flickerHash < ${glsl(WINDOW.flickerCut)}) {
  float phase = flickerHash * ${glsl(WINDOW.phasePeriod)};
  flicker = mix(1.0, 0.8 + 0.2 * sin(uTime * 6.3 + phase)
    * sin(uTime * 2.1 + phase * 1.7), uFlicker);
}
facadeWindowEmission = lightColor * lightGain * brightness * flicker
  * uEmissiveScale * facadeLit * windowCoverage;
```

For the **lite** string only, append:

```glsl
facadeWindowEmission = ${glsl3(warm.linear)} * ${glsl(warm.gain)}
  * uEmissiveScale * facadeLit * windowCoverage;
```

Retain the built-in `<emissivemap_fragment>` chunk and its existing `totalEmissiveRadiance += facadeWindowEmission;` addition. The lit amount and already-filtered window coverage multiply emission once. Unlit/lit diffuse remains the spec 01 dark glass until Task 5 is enabled. Distance averages must not introduce unmasked per-cell emission. In the full variant the rectangular edges, floor-line coverage, emissive, and diffuse average blend all retain the existing fwidth fade; lite retains the fixed-depth 6–14 fade.

- [ ] **Step 4: Add opt-in diagnostics that expose these actual production locals.**

Append after `<dithering_fragment>` with `replaceOrThrow`:

```glsl
#if defined(FACADE_DEBUG_WINDOW) && FACADE_DEBUG_WINDOW == 1
  gl_FragColor = vec4(vec3(facadeLit), 1.0);
#elif defined(FACADE_DEBUG_WINDOW) && FACADE_DEBUG_WINDOW == 2
  gl_FragColor = vec4(facadeCellHash, facadeBuildingHash, facadeTintHash, 1.0);
#elif defined(FACADE_DEBUG_WINDOW) && FACADE_DEBUG_WINDOW == 3
  gl_FragColor = vec4(facadeWindowEmission, 1.0);
#endif
```

Diagnostic 1 exposes the continuous occupancy amount before distance filtering, diagnostic 3 exposes the exact masked emission actually accumulated by the material. Preserve normal output when the define is absent. Include the define in the key dynamically so the test can set it after factory creation:

```ts
material.customProgramCacheKey=()=>`facade-${variant}-windows-ab-${material.defines?.FACADE_DEBUG_WINDOW ?? 0}`
```

- [ ] **Step 5: Update the existing scene wiring with the frame time.**

```ts
import { windowLookFor } from './window-look'
// Extend the one shared FacadeUniforms initializer:
// uTime:{value:0}, uFlicker:{value:tier==='reduced'?0:1},
// uEmissiveScale:{value:windowLookFor(current,0,tier).uEmissiveScale}
function applyWindowLook(state: StopState, t: number) {
  const look=windowLookFor(state,t,tier)
  facade.uTime.value=look.uTime
  facade.uFlicker.value=look.uFlicker
  facade.uEmissiveScale.value=look.uEmissiveScale
}
// After current is initialized, before spec 01 warm-up renders:
applyWindowLook(current,0)
// In JourneyScene.update(chapter,progress,t,pointer), after current is resolved:
applyWindowLook(current,t)
apply(current)
// Keep the existing actual render pipeline and recorder.assertClean() call here.
```

Initialize `facade` after `current` if the existing declaration order requires it, or compute the default scale from `target(0,0)` before `current` exists. Keep `apply`'s `uLit` and explicit `THREE.SRGBColorSpace` sky conversion. No per-window CPU frame loop, new `StopState` fields, or GPU resources are needed. For reduced mode `current=target(chapter,progress)` remains static, and `uFlicker=0` means arbitrary time updates do not change the picture.

- [ ] **Step 6: Run the unit suites, typecheck, and commit the integrated A/B shader.**

Run: `cd repos/portfolio && npm test -- tests/journey/window-look.test.ts tests/journey/facade-material.test.ts tests/journey/interpolate.test.ts`
Run: `cd repos/portfolio && npm run typecheck`
Expected: PASS. GPU correctness is still unproved until Task 3.

```bash
cd repos/portfolio && git add app/journey/facade-material.ts app/journey/scene.ts tests/journey/facade-material.test.ts tests/gpu/facade-probe.ts
cd repos/portfolio && git commit -m "feat: render calibrated staggered facade windows"
```

If the optional GLSL extraction happened, include `app/journey/facade-glsl.ts` in this commit explicitly.

### Task 3: Prove production GPU occupancy, hue, flicker, filtering, and restore

**Files:**
- Create: `repos/portfolio/tests/gpu/windows-probe.ts`
- Create: `repos/portfolio/tests/gpu/windows.spec.ts`
- Modify: `repos/portfolio/tests/gpu/harness.ts`

**Interfaces:**
- Consumes: production `createFacadeMaterial`, Task 1 mirrors, the three debug modes, `createTestRenderer`, and the existing `cityGpu` tier/scene/restore methods.
- Produces: `window.cityGpu.probeWindows(input: WindowProbeInput): WindowProbeResult`, where input is `{variant:'full'|'lite'; seed:number; ratio:number; time?:number; flicker?:number; emissiveScale?:number; mode?:0|1|2|3; pixelsPerCell?:number; depth?:number}` and result is `{samples:number[][]; shaderError:string|null;glError:number}`. Sample ordering is row-major for 80 columns by 50 rows; cell coordinates are `[column-40,row]`. Browser values are JSON-serializable arrays.

- [ ] **Step 1: Write the failing GPU fixture/occupancy test.**

```ts
import { expect,test } from '@playwright/test'
import { hash11, windowHashes, windowLitAmount, windowClass, WINDOW_PALETTE,
  linearLuminance, windowLookFor } from '../../app/journey/window-look'
import { STOPS } from '../../app/journey/stops'
test.beforeEach(async({page})=>{
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(()=>Boolean(window.cityGpu))
})
const seeds=Array.from({length:40},(_,i)=>Math.fround((i+.5)/40))
for(const variant of ['full','lite'] as const) {
  test(`${variant}: forty large walls match per-building occupancy`,async({page})=>{
    test.setTimeout(180000)
    for(const seed of seeds) for(const ratio of [.05,.3,.65,.9]) {
      const r=await page.evaluate(({variant,seed,ratio})=>
        window.cityGpu.probeWindows({variant,seed,ratio,mode:1,flicker:0}),{variant,seed,ratio})
      expect(r.shaderError).toBeNull(); expect(r.glError).toBe(0)
      expect(r.samples).toHaveLength(4000)
      const actual=r.samples.filter(x=>x[0]!>.5).length/4000
      const k=1.25-.5*hash11(seed)
      expect(Math.abs(actual-Math.max(0,Math.min(1,(ratio-.03)/k)))) .toBeLessThan(.03)
    }
  })
}
```

Run: `cd repos/portfolio && npm run test:gpu -- tests/gpu/windows.spec.ts`
Expected: FAIL because `probeWindows` is not registered. Run this only after spec 01 installs/configures the shared harness.

- [ ] **Step 2: Implement a wall fixture that renders the production material.**

Import `createTestRenderer` from spec 01's finalized `tests/gpu/gpu-utils.ts`; do not add another renderer helper or create a circular `harness.ts -> windows-probe.ts -> harness.ts` dependency.

```ts
import * as THREE from 'three'
import { createFacadeMaterial } from '../../app/journey/facade-material'
import { createTestRenderer } from './gpu-utils'
export interface WindowProbeInput {
  variant:'full'|'lite';seed:number;ratio:number;time?:number;flicker?:number;
  emissiveScale?:number;mode?:0|1|2|3;pixelsPerCell?:number;depth?:number
}
export interface WindowProbeResult {
  samples:number[][];shaderError:string|null;glError:number
}
export function probeWindows(input:WindowProbeInput):WindowProbeResult {
  const p=input.pixelsPerCell??6, width=80*p, height=50*p
  const ctx=createTestRenderer({width,height})
  const {renderer,recorder}=ctx
  const target=new THREE.WebGLRenderTarget(width,height,{
    type:THREE.FloatType,format:THREE.RGBAFormat,minFilter:THREE.NearestFilter,
    magFilter:THREE.NearestFilter,depthBuffer:true,stencilBuffer:false})
  const geometry=new THREE.BoxGeometry(1,1,1)
  const uniforms={uLit:{value:input.ratio},uSkyTint:{value:new THREE.Color(0xbfdbfe)},
    uTime:{value:input.time??0},uFlicker:{value:input.flicker??0},
    uEmissiveScale:{value:input.emissiveScale??1}}
  const material=createFacadeMaterial({color:0x353b5c,uniforms,variant:input.variant})
  if(input.mode) material.defines={...material.defines,FACADE_DEBUG_WINDOW:input.mode}
  const mesh=new THREE.InstancedMesh(geometry,material,1)
  geometry.setAttribute('aSeed',new THREE.InstancedBufferAttribute(new Float32Array([input.seed]),1))
  mesh.setMatrixAt(0,new THREE.Matrix4().compose(
    new THREE.Vector3(0,4.5,0),new THREE.Quaternion(),new THREE.Vector3(12.8,11,1)))
  mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false
  const scene=new THREE.Scene();scene.add(mesh)
  const depth=input.depth??4.5
  const camera=new THREE.OrthographicCamera(-6.4,6.4,5.5,-5.5,.1,200)
  camera.position.set(0,4.5,.5+depth);camera.lookAt(0,4.5,0)
  renderer.setPixelRatio(1);renderer.setSize(width,height,false)
  renderer.toneMapping=THREE.NoToneMapping
  renderer.outputColorSpace=THREE.LinearSRGBColorSpace
  target.texture.colorSpace=THREE.LinearSRGBColorSpace
  try {
    if(!renderer.getContext().getExtension('EXT_color_buffer_float'))
      throw new Error('Window GPU tests require readable float color targets')
    renderer.setRenderTarget(target);renderer.render(scene,camera);recorder.assertClean()
    const pixels=new Float32Array(width*height*4)
    renderer.readRenderTargetPixels(target,0,0,width,height,pixels)
    const samples:number[][]=[]
    for(let row=0;row<50;row++) for(let col=0;col<80;col++) {
      const x=col*p+Math.floor(p/2),y=row*p+Math.floor(p/2)
      const offset=4*(y*width+x)
      samples.push(Array.from(pixels.subarray(offset,offset+3)))
    }
    return {samples,shaderError:recorder.error?.message??null,glError:renderer.getContext().getError()}
  } finally {
    renderer.setRenderTarget(null);target.dispose();geometry.dispose();material.dispose();ctx.dispose()
  }
}
```

Six pixels per cell gives derivative widths around 0.167 cell and no full-variant distance fade. Sample coordinates are local .5833: their nearest rect-edge distances (.2167/.2367) exceed that AA width, so **rect coverage is exactly 1** for the unfiltered luminance test. Four pixels per cell would put the sample at .625 with AA width .25, partly filtering its rect and invalidating the ≥2.0 assertion. Samples avoid floor lines; 80×50 cells supply 4000 measurements per wall. The scene has no light, environment, fog, or background; normal material mode 0 therefore produces pure window emission on side-face centers, providing a separate proof beyond diagnostics. A float render target preserves HDR values above 2.0. Chromium's software WebGL test must support float targets; do not silently skip this test or use 8-bit clipped emission values to prove luminance.

Register and declare `probeWindows` on the existing harness global:

```ts
import { probeWindows, type WindowProbeInput, type WindowProbeResult } from './windows-probe'
// Add to the existing CityGpu interface:
// probeWindows(input:WindowProbeInput):WindowProbeResult
// Add to the object installed as window.cityGpu:
// probeWindows,
```

- [ ] **Step 3: Add GPU hash agreement, production emission, class/flicker and filtered-mask cases.**

Append these concrete tests. The hash tolerance is small enough to catch a missing float32 mirror or different salt. It is not an assertion of bitwise equality; exact lit decisions use preselected CPU cells with distance at least .02 from the tested binary threshold and from the hash's 0/1 wrap. The sample set is fixed by deterministic enumeration before GPU values are read. If a supported device fails, investigate operation order/highp precision and correct the mirror or shader; do not quietly expand tolerance or delete failed cells.

```ts
test('production hashes agree with the float32 mirror and 100 safe decisions agree',async({page})=>{
  const seed=seeds[13]!,ratio=.65
  const raw=await page.evaluate(({seed,ratio})=>
    window.cityGpu.probeWindows({variant:'full',seed,ratio,mode:2}),{seed,ratio})
  const amounts=await page.evaluate(({seed,ratio})=>
    window.cityGpu.probeWindows({variant:'full',seed,ratio,mode:1}),{seed,ratio})
  expect(raw.shaderError).toBeNull();expect(raw.glError).toBe(0)
  expect(amounts.shaderError).toBeNull();expect(amounts.glError).toBe(0)
  let checked=0
  for(let i=0;i<4000 && checked<100;i++) {
    const h=windowHashes([i%80-40,Math.floor(i/80)],seed)
    const t=h.cell*(1.25-.5*h.building)
    if(h.cell<.02 || h.cell>.98 || h.tint<.02 || h.tint>.98 || Math.abs(t-(ratio-.03))<.02) continue
    const gpu=raw.samples[i]!
    expect(Math.abs(gpu[0]!-h.cell)).toBeLessThan(.002)
    expect(Math.abs(gpu[1]!-h.building)).toBeLessThan(.002)
    expect(Math.abs(gpu[2]!-h.tint)).toBeLessThan(.002)
    expect(amounts.samples[i]![0]!>.5).toBe(windowLitAmount(h.cell,h.building,ratio)>.5)
    checked++
  }
  expect(checked).toBe(100)
})
test('actual normal production emission has calibrated hues and full-window luminance',async({page})=>{
  const seed=seeds[22]!,ratio=.9
  const diagnostic=await page.evaluate(({seed,ratio})=>
    window.cityGpu.probeWindows({variant:'full',seed,ratio,mode:3}),{seed,ratio})
  const normal=await page.evaluate(({seed,ratio})=>
    window.cityGpu.probeWindows({variant:'full',seed,ratio,mode:0}),{seed,ratio})
  const counts=[0,0,0];let total=0
  const normalized=WINDOW_PALETTE.map(p=>p.linear.map(c=>c/linearLuminance(p.linear)))
  for(let i=0;i<4000;i++) {
    const a=normal.samples[i]!,b=diagnostic.samples[i]!
    for(let j=0;j<3;j++) expect(Math.abs(a[j]!-b[j]!)).toBeLessThan(.005)
    const lum=linearLuminance(a)
    if(lum<2.0) continue // fully lit or almost fully lit samples only
    const hue=a.map(c=>c/lum)
    const scores=normalized.map(c=>c.reduce((s,v,j)=>s+(v-hue[j]!)**2,0))
    const cls=scores.indexOf(Math.min(...scores));counts[cls]!++;total++
  }
  expect(total).toBeGreaterThan(2000)
  for(const [i,target] of [.7,.2,.1].entries())
    expect(Math.abs(counts[i]!/total-target)).toBeLessThan(.06)
  const project=windowLookFor(STOPS[1]!,0,'full').uEmissiveScale
  const fully=await page.evaluate(({seed,project})=>
    window.cityGpu.probeWindows({variant:'full',seed,ratio:.3,emissiveScale:project}),{seed,project})
  const fade=await page.evaluate(seed=>
    window.cityGpu.probeWindows({variant:'full',seed,ratio:.3,mode:1}),seed)
  let fullCount=0
  for(let i=0;i<4000;i++) if(fade.samples[i]![0]!>=.99999) {
    expect(linearLuminance(fully.samples[i]!)).toBeGreaterThanOrEqual(2);fullCount++
  }
  expect(fullCount).toBeGreaterThan(100)
  for(const r of [diagnostic,normal,fully,fade]) {expect(r.shaderError).toBeNull();expect(r.glError).toBe(0)}
})
test('eligible production windows move, while gate-zero and lite retain full static brightness',async({page})=>{
  const seed=seeds[22]!
  const hashes=Array.from({length:4000},(_,i)=>windowHashes([i%80-40,Math.floor(i/80)],seed))
  const index=hashes.findIndex(h=>h.tint>.92 && h.flicker<.38 && h.cell*(1.25-.5*h.building)+.06<.9)
  expect(index).toBeGreaterThanOrEqual(0)
  const series:number[]=[]
  let baseline=0
  for(let n=0;n<=10;n++) {
    const result=await page.evaluate(({seed,time})=>{
      const moving=window.cityGpu.probeWindows({variant:'full',seed,ratio:.9,time,flicker:1})
      const still=window.cityGpu.probeWindows({variant:'full',seed,ratio:.9,time,flicker:0})
      const lite=window.cityGpu.probeWindows({variant:'lite',seed,ratio:.9,time,flicker:1})
      return {moving,still,lite}
    },{seed,time:n/10})
    const lum=linearLuminance(result.still.samples[index]!)
    if(n===0) baseline=lum
    expect(lum).toBeCloseTo(baseline,5)
    series.push(linearLuminance(result.moving.samples[index]!))
    for(const rgb of result.lite.samples.filter(x=>linearLuminance(x)>2)) {
      const norm=rgb.map(c=>c/linearLuminance(rgb))
      const warm=WINDOW_PALETTE[0].linear.map(c=>c/linearLuminance(WINDOW_PALETTE[0].linear))
      for(let j=0;j<3;j++) expect(norm[j]).toBeCloseTo(warm[j]!,4)
      expect(linearLuminance(rgb)).toBeCloseTo(2.3,4)
    }
    for(const r of Object.values(result)) {expect(r.shaderError).toBeNull();expect(r.glError).toBe(0)}
  }
  expect((Math.max(...series)-Math.min(...series))/baseline).toBeGreaterThan(.05)
  expect(Math.max(...series)).toBeLessThanOrEqual(baseline+.005)
})
test('distance filtering attenuates production emission on both variants',async({page})=>{
  for(const variant of ['full','lite'] as const) {
    const result=await page.evaluate(variant=>{
      const near=window.cityGpu.probeWindows({variant,seed:.5625,ratio:.9,mode:3,pixelsPerCell:6,depth:4.5})
      const far=window.cityGpu.probeWindows({variant,seed:.5625,ratio:.9,mode:3,
        pixelsPerCell:variant==='full'?2:6,depth:variant==='lite'?14.5:4.5})
      return {near,far}
    },variant)
    const total=(samples:number[][])=>samples.reduce((s,rgb)=>s+linearLuminance(rgb),0)
    expect(total(result.far.samples)).toBeLessThan(total(result.near.samples)*.8)
    for(const r of Object.values(result)){expect(r.shaderError).toBeNull();expect(r.glError).toBe(0)}
  }
})
test('lite output is identical at different times across all cells',async({page})=>{
  const result=await page.evaluate(()=>({
    a:window.cityGpu.probeWindows({variant:'lite',seed:.5625,ratio:.9,time:0,flicker:1}),
    b:window.cityGpu.probeWindows({variant:'lite',seed:.5625,ratio:.9,time:1,flicker:1}),
  }))
  expect(result.a.samples).toEqual(result.b.samples)
  for(const r of Object.values(result)){expect(r.shaderError).toBeNull();expect(r.glError).toBe(0)}
})
```

Choose the flicker sentinel deterministically from the same production-compatible hashes and verify its raw shader hashes before relying on its eligibility; use the hash debug frame and the same .002 tolerance for its tint. If that first eligible cell's waveform spans less than 5% in the required one-second interval, select the first eligible cell whose CPU `flickerMultiplier` series spans at least 6%; this is a deterministic property of the specified phase, not selecting by successful GPU output.

- [ ] **Step 4: Add real journey tier/state/restore coverage and smooth GPU reveal.**

```ts
for(const [tier,lowPower] of [['full',false],['lite',true],['reduced',false],['reduced',true]] as const) {
  test(`${tier}/${lowPower}: chapters render and restore at fixed state`,async({page})=>{
    await page.evaluate(({tier,lowPower})=>window.cityGpu.mountJourney({tier,lowPower,width:640,height:360}),{tier,lowPower})
    for(const chapter of [0,1,2,3]) {
      const d=await page.evaluate(chapter=>window.cityGpu.renderJourney({chapter,time:.4,frames:300}),chapter)
      expect(d.shaderError).toBeNull();expect(d.glError).toBe(0)
    }
    const before=await page.evaluate(()=>window.cityGpu.readFrame())
    const d=await page.evaluate(async()=>{
      await window.cityGpu.loseAndRestore()
      return window.cityGpu.renderJourney({chapter:3,time:.4,frames:2})
    })
    const after=await page.evaluate(()=>window.cityGpu.readFrame())
    expect(d.shaderError).toBeNull();expect(d.glError).toBe(0)
    expect(after).toEqual(before)
    if(tier==='reduced') {
      await page.evaluate(()=>window.cityGpu.renderJourney({chapter:3,time:9.9,frames:2}))
      expect(await page.evaluate(()=>window.cityGpu.readFrame())).toEqual(after)
    }
    await page.evaluate(()=>window.cityGpu.dispose())
  })
}
test('a production cell reveals continuously and never dims as its ratio rises',async({page})=>{
  const seed=.5625,cell=[0,0] as const,h=windowHashes(cell,seed)
  const t=h.cell*(1.25-.5*h.building),index=40 // row 0, column 40
  const ratios=[t,t+.015,t+.03,t+.045,t+.06]
  const values:number[]=[]
  for(const ratio of ratios) {
    const r=await page.evaluate(({seed,ratio})=>
      window.cityGpu.probeWindows({variant:'full',seed,ratio,mode:1}),{seed,ratio})
    expect(r.shaderError).toBeNull();expect(r.glError).toBe(0)
    values.push(r.samples[index]![0]!)
  }
  expect(values[0]).toBeLessThan(.01);expect(values[4]).toBeGreaterThan(.99)
  expect(values[2]).toBeCloseTo(.5,1)
  for(let i=1;i<values.length;i++) expect(values[i]!).toBeGreaterThan(values[i-1]!)
})
```

The specified continuity sample's CPU hash is approximately .8090, safely away from a hash wrap. Confirm the raw GPU hash agrees first; keep the thresholds' expected continuous values, rather than replacing this test with source-text assertions. The separate lite time test compares **all** 4000 RGB triples, since checking only luminance would miss hue changes.

- [ ] **Step 5: Run browser and unit checks, review lifecycle cleanup, and commit.**

Run: `cd repos/portfolio && npm run test:gpu -- tests/gpu/windows.spec.ts tests/gpu/facade.spec.ts`
Run: `cd repos/portfolio && npm test -- tests/journey/window-look.test.ts tests/journey/facade-material.test.ts`
Expected: real renders pass for full/lite materials and all four tier combinations; recorders remain empty, GL error is zero, fixed restore frames match, and fixture `finally` blocks dispose every target/material/geometry/renderer. Do not treat a unit-only pass as completion.

```bash
cd repos/portfolio && git add tests/gpu/windows-probe.ts tests/gpu/windows.spec.ts tests/gpu/harness.ts
cd repos/portfolio && git commit -m "test: verify production staggered windows on WebGL"
```

The shared `tests/gpu/gpu-utils.ts` remains owned by spec 01; no helper extraction or additional harness dependency is required here.

### Task 4: Complete visual, physical performance, and integration validation

**Files:**
- Modify: `repos/portfolio/tests/gpu/windows.spec.ts` (shared benchmark smoke test)
- Test: all `repos/portfolio/tests/journey/*.test.ts`, `repos/portfolio/tests/gpu/*.spec.ts`
- Record outside the repo: PR screenshots and benchmark result table.

**Interfaces:**
- Consumes: spec 01 `measureJourney({chapter,durationMs?})`, `getJourneyContext`, `resizeJourney`, and Tasks 1–3; the shared probe measures the actual direct/post render path.
- Produces: recorded baseline/after median-of-three render-cost results (mean and p95) for chapters 0/2/3, plus accepted screenshots. This task does not create a permanent production benchmark/UI/API.

- [ ] **Step 1: Verify the shared render-cost probe against the integrated window shader.**

Reuse spec 01's development-only `tests/gpu/render-cost.ts` and `cityGpu.measureJourney`; do not duplicate a benchmark in production or collect timings through cached pixel reads/diagnostic object allocation. Its raw update closure executes the current direct/post render path, synchronizes with a 1×1 readback, caps outstanding GPU queries at 64, and returns null GPU statistics for unavailable/disjoint samples. Preserve these controls. Add this 100 ms smoke case to `windows.spec.ts`:

```ts
test('shared render-cost probe measures the actual window scene',async({page})=>{
  const result=await page.evaluate(async()=>{
    window.cityGpu.mountJourney({tier:'full',lowPower:false,width:640,height:360})
    const report=await window.cityGpu.measureJourney({chapter:2,durationMs:100})
    const diagnostic=window.cityGpu.diagnostics()
    window.cityGpu.dispose()
    return {report,diagnostic}
  })
  expect(result.report.samples).toBeGreaterThan(0)
  expect(Number.isFinite(result.report.meanMs)).toBe(true)
  expect(result.report.meanMs).toBeGreaterThan(0)
  expect(Number.isFinite(result.report.p95Ms)).toBe(true)
  expect(result.diagnostic.shaderError).toBeNull();expect(result.diagnostic.glError).toBe(0)
})
```

Run: `cd repos/portfolio && npm run test:gpu -- tests/gpu/windows.spec.ts --grep "render-cost"`
Expected: PASS. This smoke result does not establish physical performance.

- [ ] **Step 2: Run three physical before/after measurements for chapters 0, 2, and 3.**

Start the test-only harness: `cd repos/portfolio && npm run test:gpu:serve -- --host 0.0.0.0`

Before baseline is the integrated spec 01/02 commit immediately before Task 2 changes window rendering; after is this plan's A/B implementation. Use two isolated checkouts with the identical shared measurement harness; do not reset or overwrite a user's working tree. On the named desktop, set the drawing buffer to **2560×1440** with pixel ratio 1; mount `full,false`. On a named physical iPhone, use its recorded identical before/after drawing-buffer dimensions and mount `lite,true`. Use a trusted LAN connection for the actual iPhone harness; emulation cannot satisfy the performance gate.

In browser console, call `await cityGpu.measureJourney({chapter,durationMs:10000})` for each chapter, three runs per commit/device. Compare the median of the three mean render costs; report p95 and desktop GPU times when available. Acceptance is **after minus before ≤0.2 ms on each physical device**, not merely an unchanged displayed FPS. Record device model, browser/OS, resolution, commits, means, p95s, and differences. If cost misses, profile the full hash/flicker ALU and lite mask; fix only this plan's window logic while preserving distributions/luminance/reduced behavior, then rerun affected correctness and physical checks.

- [ ] **Step 3: Capture required visual evidence and scrub through 20 ratios.**

Use the four chapters at `progress=0` and a mid-transition `progress=.5` between chapters 0/1, desktop and iPhone 14 Pro Max emulation, each in light/dark theme. Capture close wall views to look for diagonal hash stripes and the skyline to check the night silhouette and bloom clutter. Scrub the full chapter range in 20 steps; windows fade without popping, row size stays fixed during height growth, and restoring an earlier ratio restores the same pattern. Test reduced motion on desktop and phone separately. Store screenshots in the PR description, not the repo. Day glass remains the selected spec 01 flat tint; label glint/Fresnel as conditional rather than failed selected-batch work.

- [ ] **Step 4: Run final integration checks.**

Run: `cd repos/portfolio && npm test`
Run: `cd repos/portfolio && npm run test:gpu`
Run: `cd repos/portfolio && npm run typecheck`
Run: `cd repos/portfolio && npm run build`
Run: `cd repos/portfolio && git diff --check`
Expected: PASS, clean shader recorders and GL state in actual browser renders. Inspect the diff to confirm only the pure helper, facade/runtime wiring, and tests changed. Any missing physical access is recorded as a pending performance gate; do not claim the +0.2 ms budget was proven by software Chromium or emulation.

- [ ] **Step 5: Record A/B completion with conditional C status.**

The implementation PR states: Parts A/B pass CPU/GPU checks, reports physical measurements/screenshots, and explicitly says Part C awaits spec 04. Commit the probe smoke test with `cd repos/portfolio && git add tests/gpu/windows.spec.ts && git commit -m "test: validate shared window render-cost probe"`; screenshots and measurement evidence stay in the PR description.

### Task 5 (conditional follow-up): Enable full-tier dusk glass after spec 04 lands

**Gate:** This task is **not executable in the selected 01/02/06 batch**. Start only when production `FacadeUniforms.uSunDir/uSunColor`, full-variant `vWorldNormal`, and spec 04's chapter visibility approximation actually exist and have their own tests. Consume spec 05's real unclamped visibility if it has also landed. The full spec 06 glint/Fresnel criterion remains an external dependency until then; this does not block Tasks 1–4.

**Files:**
- Modify then: `repos/portfolio/app/journey/facade-material.ts` (or extracted `facade-glsl.ts`)
- Modify then: `repos/portfolio/app/journey/scene.ts`
- Modify then: `repos/portfolio/tests/gpu/windows-probe.ts`
- Modify then: `repos/portfolio/tests/gpu/windows.spec.ts`
- Modify then: `repos/portfolio/tests/journey/facade-material.test.ts`

**Interfaces:**
- Consumes: spec 04 `uSunDir:{value:THREE.Vector3}`, `uSunColor:{value:THREE.Color}`, full-only `vWorldNormal`, and normalized unclamped world-space sun direction. Until spec 05, visibility is `clamp(1-1.3*state.windowLitRatio,0,1)`; after spec 05 it is `sky.sunVisibility`.
- Produces then: `FacadeUniforms.uSunVisibility:{value:number}`, full-only `vWorldPos:vec3`, and sky reflection/glint. LowPower shader/uniform mapping remains flat glass; reduced mode uses chapter-static sun inputs.

- [ ] **Step 1: Add failing conditional GPU glass tests without weakening current flat-glass tests.**

Extend the production wall probe input then with `sunDir?:[number,number,number]`, `sunVisibility?:number`, and `viewAngle?:number` in degrees, plus diagnostic mode 4. The fixture sets spec 04 uniforms and centers one fixed physical cell in the probe projection. Add this CPU-independent GPU comparison; do not choose its result from a CPU Fresnel implementation:

```ts
test('conditional full glass reflects the real sun and increases at grazing view',async({page})=>{
  const result=await page.evaluate(()=>{
    const common={seed:.5625,ratio:0,mode:4 as const}
    return {
      sunFacing:window.cityGpu.probeWindows({...common,variant:'full',sunDir:[0,0,1],sunVisibility:1,viewAngle:0}),
      sunAway:window.cityGpu.probeWindows({...common,variant:'full',sunDir:[1,0,0],sunVisibility:1,viewAngle:0}),
      headOn:window.cityGpu.probeWindows({...common,variant:'full',sunVisibility:0,viewAngle:0}),
      grazing:window.cityGpu.probeWindows({...common,variant:'full',sunVisibility:0,viewAngle:76}),
      liteSunFacing:window.cityGpu.probeWindows({...common,variant:'lite',sunDir:[0,0,1],sunVisibility:1,viewAngle:0}),
      liteSunAway:window.cityGpu.probeWindows({...common,variant:'lite',sunDir:[1,0,0],sunVisibility:1,viewAngle:0}),
      liteHeadOn:window.cityGpu.probeWindows({...common,variant:'lite',sunVisibility:0,viewAngle:0}),
      liteGrazing:window.cityGpu.probeWindows({...common,variant:'lite',sunVisibility:0,viewAngle:76}),
    }
  })
  const index=25*80+40
  expect(linearLuminance(result.sunFacing.samples[index]!)).toBeGreaterThan(linearLuminance(result.sunAway.samples[index]!))
  expect(linearLuminance(result.grazing.samples[index]!)).toBeGreaterThan(linearLuminance(result.headOn.samples[index]!))
  expect(result.liteSunFacing.samples[index]).toEqual(result.liteSunAway.samples[index])
  expect(result.liteGrazing.samples[index]).toEqual(result.liteHeadOn.samples[index])
  for(const r of Object.values(result)){expect(r.shaderError).toBeNull();expect(r.glError).toBe(0)}
})
```

The existing four-combination journey restore tests remain mandatory with Part C enabled, and its debug patch is covered by actual renders.

Do not add inactive test skips or sun placeholders during Tasks 1–4. Run only after gate: `cd repos/portfolio && npm run test:gpu -- tests/gpu/windows.spec.ts`; expect the new comparisons to FAIL with spec 01 flat tint.

- [ ] **Step 2: Add full-only world position and glass code to the existing guarded patch.**

Declare `varying vec3 vWorldPos;` in the full vertex/fragment globals only. Add the assignment to spec 04's existing world-position code in the vertex main block, retaining the r186 marker guard and the existing scale/translate assumptions:

```glsl
vWorldPos = (modelMatrix * instanceMatrix * vec4(position,1.0)).xyz;
```

Add `uSunVisibility` to the existing full uniform registration and wrapper object only after it has a real update source. Replace the full side-face glass local after `<color_fragment>` and before rect/average-facade blending:

```glsl
vec3 glassDark = wallColor * 0.25;
vec3 N = normalize(vWorldNormal);
vec3 V = normalize(cameraPosition - vWorldPos);
float fres = pow(1.0 - max(dot(N,V),0.0),3.0);
vec3 R = reflect(-V,N);
float glint = pow(max(dot(R,uSunDir),0.0),24.0) * uSunVisibility;
vec3 glass = mix(glassDark,uSkyTint,0.35+0.45*fres) + uSunColor*glint*0.8;
```

Apply this glass through the same existing window rect/side-face mask and distance fade. Do not multiply `glass` by instance wall tint again: `wallColor` already includes it, and sky/sun colors are independent linear colors. Define `vec3 facadeGlass=vec3(0.0);` beside the other main-block diagnostic locals; assign `facadeGlass=glass;` within both variants' side-face branches, using the existing flat local in lite. Add the opt-in diagnostic branch after dithering:

```glsl
#elif defined(FACADE_DEBUG_WINDOW) && FACADE_DEBUG_WINDOW == 4
  gl_FragColor=vec4(facadeGlass,1.0);
```

Cache key suffix changes to `windows-abc` for full; lite keeps no sun, Fresnel, reflect, or new world-position code.

- [ ] **Step 3: Wire the real chapter sun visibility and extend the fixture concretely.**

Before spec 05, assign `facade.uSunVisibility.value=Math.max(0,Math.min(1,1-1.3*current.windowLitRatio))` alongside spec 04's sun mapping. After spec 05, assign `sky.sunVisibility` instead, using the real unclamped sun vector; delete the approximation and its tests in the same change. Initialize the wrapper with the same initial chapter visibility before shader warm-up.

At this future point, extend `WindowProbeInput.mode` to `0|1|2|3|4`, and add the three optional inputs named above. Add these actual wrappers to the fixture uniform object; the spec 04 effect strengths are zero in the isolated glass test:

```ts
uSunDir:{value:new THREE.Vector3().fromArray(input.sunDir??[0,0,1]).normalize()},
uSunColor:{value:new THREE.Color(0xffe1a8)},
uSunVisibility:{value:input.sunVisibility??1},
uAoStrength:{value:0},uRimStrength:{value:0},uBounce:{value:0},
uBounceColor:{value:new THREE.Color(0xffc983)},
```

After the fixture's ordinary camera setup, center the exact physical cell for diagnostic mode 4. The projection offset accounts for a pixel center so both viewing angles sample the same point, not neighboring glass:

```ts
if(input.mode===4) {
  const x=.08,y=-1+25.5*.22,z=.5
  const angle=(input.viewAngle??0)*Math.PI/180
  camera.position.set(x+depth*Math.sin(angle),y,z+depth*Math.cos(angle))
  camera.lookAt(x,y,z)
  const sampleX=40*p+Math.floor(p/2),sampleY=25*p+Math.floor(p/2)
  const offsetX=((sampleX+.5)/width-.5)*12.8
  const offsetY=((sampleY+.5)/height-.5)*11
  camera.left-=offsetX;camera.right-=offsetX
  camera.top-=offsetY;camera.bottom-=offsetY
  camera.updateProjectionMatrix()
}
```

Do not change material roughness or lighting inputs between comparisons. No parts of this fixture extension enter Tasks 1–4 while spec 04 is absent.

- [ ] **Step 4: Run conditional correctness, restore, screenshots, and the physical budget again.**

Run: `cd repos/portfolio && npm test -- tests/journey/window-look.test.ts tests/journey/facade-material.test.ts`
Run: `cd repos/portfolio && npm run test:gpu -- tests/gpu/windows.spec.ts tests/gpu/gradient.spec.ts`
Run: `cd repos/portfolio && npm run typecheck`
Repeat Task 4 before/after physical measurements and daytime/glancing-wall screenshots. Budget remains +0.2 ms for spec 06's complete change against the spec 01/02/04 baseline, with no added lowPower reflection work. Only then can the full Part C criterion be marked complete.

```bash
cd repos/portfolio && git add app/journey/facade-material.ts app/journey/scene.ts tests/gpu/windows-probe.ts tests/gpu/windows.spec.ts tests/journey/facade-material.test.ts
cd repos/portfolio && git commit -m "feat: reflect dusk sky and sun in full-tier glass"
```

Include the extracted GLSL module explicitly if it owns the glass change.

## Plan self-review and handoff

- Spec Part A threshold scale, 6% fade, monotonic reveal, stratified occupancy ranges, and noise-free spread: Task 1; production agreement and continuous reveal: Task 3.
- Spec Part B sRGB classes/linear gains, 2.3 target, projects minimum ≥2.0, fixed lowPower brightness, explicit reduced gate, modulo time, and flicker share: Tasks 1–3.
- Existing spec 01 full/lite filtering and shared failure path remain active: Tasks 2/3. Real production mode 0 emission is compared with diagnostics so a diagnostic-only shader cannot establish correctness.
- All four tiers/power combinations, real restore renders, disposal, screenshots, and physical +0.2 ms evidence: Tasks 3/4.
- Spec Part C is fully described as a dependency-gated follow-up, not silently omitted or implemented using absent uniforms: Task 5. Glint/Fresnel GPU coverage is conditional until then.
- CPU vs GLSL hashing is explicitly float32 with ordered intermediates; highp stability is tested rather than assumed. Unit stratification never masquerades as GPU per-building statistics.
- Interfaces use the existing third exhibit argument, spec 01 lowPower options, shared recorder, and harness URL/API. No overlapping ownership of spec 02 post-processing.
- Review Focus conditions each map to a concrete owning test. No product changes, dependency installation, or measurements are claimed by this planning artifact.
- Author-time arithmetic validation loaded the planned pure helper against installed Three r186: stratified fractions .021/.27595/.63345/.8706; actual salted lit-window shares 69.3/20.42/10.28%, eligible flicker 4.27%; forty-wall CPU maximum distribution error .01842; gains 3.5564/2.7537/3.2119. These are checks of proposed formulas, not completed implementation tests or GPU/performance measurements.

Execution should start with Task 1 independently, then wait for spec 01 foundation and coordinate shared-file integration with spec 02. The selected batch's completion report must distinguish A/B completion from the still-conditional full Part C scope.
