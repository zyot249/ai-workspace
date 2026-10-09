# Procedural facade shader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the skyline's floating window instances with a world-sized, base-anchored facade shader, with tested desktop/mobile variants and graceful GPU failure recovery.

**Architecture:** Patch `MeshStandardMaterial` in a dedicated facade module and share two uniforms across the three existing building layers. Introduce the series' shader-error recorder, separate device cost from motion preference, and warm up the actual render path before exposing the scene. A development-only Vite browser harness imports the real application modules; Vitest covers math/patch contracts and Playwright covers real WebGL2 output and lifecycle failures.

**Tech Stack:** Existing Nuxt 4/Vue 3/TypeScript, installed Three.js **0.186.0** and Vitest 5; add Playwright test tooling and explicitly declare the already installed Vite 8.3.0 and Vue Vite plugin 6.0.9 as development dependencies.

**Spec:** `docs/superpowers/specs/2026-10-09-city-01-facade-shader-design.md`, together with `docs/superpowers/specs/2026-10-09-city-00-shared-conventions.md`.

## Global Constraints

- `StopState` colors (`skyColor`, `fogColor`, and any new `Vec3` color) are sRGB values produced by `hexToRgb`.
- Always pass `THREE.SRGBColorSpace` when writing those triples into `THREE.Color.setRGB`.
- Patch built-in materials with `onBeforeCompile` and `replaceOrThrow(source, marker, replacement)` from `app/journey/shader-utils.ts`.
- Never use a bare `String.replace` on shader source.
- Set `frustumCulled = false` on every `InstancedMesh` whose matrices change over time.
- When two variants of a patched material exist, `customProgramCacheKey` includes the variant name.
- `tier === 'reduced'` decides motion; `lowPower` decides cost and detail.
- Lite: no extra render passes. Full: `fwidth` anti-aliasing. Reduced: static look per chapter, no time-driven animation.
- Cell size is `0.16 x 0.22` world units; window rectangle is `[0.2, 0.8] x [0.18, 0.82]`; floor band is `0.02` world units.
- Lite view-depth fade uses `FADE_NEAR = 6.0` and `FADE_FAR = 14.0` world units.
- Warm emissive color is `#ffe1a8`, converted to linear; `EMISSIVE_GAIN = 2.7`.
- World anchors: building base and road `-1`; road center line `-0.99`; ground `-1.01`; camera height `0.2 to 0.8`.
- Road half width is `3`; path length is `100` units with two 90-degree turns.
- Unit tests live in `tests/journey/*.test.ts`; GPU tests live in `tests/gpu/*.spec.ts`, run through `npm run test:gpu`, and perform real renders.
- Anything with GPU resources is disposed in `JourneyScene.dispose()`; context-loss tests use `WEBGL_lose_context`.
- No frame-time regression above `10%` on lite, measured on a physical phone using the shared sync-based procedure.
- New feature code goes in new modules under `app/journey/`; `scene.ts` keeps wiring and stays below its `800`-line soft ceiling.
- Do not implement spec 03 geometry/archetypes, spec 04 occlusion/rim shading, or spec 06 flicker/variety in this plan.

## Review Focus

- Reduced-motion phones must use mobile counts/shaders and remain static at arbitrary time/progress; pin all four normal combinations plus explicit full/lite lowPower overrides in Tasks 1, 3 and 5.
- Shrinking/growing walls must clip complete fixed-size cells, without translating existing rows; prove both the pure grid model and fixed camera pixel samples in Tasks 2 and 5.
- Top faces and negative horizontal cell coordinates must remain valid, with roofs unaffected and all four side orientations windowed; test actual pixels in Task 5.
- A shader may first fail during a restored context or an initially disabled post pass; retain the recorder across restore, use actual warmup frames, and test creation/runtime failure in Tasks 3 and 6.
- Repeated creation/disposal and failed startup must free textures, geometries, materials and the renderer exactly once; test spies and browser navigation/context cycles in Tasks 3 and 6.

---

## Execution boundaries and current code

This document is a plan, not an execution request. All file paths below are relative to the workspace; every shell command explicitly runs from `repos/portfolio`. Installation and commits listed below are future execution steps only. Read the two specs before executing. Worktree creation is an execution-time decision, not part of writing this plan.

The three selected plans were written independently in parallel. At implementation time, pure facade/shader-utils work, the post module and atomic post `StopState` additions, and the window-look pure helpers can be built in separate branches concurrently. Serialize edits to shared `scene.ts`, `JourneyCanvas.vue`, and browser harness files after spec 01 foundations land; then integrate spec 02 and spec 06 against their declared shared contracts. Check a clean workspace root and `repos/portfolio` status before execution; writing this plan performs no product changes or commits.

Inspected implementation: `createJourneyScene(canvas, tier, projectItems)` already has a **third** argument; the options must be a **fourth** argument. `scene.ts` has three `BoxGeometry` layers (24/32/40 instances; lite rounds each count times 0.6), one near-layer floating window instanced mesh, chapter damping at 0.08, and no post pipeline. Existing `apply` correctly converts sky/fog/hemi colors from sRGB. Existing disposal traverses meshes but does not dispose exhibition canvas textures. `JourneyCanvas.vue` already handles lost/restored contexts, but its RAF callback has no catch. `vitest.config.ts` discovers only `tests/**/*.test.ts` in Node. Installed r186 `meshphysical.glsl.js` contains `begin_vertex`, `project_vertex`, `color_fragment`, and `emissivemap_fragment`; `mvPosition` only exists **after** `project_vertex`. r186 `WebGLProgram.onFirstUse` invokes `onShaderError` only upon first uniforms/attributes access, so `compile()` alone cannot validate this change.

## File map

| File | Responsibility |
| --- | --- |
| `repos/portfolio/app/journey/shader-utils.ts` | Checked replacement, renderer recorder registry, real-frame assertion; no rendering pipeline ownership. |
| `repos/portfolio/app/journey/facade-grid.ts` | Constants and pure base-anchored coordinate/reference-cell math. |
| `repos/portfolio/app/journey/facade-material.ts` | Uniform interface, variant GLSL and material factory. |
| `repos/portfolio/app/journey/tier.ts` | Shared `lowPowerFor(TierInput)` device-cost helper. |
| `repos/portfolio/app/journey/scene.ts` | Fourth-argument options, layer seeds/materials, shared updates, initial real render, cleanup. |
| `repos/portfolio/app/components/JourneyCanvas.vue` | Explicit lowPower input and guarded RAF rendering. |
| `repos/portfolio/tests/journey/{tier,shader-utils,facade-grid,facade-material}.test.ts` | Device, error, grid and patch contracts. |
| `repos/portfolio/{playwright.config.ts,vite.gpu.config.ts,package.json,package-lock.json}` | Browser-only tooling and separate development server. |
| `repos/portfolio/tests/gpu/{harness.html,harness.ts,gpu-utils.ts}` | Browser API, application scene adapter, reusable renderer/readback helpers. |
| `repos/portfolio/tests/gpu/{facade-probe.ts,facade.spec.ts}` | Deterministic facade fixtures, chapter rendering, pixel/restore/draw tests. |
| `repos/portfolio/tests/gpu/{component-probe.ts,shader-failure.spec.ts}` | Real Vue component creation/runtime fallback proofs. |
| `repos/portfolio/tests/gpu/render-cost.ts` | Development-only sync/timer query measurement, no production flag or UI. |

No new `StopState` fields are required by spec 01. Later plans adding fields must change the type, all four stops, `lerpStop`, and endpoint/midpoint tests in one commit.

## Shared interfaces for specs 02 and 06

Keep these names/signatures stable. Feature probe modules import `gpu-utils.ts`, **never** `harness.ts`, to avoid cycles. Later plans extend `FacadeUniforms` in `facade-material.ts`; do not duplicate or freeze its definition.

```ts
// scene.ts — additions; preserve existing JourneyScene and ExhibitItem.
export interface JourneySceneOptions {
  lowPower?: boolean
  onRenderer?: (renderer: THREE.WebGLRenderer) => void
  onSceneReady?: (context: {
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
  }) => void
}
// options defaults to {}; resolved cost = options.lowPower ?? (tier === 'lite').
createJourneyScene(canvas, tier, projectItems, options?: JourneySceneOptions): JourneyScene

// facade-material.ts
export interface FacadeUniforms {
  uLit: { value: number }
  uSkyTint: { value: THREE.Color }
}
export type FacadeVariant = 'full' | 'lite'
createFacadeMaterial(options: {
  color: number; uniforms: FacadeUniforms; variant: FacadeVariant
}): THREE.MeshStandardMaterial

// shader-utils.ts
export interface ShaderErrorRecorder {
  readonly error: Error | null
  assertClean(): void
  dispose(): void
}
createShaderErrorRecorder(renderer: THREE.WebGLRenderer): ShaderErrorRecorder
getShaderErrorRecorder(renderer: THREE.WebGLRenderer): ShaderErrorRecorder | undefined
replaceOrThrow(source: string, marker: string, replacement: string): string

// tests/gpu/gpu-utils.ts
export interface GpuDiagnostics {
  shaderError: string | null; glError: number; calls: number
  width: number; height: number; geometries: number; textures: number
}
createTestRenderer(options?: {width?: number; height?: number}): {
  renderer: THREE.WebGLRenderer; recorder: ShaderErrorRecorder
  canvas: HTMLCanvasElement; dispose(): void
}
readFrame(renderer: THREE.WebGLRenderer): number[]
readPixel(renderer: THREE.WebGLRenderer, x: number, y: number): number[]
diagnostics(renderer: THREE.WebGLRenderer): GpuDiagnostics

// tests/gpu/harness.ts — window.cityGpu browser API.
mountJourney(options: {
  tier: 'full' | 'lite' | 'reduced'; lowPower: boolean
  width?: number; height?: number
}, observers?: Pick<JourneySceneOptions, 'onRenderer' | 'onSceneReady'>): void
renderJourney(options: {
  chapter: number; progress?: number; time?: number; frames?: number
}): GpuDiagnostics
getJourneyContext(): {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer
}
resizeJourney(width: number, height: number): void
getJourneyUpdate(): () => void
loseAndRestore(): Promise<GpuDiagnostics>
diagnostics(): GpuDiagnostics
readFrame(): number[]
dispose(): void
```

`onRenderer` runs immediately after recorder installation and before rendering; `onSceneReady` runs only after successful initial warmup. Both are observation seams for the development harness and performance probe, not product controls. Spec 02 replaces the single real render with its actual `post.render()` path and warms optional passes once forced on and once at the actual chapter state; spec 01 owns only the existing direct-render path. Recorder and cleanup remain shared.

### Task 1: Device cost and shader guard primitives

**Files:**
- Modify: `repos/portfolio/app/journey/tier.ts`; `repos/portfolio/tests/journey/tier.test.ts`
- Create: `repos/portfolio/app/journey/shader-utils.ts`; `repos/portfolio/tests/journey/shader-utils.test.ts`

**Interfaces:** Consumes existing `TierInput`/`LITE_MAX_WIDTH` and r186 renderer debug callback. Produces `lowPowerFor(input): boolean` plus the three shader-utils exports declared above.

- [ ] **Step 1: Add failing device/marker/recorder tests.** Add this device matrix to `tier.test.ts` and a new shader-utils test file. Fake renderer contexts are intentionally Node-only; actual GLSL failure is Task 6.

```ts
it.each([
  [767, false, true], [768, false, false], [1440, true, true],
] as const)('cost policy width=%i coarse=%s', (width, coarsePointer, expected) => {
  for (const reducedMotion of [false, true]) {
    expect(lowPowerFor({ webgl: true, reducedMotion, width, coarsePointer })).toBe(expected)
  }
})
```

```ts
import { expect, it, vi } from 'vitest'
import type * as THREE from 'three'
import { createShaderErrorRecorder, getShaderErrorRecorder, replaceOrThrow } from '../../app/journey/shader-utils'

it('replaces exactly the requested marker and fails loudly when absent', () => {
  expect(replaceOrThrow('a MARK b', 'MARK', 'PATCH')).toBe('a PATCH b')
  expect(() => replaceOrThrow('a b', 'MARK', 'PATCH')).toThrow('Missing shader marker: MARK')
})
it('retains first failure, registers itself, restores previous callback', () => {
  const previous = vi.fn()
  const renderer = { debug: { checkShaderErrors: false, onShaderError: previous } } as unknown as THREE.WebGLRenderer
  const gl = {
    getProgramInfoLog: () => 'bad link',
    getShaderInfoLog: () => 'bad GLSL',
  } as unknown as WebGLRenderingContext
  const recorder = createShaderErrorRecorder(renderer)
  expect(renderer.debug.checkShaderErrors).toBe(true)
  expect(getShaderErrorRecorder(renderer)).toBe(recorder)
  renderer.debug.onShaderError!(gl, {} as WebGLProgram, {} as WebGLShader, {} as WebGLShader)
  const first = recorder.error
  renderer.debug.onShaderError!(gl, {} as WebGLProgram, {} as WebGLShader, {} as WebGLShader)
  expect(recorder.error).toBe(first)
  expect(() => recorder.assertClean()).toThrow('bad link')
  expect(first?.message).toContain('bad GLSL')
  recorder.dispose()
  expect(renderer.debug.onShaderError).toBe(previous)
  expect(renderer.debug.checkShaderErrors).toBe(false)
  expect(getShaderErrorRecorder(renderer)).toBeUndefined()
})
```

- [ ] **Step 2: Prove red.** Run `cd repos/portfolio && npm test -- tests/journey/tier.test.ts tests/journey/shader-utils.test.ts`. Expect missing exports/module errors; confirm no browser is involved.
- [ ] **Step 3: Implement the helpers.** Export `lowPowerFor` and have existing `pickTier` call it after the reduced-motion branch. Use the r186 callback's exact four arguments, retain the first error and restore prior debug settings on disposal.

```ts
export function lowPowerFor(input: TierInput): boolean {
  return input.coarsePointer || input.width < LITE_MAX_WIDTH
}
```

```ts
import type * as THREE from 'three'
export interface ShaderErrorRecorder {
  readonly error: Error | null
  assertClean(): void
  dispose(): void
}
const recorders = new WeakMap<THREE.WebGLRenderer, ShaderErrorRecorder>()
export function replaceOrThrow(source: string, marker: string, replacement: string): string {
  const index = source.indexOf(marker)
  if (index < 0) throw new Error(`Missing shader marker: ${marker}`)
  return source.slice(0, index) + replacement + source.slice(index + marker.length)
}
export function getShaderErrorRecorder(renderer: THREE.WebGLRenderer): ShaderErrorRecorder | undefined {
  return recorders.get(renderer)
}
export function createShaderErrorRecorder(renderer: THREE.WebGLRenderer): ShaderErrorRecorder {
  const previous = renderer.debug.onShaderError
  const checked = renderer.debug.checkShaderErrors
  let first: Error | null = null
  let disposed = false
  renderer.debug.checkShaderErrors = true
  const callback: NonNullable<THREE.WebGLRenderer['debug']['onShaderError']> = (gl, program, vertex, fragment) => {
    first ??= new Error([
      '[journey] Shader compile/link failed',
      gl.getProgramInfoLog(program) ?? '',
      gl.getShaderInfoLog(vertex) ?? '',
      gl.getShaderInfoLog(fragment) ?? '',
    ].join('\n'))
  }
  renderer.debug.onShaderError = callback
  const recorder: ShaderErrorRecorder = {
    get error() { return first },
    assertClean() { if (first) throw first },
    dispose() {
      if (disposed) return
      disposed = true
      if (renderer.debug.onShaderError === callback) renderer.debug.onShaderError = previous
      renderer.debug.checkShaderErrors = checked
      recorders.delete(renderer)
    },
  }
  recorders.set(renderer, recorder)
  return recorder
}
```

- [ ] **Step 4: Prove green.** Repeat the Step 2 command. All previous tier tests and both new primitive tests pass.
- [ ] **Step 5: Commit the independently testable primitives.** Run `cd repos/portfolio && git add app/journey/tier.ts app/journey/shader-utils.ts tests/journey/tier.test.ts tests/journey/shader-utils.test.ts && git commit -m "feat: add journey device cost and shader guards"`.

### Task 2: Base-anchored grid and facade material

**Files:**
- Create: `repos/portfolio/app/journey/facade-grid.ts`; `repos/portfolio/app/journey/facade-material.ts`
- Create: `repos/portfolio/tests/journey/facade-grid.test.ts`; `repos/portfolio/tests/journey/facade-material.test.ts`

**Interfaces:** Consumes `replaceOrThrow`; produces `FacadeUniforms`, `FacadeVariant`, material factory, `FACADE_CELL`, `FACADE_BASE_Y`, `facadeBaseY(localY,height):number`, `facadeCellAtWorldY(worldY):{row:number,local:number}`, `floorWorldY(row):number`.

- [ ] **Step 1: Write failing math and material tests.** Material tests call the patch using the actual pinned `ShaderLib.standard` strings, not copied markers. Include full and lite variants and assert a later extension can share the same uniform references.

```ts
import { expect, it } from 'vitest'
import { facadeBaseY, facadeCellAtWorldY, floorWorldY } from '../../app/journey/facade-grid'
it('keeps physical rows anchored as the building grows', () => {
  for (const row of [0, 1, 2]) {
    const worldY = floorWorldY(row)
    for (const height of [0.6, 1.0]) {
      const localY = (worldY + 1) / height - 0.5
      expect(facadeBaseY(localY, height)).toBeCloseTo(row * 0.22, 12)
      expect(facadeCellAtWorldY(worldY + 1e-8).row).toBe(row)
    }
  }
  expect(facadeBaseY(-0.5, 0.6)).toBe(0)
})
```

```ts
import * as THREE from 'three'
import { expect, it } from 'vitest'
import { createFacadeMaterial } from '../../app/journey/facade-material'
it.each(['full', 'lite'] as const)('patches pinned standard shader: %s', variant => {
  const uniforms = { uLit: { value: 0.9 }, uSkyTint: { value: new THREE.Color(0xbfdbfe) } }
  const material = createFacadeMaterial({ color: 0x1f2438, uniforms, variant })
  const shader = {
    uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  }
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
  expect(shader.uniforms).toMatchObject(uniforms)
  expect((shader.uniforms as typeof uniforms).uLit).toBe(uniforms.uLit)
  expect(material.customProgramCacheKey()).toBe(`facade-${variant}`)
  expect(shader.vertexShader).toContain('(position + vec3(0.0, 0.5, 0.0)) * facadeScale')
  expect(shader.vertexShader.indexOf('vFacadeDepth = -mvPosition.z')).toBeGreaterThan(shader.vertexShader.indexOf('#include <project_vertex>'))
  expect(shader.fragmentShader).toContain('totalEmissiveRadiance += facadeWindowEmission')
  expect(shader.fragmentShader.includes('fwidth(')).toBe(variant === 'full')
  expect(shader.fragmentShader).toContain('#include <color_fragment>')
  expect(shader.fragmentShader).toContain('#include <emissivemap_fragment>')
})
it('separates program cache variants', () => {
  const uniforms = { uLit: { value: 0 }, uSkyTint: { value: new THREE.Color() } }
  const full = createFacadeMaterial({ color: 0, uniforms, variant: 'full' })
  const lite = createFacadeMaterial({ color: 0, uniforms, variant: 'lite' })
  expect(full.customProgramCacheKey()).not.toBe(lite.customProgramCacheKey())
})
```

- [ ] **Step 2: Prove red.** Run `cd repos/portfolio && npm test -- tests/journey/facade-grid.test.ts tests/journey/facade-material.test.ts`. Expect missing modules.
- [ ] **Step 3: Implement pure grid functions.** These are reference math that the GLSL mirrors, not a UV texture mapping.

```ts
export const FACADE_CELL = [0.16, 0.22] as const
export const FACADE_BASE_Y = -1
export function facadeBaseY(localY: number, height: number): number {
  return (localY + 0.5) * height
}
export function floorWorldY(row: number): number {
  return FACADE_BASE_Y + row * FACADE_CELL[1]
}
export function facadeCellAtWorldY(worldY: number): { row: number; local: number } {
  const cells = (worldY - FACADE_BASE_Y) / FACADE_CELL[1]
  const row = Math.floor(cells)
  return { row, local: cells - row }
}
```

- [ ] **Step 4: Implement the factory using checked patch points.** Put uniforms/types in `facade-material.ts`. Use `material.name = 'journey-facade-' + variant` for diagnostic selection. Preserve the native PBR/light/fog/tone-mapping stages. Derivative filtering must affect glass, floor bands **and emission**; merely filtering the diffuse term still shimmers.

```ts
import * as THREE from 'three'
import { FACADE_CELL } from './facade-grid'
import { replaceOrThrow } from './shader-utils'
export interface FacadeUniforms {
  uLit: { value: number }
  uSkyTint: { value: THREE.Color }
}
export type FacadeVariant = 'full' | 'lite'
const warm = new THREE.Color(0xffe1a8)
const warmGlsl = `vec3(${warm.r.toFixed(9)}, ${warm.g.toFixed(9)}, ${warm.b.toFixed(9)})`
const vertexDeclarations = `
attribute float aSeed;
varying vec3 vFacadePos;
varying vec3 vFaceNormal;
varying float vSeed;
varying float vFacadeDepth;
`
const fragmentDeclarations = `
uniform float uLit;
uniform vec3 uSkyTint;
varying vec3 vFacadePos;
varying vec3 vFaceNormal;
varying float vSeed;
varying float vFacadeDepth;
float facadeHash13(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
`
function facadeColorPatch(variant: FacadeVariant): string {
  const filter = variant === 'full'
    ? `vec2 aa = max(fwidth(uv) / CELL, vec2(0.00001));
       distanceFade = smoothstep(0.35, 0.7, max(aa.x, aa.y));
       vec2 lo = smoothstep(vec2(0.2, 0.18) - aa, vec2(0.2, 0.18) + aa, local);
       vec2 hi = 1.0 - smoothstep(vec2(0.8, 0.82) - aa, vec2(0.8, 0.82) + aa, local);
       float rect = lo.x * lo.y * hi.x * hi.y;
       float floorBand = 1.0 - smoothstep(0.02 - aa.y * CELL.y, 0.02 + aa.y * CELL.y, local.y * CELL.y);`
    : `distanceFade = smoothstep(6.0, 14.0, vFacadeDepth);
       float rect = step(0.2, local.x) * step(local.x, 0.8) * step(0.18, local.y) * step(local.y, 0.82);
       float floorBand = 1.0 - step(0.02, local.y * CELL.y);`
  return `
#include <color_fragment>
vec2 facadeCell = vec2(0.0);
vec2 facadeLocal = vec2(0.0);
float windowCoverage = 0.0;
float distanceFade = 0.0;
float facadeCellHash = 0.0;
float facadeBuildingHash = 0.0;
float facadeLit = 0.0;
vec3 facadeWindowEmission = vec3(0.0);
if (abs(vFaceNormal.y) < 0.5) {
  vec2 uv = abs(vFaceNormal.x) > 0.5 ? vec2(vFacadePos.z, vFacadePos.y) : vec2(vFacadePos.x, vFacadePos.y);
  const vec2 CELL = vec2(${FACADE_CELL[0]}, ${FACADE_CELL[1]});
  facadeCell = floor(uv / CELL);
  facadeLocal = fract(uv / CELL);
  vec2 local = facadeLocal;
  ${filter}
  vec3 wallColor = diffuseColor.rgb;
  vec3 glass = mix(wallColor, uSkyTint * 0.35, 0.6);
  windowCoverage = rect * (1.0 - distanceFade);
  vec3 linedWall = wallColor * (1.0 - 0.12 * floorBand * (1.0 - distanceFade));
  vec3 detail = mix(linedWall, glass, windowCoverage);
  const float windowArea = 0.6 * 0.64;
  const float floorArea = 0.02 / 0.22;
  vec3 averageFacade = mix(wallColor * (1.0 - 0.12 * floorArea), glass, windowArea);
  diffuseColor.rgb = mix(detail, averageFacade, distanceFade);
  facadeCellHash = facadeHash13(vec3(facadeCell, vSeed));
  facadeLit = 1.0 - step(uLit, facadeCellHash);
  facadeWindowEmission = ${warmGlsl} * 2.7 * facadeLit * windowCoverage;
}
`
}
export function createFacadeMaterial(options: {
  color: number; uniforms: FacadeUniforms; variant: FacadeVariant
}): THREE.MeshStandardMaterial {
  const { color, uniforms, variant } = options
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 })
  material.name = `journey-facade-${variant}`
  material.customProgramCacheKey = () => `facade-${variant}`
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <common>', '#include <common>\n' + vertexDeclarations)
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <begin_vertex>', `
#include <begin_vertex>
vec3 facadeScale = vec3(1.0);
#ifdef USE_INSTANCING
facadeScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
#endif
vFacadePos = (position + vec3(0.0, 0.5, 0.0)) * facadeScale;
vFaceNormal = normal;
vSeed = aSeed;
`)
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <project_vertex>', '#include <project_vertex>\nvFacadeDepth = -mvPosition.z;')
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <common>', '#include <common>\n' + fragmentDeclarations)
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <color_fragment>', facadeColorPatch(variant))
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += facadeWindowEmission;')
  }
  return material
}
```

Zero-width hidden instances remain valid: scale extraction never divides by zero. Top/bottom faces use the unchanged material albedo. `floor(uv/CELL)` with `fract` handles negative horizontal coordinates. Instance color, if later present, is already applied before `wallColor`; glass remains independently tinted. This creates no textures, lights, extra meshes, or new draws. Floor-line tint uses the declared starting factor 0.12; visually tune that factor only after pixel contracts pass. Spec 06 may replace the hash/lit calculation and add uniforms but must keep these patch boundaries and filtering contracts. The fragment-scope locals `facadeCell`, `facadeLocal`, `windowCoverage`, `distanceFade`, `facadeCellHash`, `facadeBuildingHash`, `facadeLit`, and `facadeWindowEmission` remain visible after `dithering_fragment` for test-only diagnostics. `windowCoverage` already includes `(1.0 - distanceFade)`, so later emission must not multiply that factor twice. `facadeBuildingHash` is zero in spec 01; spec 06 assigns it its real building hash, using function names distinct from these locals.

- [ ] **Step 5: Prove green and commit.** Run `cd repos/portfolio && npm test -- tests/journey/facade-grid.test.ts tests/journey/facade-material.test.ts`, then `cd repos/portfolio && git add app/journey/facade-grid.ts app/journey/facade-material.ts tests/journey/facade-grid.test.ts tests/journey/facade-material.test.ts && git commit -m "feat: add anchored procedural facade material"`.

### Task 3: Wire the real scene and runtime fallback

**Files:** Modify `repos/portfolio/app/journey/scene.ts`, `repos/portfolio/app/components/JourneyCanvas.vue`. Extend `repos/portfolio/tests/journey/facade-material.test.ts` with layer attribute contract checks once the browser fixture exists in Task 5; runtime proof comes in Tasks 5–6.

**Interfaces:** Consumes material factory, uniform interface and recorder; produces `JourneySceneOptions` fourth argument and unchanged `JourneyScene` methods. `onRenderer` precedes every render; `onSceneReady` follows validated warmup. Future post factory calls replace only `renderFrame()` and add owned cleanup.

- [ ] **Step 1: Write the failing acceptance tests before changing wiring.** Create `tests/gpu/facade.spec.ts` with the chapter/tier test from Task 5 and `tests/gpu/shader-failure.spec.ts` with Task 6's creation/update tests. Until Task 4 supplies tooling the expected failure is missing script; after Task 4 their expected failure is missing facade/guard behavior. Add this source-contract test to `facade-material.test.ts` only as a narrow executable fixture for removed old code, not as GPU proof:

```ts
import { readFileSync } from 'node:fs'
it('removes obsolete skyline window mesh and opts changing matrices out of culling', () => {
  const source = readFileSync(new URL('../../app/journey/scene.ts', import.meta.url), 'utf8')
  for (const oldName of ['createWindows', 'applyWindowState', 'windowsMesh', 'interface WindowLight']) {
    expect(source).not.toContain(oldName)
  }
  expect(source).toContain('mesh.frustumCulled = false')
})
```

- [ ] **Step 2: Prove the current integration fails.** Run `cd repos/portfolio && npm test -- tests/journey/facade-material.test.ts`; expect the old `createWindows` assertion to fail.
- [ ] **Step 3: Change layer construction and delete the old window implementation.** Import facade factory/types and recorder. Add the options interface above. Change `createBuildingLayer(config, layerIndex, lowPower, facade)` and its call sites as follows; preserve placement and matrix code otherwise.

```ts
const count = lowPower ? Math.round(config.count * 0.6) : config.count
const geometry = new THREE.BoxGeometry(1, 1, 1)
geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(
  Float32Array.from({ length: count }, (_, i) => seeded(layerIndex * 1000 + i)), 1,
))
const material = createFacadeMaterial({ color: config.color, uniforms: facade, variant: lowPower ? 'lite' : 'full' })
const mesh = new THREE.InstancedMesh(geometry, material, count)
mesh.name = ['journey-building-near', 'journey-building-mid', 'journey-building-far'][layerIndex]
  ?? `journey-building-${layerIndex}`
mesh.frustumCulled = false
```

Delete `WindowLight`, `createWindows`, `applyWindowState`, the near-layer destructuring used only for windows, `windowsMesh` creation/addition and both window lines in `apply`. Keep the courtyard's two authored house window meshes: those are static set-piece geometry, not the removed skyline window batch.

- [ ] **Step 4: Add fourth-argument options, initial apply/warmup and shared uniforms.** Resolve `const lowPower = options.lowPower ?? (tier === 'lite')`. Antialiasing uses `!lowPower`, DPR uses `lowPower ? 1.5 : 2`, layer counts/variant use lowPower. Static stars follow detail (`!lowPower`) rather than `tier === 'full'`; reduced desktop gets static full detail. Install the recorder directly after renderer construction. Call `options.onRenderer?.(renderer)` inside the startup try so observer errors clean up too.

Use the exact installation statement `const recorder = createShaderErrorRecorder(renderer)`; Task 4's test-only Vite transform anchors its renderer observer on this statement. Configure normal renderer DPR before invoking the optional `onRenderer` callback, so the harness's explicit pixel ratio 1 wins. No render occurs before that callback.

```ts
const facade: FacadeUniforms = {
  uLit: { value: 0 }, uSkyTint: { value: new THREE.Color() },
}
// In apply(state), before rendering:
facade.uLit.value = state.windowLitRatio
facade.uSkyTint.value.setRGB(...state.skyColor, THREE.SRGBColorSpace)

function resize(width: number, height: number) {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  renderer.setSize(safeWidth, safeHeight, false)
  camera.aspect = safeWidth / safeHeight
  camera.fov = fovForAspect(camera.aspect)
  camera.updateProjectionMatrix()
}
function renderFrame() {
  renderer.render(scene, camera)
  recorder.assertClean()
}
// At end of successful construction; wrap construction and these calls in try/catch.
apply(current)
resize(canvas.clientWidth || canvas.width || window.innerWidth,
  canvas.clientHeight || canvas.height || window.innerHeight)
renderFrame()
const gl = renderer.getContext()
const startupError = gl.getError()
if (startupError !== gl.NO_ERROR) throw new Error(`[journey] WebGL warmup error: ${startupError}`)
options.onSceneReady?.({ scene, camera })
```

The normal `update` keeps its existing target/damping/tilt logic, calls `apply(current)`, then `renderFrame()`. Do not call `gl.getError()` on every production frame; the recorder assertion is the runtime contract and GPU tests read GL errors after renders. Assign initial matrices before the first render. Use existing `target` behavior for reduced motion so progress/time/pointer cannot animate it. Preserve the camera path and existing exhibition contents. Spec 02 later forces optional post passes on for one warmup and restores current state for a second; do not add a fake composer here.

- [ ] **Step 5: Make cleanup idempotent and use it on startup failure.** Create `scene` and the recorder before the construction try, allocate objects inside it, and immediately add each completed layer/group to `scene` so cleanup reaches it. For a failure before a group is added, dispose that local group's owned resources in its factory catch. Move disposal to a shared function before returning the API. Texture disposal below repairs the existing canvas-texture omission because startup errors now exercise that path.

```ts
let disposed = false
function dispose() {
  if (disposed) return
  disposed = true
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return
    geometries.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
    }
  })
  for (const texture of textures) texture.dispose()
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  recorder.dispose()
  renderer.dispose()
  if (!renderer.getContext().isContextLost()) renderer.forceContextLoss()
}
// The startup catch is: catch (error) { dispose(); throw error }
// Returned API uses the same resize and dispose functions.
```

Keep renderer creation outside this try only when it fails without returning a renderer; every later throw goes through `dispose`. The renderer observer callback is inside the try. Material creation introduces no textures; render targets/composer introduced by spec 02 must be explicitly disposed before `renderer.dispose`, once only. Do not dispose resources on transient context loss; existing component pause/restore owns that lifecycle.

- [ ] **Step 6: Pass explicit lowPower from the same TierInput and catch runtime errors.** Import `lowPowerFor`. Store the current inline object as `const tierInput = {...}`, derive tier with `pickTier(tierInput)`, and call `createJourneyScene(canvas.value, tier, props.projectItems, { lowPower: lowPowerFor(tierInput) })`. Replace RAF body with:

```ts
function render(now: number) {
  frame = 0
  try {
    scene?.update(props.chapter, props.progress, now / 1000, pointer)
  } catch (error) {
    console.warn('[journey] 3D scene disabled:', error)
    teardown()
    emit('unavailable')
    return
  }
  if (scene && !contextLost && !document.hidden) frame = requestAnimationFrame(render)
}
```

`teardown` already stops RAF, removes all listeners/timer, disposes scene and hides canvas. Using it preserves the visible-time restore budget and prevents future frames after failure. Startup catch also calls `teardown()` before `emit('unavailable')`; constructor handles its own partial scene before assignment. Keep `none` handling and unmounted async-import guard.

- [ ] **Step 7: Run the Node check and typecheck, then commit wiring.** Run `cd repos/portfolio && npm test && npm run typecheck`; expect all discovered tests and Vue typing to pass. If cleanup/factory scoping makes `scene.ts` exceed 800 lines, move disposal into `app/journey/dispose-scene.ts` with signature `disposeSceneResources(scene: THREE.Scene): void` and the exact traversal body above; do not split unrelated set-pieces. Commit `cd repos/portfolio && git add app/journey/scene.ts app/components/JourneyCanvas.vue tests/journey/facade-material.test.ts tests/gpu/facade.spec.ts tests/gpu/shader-failure.spec.ts && git commit -m "feat: integrate guarded facade scene rendering"`. Browser acceptance must pass before completing the whole plan, even though this intermediate commit has only Node proof.

### Task 4: Reusable development-only GPU harness

**Files:** Create `repos/portfolio/playwright.config.ts`, `repos/portfolio/vite.gpu.config.ts`, `repos/portfolio/tests/gpu/harness.html`, `repos/portfolio/tests/gpu/harness.ts`, `repos/portfolio/tests/gpu/gpu-utils.ts`. Modify `repos/portfolio/package.json` and lockfile.

**Interfaces:** Consumes real app `createJourneyScene`, shared recorder and unchanged scene update methods. Produces browser URL `http://127.0.0.1:4175/tests/gpu/harness.html`, the shared interfaces above and scripts `test:gpu` / `test:gpu:serve`. No harness code is placed in Nuxt `public/`, routes or plugins, so production builds do not expose it.

- [ ] **Step 1: Write the first failing real-browser smoke test.** Start `facade.spec.ts` with:

```ts
import { expect, test } from '@playwright/test'
test('harness runs the real scene and checks a real render', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
  const result = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, width: 640, height: 360 })
    return window.cityGpu.renderJourney({ chapter: 0, frames: 1 })
  })
  expect(result.shaderError).toBeNull()
  expect(result.glError).toBe(0)
  expect(result.calls).toBeGreaterThan(0)
  expect(result.width).toBe(640)
})
```

- [ ] **Step 2: Install only browser tooling at execution time and demonstrate red.** Run `cd repos/portfolio && npm install --save-dev @playwright/test vite@8.3.0 @vitejs/plugin-vue@6.0.9`, then `cd repos/portfolio && npx playwright install chromium`. Commit the resolved Playwright version in the lockfile; do not claim an unverified version is already installed. Add scripts below and run `cd repos/portfolio && npm run test:gpu -- tests/gpu/facade.spec.ts`. Before config/harness exists, expect failure locating config/test server. Browser download may require the executor's normal network permission.

```json
"test:gpu": "playwright test --config playwright.config.ts",
"test:gpu:serve": "vite --config vite.gpu.config.ts --host 127.0.0.1 --port 4175 --strictPort"
```

- [ ] **Step 3: Add independent Vite/Playwright configuration.** All examples are entire files; `~` resolves actual app imports. The one-file test transform supplies the Vue imports Nuxt normally auto-injects. It is development-only and does not rewrite application sources on disk.

```ts
// vite.gpu.config.ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  resolve: { alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) } },
  plugins: [
    {
      name: 'gpu-harness-vue-auto-imports', enforce: 'pre',
      transform(source, id) {
        if (id.endsWith('/app/journey/scene.ts')) {
          const marker = 'const recorder = createShaderErrorRecorder(renderer)'
          if (!source.includes(marker)) throw new Error('GPU renderer observer marker missing')
          return source.replace(marker, marker + '\nwindow.__cityGpuRendererObserver?.(renderer)')
        }
        if (!id.endsWith('/app/components/JourneyCanvas.vue')) return
        return source.replace('<script setup lang="ts">', '<script setup lang="ts">\nimport { ref, onMounted, onBeforeUnmount, watch } from "vue"')
      },
    },
    vue(),
  ],
  server: { host: '127.0.0.1', port: 4175, strictPort: true },
})
```

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/gpu', testMatch: '**/*.spec.ts',
  fullyParallel: false, workers: 1, timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:4175', viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [{ name: 'chromium-webgl2', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run test:gpu:serve', url: 'http://127.0.0.1:4175/tests/gpu/harness.html',
    reuseExistingServer: !process.env.CI, timeout: 60000,
  },
})
```

```html
<!-- tests/gpu/harness.html -->
<!doctype html>
<html><head><meta charset="utf-8"><title>Journey GPU tests</title></head>
<body style="margin:0"><div id="journey-component"></div>
<script type="module" src="./harness.ts"></script></body></html>
```

- [ ] **Step 4: Implement `gpu-utils.ts`.** Export the interface and renderer helpers above. Use pixel ratio 1 and synchronous readback **immediately after a render in the same browser task**, before the default framebuffer can be discarded. Read coordinates are bottom-left origin; return ordinary arrays for Playwright serialization.

```ts
import * as THREE from 'three'
import { createShaderErrorRecorder, getShaderErrorRecorder, type ShaderErrorRecorder } from '../../app/journey/shader-utils'
export interface GpuDiagnostics {
  shaderError: string | null; glError: number; calls: number
  width: number; height: number; geometries: number; textures: number
}
export function diagnostics(renderer: THREE.WebGLRenderer): GpuDiagnostics {
  const gl = renderer.getContext()
  return {
    shaderError: getShaderErrorRecorder(renderer)?.error?.message ?? null,
    glError: gl.getError(), calls: renderer.info.render.calls,
    width: gl.drawingBufferWidth, height: gl.drawingBufferHeight,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
  }
}
export function readPixel(renderer: THREE.WebGLRenderer, x: number, y: number): number[] {
  const gl = renderer.getContext()
  const pixels = new Uint8Array(4)
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return Array.from(pixels)
}
export function readFrame(renderer: THREE.WebGLRenderer): number[] {
  const gl = renderer.getContext()
  const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return Array.from(pixels)
}
export function createTestRenderer(options: {width?: number; height?: number} = {}): {
  renderer: THREE.WebGLRenderer; recorder: ShaderErrorRecorder
  canvas: HTMLCanvasElement; dispose(): void
} {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
  renderer.setPixelRatio(1)
  renderer.setSize(options.width ?? 512, options.height ?? 512, false)
  const recorder = createShaderErrorRecorder(renderer)
  let disposed = false
  return { renderer, recorder, canvas, dispose() {
    if (disposed) return
    disposed = true
    recorder.dispose(); renderer.dispose()
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss()
    canvas.remove()
  } }
}
```

- [ ] **Step 5: Implement the app scene adapter in `harness.ts`.** Import the three gpu-utils read helpers under aliases, create/remove a canvas per mount, and retain the renderer/scene/camera through the observation seams. Add `declare global { interface Window { cityGpu: typeof cityGpu } }` after defining the object. `renderJourney` loops synchronously, so its defaults settle existing chapter damping without waiting minutes of RAF; reduced tier renders once or many with identical results. Expose helpers exactly as the shared API.

```ts
import * as THREE from 'three'
import { createJourneyScene, type JourneyScene, type JourneySceneOptions } from '../../app/journey/scene'
import { diagnostics as rendererDiagnostics, readFrame as rendererFrame } from './gpu-utils'
let journey: JourneyScene | null = null
let renderer: THREE.WebGLRenderer | null = null
let context: { scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null
let canvas: HTMLCanvasElement | null = null
let latestFrame: number[] | null = null
let last = { chapter: 0, progress: 0, time: 0 }
function requireRenderer(): THREE.WebGLRenderer {
  if (!renderer) throw new Error('Mount a journey first')
  return renderer
}
const cityGpu = {
  mountJourney(options: {tier: 'full'|'lite'|'reduced'; lowPower: boolean; width?: number; height?: number},
    observers?: Pick<JourneySceneOptions, 'onRenderer'|'onSceneReady'>) {
    cityGpu.dispose()
    canvas = document.createElement('canvas'); document.body.append(canvas)
    last = { chapter: 0, progress: 0, time: 0 }
    journey = createJourneyScene(canvas, options.tier, [{ title: 'GPU test exhibit', date: '2026-10' }], {
      lowPower: options.lowPower,
      onRenderer(value) { renderer = value; value.setPixelRatio(1); observers?.onRenderer?.(value) },
      onSceneReady(value) { context = value; observers?.onSceneReady?.(value) },
    })
    journey.resize(options.width ?? 640, options.height ?? 360)
  },
  renderJourney(options: {chapter: number; progress?: number; time?: number; frames?: number}) {
    if (!journey) throw new Error('Mount a journey first')
    last = { chapter: options.chapter, progress: options.progress ?? 0, time: options.time ?? 0 }
    for (let i = 0; i < (options.frames ?? 240); i++) journey.update(last.chapter, last.progress, last.time, { x: 0, y: 0 })
    latestFrame = rendererFrame(requireRenderer())
    return rendererDiagnostics(requireRenderer())
  },
  getJourneyContext() {
    if (!context) throw new Error('Journey warmup did not complete')
    return { ...context, renderer: requireRenderer() }
  },
  resizeJourney(width: number, height: number) {
    if (!journey) throw new Error('Mount a journey first')
    latestFrame = null
    journey.resize(width, height)
  },
  getJourneyUpdate() {
    if (!journey) throw new Error('Mount a journey first')
    const mounted = journey
    return () => mounted.update(last.chapter, last.progress, last.time, { x: 0, y: 0 })
  },
  diagnostics() { return rendererDiagnostics(requireRenderer()) },
  readFrame() {
    if (!latestFrame) throw new Error('Render a journey frame before reading its pixels')
    return latestFrame
  },
  async loseAndRestore() {
    if (!canvas) throw new Error('Mount a journey first')
    const target = canvas
    const gl = requireRenderer().getContext()
    const extension = gl.getExtension('WEBGL_lose_context')
    if (!extension) throw new Error('WEBGL_lose_context unavailable')
    const restored = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Context restore timed out')), 10000)
      target.addEventListener('webglcontextlost', event => {
        event.preventDefault()
        setTimeout(() => extension.restoreContext(), 100)
      }, { once: true })
      target.addEventListener('webglcontextrestored', () => { clearTimeout(timeout); resolve() }, { once: true })
    })
    extension.loseContext(); await restored
    return cityGpu.renderJourney({ ...last, frames: 1 })
  },
  dispose() {
    journey?.dispose(); journey = null; renderer = null; context = null
    latestFrame = null
    canvas?.remove(); canvas = null
  },
}
declare global {
  interface Window {
    cityGpu: typeof cityGpu
    __cityGpuRendererObserver?: (renderer: THREE.WebGLRenderer) => void
  }
}
window.cityGpu = cityGpu
```

Later add feature probes as imported functions on this `cityGpu` object; preserve `getJourneyContext`. `renderJourney` caches pixels immediately after its final synchronous render; `cityGpu.readFrame()` returns that cache so separate `page.evaluate` calls cannot accidentally read a discarded default framebuffer. Mount/dispose/resize invalidate the cache; use a harness-owned `resizeJourney(width,height):void` that invalidates it before calling `journey.resize`. Never resize directly through the observer without invalidating or rerendering. Raw performance updates deliberately omit readback caching. Keep `Math.random` out of deterministic pixel comparisons: synthetic fixtures have no stars; for real-scene repeat image checks use the same mounted scene, not a fresh random star layout. Ensure any resize used by real pixel tests is followed immediately by `renderJourney` before readback.

- [ ] **Step 6: Prove green and commit tooling.** Run `cd repos/portfolio && npm run test:gpu -- tests/gpu/facade.spec.ts --grep "harness runs"`. Expect one Chromium WebGL2 test pass. Run `cd repos/portfolio && npm test && npm run typecheck`; ensure Node discovery still excludes GPU specs. Commit `cd repos/portfolio && git add package.json package-lock.json playwright.config.ts vite.gpu.config.ts tests/gpu/harness.html tests/gpu/harness.ts tests/gpu/gpu-utils.ts tests/gpu/facade.spec.ts && git commit -m "test: add real WebGL journey browser harness"`.

### Task 5: Real facade pixels, counts, draw calls and context restoration

**Files:** Create `repos/portfolio/tests/gpu/facade-probe.ts`. Extend `repos/portfolio/tests/gpu/facade.spec.ts` and `repos/portfolio/tests/gpu/harness.ts`.

**Interfaces:** Consumes `createTestRenderer`, diagnostics/readback helpers and actual facade factory. Produces harness `probeFacade({variant, height, face, lit, depth?, span?}): {diagnostics:GpuDiagnostics,pixels:number[],calls:number}`, `journeyLayers(): {count:number,seedCount:number,frustumCulled:boolean,variant:string}[]`. `face` is `'front'|'back'|'left'|'right'|'top'`. All fixtures dispose owned geometry/material in `finally`.

- [ ] **Step 1: Add failing complete tier/chapter tests.** Exercise cost/motion independently, including explicit contradictory option overrides. Fail rather than skip missing WebGL or unavailable loss extension in the configured Chromium job.

```ts
for (const [tier, lowPower] of [
  ['full', false], ['lite', true], ['reduced', false], ['reduced', true],
  ['full', true], ['lite', false],
] as const) {
  test(`${tier} lowPower=${lowPower}: chapters, mid-transition and restore`, async ({ page }) => {
    await page.goto('/tests/gpu/harness.html')
    await page.waitForFunction(() => Boolean(window.cityGpu))
    const result = await page.evaluate(async ({ tier, lowPower }) => {
      window.cityGpu.mountJourney({ tier, lowPower })
      const layers = window.cityGpu.journeyLayers()
      const frames = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter }))
      frames.push(window.cityGpu.renderJourney({ chapter: 0, progress: 0.5 }))
      window.cityGpu.renderJourney({ chapter: 3 })
      const before = window.cityGpu.readFrame()
      const restore = await window.cityGpu.loseAndRestore()
      const after = window.cityGpu.readFrame()
      window.cityGpu.dispose()
      return { layers, frames, restore, before, after }
    }, { tier, lowPower })
    expect(result.layers.map(layer => layer.count)).toEqual(lowPower ? [14, 19, 24] : [24, 32, 40])
    for (const layer of result.layers) {
      expect(layer.seedCount).toBe(layer.count)
      expect(layer.frustumCulled).toBe(false)
      expect(layer.variant).toBe(lowPower ? 'journey-facade-lite' : 'journey-facade-full')
    }
    for (const frame of [...result.frames, result.restore]) {
      expect(frame.shaderError).toBeNull(); expect(frame.glError).toBe(0)
      expect(frame.calls).toBeGreaterThan(0)
    }
    const difference = result.before.reduce((sum, byte, index) => sum + Math.abs(byte - result.after[index]!), 0) / result.before.length
    expect(difference).toBeLessThan(1)
  })
}
test('reduced stays static across time and progress for both costs', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html'); await page.waitForFunction(() => Boolean(window.cityGpu))
  for (const lowPower of [false, true]) {
    const same = await page.evaluate(lowPower => {
      window.cityGpu.mountJourney({ tier: 'reduced', lowPower })
      window.cityGpu.renderJourney({ chapter: 2, progress: 0, time: 0 })
      const a = window.cityGpu.readFrame()
      window.cityGpu.renderJourney({ chapter: 2, progress: 0.9, time: 1000 })
      const b = window.cityGpu.readFrame()
      window.cityGpu.dispose()
      return a.every((value, index) => value === b[index])
    }, lowPower)
    expect(same).toBe(true)
  }
})
```

- [ ] **Step 2: Run to prove missing probe methods fail.** Run `cd repos/portfolio && npm run test:gpu -- tests/gpu/facade.spec.ts`. Expect `journeyLayers`/`probeFacade` missing, not shader syntax silently ignored.
- [ ] **Step 3: Implement the deterministic single-box pixel fixture.** This real factory fixture has no sky/scene damping/fog/random stars, making physical-size tests meaningful. Both variants run near enough that depth fade is zero. Use an orthographic camera and fixed world-to-pixel mapping. `probeFacade` returns pixels synchronously from its own render and disposes resources before returning.

```ts
import * as THREE from 'three'
import { createFacadeMaterial, type FacadeVariant } from '../../app/journey/facade-material'
import { createTestRenderer, diagnostics, readFrame } from './gpu-utils'
export function probeFacade(options: {
  variant: FacadeVariant; height: number
  face: 'front'|'back'|'left'|'right'|'top'; lit: number; depth?: number; span?: number
}) {
  const gpu = createTestRenderer({ width: 512, height: 512 })
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array([0.375]), 1))
  const material = createFacadeMaterial({ color: 0x505050, variant: options.variant,
    uniforms: { uLit: { value: options.lit }, uSkyTint: { value: new THREE.Color(0x6688aa) } } })
  try {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0)
    const mesh = new THREE.InstancedMesh(geometry, material, 1); mesh.frustumCulled = false
    mesh.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(0, options.height / 2 - 1, 0),
      new THREE.Quaternion(), new THREE.Vector3(1.6, options.height, 1.6)))
    mesh.instanceMatrix.needsUpdate = true; scene.add(mesh)
    scene.add(new THREE.AmbientLight(0xffffff, 1))
    const halfSpan = (options.span ?? 1.6) / 2
    const camera = new THREE.OrthographicCamera(-halfSpan, halfSpan, halfSpan, -halfSpan, 0.01, 50)
    const center = new THREE.Vector3(0, -0.2, 0)
    const distance = options.depth ?? 3
    const directions = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0] } as const
    const direction = directions[options.face]
    if (options.face === 'top') { center.y = options.height - 1; camera.up.set(0, 0, -1) }
    camera.position.copy(center).add(new THREE.Vector3(...direction).multiplyScalar(distance))
    camera.lookAt(center)
    gpu.renderer.render(scene, camera); gpu.recorder.assertClean()
    const pixels = readFrame(gpu.renderer)
    return { diagnostics: diagnostics(gpu.renderer), pixels, calls: gpu.renderer.info.render.calls }
  } finally {
    geometry.dispose(); material.dispose(); gpu.dispose()
  }
}
```

Camera spans world `y=-1..0.6` for side faces, so a row below the 0.6-height top stays at the same pixel when height grows to 1.0. Add `probeFacade` to harness imports/object. Add `journeyLayers` using `getJourneyContext().scene.children` filtered by `object instanceof THREE.InstancedMesh` and material names starting `journey-facade-`; return geometry `getAttribute('aSeed').count`, mesh count and culling flag. These actual meshes, not source text, prove seed/count wiring.

- [ ] **Step 4: Add anchored/all-sides/roof/readback tests.** The code below includes safe interior pixel locations away from row and rect edges. At `x=0.064`, each corresponding horizontal cell lies inside the window; at `y=-0.89`, row 0 lies at its vertical center. Pixel origin is bottom-left. Compare byte values with a tolerance of 2 only for GPU roundoff. Run both variants.

```ts
for (const variant of ['full', 'lite'] as const) {
  test(`${variant}: fixed rows, four side grids and unwindowed roof`, async ({ page }) => {
    await page.goto('/tests/gpu/harness.html'); await page.waitForFunction(() => Boolean(window.cityGpu))
    const results = await page.evaluate(variant => {
      const sample = (pixels: number[], x: number, y: number) => pixels.slice((y * 512 + x) * 4, (y * 512 + x) * 4 + 3)
      const x = Math.floor((0.064 + 0.8) / 1.6 * 512)
      const rows = [0, 1].map(row => Math.floor(((row * 0.22 + 0.11)) / 1.6 * 512))
      const small = window.cityGpu.probeFacade({ variant, height: 0.6, face: 'front', lit: 1 })
      const tall = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 1 })
      const sides = ['front', 'back', 'left', 'right'].map(face => {
        const on = window.cityGpu.probeFacade({ variant, height: 1, face: face as 'front', lit: 1 })
        const off = window.cityGpu.probeFacade({ variant, height: 1, face: face as 'front', lit: 0 })
        return { on: sample(on.pixels, x, rows[0]!), off: sample(off.pixels, x, rows[0]!), errors: [on.diagnostics, off.diagnostics] }
      })
      const roofOn = window.cityGpu.probeFacade({ variant, height: 1, face: 'top', lit: 1 })
      const roofOff = window.cityGpu.probeFacade({ variant, height: 1, face: 'top', lit: 0 })
      return { rows: rows.map(y => [sample(small.pixels, x, y), sample(tall.pixels, x, y)]), sides,
        roofSame: roofOn.pixels.every((byte, index) => byte === roofOff.pixels[index]),
        calls: small.calls, errors: [small.diagnostics, tall.diagnostics, roofOn.diagnostics, roofOff.diagnostics] }
    }, variant)
    for (const [small, tall] of results.rows) small!.forEach((byte, index) => expect(Math.abs(byte - tall![index]!)).toBeLessThanOrEqual(2))
    for (const side of results.sides) {
      expect(side.on.reduce((sum, byte) => sum + byte, 0)).toBeGreaterThan(side.off.reduce((sum, byte) => sum + byte, 0) + 100)
      for (const frame of side.errors) { expect(frame.shaderError).toBeNull(); expect(frame.glError).toBe(0) }
    }
    expect(results.roofSame).toBe(true); expect(results.calls).toBe(1)
    for (const frame of results.errors) { expect(frame.shaderError).toBeNull(); expect(frame.glError).toBe(0) }
  })
}
```

Back/right cameras can mirror horizontal coordinates, but `±0.064` both land safely inside the rect because `fract` maps the negative cell to 0.6. Add a lit-area test comparing lit=0.05 and 0.9 on the same deterministic fixture: count pixels whose RGB sum exceeds 650, require high count > low count * 4 and high count > 0. Zero lit cells in the small intro fixture is valid; statistical fraction coverage uses spec 06's larger sample. This tests thresholds at spec endpoints without needing a CPU hash bit-for-bit identical to floating point GLSL. Record exact counts in the failure attachment. For full derivative filtering compare `span:1.6` with `span:64` at fixed depth 3, `height=1,lit=1`; this shrinks projected cells and increases `fwidth`. Moving an orthographic camera back alone does not change derivatives. Require the zoomed-out fixture to have no saturated window-center pixels and no GL errors. For lite compare depths 3 and 20 with fixed span1.6 and require lower distant bright-pixel fraction. The fixture's far plane accommodates both.

- [ ] **Step 5: Pin complete retained rows, newly revealed wall and lit proportions.** Add the following real-render test for both variants. The column comparison excludes a few pixels at the old top edge, where silhouette sampling differs; otherwise it proves complete floor/window spacing, not just two centers. The fixed lit=1 removes random occupancy from the stretch test. Pixel tests should fail if vertex offset is removed or UV-space scale is substituted.

```ts
for (const variant of ['full', 'lite'] as const) {
  test(`${variant}: retained column and chapter occupancy`, async ({ page }) => {
    await page.goto('/tests/gpu/harness.html'); await page.waitForFunction(() => Boolean(window.cityGpu))
    const result = await page.evaluate(variant => {
      const small = window.cityGpu.probeFacade({ variant, height: 0.6, face: 'front', lit: 1 })
      const tall = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 1 })
      const x = Math.floor((0.064 + 0.8) / 1.6 * 512)
      let retainedError = 0
      for (let y = 3; y < 185; y++) for (let channel = 0; channel < 3; channel++) {
        const index = (y * 512 + x) * 4 + channel
        retainedError = Math.max(retainedError, Math.abs(small.pixels[index]! - tall.pixels[index]!))
      }
      const nonBlack = (pixels: number[]) => {
        let count = 0
        for (let y = 220; y < 300; y++) if (pixels[(y * 512 + x) * 4]! > 0) count++
        return count
      }
      const bright = (pixels: number[]) => {
        let count = 0
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 650) count++
        return count
      }
      const intro = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 0.05 })
      const about = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 0.9 })
      const far = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 1,
        depth: variant === 'lite' ? 20 : 3, span: variant === 'full' ? 64 : 1.6 })
      return { retainedError, smallRevealed: nonBlack(small.pixels), tallRevealed: nonBlack(tall.pixels),
        introBright: bright(intro.pixels), aboutBright: bright(about.pixels), farBright: bright(far.pixels),
        nearBright: bright(tall.pixels), errors: [small, tall, intro, about, far].map(value => value.diagnostics) }
    }, variant)
    expect(result.retainedError).toBeLessThanOrEqual(2)
    expect(result.tallRevealed).toBeGreaterThan(result.smallRevealed)
    expect(result.introBright).toBeGreaterThan(0)
    expect(result.aboutBright).toBeGreaterThan(result.introBright * 4)
    expect(result.farBright).toBeLessThan(result.nearBright)
    if (variant === 'full') expect(result.farBright).toBe(0)
    for (const frame of result.errors) { expect(frame.shaderError).toBeNull(); expect(frame.glError).toBe(0) }
  })
}
```
- [ ] **Step 6: Record the one-draw reduction against the actual parent revision.** Before executing Task 3, run a temporary harness that imports that checkout's `createJourneyScene` (copy only harness/tooling into a separate worktree; do not mix feature commits). For a fixed project list, dimensions, tier, chapter and disabled optional post effects, record `renderer.info.render.calls` after rendering the same scene. After Task 3, require each direct-render scene count to be exactly baseline minus one; reduced desktop may separately add static stars because of correct cost routing, so compare the baseline with its cost/detail normalized to the same static star policy. Also assert actual scene contains exactly three skyline facade instanced meshes and no skyline `PlaneGeometry` instanced batch. The one-box fixture's one call is supplemental proof, not a substitute for this actual-scene baseline. If spec 02 has already landed, disable its optional passes only for this direct-object comparison and separately run its real-pipeline tests.
- [ ] **Step 7: Run the complete proof and commit.** Run `cd repos/portfolio && npm test && npm run test:gpu -- tests/gpu/facade.spec.ts && npm run typecheck`. Expect all tier/restore/readback cases to pass. Commit `cd repos/portfolio && git add tests/gpu/facade-probe.ts tests/gpu/facade.spec.ts tests/gpu/harness.ts && git commit -m "test: prove facade pixels and restored scene state"`.

### Task 6: Real creation/runtime shader failures and disposal

**Files:** Create `repos/portfolio/tests/gpu/component-probe.ts`; complete `repos/portfolio/tests/gpu/shader-failure.spec.ts`; extend harness registration. Add Node disposal spy coverage in `repos/portfolio/tests/journey/shader-utils.test.ts` if cleanup is extracted.

**Interfaces:** Consumes the actual `JourneyCanvas.vue` via test-only Vue transform; produces `mountComponent(options:{failure:'none'|'creation';beforeMount?:()=>void}):Promise<void>`, `breakRestoredComponent(options?:{beforeRestore?:()=>void}):Promise<void>`, `componentStatus():{unavailable:number,visible:boolean,updatesAfterFailure:number,disposed:number}`, `unmountComponent():void` on browser harness. This is a test host; no production code or import receives an injected failing shader. Invoke `beforeMount` immediately before `app.mount`, and `beforeRestore` after context loss immediately before `restoreContext`. If `beforeRestore` is supplied it replaces, rather than accompanies, the default standard-material fault. Browser-local callbacks let spec 02 inject invalid fullscreen material code through its own test-only Material prototype wrapper.

- [ ] **Step 1: Add failing real-component assertions.** Browser console/page errors remain recorded. A deliberately invalid shader may log diagnostic warnings; tests must assert the fallback event and stopped loop rather than treating those intentional logs as unrelated errors.

```ts
import { expect, test } from '@playwright/test'
test('creation shader failure emits unavailable and never activates canvas', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html'); await page.waitForFunction(() => Boolean(window.cityGpu))
  await page.evaluate(() => window.cityGpu.mountComponent({ failure: 'creation' }))
  await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().unavailable)).toBe(1)
  expect(await page.evaluate(() => window.cityGpu.componentStatus().visible)).toBe(false)
  await page.evaluate(() => window.cityGpu.unmountComponent())
})
test('restored-context shader failure disposes once and stops RAF', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html'); await page.waitForFunction(() => Boolean(window.cityGpu))
  await page.evaluate(() => window.cityGpu.mountComponent({ failure: 'none' }))
  await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().visible)).toBe(true)
  await page.evaluate(() => window.cityGpu.breakRestoredComponent())
  await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().unavailable)).toBe(1)
  const failed = await page.evaluate(() => window.cityGpu.componentStatus())
  await page.waitForTimeout(100)
  const later = await page.evaluate(() => window.cityGpu.componentStatus())
  expect(later.visible).toBe(false)
  expect(later.updatesAfterFailure).toBe(failed.updatesAfterFailure)
  expect(later.disposed).toBe(1)
  await page.evaluate(() => window.cityGpu.unmountComponent())
})
```

- [ ] **Step 2: Prove red.** Run `cd repos/portfolio && npm run test:gpu -- tests/gpu/shader-failure.spec.ts`; expect missing component probe methods before implementation.
- [ ] **Step 3: Implement the test host and shader-only fault injection.** `component-probe.ts` imports `createApp`, `h`, `nextTick` from Vue, `JourneyCanvas` from `../../app/components/JourneyCanvas.vue`, and Three. Restore all global monkey patches on unmount. Store the original `THREE.ShaderLib.standard.fragmentShader`; append a deliberately invalid global declaration before component mount for creation failure. For runtime failure append it only after success and before `restoreContext` rebuilds programs.

```ts
const invalid = '\nthis_is_deliberately_invalid_glsl;\n'
const originalShader = THREE.ShaderLib.standard.fragmentShader
function breakShader() { THREE.ShaderLib.standard.fragmentShader = originalShader + invalid }
function restoreShader() { THREE.ShaderLib.standard.fragmentShader = originalShader }
// Host rendering:
app = createApp({ render: () => h(JourneyCanvas, {
  chapter: 3, progress: 0, isDark: false, projectItems: [{ title: 'Disposal probe' }],
  onUnavailable() { unavailable++ },
}) })
app.mount(document.querySelector('#journey-component')!)
await nextTick()
```

Capture the real renderer through Task 4's development-only Vite insertion, which invokes `window.__cityGpuRendererObserver` immediately after recorder installation. `WebGLRenderer.render` and `.dispose` are instance methods created by its constructor; wrapping its prototype would not intercept them. Save the previous global observer and install the component probe's observer before mounting. Inside it, retain renderer/canvas, wrap **instance** render/dispose before initial rendering, and collect resource spies before calling original render. Thus an `onBeforeCompile` marker throw is observed too. The WebGL probe in `hasWebGL` is not a renderer.

```ts
const previousObserver = window.__cityGpuRendererObserver
window.__cityGpuRendererObserver = renderer => {
  capturedRenderer = renderer
  const originalRender = renderer.render.bind(renderer)
  const originalDispose = renderer.dispose.bind(renderer)
  renderer.render = (scene, camera) => {
    if (unavailable > 0) updatesAfterFailure++
    observeSceneResources(scene) // installs one spy per geometry/material/texture in Sets
    originalRender(scene, camera)
  }
  renderer.dispose = () => { disposed++; originalDispose() }
}
// unmountComponent restores window.__cityGpuRendererObserver = previousObserver.
```

Implement `observeSceneResources(scene: THREE.Object3D):void` by the exact mesh/material/texture traversal in Task 3's disposal helper, wrapping each discovered resource's instance `dispose` once and incrementing a `Map<object,number>`. Return the counts from a test-only `componentResourceCounts():number[]` API so the disposal test asserts every count is 1. After `onUnavailable`, count any subsequent render attempt as `updatesAfterFailure`. Normal tests must see zero; app unmount must not increment dispose twice. Observer insertion exists only in the GPU server transform and never on disk in production scene code.

For runtime failure obtain canvas's `WEBGL_lose_context`, listen for actual loss/restoration events, call `loseContext`, then call `options?.beforeRestore ? options.beforeRestore() : breakShader()` and `restoreContext` after 100 ms. The real component listener prevents default, pauses RAF, and resumes after Three has rebuilt GL managers. Await restored event and let the component's next RAF throw through the recorder. Restore the original shader only **after** `unavailable`, otherwise the test races recompilation. Use a 10-second reject timeout. `componentStatus.visible` checks canvas exists and `getComputedStyle(canvas).display !== 'none'`. Unmount via `app.unmount`, restore observer/callbacks/shader and any feature-owned Material prototype wrapper, remove host children. Register these functions on `cityGpu` without introducing imports back to `harness.ts`.

- [ ] **Step 4: Add successful loss/recovery and disposal cycles.** For a successfully mounted component, loss/restore without invalid injection must resume visible at chapter 3 and emit zero unavailable. Add a probe returning resource spy counts after `unmountComponent`; assert every geometry/material/texture observed in the scene is disposed once, and renderer once. Repeat mount/unmount three times in one browser page; include a canvas-textured exhibit in each mount and verify no retained component canvas. Separately call harness `dispose()` twice and require no exception. Creation failure must also record renderer disposal once, including when `onBeforeCompile` throws a missing-marker error: temporarily set `ShaderLib.standard.fragmentShader` to a string without `color_fragment`, mount, assert fallback, and restore the original shader. This distinguishes replacement exceptions from recorded GLSL link failures.
- [ ] **Step 5: Prove green and commit.** Run `cd repos/portfolio && npm run test:gpu -- tests/gpu/shader-failure.spec.ts && npm test && npm run typecheck`. Expected: real startup failure, runtime restored-program failure, successful restore and disposal cycles all pass. Commit `cd repos/portfolio && git add tests/gpu/component-probe.ts tests/gpu/shader-failure.spec.ts tests/gpu/harness.ts tests/journey/shader-utils.test.ts && git commit -m "test: cover journey shader fallback and disposal"`.

### Task 7: Measured phone budget, visual review and final acceptance

**Files:** Create development-only `repos/portfolio/tests/gpu/render-cost.ts`; extend harness with `measureJourney({chapter,durationMs?}):Promise<RenderCost>`. No production instrumentation or screenshot assets. Record evidence in the future PR description.

**Interfaces:** Consumes `getJourneyContext`, `renderJourney` and actual renderer; produces `RenderCost = {meanMs:number,p95Ms:number,samples:number,gpuMeanMs:number|null,gpuP95Ms:number|null,disjoint:boolean}`. The loop follows the actual `JourneyScene.update` render path, so it measures post rendering too once spec 02 is present.

- [ ] **Step 1: Implement a test-only uncapped sync probe and a small executable smoke test.** Before timing, set chapter and settle 240 frames. Use 10-second windows in measurements; the smoke test passes 100 ms and asserts `samples > 0`, finite positive mean/p95, p95 >= median (do not assert p95 >= mean for arbitrary distributions). Each sample calls `renderJourney({chapter,frames:1,time:0})` with diagnostics excluded from the timed body by adding a development-only raw update closure: `getJourneyUpdate(): () => void` returns `() => journey!.update(last.chapter,last.progress,last.time,{x:0,y:0})`. Do not measure adapter diagnostic object allocation or repeated `gl.getError` as render cost.

```ts
const gl = renderer.getContext() as WebGL2RenderingContext
const syncPixel = new Uint8Array(4)
const samples: number[] = []
const started = performance.now()
while (performance.now() - started < durationMs) {
  const before = performance.now()
  update() // invokes the real direct or post render path
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel)
  samples.push(performance.now() - before)
}
const sorted = [...samples].sort((a, b) => a - b)
const meanMs = samples.reduce((sum, value) => sum + value, 0) / samples.length
const p95Ms = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!
```

When `EXT_disjoint_timer_query_webgl2` exists, start/end a query around `update`, collect results after completion with asynchronous polling outside timing, divide nanoseconds by `1e6`, discard all GPU samples if `GPU_DISJOINT_EXT` becomes true, and delete every query. Cap pending queries at 64, poll completed queries each loop, and if the cap is reached omit that sample's GPU query while retaining sync measurements. Never busy-wait query results inside the sample. Return null GPU statistics on iOS where the extension is absent. Check recorder and `gl.getError` after the full run. Include the probe only through the GPU harness.

- [ ] **Step 2: Run baseline and changed phone measurements.** Use the parent revision and the implementation revision on the **same physical iPhone**, same browser/version, battery/thermal state, drawing-buffer resolution, chapter and no unrelated changes. Run chapters 0, 2 and 3 three times for 10 seconds each. Report median of three means and median of three p95s, device model, browser, resolution and both commit IDs. Require `(afterMedian - beforeMedian) / beforeMedian <= 0.10` for lite in every measured chapter for mean and p95. Also record a named desktop at explicit 2560x1440 drawing buffer, pixel ratio 1, including timer-query results when available. Emulated iPhone screenshots establish appearance only. To reach the test-only page from the phone, run `cd repos/portfolio && npm run test:gpu:serve -- --host 0.0.0.0` on an approved LAN, visit the machine's LAN address on port 4175, and use a temporary bookmark/dev-console call to `cityGpu.mountJourney({tier:'lite',lowPower:true,...})` and `measureJourney`; do not publish this harness.
- [ ] **Step 3: If the measured lite budget fails, implement only the specified fallback and retest.** Do not reduce global quality invisibly. Add optional `windowed?:boolean` to facade options, default true; for lowPower far layer only set false, with a named material cache key `facade-lite-wall` and keep wall material/floor grid disabled there. This is the spec's documented far-layer grid fallback, not a default without evidence. Add Node cache/patch tests and GPU tests proving near/mid retain windows and far renders plain walls, rerun physical measurements, and document the exception to “every layer” in the PR with recorded regression. If this fallback still violates 10%, do not declare the feature ready; report measured figures for a product decision. Full remains windowed in every layer.
- [ ] **Step 4: Capture visual acceptance.** Run app `cd repos/portfolio && npm run dev -- --host 127.0.0.1`; use the browser to capture all four chapters at progress 0, plus chapter 0/progress 0.5, on desktop and iPhone 14 Pro Max emulation, in light and dark theme. Confirm visible side grids on near/mid/far, no roof windows, fixed spacing during height growth, subtle floor bands, daytime sky-tinted dark glass, intro mostly unlit, about mostly lit, and no grazing-angle shimmer on intro's long sightlines. Capture another frame immediately after context restore at about. Store screenshots in PR attachments, not repo files. Tune constants only if necessary and rerun corresponding unit/GPU tests plus performance after shader-cost changes.
- [ ] **Step 5: Final verification and evidence commit.** Run `cd repos/portfolio && npm test && npm run test:gpu && npm run typecheck && npm run build`. Confirm no test HTML/probes appear in generated application routes or copied public assets. Inspect `git diff --check`, final file count and `scene.ts` line count with `cd repos/portfolio && git diff --check && wc -l app/journey/scene.ts`. Commit test probe `cd repos/portfolio && git add tests/gpu/render-cost.ts tests/gpu/harness.ts tests/gpu/facade.spec.ts && git commit -m "test: add measured journey rendering acceptance"`. Attach device/commit/performance table, object draw-call baseline and screenshot evidence to the reviewable result. Hardware measurements are mandatory for the 10% claim; browser software rendering cannot certify them.

## Self-review and acceptance mapping

- Shader/model: Task 2 implements all declared patch points, anchored coordinates, fixed cell dimensions, sky-tinted glass, converted warm gain, floor bands, roof exclusion, filtering and cache variants. Task 5 proves actual pixels rather than merely checking strings.
- Integration: Task 3 removes exactly the skyline quad batch and per-frame matrices, adds per-instance seeds whose lengths match actual counts, converts sky uniforms and routes all cost by lowPower. Task 5 exercises chapters, progress and all tier/cost combinations.
- Guard/lifecycle: Tasks 1/3 install before first render, apply initial matrices/camera, render rather than compile, throw on recorded/initial GL errors and clean partial allocations. Task 6 exercises actual component creation/runtime catches, loss/restore and idempotent cleanup.
- Performance/visuals: Tasks 5/7 require parent-revision draw count minus one, physical-phone sync measurements, named-desktop measurements and the exact screenshot matrix. Any unavailable phone leaves the 10% criterion unverified; do not substitute host-GPU emulation.
- Future compatibility: shared FacadeUniforms, scale-only part assumptions, seeded values per instance, patch naming, recorder and harness helpers enable specs 02/06; no geometry variety, AO/rim shading or flicker is introduced here.
- Type consistency: `FacadeVariant` is always full/lite; `JourneySceneOptions` is fourth; `lowPowerFor` accepts unchanged `TierInput`; browser imports flow probes → gpu-utils and harness → probes, with no reverse edge.
- Local planning verification: inspect this plan for unresolved markers and compare each numbered spec section to the tasks before handing off. Installation, compilation, rendering and hardware measurements remain execution-time work; this plan does not claim they have already passed.
