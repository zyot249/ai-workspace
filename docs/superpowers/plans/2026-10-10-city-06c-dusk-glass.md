# City 06 Part C: Dusk Glass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work in an isolated worktree (`superpowers:using-git-worktrees`) on branch `feat/city-06c-dusk-glass` cut from `master`.

**Goal:** Replace the flat glass tint on `full`-variant facade walls with a sky-and-sun reflection (Fresnel blend plus a sun glint), while `lite` keeps the flat tint.

**Architecture:** A new module `facade-glass.ts` owns the constants, CPU mirrors, and GLSL fragments for the glass, following the pattern of `facade-gradient.ts`. `facade-material.ts` splices those fragments into the existing `full` patch and adds one uniform, `uSunVisibility`. `scene.ts` writes that uniform from `sky.sunVisibility` each frame. Everything else Part C needs already exists on master: `uSunDir`, `uSunColor`, `vWorldNormal`, and a per-chapter `uSkyTint`.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Three.js r186 (`MeshStandardMaterial` + `onBeforeCompile`), Vitest, Playwright GPU harness (`tests/gpu/`).

**Spec:** `docs/superpowers/specs/2026-10-09-city-06-staggered-windows-design.md`, section "Part C: dusk glass". Also read `docs/superpowers/specs/2026-10-09-city-00-shared-conventions.md` (sections 1, 8, 9).

**Supersedes:** Task 5 of `docs/superpowers/plans/2026-10-09-city-06-staggered-windows.md`. That task was written before specs 04 and 05 landed and describes a spec 04 sun-visibility approximation and an unwired `uSkyTint`. Neither applies to current master.

**Research:** `docs/superpowers/research/2026-10-09-portfolio-overview-research.md` was written at commit `ef03e91`, before the facade shader existed. This plan does not rely on it. All code references below were read at `HEAD` (`cbdacb5` and later).

## Global Constraints

- `StopState` colors (`skyColor`, `sunColor`) are sRGB values. `scene.ts` already converts them with `setRGB(..., THREE.SRGBColorSpace)`, so every shader uniform holds linear color.
- Patch built-in materials with `onBeforeCompile` and `replaceOrThrow(source, marker, replacement)` from `app/journey/shader-utils.ts`.
- `tier === 'reduced'` decides motion. `lowPower` decides cost and detail. Part C adds no time-driven term, so `reduced` needs no special case. `lowPower` (the `lite` variant) gets no Part C code.
- Glass is part of `diffuseColor`. It must never be added to `totalEmissiveRadiance`.
- Glass is added "after the instance tint, as in spec 01": `wallColor` already includes the instance tint, so do not multiply the glass by it again.
- Cost: at most +0.2 ms on the named reference desktop and +0.2 ms on a physical iPhone for spec 06 as a whole (shared conventions, section 8). The `full` variant only.
- Bloom threshold is `1.0` (`BLOOM_THRESHOLD` in `app/journey/post.ts`). Bloom strength is 0 in every light-theme stop and 0.12 to 0.42 in the dark-theme stops.
- Spec 06 constants, copied verbatim: `glassDark = wallColor * 0.25`; Fresnel `pow(1.0 - max(dot(N, V), 0.0), 3.0)`; glint `pow(max(dot(R, uSunDir), 0.0), 24.0) * uSunVisibility`; `glass = mix(glassDark, uSkyTint, 0.35 + 0.45 * fres) + uSunColor * glint * 0.8`.
- Unit tests (Vitest, Node, no GPU) live in `tests/journey/*.test.ts`. GPU tests live in `tests/gpu/*.spec.ts`.
- Commit messages use `<type>: <description>`. Do not add a `Co-Authored-By` trailer.

## Review Focus

Inputs and conditions the spec implies but does not test. Each line names the task whose tests pin it.

1. **Sun below the horizon.** At the dark `about` chapter the sun is at -22 degrees and `sunVisibility` is 0. Expect no glint, no NaN, and no black pixel. Task 2 renders with `sunVisibility = 0` and requires the result to equal the sun-away result.
2. **`lowPower` regression.** The `lite` shader must not gain `reflect`, `pow` on Fresnel, `vWorldPos`, or `uSunVisibility`, and its output must not change with sun or view angle. Tasks 2 and 3 assert the source strings and render the lite probe at two sun directions and two view angles.
3. **Glass leaking into bloom.** Glass is diffuse and lit. If it were added to emissive, a glint would exceed the 1.0 bloom threshold at dusk. Task 2 asserts the emissive line is unchanged and `facadeGlass` never appears in it. Task 4 adds a manual dusk check.
4. **Varying budget on phones.** The patch adds a 9th facade varying. WebGL2 guarantees only 15 vectors. Task 2 counts `varying` declarations in the patched full vertex shader. Task 4 adds a physical-iPhone link check.
5. **Light-theme glass changes look.** The old tint was `mix(wallColor, uSkyTint * 0.35, 0.6)`. The new head-on tint is `0.65 * wall * 0.25 + 0.35 * sky`. In daylight, sky luminance is far above wall luminance, so glass gets brighter and bluer. This follows the spec, but nobody has seen it. Task 4 requires before and after screenshots in both themes, and a decision from the user.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `repos/portfolio/app/journey/facade-glass.ts` | Create | Glass constants, CPU mirrors, GLSL fragments (full and lite) |
| `repos/portfolio/app/journey/facade-material.ts` | Modify | Register `uSunVisibility`, splice glass fragments, debug mode 4, cache key |
| `repos/portfolio/app/journey/scene.ts` | Modify | Write `facade.uSunVisibility` from `sky.sunVisibility` |
| `repos/portfolio/tests/journey/facade-glass.test.ts` | Create | Unit tests for the CPU mirrors and GLSL fragments |
| `repos/portfolio/tests/journey/facade-material.test.ts` | Modify | Update cache-key and uniform assertions, add glass assertions |
| `repos/portfolio/tests/gpu/windows-probe.ts` | Modify | Add diagnostic mode 4, sun and view-angle inputs |
| `repos/portfolio/tests/gpu/windows.spec.ts` | Modify | Add glass GPU tests |
| `docs/superpowers/plans/2026-10-09-city-06-staggered-windows.md` | Modify | One-line pointer at Task 5 to this plan |

All paths below are relative to `repos/portfolio` unless they start with `docs/`.

---

### Task 1: Glass module with CPU mirrors and GLSL fragments

**Files:**
- Create: `app/journey/facade-glass.ts`
- Test: `tests/journey/facade-glass.test.ts`

**Interfaces:**
- Consumes: `glslFloat(n: number): string` from `app/journey/shader-utils.ts`.
- Produces (used by Task 2):
  - `GLASS` constants object.
  - `type Rgb = readonly [number, number, number]` and `type Vec3Tuple = readonly [number, number, number]`.
  - `fresnelAmount(normalDotView: number): number`
  - `glintAmount(reflectDotSun: number, sunVisibility: number): number`
  - `reflectedSunDot(normal: Vec3Tuple, view: Vec3Tuple, sunDir: Vec3Tuple): number`
  - `glassColorFor(input: GlassInput): Rgb`
  - `glassVertexDeclarations(variant: GlassVariant): string`, `glassVertexPatch(variant): string`, `glassFragmentDeclarations(variant): string`, `glassStatements(variant): string`
  - `type GlassVariant = 'full' | 'lite'`

- [ ] **Step 1: Create a worktree and record the baseline**

```bash
cd repos/portfolio && npm test
```

Expected: all unit tests pass. Write the pass count in your notes. Later tasks compare against it.

- [ ] **Step 2: Write the failing unit tests**

Create `tests/journey/facade-glass.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  GLASS, fresnelAmount, glassColorFor, glassFragmentDeclarations, glassStatements,
  glassVertexDeclarations, glassVertexPatch, glintAmount, reflectedSunDot, type Rgb,
} from '../../app/journey/facade-glass'
import { glslFloat } from '../../app/journey/shader-utils'

const DEG = Math.PI / 180

describe('fresnelAmount', () => {
  it('is 0 head-on, 1 edge-on, and treats a back-facing view as edge-on', () => {
    expect(fresnelAmount(1)).toBe(0)
    expect(fresnelAmount(0)).toBe(1)
    expect(fresnelAmount(-0.5)).toBe(1)
  })
  it('matches (1 - cos)^3 at 76 degrees', () => {
    expect(fresnelAmount(Math.cos(76 * DEG))).toBeCloseTo((1 - Math.cos(76 * DEG)) ** 3, 10)
  })
})

describe('glintAmount', () => {
  it('peaks at a perfect mirror and scales by sun visibility', () => {
    expect(glintAmount(1, 1)).toBe(1)
    expect(glintAmount(1, 0)).toBe(0)
    expect(glintAmount(1, 0.5)).toBeCloseTo(0.5, 10)
  })
  it('is 0 when the reflection points away from the sun', () => {
    expect(glintAmount(0, 1)).toBe(0)
    expect(glintAmount(-0.9, 1)).toBe(0)
  })
  it('falls off as cos^24', () => {
    expect(glintAmount(Math.cos(10 * DEG), 1)).toBeCloseTo(Math.cos(10 * DEG) ** 24, 10)
  })
})

describe('reflectedSunDot', () => {
  const normal = [0, 0, 1] as const
  it('reflects straight back head-on', () => {
    expect(reflectedSunDot(normal, [0, 0, 1], [0, 0, 1])).toBeCloseTo(1, 10)
    expect(reflectedSunDot(normal, [0, 0, 1], [1, 0, 0])).toBeCloseTo(0, 10)
  })
  it('mirrors the view direction about the normal', () => {
    const s = Math.sin(45 * DEG), c = Math.cos(45 * DEG)
    expect(reflectedSunDot(normal, [s, 0, c], [-s, 0, c])).toBeCloseTo(1, 10)
    expect(reflectedSunDot(normal, [s, 0, c], [s, 0, c])).toBeCloseTo(0, 10)
  })
})

describe('glassColorFor', () => {
  const wall: Rgb = [0.04, 0.05, 0.1]
  const skyTint: Rgb = [0.5, 0.7, 1]
  const sunColor: Rgb = [1, 0.75, 0.4]
  const base = { wall, skyTint, sunColor, normal: [0, 0, 1] as const, sunDir: [1, 0, 0] as const, sunVisibility: 1 }
  const expectedMix = (t: number): Rgb => [0, 1, 2].map(i => wall[i]! * GLASS.darkFactor * (1 - t) + skyTint[i]! * t) as unknown as Rgb

  it('is 65% dark wall and 35% sky head-on with no glint', () => {
    const out = glassColorFor({ ...base, view: [0, 0, 1] })
    const want = expectedMix(GLASS.tintBase)
    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(want[i]!, 10)
  })
  it('moves toward the sky at a grazing view', () => {
    const view = [Math.sin(76 * DEG), 0, Math.cos(76 * DEG)] as const
    const out = glassColorFor({ ...base, view })
    const want = expectedMix(GLASS.tintBase + GLASS.tintFresnel * fresnelAmount(Math.cos(76 * DEG)))
    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(want[i]!, 10)
  })
  it('adds sunColor * 0.8 on a perfect mirror and nothing when sunVisibility is 0', () => {
    const lit = glassColorFor({ ...base, sunDir: [0, 0, 1], view: [0, 0, 1] })
    const dark = glassColorFor({ ...base, sunDir: [0, 0, 1], view: [0, 0, 1], sunVisibility: 0 })
    for (let i = 0; i < 3; i++) expect(lit[i]! - dark[i]!).toBeCloseTo(sunColor[i]! * GLASS.glintGain, 10)
    const away = glassColorFor({ ...base, view: [0, 0, 1] })
    expect(dark).toEqual(away)
  })
})

describe('GLSL fragments', () => {
  it('full glass uses the spec 06 constants and the spec 04 inputs', () => {
    const source = glassStatements('full')
    expect(source).toContain(`wallColor * ${glslFloat(GLASS.darkFactor)}`)
    expect(source).toContain('normalize(vWorldNormal)')
    expect(source).toContain('normalize(cameraPosition - vWorldPos)')
    expect(source).toContain(`pow(1.0 - max(dot(glassN, glassV), 0.0), ${glslFloat(GLASS.fresnelPower)})`)
    expect(source).toContain('reflect(-glassV, glassN)')
    expect(source).toContain(`pow(max(dot(glassR, uSunDir), 0.0), ${glslFloat(GLASS.glintPower)}) * uSunVisibility`)
    expect(source).toContain(`mix(glassDark, uSkyTint, ${glslFloat(GLASS.tintBase)} + ${glslFloat(GLASS.tintFresnel)} * glassFresnel)`)
    expect(source).toContain(`uSunColor * glassGlint * ${glslFloat(GLASS.glintGain)}`)
  })
  it('lite keeps the flat spec 01 tint and emits no other glass code', () => {
    expect(glassStatements('lite')).toBe('vec3 glass = mix(wallColor, uSkyTint * 0.35, 0.6);')
    expect(glassVertexDeclarations('lite')).toBe('')
    expect(glassVertexPatch('lite')).toBe('')
    expect(glassFragmentDeclarations('lite')).toBe('')
  })
  it('full declares vWorldPos and uSunVisibility, and derives vWorldPos from facadeModel', () => {
    expect(glassVertexDeclarations('full')).toContain('varying vec3 vWorldPos;')
    expect(glassFragmentDeclarations('full')).toContain('varying vec3 vWorldPos;')
    expect(glassFragmentDeclarations('full')).toContain('uniform float uSunVisibility;')
    expect(glassVertexPatch('full')).toContain('vWorldPos = (facadeModel * vec4(position, 1.0)).xyz;')
  })
})
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `cd repos/portfolio && npm test -- tests/journey/facade-glass.test.ts`
Expected: FAIL with "Failed to resolve import ../../app/journey/facade-glass".

- [ ] **Step 4: Write the module**

Create `app/journey/facade-glass.ts`:

```ts
import { glslFloat } from './shader-utils'

// Spec 06 Part C. The CPU mirrors below define the formula; the GLSL in glassStatements() must match them.
export const GLASS = {
  darkFactor: 0.25,
  fresnelPower: 3,
  tintBase: 0.35,
  tintFresnel: 0.45,
  glintPower: 24,
  glintGain: 0.8,
} as const

export type Rgb = readonly [number, number, number]
export type Vec3Tuple = readonly [number, number, number]
export type GlassVariant = 'full' | 'lite'

const glsl = glslFloat
const dot = (a: Vec3Tuple, b: Vec3Tuple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export function fresnelAmount(normalDotView: number): number {
  return (1 - Math.max(normalDotView, 0)) ** GLASS.fresnelPower
}

export function glintAmount(reflectDotSun: number, sunVisibility: number): number {
  return Math.max(reflectDotSun, 0) ** GLASS.glintPower * sunVisibility
}

// R = reflect(-V, N) = -V + 2 (N . V) N. All vectors must be unit length.
export function reflectedSunDot(normal: Vec3Tuple, view: Vec3Tuple, sunDir: Vec3Tuple): number {
  const k = 2 * dot(normal, view)
  const reflected: Vec3Tuple = [
    -view[0] + k * normal[0], -view[1] + k * normal[1], -view[2] + k * normal[2],
  ]
  return dot(reflected, sunDir)
}

export interface GlassInput {
  wall: Rgb
  skyTint: Rgb
  sunColor: Rgb
  normal: Vec3Tuple
  view: Vec3Tuple
  sunDir: Vec3Tuple
  sunVisibility: number
}

export function glassColorFor(input: GlassInput): Rgb {
  const fres = fresnelAmount(dot(input.normal, input.view))
  const glint = glintAmount(reflectedSunDot(input.normal, input.view, input.sunDir), input.sunVisibility)
  const t = GLASS.tintBase + GLASS.tintFresnel * fres
  const channel = (i: 0 | 1 | 2): number =>
    input.wall[i] * GLASS.darkFactor * (1 - t) + input.skyTint[i] * t + input.sunColor[i] * glint * GLASS.glintGain
  return [channel(0), channel(1), channel(2)]
}

export function glassVertexDeclarations(variant: GlassVariant): string {
  return variant === 'full' ? 'varying vec3 vWorldPos;\n' : ''
}

// Runs after gradientVertexPatch, which declares `facadeModel`.
export function glassVertexPatch(variant: GlassVariant): string {
  return variant === 'full' ? 'vWorldPos = (facadeModel * vec4(position, 1.0)).xyz;\n' : ''
}

// uSunDir, uSunColor, uSkyTint, and vWorldNormal are declared by facade-gradient.ts and facade-material.ts.
export function glassFragmentDeclarations(variant: GlassVariant): string {
  return variant === 'full' ? 'uniform float uSunVisibility;\nvarying vec3 vWorldPos;\n' : ''
}

// Runs inside the windowed-face branch, after `wallColor` is set. Defines `glass`.
export function glassStatements(variant: GlassVariant): string {
  if (variant === 'lite') return 'vec3 glass = mix(wallColor, uSkyTint * 0.35, 0.6);'
  return `
  vec3 glassDark = wallColor * ${glsl(GLASS.darkFactor)};
  vec3 glassN = normalize(vWorldNormal);
  vec3 glassV = normalize(cameraPosition - vWorldPos);
  float glassFresnel = pow(1.0 - max(dot(glassN, glassV), 0.0), ${glsl(GLASS.fresnelPower)});
  vec3 glassR = reflect(-glassV, glassN);
  float glassGlint = pow(max(dot(glassR, uSunDir), 0.0), ${glsl(GLASS.glintPower)}) * uSunVisibility;
  vec3 glass = mix(glassDark, uSkyTint, ${glsl(GLASS.tintBase)} + ${glsl(GLASS.tintFresnel)} * glassFresnel)
    + uSunColor * glassGlint * ${glsl(GLASS.glintGain)};`
}
```

Both `pow` calls have a non-negative base by construction (`max(..., 0.0)` and `1.0 - max(..., 0.0)` with the dot at most 1). That avoids the undefined `pow(x < 0, y)` case in GLSL.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd repos/portfolio && npm test -- tests/journey/facade-glass.test.ts`
Expected: PASS, all tests in the file.

If `glslFloat(24)` prints `24` and not `24.0`, the assertions still pass because both sides use `glslFloat`. Check that the printed shader text is valid GLSL before moving on: `glslFloat` must return a literal with a decimal point.

- [ ] **Step 6: Commit**

```bash
cd repos/portfolio && git add app/journey/facade-glass.ts tests/journey/facade-glass.test.ts
cd repos/portfolio && git commit -m "feat: add facade glass module with CPU mirrors and GLSL fragments"
```

---

### Task 2: Splice the glass into the full facade shader and prove it on the GPU

**Files:**
- Modify: `app/journey/facade-material.ts` (lines 1-17, 24-32, 44-72, 109-142, 144-157, 166-188)
- Modify: `tests/journey/facade-material.test.ts` (lines 18, 76-80, 97-106)
- Modify: `tests/gpu/windows-probe.ts` (lines 4-7, 19-22, 31-32)
- Modify: `tests/gpu/windows.spec.ts` (append one test and update the import)

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces (used by Task 3): `FacadeUniforms.uSunVisibility: { value: number }`, default `0`. `createFacadeUniforms()` returns it.
- Produces (diagnostic): `FACADE_DEBUG_WINDOW == 4` writes `vec4(facadeGlass, 1.0)`. In `lite`, `facadeGlass` holds the flat tint.

- [ ] **Step 1: Update and extend the unit tests (red)**

In `tests/journey/facade-material.test.ts`:

1. Replace the cache-key assertion at line 18:

```ts
  expect(material.customProgramCacheKey()).toBe(`facade-${variant}-windows-${variant === 'full' ? 'abc' : 'ab'}-0-ao-0`)
```

2. In the test `'registers window uniforms and emits the reduced-cost variant separately'`, replace the `not.toContain('uSunVisibility')` line inside the `for (const variant of [full, lite])` loop. Delete that one line. The new test below covers it.

3. In the test `'splices the gradient into both variants, and the rim and bounce into full only'`, extend the lite exclusion list:

```ts
  for (const name of ['uRimStrength', 'uBounce', 'uSunDir', 'uSunColor', 'uBounceColor', 'vTopY', 'vWorldNormal', 'uSunVisibility', 'vWorldPos']) {
```

4. Append this test at the end of the file:

```ts
it('adds dusk glass to the full variant only', () => {
  const full = patched('full'); const lite = patched('lite')
  const { vertexShader, fragmentShader, uniforms } = full.shader
  expect(uniforms.uSunVisibility).toBe(full.uniforms.uSunVisibility)
  expect(full.uniforms.uSunVisibility.value).toBe(0)
  expect(vertexShader).toContain('vWorldPos = (facadeModel * vec4(position, 1.0)).xyz;')
  expect(vertexShader.indexOf('vWorldPos =')).toBeGreaterThan(vertexShader.indexOf('mat4 facadeModel = modelMatrix;'))
  expect(fragmentShader).toContain('reflect(-glassV, glassN)')
  expect(fragmentShader).toContain('facadeGlass = glass;')
  expect(fragmentShader).toContain('FACADE_DEBUG_WINDOW == 4')
  // Glass is diffuse and lit. It must never reach the emissive sum, or it would feed bloom.
  expect(fragmentShader).toContain('totalEmissiveRadiance += facadeWindowEmission + facadeGradientEmission;')
  expect(fragmentShader).not.toMatch(/totalEmissiveRadiance[^;]*facadeGlass/)
  for (const name of ['uSunVisibility', 'vWorldPos', 'reflect(', 'glassFresnel', 'glassGlint']) {
    expect(lite.shader.fragmentShader).not.toContain(name)
    expect(lite.shader.vertexShader).not.toContain(name)
  }
  expect(lite.shader.fragmentShader).toContain('vec3 glass = mix(wallColor, uSkyTint * 0.35, 0.6);')
  expect(full.m.customProgramCacheKey()).toBe('facade-full-windows-abc-0-ao-0')
  expect(lite.m.customProgramCacheKey()).toBe('facade-lite-windows-ab-0-ao-0')
  // WebGL2 guarantees only 15 varying vectors, and each declaration here takes at most one.
  const varyings = (source: string): number => (source.match(/^\s*varying\s/gm) ?? []).length
  expect(varyings(vertexShader)).toBeLessThanOrEqual(15)
  expect(varyings(fragmentShader)).toBeLessThanOrEqual(15)
  full.m.dispose(); lite.m.dispose()
})
```

- [ ] **Step 2: Extend the GPU probe (test support)**

In `tests/gpu/windows-probe.ts`:

1. Replace the `WindowProbeInput` interface:

```ts
export interface WindowProbeInput {
  variant:'full'|'lite';seed:number;ratio:number;time?:number;flicker?:number;
  emissiveScale?:number;mode?:0|1|2|3|4;pixelsPerCell?:number;depth?:number;
  sunDir?:[number,number,number];sunVisibility?:number;viewAngle?:number
}
```

2. Replace the `uniforms` constant (lines 19-20) so it also sets the sun inputs. The gradient strengths stay at their zero defaults from `createFacadeUniforms`:

```ts
  const uniforms={...createFacadeUniforms(input.flicker??0),uLit:{value:input.ratio},uSkyTint:{value:new THREE.Color(0xbfdbfe)},
    uTime:{value:input.time??0},uEmissiveScale:{value:input.emissiveScale??1},
    uSunDir:{value:new THREE.Vector3().fromArray(input.sunDir??[0,0,1]).normalize()},
    uSunColor:{value:new THREE.Color(0xffe1a8)},uSunVisibility:{value:input.sunVisibility??0}}
```

3. After the line `camera.position.set(0,4.5,.5+depth);camera.lookAt(0,4.5,0)`, add the mode 4 camera. It aims the camera at one fixed physical cell (row 25, column 40) from a chosen angle, and shifts the orthographic frustum so that cell lands on the sampled pixel. The offset accounts for the pixel center, so both angles sample the same point:

```ts
  if(input.mode===4) {
    const x=.08,y=-1+25.5*.22,z=.5 // center of cell (col 40, row 25) on the +z face
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

Cell size is `FACADE_CELL = [0.16, 0.22]` and the wall spans x in [-6.4, 6.4], y in [-1, 10], so column 40 of 80 has center x = 0.08 and row 25 has center y = 4.61.

- [ ] **Step 3: Write the failing GPU test**

In `tests/gpu/windows.spec.ts`, change the import on line 2-3 to also bring in the glass mirror, and add `import * as THREE from 'three'` at the top:

```ts
import * as THREE from 'three'
import { glassColorFor } from '../../app/journey/facade-glass'
```

Append this test at the end of the file:

```ts
test('full glass reflects the real sun and brightens at grazing view; lite stays flat', async({page})=>{
  const result=await page.evaluate(()=>{
    const common={seed:.5625,ratio:0,mode:4 as const}
    const full=(extra:object)=>window.cityGpu.probeWindows({...common,variant:'full',...extra})
    const lite=(extra:object)=>window.cityGpu.probeWindows({...common,variant:'lite',...extra})
    return {
      sunFacing:full({sunDir:[0,0,1],sunVisibility:1,viewAngle:0}),
      sunAway:full({sunDir:[1,0,0],sunVisibility:1,viewAngle:0}),
      sunHidden:full({sunDir:[0,0,1],sunVisibility:0,viewAngle:0}),
      headOn:full({sunVisibility:0,viewAngle:0}),
      grazing:full({sunVisibility:0,viewAngle:76}),
      liteSunFacing:lite({sunDir:[0,0,1],sunVisibility:1,viewAngle:0}),
      liteSunAway:lite({sunDir:[1,0,0],sunVisibility:1,viewAngle:0}),
      liteHeadOn:lite({sunVisibility:0,viewAngle:0}),
      liteGrazing:lite({sunVisibility:0,viewAngle:76}),
    }
  })
  for(const r of Object.values(result)){expect(r.shaderError).toBeNull();expect(r.glError).toBe(0)}
  const index=25*80+40
  const at=(r:{samples:number[][]})=>r.samples[index]!
  const lum=(r:{samples:number[][]})=>linearLuminance(at(r))
  // Glint: a wall facing the sun is much brighter than the same wall with the sun rotated 90 degrees away.
  expect(lum(result.sunFacing)).toBeGreaterThan(lum(result.sunAway)+.5)
  // No sun below the horizon: visibility 0 removes the glint exactly, and nothing turns black.
  expect(at(result.sunHidden)).toEqual(at(result.sunAway))
  expect(lum(result.sunAway)).toBeGreaterThan(.05)
  // Fresnel: grazing is brighter than head-on.
  expect(lum(result.grazing)).toBeGreaterThan(lum(result.headOn)*1.3)
  // lowPower variant shows neither effect.
  expect(at(result.liteSunFacing)).toEqual(at(result.liteSunAway))
  expect(at(result.liteGrazing)).toEqual(at(result.liteHeadOn))
  // The shader matches the CPU mirror at three geometries.
  const wall=new THREE.Color(0x353b5c),sky=new THREE.Color(0xbfdbfe),sun=new THREE.Color(0xffe1a8)
  const expected=(angle:number,sunDir:[number,number,number],sunVisibility:number)=>{
    const a=angle*Math.PI/180
    return glassColorFor({wall:[wall.r,wall.g,wall.b],skyTint:[sky.r,sky.g,sky.b],sunColor:[sun.r,sun.g,sun.b],
      normal:[0,0,1],view:[Math.sin(a),0,Math.cos(a)],sunDir,sunVisibility})
  }
  const cases:[string,number,[number,number,number],number][]=[
    ['sunFacing',0,[0,0,1],1],['headOn',0,[0,0,1],0],['grazing',76,[0,0,1],0]]
  for(const [name,angle,sunDir,vis] of cases) {
    const want=expected(angle,sunDir,vis),got=at(result[name as 'sunFacing'])
    for(let i=0;i<3;i++) expect(Math.abs(got[i]!-want[i]!)).toBeLessThan(2e-3)
  }
})
```

- [ ] **Step 4: Run both suites and confirm they fail for the expected reason**

Run: `cd repos/portfolio && npm test -- tests/journey/facade-material.test.ts`
Expected: FAIL. The cache-key assertion reports `facade-full-windows-ab-0-ao-0`, and the new test reports a missing `uSunVisibility`.

Run: `cd repos/portfolio && npm run test:gpu -- tests/gpu/windows.spec.ts -g "full glass reflects"`
Expected: FAIL on the first luminance assertion. Mode 4 has no branch yet, so the probe renders unlit emissive-only output and every sample is 0.

- [ ] **Step 5: Implement the splice in `app/journey/facade-material.ts`**

1. Add the import after the `facade-gradient` import:

```ts
import {
  glassFragmentDeclarations, glassStatements, glassVertexDeclarations, glassVertexPatch,
} from './facade-glass'
```

2. Add the uniform to the interface and to the defaults:

```ts
export interface FacadeUniforms extends FacadeGradientUniforms {
  uLit: { value: number }
  uSkyTint: { value: THREE.Color }
  uTime: { value: number }
  uFlicker: { value: number }
  uEmissiveScale: { value: number }
  uSunVisibility: { value: number }
}
```

In `createFacadeUniforms`, change the second line of the returned object:

```ts
    uTime: { value: 0 }, uFlicker: { value: flicker }, uEmissiveScale: { value: 1 }, uSunVisibility: { value: 0 },
```

Update the comment above the function to read: `// Neutral defaults: the gradient and the glint are off (strengths 0), so a caller that sets only the window uniforms renders as before.`

3. In `facadeColorPatch`, declare `facadeGlass` beside the other main-scope locals. After the line `vec3 facadeWindowEmission = vec3(0.0);` add:

```glsl
vec3 facadeGlass = vec3(0.0);
```

4. Replace the single glass line `  vec3 glass = mix(wallColor, uSkyTint * 0.35, 0.6);` with:

```
  ${glassStatements(variant)}
  facadeGlass = glass;
```

5. In `debugOutput`, add a branch for mode 4 before the first `#endif`:

```glsl
#elif defined(FACADE_DEBUG_WINDOW) && FACADE_DEBUG_WINDOW == 4
  gl_FragColor = vec4(facadeGlass, 1.0);
```

6. In `createFacadeMaterial`, replace the cache key:

```ts
  material.customProgramCacheKey = () =>
    `facade-${variant}-windows-${variant === 'full' ? 'abc' : 'ab'}-${material.defines?.FACADE_DEBUG_WINDOW ?? 0}-ao-${material.defines?.FACADE_DEBUG_AO ?? 0}`
```

7. Append the glass fragments to the existing patches:

```ts
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <common>', '#include <common>\n' + vertexDeclarations + gradientVertexDeclarations(variant) + glassVertexDeclarations(variant))
```

In the `begin_vertex` replacement, change the last line from `${gradientVertexPatch(variant)}` to:

```
${gradientVertexPatch(variant)}${glassVertexPatch(variant)}`)
```

and for the fragment shader:

```ts
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <common>', '#include <common>\n' + fragmentDeclarations + gradientFragmentDeclarations(variant) + glassFragmentDeclarations(variant))
```

Leave the `emissivemap_fragment` replacement untouched. Its line is the invariant Task 2's unit test pins.

- [ ] **Step 6: Run both suites and confirm they pass**

Run: `cd repos/portfolio && npm test -- tests/journey/facade-material.test.ts tests/journey/facade-glass.test.ts`
Expected: PASS.

Run: `cd repos/portfolio && npm run test:gpu -- tests/gpu/windows.spec.ts`
Expected: PASS for every test, including the four tier and `lowPower` restore tests and the new glass test.

If the new GPU test fails on the CPU-mirror comparison and not on the ordering checks, re-derive the geometry before loosening the tolerance. Check that `vWorldPos` is the face center (z = 0.5), that the camera sits at `depth` from the cell, and that the cell samples the intended pixel (print `samples[index]` for `viewAngle` 0 and 76).

If the varying-count assertion fails, stop and report the count. Do not raise the limit. The fallback is to drop `vWorldPos` and rebuild it in the fragment shader from `vFacadePos` and the face normal, which changes this plan.

- [ ] **Step 7: Typecheck and commit**

Run: `cd repos/portfolio && npm run typecheck`
Expected: no errors.

```bash
cd repos/portfolio && git add app/journey/facade-material.ts tests/journey/facade-material.test.ts tests/gpu/windows-probe.ts tests/gpu/windows.spec.ts
cd repos/portfolio && git commit -m "feat: reflect sky and sun in full-tier facade glass"
```

---

### Task 3: Drive the glint from the sky each frame

**Files:**
- Modify: `app/journey/scene.ts` (the block at lines 546-551)
- Modify: `tests/journey/facade-material.test.ts` (the test `'wires the gradient uniforms and the shadow field into the scene'`)

**Interfaces:**
- Consumes: `FacadeUniforms.uSunVisibility` (Task 2); `sky.sunVisibility: number` (already exists in `app/journey/sky.ts`, a smoothstep of the unclamped sun elevation).
- Produces: nothing new. After this task the glint responds to the chapter.

- [ ] **Step 1: Write the failing test**

In the test `'wires the gradient uniforms and the shadow field into the scene'`, add after the `uSunDir` assertion:

```ts
  expect(scene).toContain('facade.uSunVisibility.value = sky.sunVisibility')
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd repos/portfolio && npm test -- tests/journey/facade-material.test.ts -t "wires the gradient"`
Expected: FAIL, `facade.uSunVisibility.value = sky.sunVisibility` not found.

- [ ] **Step 3: Implement**

In `app/journey/scene.ts`, after the line `facade.uSunColor.value.copy(sun.color)` (inside the same block, after `sky.update(...)`), add:

```ts
    facade.uSunVisibility.value = sky.sunVisibility
```

`sky.update` runs earlier in the same function, so the value is current. The `lite` variant ignores the uniform, so no tier branch is needed. Under `reduced`, `sky.update` gets a chapter-static state, so the glint is static too.

- [ ] **Step 4: Run unit and GPU suites**

Run: `cd repos/portfolio && npm test`
Expected: PASS, with at least the Task 1 baseline count plus the new tests.

Run: `cd repos/portfolio && npm run test:gpu -- tests/gpu/windows.spec.ts`
Expected: PASS. The four `chapters render and restore at fixed state` tests render the real journey with the glass active and check that `loseContext()` and `restoreContext()` reproduce the same frame.

- [ ] **Step 5: Commit**

```bash
cd repos/portfolio && git add app/journey/scene.ts tests/journey/facade-material.test.ts
cd repos/portfolio && git commit -m "feat: drive facade glint from sky sun visibility"
```

---

### Task 4: Acceptance, measurement, and handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-10-09-city-06-staggered-windows.md` (Task 5 heading)

- [ ] **Step 1: Point the old plan at this one**

Directly under the heading `### Task 5 (conditional follow-up): Enable full-tier dusk glass after spec 04 lands`, insert:

```markdown
> **Superseded** by `docs/superpowers/plans/2026-10-10-city-06c-dusk-glass.md`. Specs 04 and 05 have landed, so the gate is met. Do not execute this task.
```

Commit: `git add docs/superpowers/plans/2026-10-09-city-06-staggered-windows.md && git commit -m "docs: point city 06 Task 5 at the Part C plan"`

- [ ] **Step 2: Capture before and after screenshots**

Build a baseline from `master` and the branch. For both builds, capture the four chapters in light theme and the four in dark theme, at desktop width and at an iPhone 14 Pro Max emulation. Attach them to the PR description. Do not commit images.

- [ ] **Step 3: Measure cost**

Run the shared render-cost probe (`window.cityGpu.measureJourney`, see `tests/gpu/render-cost.ts`) on the baseline and on the branch, for chapter 2, `full` tier. Software WebGL numbers show only that the probe works. The budget needs a physical desktop and a physical iPhone. Record both in the PR description. The budget is at most +0.2 ms for all of spec 06 against the spec 01/02/04 baseline.

- [ ] **Step 4: Final acceptance checklists**

**Automated verification** (the agent runs these; all must pass):

- [ ] `cd repos/portfolio && npm test`
- [ ] `cd repos/portfolio && npm run test:gpu`
- [ ] `cd repos/portfolio && npm run typecheck`
- [ ] `cd repos/portfolio && npm run build`

**Manual verification** (a person does these; do not mark them done until the user confirms):

- [ ] Light theme, all four chapters: glass is brighter and bluer than before. The user accepts or rejects the new look (Review Focus 5).
- [ ] Dark theme `intro` (sun at +4 degrees, bloom 0.12) and `projects` (bloom 0.25): a sun glint on glass does not bloom into a halo (Review Focus 3).
- [ ] Dark theme `skills` and `about`: no glint, no black or flat-grey windows, silhouettes still readable.
- [ ] Scrub the whole range in 20 steps on desktop and iPhone emulation: the glint tracks smoothly with no pops or shimmer.
- [ ] `reduced` tier (OS reduced-motion on): glass is static between frames.
- [ ] `lowPower` (`lite`) looks the same as before this change.
- [ ] Physical iPhone: the full-tier shader links (no blank buildings) and the cost is at most +0.2 ms (Review Focus 4).
- [ ] Physical desktop: cost is at most +0.2 ms.

---

## Plan self-review

**Spec coverage (Part C, one line each):**
- Fresnel, `reflect`, glint, and `mix` formula with spec constants: Task 1 (`glassStatements`) and Task 2 (spliced into the shader).
- `glassDark = wallColor * 0.25`, with `wallColor` taken after `<color_fragment>`: Task 2 step 5; `wallColor` is the existing local at the point where the old glass line sat.
- `uSkyTint` from the stop's `skyColor`, linear: already wired at `scene.ts:523`. No work needed.
- `uSunDir`, `uSunColor`, `vWorldNormal`: already present from spec 04. Task 2 reads them. `vWorldPos`: added in Task 2.
- `uSunVisibility` from `sky.sunVisibility` (spec 05): Task 3. The spec 04 approximation is not used.
- `full` only; `lowPower` keeps the flat tint: Tasks 1 and 2 (string tests), Task 2 (GPU lite equality).
- Glass added to `diffuseColor`, no further wall-tint multiply: the existing `mix(detail, averageFacade, ...)` code is unchanged.
- Spec test 11 (glint at `intro`, Fresnel at above 75 degrees, lite shows neither): Task 2 GPU test, using 76 degrees and a sun-facing versus 90-degree-rotated comparison.
- Spec test 12 (shader errors for both variants, restore): Task 2 asserts `shaderError` and `glError` on every probe; Task 3 runs the four tier and `lowPower` restore tests with the glass active.
- Budget 0.2 ms, bloom and silhouette checks: Task 4.

**Placeholder scan:** none. Every code step shows code.

**Type consistency:** `GlassVariant`, `Rgb`, `Vec3Tuple`, `GLASS.*` keys, and the four GLSL function names match across Tasks 1 and 2. The probe's `sunDir`, `sunVisibility`, `viewAngle`, and `mode: 4` match between `windows-probe.ts` and `windows.spec.ts`. The GLSL local names (`glassN`, `glassV`, `glassR`, `glassFresnel`, `glassGlint`, `glassDark`, `facadeGlass`) match the unit-test assertions.

**Differences from the spec text, on purpose:**
- GLSL locals are prefixed `glass*`. The spec uses bare `N`, `V`, `R`, which could collide with names in the surrounding three.js fragment shader.
- Glass is computed for every windowed fragment, as before. Lit windows add emission on top, so the spec's phrase "unlit windows" describes what the viewer sees and needs no extra branch.
