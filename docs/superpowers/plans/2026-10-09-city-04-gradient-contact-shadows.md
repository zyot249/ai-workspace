# City 04: Vertical Gradient and Contact Shadows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a height-based wall gradient (base occlusion, warm roof rim, night bounce) to the facade shader and a soft contact-shadow quad under every active building, in one extra draw call.

**Architecture:** A new module `app/journey/facade-gradient.ts` holds the shared constants, CPU mirrors of the shader math, the uniform mapping `facadeLookFor`, and the GLSL snippets that `facade-material.ts` splices into its existing `onBeforeCompile` patch. A second new module `app/journey/contact-shadows.ts` owns one `InstancedMesh` of flat quads with a procedural radial `alphaMap`. `applyBuildingState` reports whether it rewrote matrices, and the scene then rewrites the matching shadow instances. `scene.ts` only wires uniforms and the field.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Three.js r186, Vitest 5, and the Playwright/Vite GPU harness in `tests/gpu`.

**Spec:** `docs/superpowers/specs/2026-10-09-city-04-gradient-contact-shadows-design.md`. Read `docs/superpowers/specs/2026-10-09-city-00-shared-conventions.md` first.

**Research:** `docs/superpowers/research/2026-10-09-portfolio-overview-research.md` was written at commit `ef03e91`, before specs 01, 03, 05 and 06 merged. This plan does not rely on it. Every code reference below was checked against `HEAD` (`e47461c`).

## Global Constraints

- `StopState` colors are sRGB values from `hexToRgb`. Pass the space explicitly: `color.setRGB(r, g, b, THREE.SRGBColorSpace)`. Raw numbers written to shader uniforms are not converted by three.
- Patch built-in materials with `onBeforeCompile` and `replaceOrThrow(source, marker, replacement)` from `app/journey/shader-utils.ts`. Never use a bare `String.replace` on shader source.
- `customProgramCacheKey` includes the variant name and every `defines` value that changes the program.
- `tier === 'reduced'` decides motion. `lowPower` decides cost and detail. The `lite` variant of the facade material is used when `lowPower` is true.
- Every `InstancedMesh` whose matrices change over time sets `frustumCulled = false`.
- Ground is at world `y = -1` for the gradient height. Road surface `-1`, ground plane `-1.01`, road center line `-0.99`. Shadow quads sit at `y = -0.995`.
- `AO_MIN = 0.55`, `AO_HEIGHT = 0.9`, `RIM_DEPTH = 0.25`, `SHADOW_OPACITY = 0.45`. Constants live in TypeScript and are injected into the GLSL string.
- Shadow quad size per axis: `footprint * 1.5 + 0.2 + 0.12 * min(height, 2.5)`.
- The `alphaMap` falloff is opaque grayscale RGB (`R = G = B = falloff`, `A = 255`), because r186 `alphamap_fragment` reads the green channel only. Size 64 x 64, `NoColorSpace`, linear filtering, no mipmaps.
- Draw order: shadow mesh `renderOrder = 1`, road center line `renderOrder = 2`.
- Cost: one extra draw call and at most 0.3 ms on the named reference desktop and 0.3 ms on a physical iPhone (shared conventions, section 8).
- `scene.ts` stays below 800 lines. New logic goes in new modules.
- Every `.spec.ts` GPU test asserts an empty shader-error recorder and `glError === 0`.
- Commit messages use the repo format `<type>: <description>` with no `Co-Authored-By` trailer.

## Review Focus

1. A building that is hidden, has `width === 0`, or sits beyond the active count must produce a zero-scale shadow, never a `NaN` or a stale quad. Task 4 tests `shadowTransform`; Task 5 tests a real layer at low density and at density 0.
2. The AO term must stay glued to the ground when a building grows or shrinks with `buildingHeight`. Task 3 renders the same world height on a 3-unit and a 5-unit building and compares.
3. A setback building has two body parts. The upper part must continue the gradient from the ground, not restart it. Task 3 samples the AO term by world height only, and Task 2 asserts the shader derives height from `vWorldY`, not from `position`.
4. The rim must be off at night even though moonlight still lights the walls. Task 3 checks `dark.about` (elevation -22) gives no rim and `dark.projects` (elevation -3) still does.
5. A context loss must not drop the shadow `alphaMap` (a flat black quad would look like a hard rectangle). Task 7 compares frames before and after `loseContext()` / `restoreContext()` on all four tier combinations.

---

## Scope and repository findings

Specs 01, 03, 05 and 06 are merged, which changes four assumptions in the spec:

- **Buildings are multi-part.** `BuildingLayer.boxMesh` has one instance per part (`partRanges`), not per building. The gradient works per instance, so a setback's upper body and a rooftop block each get their own `vTopY` and rim. The shadow field has one quad per **building** (`layer.buildings[i]`), sized from the building's own footprint.
- **`Building.depth` exists and is required.** The spec's `depth ?? width` fallback is not needed. Hidden buildings use `HIDDEN_BUILDING` with `width === 0`.
- **Spec 05 is merged.** Use `sky.sunDirection` (unclamped) and `sky.sunVisibility` directly. Do not add the `windowLitRatio` approximation. The spec's "before spec 05" test group is dropped.
- **The dirty check exists.** `applyBuildingState` already skips unchanged states. Task 5 makes it return `moved` so the scene can gate the shadow rewrite on the same condition.

`scene.ts` currently has `scene.traverse` in `dispose()` that collects textures from every material property, so the `alphaMap` is disposed there too. `ContactShadowField.dispose()` is still implemented (idempotent in three) and called explicitly for clarity.

`tests/gpu/facade.spec.ts` pins exact draw-call counts and counts `PlaneGeometry` instanced meshes (expects 0). Task 7 updates both: +1 call per tier, and the plane check excludes the shadow mesh by name.

Spec 06 Part C (glass reflection) is separate and out of scope here. This plan adds only the uniforms listed in the spec table.

All commands run from `repos/portfolio` unless a step says otherwise. Work on an isolated branch `feat/city-04-gradient-contact-shadows` (the executing skill sets up the worktree).

## File structure

| File | Responsibility |
| --- | --- |
| `app/journey/facade-gradient.ts` | New. Constants, CPU mirrors (`aoFactor`, `aoEffective`, `rimAmount`, `bounceAmount`), `facadeLookFor`, uniform type, GLSL snippet builders. |
| `app/journey/facade-material.ts` | Modify. Extend `FacadeUniforms`, add `createFacadeUniforms`, splice gradient GLSL, add `FACADE_DEBUG_AO`. |
| `app/journey/contact-shadows.ts` | New. `shadowTransform`, `radialFalloffPixels`, `createContactShadowField`, `writeLayerShadows`, render-order constants. |
| `app/journey/buildings.ts` | Modify. Export `isActive`; `applyBuildingState` returns `moved`. |
| `app/journey/scene.ts` | Modify. Use `createFacadeUniforms`, add the field, set gradient uniforms after `sky.update`, set road line `renderOrder`. |
| `tests/journey/facade-gradient.test.ts` | New. Pure math and uniform mapping. |
| `tests/journey/contact-shadows.test.ts` | New. Transform, texture, field, layer sync. |
| `tests/journey/facade-material.test.ts` | Modify. New uniform fixtures, cache key, gradient patch. |
| `tests/journey/building-layer.test.ts` | Modify. New uniform fixture, `moved` return value. |
| `tests/gpu/gradient-probe.ts` | New. Renders one wall into a float target and samples by height. |
| `tests/gpu/contact-shadow-probe.ts` | New. Isolated shadow render and scene draw-call probe. |
| `tests/gpu/gradient.spec.ts` | New. Shader tests (spec tests 5, 6, 8). |
| `tests/gpu/contact-shadows.spec.ts` | New. Shadow tests, tiers, restore (spec tests 7, 9). The spec lists one file; this splits by responsibility. |
| `tests/gpu/harness.ts`, `facade-probe.ts`, `windows-probe.ts`, `facade.spec.ts` | Modify. Register probes, adopt `createFacadeUniforms`, update call counts. |

---

### Task 1: Gradient math and uniform mapping

**Files:**
- Create: `app/journey/facade-gradient.ts`
- Test: `tests/journey/facade-gradient.test.ts`

**Interfaces:**
- Consumes: `smoothstep(edge0, edge1, x)` from `app/journey/sky-mirror.ts`; `LookState` from `app/journey/stops.ts`.
- Produces (Task 2 and Task 6 rely on these exact names):
  - `GRADIENT_GROUND_Y = -1`, `AO_MIN = 0.55`, `AO_HEIGHT = 0.9`, `RIM_DEPTH = 0.25`, `BOUNCE_HEIGHT = 0.6`
  - `aoFactor(height: number): number`
  - `aoEffective(height: number, strength: number): number`
  - `rimAmount(worldY: number, topY: number, normalDotSun: number): number`
  - `bounceAmount(height: number): number`
  - `facadeLookFor(look: Pick<LookState, 'windowLitRatio'>, sunVisibility: number): { uAoStrength: number; uRimStrength: number; uBounce: number }`

- [ ] **Step 1: Write the failing test**

Create `tests/journey/facade-gradient.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BASE_Y } from '../../app/journey/buildings'
import {
  AO_HEIGHT, AO_MIN, aoEffective, aoFactor, BOUNCE_HEIGHT, bounceAmount, facadeLookFor,
  GRADIENT_GROUND_Y, RIM_DEPTH, rimAmount,
} from '../../app/journey/facade-gradient'
import { sunDirectionFor, sunVisibilityFor } from '../../app/journey/sky-mirror'
import { CHAPTER_IDS, LOOKS, type Theme } from '../../app/journey/stops'

const THEMES: readonly Theme[] = ['light', 'dark']

describe('aoFactor', () => {
  it('starts at AO_MIN on the ground and reaches 1 at AO_HEIGHT', () => {
    expect(GRADIENT_GROUND_Y).toBe(BASE_Y)
    expect(aoFactor(0)).toBeCloseTo(AO_MIN, 12)
    expect(aoFactor(AO_HEIGHT)).toBeCloseTo(1, 12)
    expect(aoFactor(AO_HEIGHT * 3)).toBe(1)
    expect(aoFactor(-0.5)).toBeCloseTo(AO_MIN, 12)
  })

  it('rises monotonically in between', () => {
    let previous = aoFactor(0)
    for (let h = 0.01; h <= AO_HEIGHT; h += 0.01) {
      const value = aoFactor(h)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe('aoEffective', () => {
  it('is 1 at strength 0 and equals aoFactor at strength 1', () => {
    expect(aoEffective(0.1, 0)).toBe(1)
    expect(aoEffective(0.1, 1)).toBeCloseTo(aoFactor(0.1), 12)
  })

  it('keeps luminance 0.2 above the base at most 70% of luminance 1.5 above, at every stop', () => {
    for (const theme of THEMES) {
      for (const chapter of CHAPTER_IDS) {
        const strength = facadeLookFor(LOOKS[theme][chapter], 1).uAoStrength
        const ratio = aoEffective(0.2, strength) / aoEffective(1.5, strength)
        expect(ratio, `${theme} ${chapter}`).toBeLessThanOrEqual(0.7)
      }
    }
  })
})

describe('rimAmount', () => {
  it('is zero below the rim band and full at the roof edge', () => {
    expect(rimAmount(2 - RIM_DEPTH - 0.01, 2, 1)).toBe(0)
    expect(rimAmount(2, 2, 0.8)).toBeCloseTo(0.8, 12)
  })

  it('ignores walls that face away from the sun', () => {
    expect(rimAmount(2, 2, -0.7)).toBe(0)
  })

  it('moves with the roof, not with a fixed height', () => {
    expect(rimAmount(4 - 0.1, 4, 1)).toBeCloseTo(rimAmount(2 - 0.1, 2, 1), 12)
  })
})

describe('bounceAmount', () => {
  it('is 1 at the ground and 0 from BOUNCE_HEIGHT up', () => {
    expect(bounceAmount(0)).toBe(1)
    expect(bounceAmount(BOUNCE_HEIGHT)).toBe(0)
    expect(bounceAmount(3)).toBe(0)
  })
})

describe('facadeLookFor', () => {
  it('maps windowLitRatio to AO relief and bounce', () => {
    for (const theme of THEMES) {
      for (const chapter of CHAPTER_IDS) {
        const look = LOOKS[theme][chapter]
        const mapped = facadeLookFor(look, 1)
        expect(mapped.uAoStrength).toBeCloseTo(1 - 0.25 * look.windowLitRatio, 12)
        expect(mapped.uBounce).toBeCloseTo(0.06 * look.windowLitRatio, 12)
      }
    }
  })

  it('scales the rim by sun visibility and clamps it to [0, 1]', () => {
    const look = LOOKS.light.intro
    expect(facadeLookFor(look, 1).uRimStrength).toBeCloseTo(0.35, 12)
    expect(facadeLookFor(look, 0.5).uRimStrength).toBeCloseTo(0.175, 12)
    expect(facadeLookFor(look, 0).uRimStrength).toBe(0)
    expect(facadeLookFor(look, 2).uRimStrength).toBeCloseTo(0.35, 12)
    expect(facadeLookFor(look, -1).uRimStrength).toBe(0)
  })

  it('turns the rim off at night and keeps it at sunset', () => {
    const rimFor = (theme: Theme, chapter: (typeof CHAPTER_IDS)[number]) => {
      const look = LOOKS[theme][chapter]
      const [, y] = sunDirectionFor(look.sunElevation, look.sunAzimuth)
      return facadeLookFor(look, sunVisibilityFor(y)).uRimStrength
    }
    expect(rimFor('dark', 'about')).toBe(0)
    expect(rimFor('dark', 'projects')).toBeGreaterThan(0.3)
    for (const chapter of CHAPTER_IDS) expect(rimFor('light', chapter)).toBeCloseTo(0.35, 12)
  })

  it('clamps an out-of-range windowLitRatio', () => {
    expect(facadeLookFor({ windowLitRatio: 2 }, 1).uAoStrength).toBeCloseTo(0.75, 12)
    expect(facadeLookFor({ windowLitRatio: -1 }, 1).uBounce).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/journey/facade-gradient.test.ts`
Expected: FAIL with "Failed to resolve import ../../app/journey/facade-gradient".

- [ ] **Step 3: Write minimal implementation**

Create `app/journey/facade-gradient.ts`:

```ts
import { smoothstep } from './sky-mirror'
import type { LookState } from './stops'

// World Y of the ground the walls stand on (shared conventions, section 6). Equals BASE_Y in buildings.ts;
// a test pins the two together so this file does not import buildings.ts.
export const GRADIENT_GROUND_Y = -1
export const AO_MIN = 0.55
export const AO_HEIGHT = 0.9
export const RIM_DEPTH = 0.25
export const BOUNCE_HEIGHT = 0.6

const RIM_STRENGTH = 0.35
const AO_NIGHT_RELIEF = 0.25
const BOUNCE_STRENGTH = 0.06

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

// CPU mirror of the base-occlusion factor in the fragment shader.
export function aoFactor(height: number): number {
  return AO_MIN + (1 - AO_MIN) * smoothstep(0, AO_HEIGHT, height)
}

// The exact multiplier applied to the wall color: mix(1.0, ao, strength).
export function aoEffective(height: number, strength: number): number {
  return 1 + (aoFactor(height) - 1) * strength
}

export function rimAmount(worldY: number, topY: number, normalDotSun: number): number {
  return smoothstep(topY - RIM_DEPTH, topY, worldY) * Math.max(normalDotSun, 0)
}

export function bounceAmount(height: number): number {
  return 1 - smoothstep(0, BOUNCE_HEIGHT, height)
}

export interface FacadeGradientLook {
  uAoStrength: number
  uRimStrength: number
  uBounce: number
}

// `sunVisibility` is `sky.sunVisibility`: a smoothstep on the unclamped sun elevation.
export function facadeLookFor(look: Pick<LookState, 'windowLitRatio'>, sunVisibility: number): FacadeGradientLook {
  const lit = clamp01(look.windowLitRatio)
  return {
    uAoStrength: 1 - AO_NIGHT_RELIEF * lit,
    uRimStrength: RIM_STRENGTH * clamp01(sunVisibility),
    uBounce: BOUNCE_STRENGTH * lit,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/journey/facade-gradient.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add app/journey/facade-gradient.ts tests/journey/facade-gradient.test.ts
git commit -m "feat: add facade gradient math and uniform mapping"
```

---

### Task 2: Splice the gradient into the facade material

**Files:**
- Modify: `app/journey/facade-gradient.ts` (append GLSL builders and the uniform type)
- Modify: `app/journey/facade-material.ts`
- Modify: `app/journey/scene.ts:401-404` (uniform creation only)
- Modify: `tests/journey/facade-material.test.ts`, `tests/journey/building-layer.test.ts:8-11`, `tests/gpu/facade-probe.ts:14-16`, `tests/gpu/windows-probe.ts:17-21`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `FacadeGradientUniforms` (from `facade-gradient.ts`): `uAoStrength`, `uRimStrength`, `uBounce` as `{ value: number }`; `uSunDir` as `{ value: THREE.Vector3 }`; `uSunColor`, `uBounceColor` as `{ value: THREE.Color }`.
  - `FacadeUniforms extends FacadeGradientUniforms` (adds the existing five).
  - `createFacadeUniforms(flicker = 1): FacadeUniforms` in `facade-material.ts`. Neutral defaults: `uAoStrength 0`, `uRimStrength 0`, `uBounce 0`, `uSunDir (0, 1, 0)`, `uSunColor` white, `uBounceColor` from `WINDOW_PALETTE[0].hex`. Neutral AO means existing GPU tests keep their pixels.
  - Debug define `FACADE_DEBUG_AO`: `1` writes `vec3(facadeAoEffective)` to `gl_FragColor`; `2` writes `facadeGradientEmission` (rim plus bounce). Cache key suffix `-ao-${FACADE_DEBUG_AO ?? 0}`.
  - GLSL local names later tasks read: `facadeAoEffective`, `facadeGradientEmission`.

- [ ] **Step 1: Write the failing tests**

In `tests/journey/facade-material.test.ts`, change the import and the three uniform literals, update the cache-key assertion, and add a gradient test.

Replace the import line:

```ts
import { createFacadeMaterial, createFacadeUniforms } from '../../app/journey/facade-material'
import { AO_HEIGHT, AO_MIN, RIM_DEPTH } from '../../app/journey/facade-gradient'
import { glslFloat } from '../../app/journey/shader-utils'
```

In the first test (`patches pinned standard shader`), replace the `uniforms` literal with:

```ts
  const uniforms = { ...createFacadeUniforms(0), uLit: { value: 0.9 }, uSkyTint: { value: new THREE.Color(0xbfdbfe) } }
```

and the cache-key assertion with:

```ts
  expect(material.customProgramCacheKey()).toBe(`facade-${variant}-windows-ab-0-ao-0`)
```

In `separates program cache variants`, replace the `uniforms` literal with `const uniforms = createFacadeUniforms(0)`.

In `patched(...)`, replace the signature and uniform literal:

```ts
function patched(variant: 'full' | 'lite', debug = 0, debugAo = 0) {
  const uniforms = { ...createFacadeUniforms(0), uLit: { value: .65 }, uSkyTint: { value: new THREE.Color(0xbfdbfe) } }
  const m = createFacadeMaterial({ color: 0x353b5c, uniforms, variant })
  if (debug) m.defines = { ...m.defines, FACADE_DEBUG_WINDOW: debug }
  if (debugAo) m.defines = { ...m.defines, FACADE_DEBUG_AO: debugAo }
```

Append at the end of the file:

```ts
it('splices the gradient into both variants, and the rim and bounce into full only', () => {
  const full = patched('full'); const lite = patched('lite')
  for (const variant of [full, lite]) {
    const { vertexShader, fragmentShader, uniforms } = variant.shader
    expect(fragmentShader).toContain('facadeAoEffective')
    expect(fragmentShader).toContain('facadeGradientEmission')
    expect(fragmentShader).toContain('totalEmissiveRadiance += facadeWindowEmission + facadeGradientEmission')
    expect(fragmentShader).toContain(glslFloat(AO_MIN))
    expect(fragmentShader).toContain(glslFloat(AO_HEIGHT))
    expect(vertexShader).toContain('vWorldY = (facadeModel * vec4(position, 1.0)).y')
    expect(uniforms.uAoStrength).toBe(variant.uniforms.uAoStrength)
    variant.m.dispose()
  }
  expect(full.shader.fragmentShader).toContain(glslFloat(RIM_DEPTH))
  expect(full.shader.fragmentShader).toContain('uRimStrength')
  expect(full.shader.fragmentShader).toContain('vTopY')
  expect(full.shader.vertexShader).toContain('vTopY = (facadeModel * vec4(0.0, 0.5, 0.0, 1.0)).y')
  expect(full.shader.vertexShader).toContain('vWorldNormal')
  for (const name of ['uRimStrength', 'uBounce', 'uSunDir', 'uSunColor', 'uBounceColor', 'vTopY', 'vWorldNormal']) {
    expect(lite.shader.fragmentShader).not.toContain(name)
    expect(lite.shader.vertexShader).not.toContain(name)
  }
  expect(full.m.customProgramCacheKey()).not.toBe(patched('full', 0, 1).m.customProgramCacheKey())
  expect(patched('full', 0, 1).m.customProgramCacheKey()).not.toBe(patched('full', 0, 2).m.customProgramCacheKey())
  expect(full.shader.fragmentShader).toContain('FACADE_DEBUG_AO')
})
```

In `tests/journey/building-layer.test.ts`, replace the local `facade` helper (lines 8-11) and its import:

```ts
import { createFacadeUniforms } from '../../app/journey/facade-material'
```

and delete the `const facade = (): FacadeUniforms => ({ ... })` block, then change `layerFor` to:

```ts
const layerFor = (index: number, lowPower = false): BuildingLayer =>
  createBuildingLayer(index, { lowPower, facade: createFacadeUniforms() })
```

Remove the now-unused `import type { FacadeUniforms }` line from that file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/journey/facade-material.test.ts tests/journey/building-layer.test.ts`
Expected: FAIL. `createFacadeUniforms` is not exported, and the cache-key and gradient assertions fail.

- [ ] **Step 3: Write the implementation**

Append to `app/journey/facade-gradient.ts` (add `import type * as THREE from 'three'` and `import { glslFloat } from './shader-utils'` at the top):

```ts
export type GradientVariant = 'full' | 'lite'

export interface FacadeGradientUniforms {
  uAoStrength: { value: number }
  uRimStrength: { value: number }
  uBounce: { value: number }
  uSunDir: { value: THREE.Vector3 }
  uSunColor: { value: THREE.Color }
  uBounceColor: { value: THREE.Color }
}

const glsl = glslFloat

export function gradientVertexDeclarations(variant: GradientVariant): string {
  return `
varying float vWorldY;${variant === 'full' ? `
varying float vTopY;
varying vec3 vWorldNormal;` : ''}
`
}

// Runs inside <begin_vertex>. Walls are scale-and-translate only (no rotation), so the unscaled normal is right.
export function gradientVertexPatch(variant: GradientVariant): string {
  return `
mat4 facadeModel = modelMatrix;
#ifdef USE_INSTANCING
facadeModel = modelMatrix * instanceMatrix;
#endif
vWorldY = (facadeModel * vec4(position, 1.0)).y;${variant === 'full' ? `
vTopY = (facadeModel * vec4(0.0, 0.5, 0.0, 1.0)).y;
vWorldNormal = normalize(mat3(modelMatrix) * normal);` : ''}
`
}

export function gradientFragmentDeclarations(variant: GradientVariant): string {
  return `
uniform float uAoStrength;
varying float vWorldY;
const float FACADE_AO_MIN = ${glsl(AO_MIN)};
const float FACADE_AO_HEIGHT = ${glsl(AO_HEIGHT)};${variant === 'full' ? `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uRimStrength;
uniform float uBounce;
uniform vec3 uBounceColor;
varying float vTopY;
varying vec3 vWorldNormal;
const float FACADE_RIM_DEPTH = ${glsl(RIM_DEPTH)};
const float FACADE_BOUNCE_HEIGHT = ${glsl(BOUNCE_HEIGHT)};` : ''}
`
}

// Runs at main scope after the window logic, so it darkens the wall and the glass diffuse but never the emissive windows.
export function gradientFragmentPatch(variant: GradientVariant): string {
  return `
float facadeHeight = vWorldY - (${glsl(GRADIENT_GROUND_Y)});
float facadeAo = mix(FACADE_AO_MIN, 1.0, smoothstep(0.0, FACADE_AO_HEIGHT, facadeHeight));
float facadeAoEffective = mix(1.0, facadeAo, uAoStrength);
diffuseColor.rgb *= facadeAoEffective;
vec3 facadeGradientEmission = vec3(0.0);${variant === 'full' ? `
float facadeRim = smoothstep(vTopY - FACADE_RIM_DEPTH, vTopY, vWorldY) * max(dot(normalize(vWorldNormal), uSunDir), 0.0);
facadeGradientEmission += uSunColor * facadeRim * uRimStrength;
float facadeBounce = 1.0 - smoothstep(0.0, FACADE_BOUNCE_HEIGHT, facadeHeight);
facadeGradientEmission += uBounceColor * facadeBounce * uBounce;` : ''}
`
}
```

In `app/journey/facade-material.ts`:

1. Add imports:

```ts
import {
  type FacadeGradientUniforms, gradientFragmentDeclarations, gradientFragmentPatch,
  gradientVertexDeclarations, gradientVertexPatch,
} from './facade-gradient'
```

2. Change the interface and add the factory right after `FacadeVariant`:

```ts
export interface FacadeUniforms extends FacadeGradientUniforms {
  uLit: { value: number }
  uSkyTint: { value: THREE.Color }
  uTime: { value: number }
  uFlicker: { value: number }
  uEmissiveScale: { value: number }
}
export type FacadeVariant = 'full' | 'lite'

// Neutral defaults: the gradient is off (strengths 0), so a caller that sets only the window uniforms renders as before.
export function createFacadeUniforms(flicker = 1): FacadeUniforms {
  return {
    uLit: { value: 0 }, uSkyTint: { value: new THREE.Color() },
    uTime: { value: 0 }, uFlicker: { value: flicker }, uEmissiveScale: { value: 1 },
    uAoStrength: { value: 0 }, uRimStrength: { value: 0 }, uBounce: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(0xffffff) },
    uBounceColor: { value: new THREE.Color(warm.hex) },
  }
}
```

3. In `facadeColorPatch`, append the gradient after the closing `}` of the `if` block. Change the end of the returned template from

```
  facadeLit = smoothstep(threshold, threshold + ${glsl(WINDOW.fadeBand)}, uLit);${variant === 'full' ? fullEmission : liteEmission}
}
`
```

to

```
  facadeLit = smoothstep(threshold, threshold + ${glsl(WINDOW.fadeBand)}, uLit);${variant === 'full' ? fullEmission : liteEmission}
}
${gradientFragmentPatch(variant)}`
```

4. Extend `debugOutput` (before the closing backtick):

```
#if defined(FACADE_DEBUG_AO) && FACADE_DEBUG_AO == 1
  gl_FragColor = vec4(vec3(facadeAoEffective), 1.0);
#elif defined(FACADE_DEBUG_AO) && FACADE_DEBUG_AO == 2
  gl_FragColor = vec4(facadeGradientEmission, 1.0);
#endif
```

5. Change the cache key:

```ts
  material.customProgramCacheKey = () =>
    `facade-${variant}-windows-ab-${material.defines?.FACADE_DEBUG_WINDOW ?? 0}-ao-${material.defines?.FACADE_DEBUG_AO ?? 0}`
```

6. In `onBeforeCompile`, make four replacements:

```ts
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <common>',
      '#include <common>\n' + vertexDeclarations + gradientVertexDeclarations(variant))
```

In the `begin_vertex` template, add `${gradientVertexPatch(variant)}` as the last line before the closing backtick (after `vWindowed = aWindowed;`).

```ts
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <common>',
      '#include <common>\n' + fragmentDeclarations + gradientFragmentDeclarations(variant))
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += facadeWindowEmission + facadeGradientEmission;')
```

In `app/journey/scene.ts`, replace the `facade` literal (lines 401-404) with:

```ts
  const facade = createFacadeUniforms(tier === 'reduced' ? 0 : 1)
```

and change the import `import type { FacadeUniforms } from './facade-material'` to `import { createFacadeUniforms } from './facade-material'`. Remove `type FacadeUniforms` usage if it is now unused (typecheck will say).

In `tests/gpu/facade-probe.ts`, replace the `uniforms` literal passed to `createFacadeMaterial` with:

```ts
    uniforms: { ...createFacadeUniforms(0), uLit: { value: options.lit }, uSkyTint: { value: new THREE.Color(0x6688aa) } } })
```

and import `createFacadeUniforms` next to `createFacadeMaterial`.

In `tests/gpu/windows-probe.ts`, replace the `uniforms` object with:

```ts
  const uniforms={...createFacadeUniforms(input.flicker??0),uLit:{value:input.ratio},uSkyTint:{value:new THREE.Color(0xbfdbfe)},
    uTime:{value:input.time??0},uEmissiveScale:{value:input.emissiveScale??1}}
```

and import `createFacadeUniforms`. (`uFlicker` previously came from `input.flicker ?? 0`; the factory argument keeps that.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS for the whole Vitest suite.

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run test:gpu -- tests/gpu/windows.spec.ts tests/gpu/facade.spec.ts tests/gpu/buildings.spec.ts`
Expected: PASS. Neutral gradient defaults keep these pixels unchanged. If a window test fails on pixel values, the AO or emission splice changed an unrelated output: recheck that `uAoStrength` defaults to 0 in the probe.

- [ ] **Step 5: Commit**

```bash
git add app/journey/facade-gradient.ts app/journey/facade-material.ts app/journey/scene.ts tests/journey/facade-material.test.ts tests/journey/building-layer.test.ts tests/gpu/facade-probe.ts tests/gpu/windows-probe.ts
git commit -m "feat: add wall gradient, roof rim, and night bounce to facade shader"
```

---

### Task 3: GPU tests for the gradient shader

**Files:**
- Create: `tests/gpu/gradient-probe.ts`, `tests/gpu/gradient.spec.ts`
- Modify: `tests/gpu/harness.ts`

**Interfaces:**
- Consumes: `createFacadeMaterial`, `createFacadeUniforms`, `FACADE_DEBUG_AO` (Task 2); `aoEffective`, `rimAmount`, `facadeLookFor`, `GRADIENT_GROUND_Y`, `RIM_DEPTH` (Task 1); `createTestRenderer` (`tests/gpu/gpu-utils.ts`).
- Produces: `window.cityGpu.probeGradient(input: GradientProbeInput): GradientProbeResult`. `samples[i]` is `[r, g, b]` in linear floats at `heights[i]` above the ground. `heights` are the actual pixel-center heights, not the requested ones.

- [ ] **Step 1: Write the failing spec**

Create `tests/gpu/gradient.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import * as THREE from 'three'
import { aoEffective, facadeLookFor, GRADIENT_GROUND_Y, RIM_DEPTH, rimAmount } from '../../app/journey/facade-gradient'
import { sunDirectionFor, sunVisibilityFor } from '../../app/journey/sky-mirror'
import { CHAPTER_IDS, type ChapterId, LOOKS, type Theme } from '../../app/journey/stops'

const THEMES: readonly Theme[] = ['light', 'dark']
const AO_HEIGHTS = [0.02, 0.2, 0.45, 0.9, 1.5, 2.4]
const FACES = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] } as const
type Face = keyof typeof FACES

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

for (const variant of ['full', 'lite'] as const) {
  test(`${variant}: the AO term matches the CPU mirror at every stop strength`, async ({ page }) => {
    for (const theme of THEMES) {
      for (const chapter of CHAPTER_IDS) {
        const strength = facadeLookFor(LOOKS[theme][chapter], 1).uAoStrength
        const result = await page.evaluate(input => window.cityGpu.probeGradient(input), {
          variant, buildingHeight: 3, face: 'front' as Face, output: 'ao' as const,
          sampleHeights: AO_HEIGHTS, aoStrength: strength,
        })
        expect(result.shaderError).toBeNull()
        expect(result.glError).toBe(0)
        result.heights.forEach((height, i) => {
          for (const channel of [0, 1, 2]) {
            expect(result.samples[i]![channel], `${theme} ${chapter} h=${height}`).toBeCloseTo(aoEffective(height, strength), 3)
          }
        })
        // Spec criterion: luminance 0.2 above the base is at most 70% of luminance 1.5 above it.
        const low = result.samples[1]![0]!
        const high = result.samples[4]![0]!
        expect(low / high, `${theme} ${chapter}`).toBeLessThanOrEqual(0.7)
      }
    }
  })

  test(`${variant}: the AO term depends on world height, not on building height`, async ({ page }) => {
    const heights = [0.4, 1.2]
    const probe = (buildingHeight: number) => page.evaluate(input => window.cityGpu.probeGradient(input), {
      variant, buildingHeight, face: 'front' as Face, output: 'ao' as const, sampleHeights: heights, aoStrength: 1,
    })
    const short = await probe(3)
    const tall = await probe(5)
    for (const result of [short, tall]) {
      expect(result.shaderError).toBeNull()
      expect(result.glError).toBe(0)
    }
    heights.forEach((_, i) => {
      const a = short.samples[i]![0]!
      const b = tall.samples[i]![0]!
      expect(Math.abs(a - b) / a).toBeLessThan(0.03)
    })
  })
}

test('full: the rim moves with the roof', async ({ page }) => {
  const sunDir = [0, 0.2, 0.98] as const
  const dot = sunDir[2] / Math.hypot(...sunDir)
  for (const buildingHeight of [3, 5]) {
    const sampleHeights = Array.from({ length: 80 }, (_, i) => buildingHeight - 0.8 + i * 0.01)
    const result = await page.evaluate(input => window.cityGpu.probeGradient(input), {
      variant: 'full' as const, buildingHeight, face: 'front' as Face, output: 'emission' as const,
      sampleHeights, rimStrength: 0.35, sunDir, sunColor: [1, 1, 1] as const,
    })
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
    const topY = buildingHeight + GRADIENT_GROUND_Y
    let peak = 0
    result.heights.forEach((height, i) => {
      const expected = 0.35 * rimAmount(height + GRADIENT_GROUND_Y, topY, dot)
      expect(result.samples[i]![0]).toBeCloseTo(expected, 3)
      if (result.samples[i]![0]! > result.samples[peak]![0]!) peak = i
    })
    expect(topY - (result.heights[peak]! + GRADIENT_GROUND_Y)).toBeLessThanOrEqual(RIM_DEPTH)
    expect(result.samples[peak]![0]).toBeGreaterThan(0.1)
    expect(result.samples[0]![0]).toBeCloseTo(0, 6)
  }
})

function sunFor(theme: Theme, chapter: ChapterId) {
  const look = LOOKS[theme][chapter]
  const dir = sunDirectionFor(look.sunElevation, look.sunAzimuth)
  const color = new THREE.Color().setRGB(look.sunColor[0], look.sunColor[1], look.sunColor[2], THREE.SRGBColorSpace)
  const face = (Object.keys(FACES) as Face[]).reduce((best, name) => {
    const score = (key: Face) => FACES[key][0] * dir[0] + FACES[key][2] * dir[2]
    return score(name) > score(best) ? name : best
  })
  return { dir, face, color: [color.r, color.g, color.b] as const,
    rimStrength: facadeLookFor(look, sunVisibilityFor(dir[1])).uRimStrength }
}

for (const [theme, chapter, label] of [
  ['light', 'intro', 'day'], ['dark', 'projects', 'sunset'], ['dark', 'about', 'night'],
] as const) {
  test(`full: rim at ${label} (${theme} ${chapter})`, async ({ page }) => {
    const sun = sunFor(theme, chapter)
    const buildingHeight = 3
    const result = await page.evaluate(input => window.cityGpu.probeGradient(input), {
      variant: 'full' as const, buildingHeight, face: sun.face, output: 'emission' as const,
      sampleHeights: [buildingHeight - 0.01, buildingHeight - 0.6], rimStrength: sun.rimStrength,
      sunDir: sun.dir, sunColor: sun.color,
    })
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
    const [top, below] = result.samples.map(sample => sample[0]!)
    if (label === 'night') {
      expect(sun.rimStrength).toBe(0)
      expect(top!).toBeLessThan(2 / 255)
    } else {
      expect(top!).toBeGreaterThan(0.1)
      expect(top! - below!).toBeGreaterThan(0.1)
    }
  })
}
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npm run test:gpu -- tests/gpu/gradient.spec.ts`
Expected: FAIL with "window.cityGpu.probeGradient is not a function".

- [ ] **Step 3: Write the probe and register it**

Create `tests/gpu/gradient-probe.ts`:

```ts
import * as THREE from 'three'
import { GRADIENT_GROUND_Y } from '../../app/journey/facade-gradient'
import { createFacadeMaterial, createFacadeUniforms, type FacadeVariant } from '../../app/journey/facade-material'
import { createTestRenderer } from './gpu-utils'

export interface GradientProbeInput {
  variant: FacadeVariant
  buildingHeight: number
  face: 'front' | 'back' | 'left' | 'right'
  // 'ao' writes the AO multiplier, 'emission' writes the rim plus bounce emission (FACADE_DEBUG_AO 1 or 2).
  output: 'ao' | 'emission'
  // Heights above the ground. The result reports the pixel-center heights actually sampled.
  sampleHeights: readonly number[]
  aoStrength?: number
  rimStrength?: number
  bounce?: number
  sunDir?: readonly [number, number, number]
  sunColor?: readonly [number, number, number] // linear
}

export interface GradientProbeResult {
  samples: number[][]
  heights: number[]
  shaderError: string | null
  glError: number
}

const ROWS = 600
const COLUMNS = 8
const BOX = 1.6
const CAMERA_DISTANCE = 5
const FACE_DIRECTIONS = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] } as const

export function probeGradient(input: GradientProbeInput): GradientProbeResult {
  const gpu = createTestRenderer({ width: COLUMNS, height: ROWS })
  const { renderer, recorder } = gpu
  const target = new THREE.WebGLRenderTarget(COLUMNS, ROWS, {
    type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false,
  })
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array([0.5]), 1))
  // Unwindowed: the wall color is untouched except by the gradient.
  geometry.setAttribute('aWindowed', new THREE.InstancedBufferAttribute(new Float32Array([0]), 1))
  const uniforms = createFacadeUniforms(0)
  uniforms.uAoStrength.value = input.aoStrength ?? 1
  uniforms.uRimStrength.value = input.rimStrength ?? 0
  uniforms.uBounce.value = input.bounce ?? 0
  if (input.sunDir) uniforms.uSunDir.value.set(...input.sunDir).normalize()
  if (input.sunColor) uniforms.uSunColor.value.setRGB(...input.sunColor)
  const material = createFacadeMaterial({ color: 0x505050, uniforms, variant: input.variant })
  material.defines = { ...material.defines, FACADE_DEBUG_AO: input.output === 'ao' ? 1 : 2 }
  const mesh = new THREE.InstancedMesh(geometry, material, 1)
  mesh.frustumCulled = false
  const bottom = GRADIENT_GROUND_Y
  const top = GRADIENT_GROUND_Y + input.buildingHeight
  mesh.setMatrixAt(0, new THREE.Matrix4().compose(
    new THREE.Vector3(0, (top + bottom) / 2, 0), new THREE.Quaternion(), new THREE.Vector3(BOX, input.buildingHeight, BOX)))
  mesh.instanceMatrix.needsUpdate = true
  const scene = new THREE.Scene()
  scene.add(mesh)
  // Ortho bounds are view-space (relative to the camera), so center them on the camera at mid-height.
  const camera = new THREE.OrthographicCamera(-BOX / 2, BOX / 2, input.buildingHeight / 2, -input.buildingHeight / 2, 0.1, 50)
  const direction = new THREE.Vector3(...FACE_DIRECTIONS[input.face])
  camera.position.copy(direction).multiplyScalar(CAMERA_DISTANCE)
  camera.position.y = (top + bottom) / 2
  camera.lookAt(0, (top + bottom) / 2, 0)
  renderer.setPixelRatio(1)
  renderer.setSize(COLUMNS, ROWS, false)
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  target.texture.colorSpace = THREE.LinearSRGBColorSpace
  try {
    if (!renderer.getContext().getExtension('EXT_color_buffer_float')) {
      throw new Error('Gradient GPU tests require readable float color targets')
    }
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    recorder.assertClean()
    const pixels = new Float32Array(COLUMNS * ROWS * 4)
    renderer.readRenderTargetPixels(target, 0, 0, COLUMNS, ROWS, pixels)
    const column = COLUMNS / 2
    const samples: number[][] = []
    const heights: number[] = []
    for (const height of input.sampleHeights) {
      const row = Math.min(ROWS - 1, Math.max(0, Math.floor((height / input.buildingHeight) * ROWS)))
      const offset = 4 * (row * COLUMNS + column)
      samples.push(Array.from(pixels.subarray(offset, offset + 3)))
      heights.push(((row + 0.5) / ROWS) * input.buildingHeight)
    }
    return { samples, heights, shaderError: recorder.error?.message ?? null, glError: renderer.getContext().getError() }
  } finally {
    renderer.setRenderTarget(null)
    target.dispose()
    geometry.dispose()
    material.dispose()
    gpu.dispose()
  }
}
```

In `tests/gpu/harness.ts`, add the import and register it:

```ts
import { probeGradient } from './gradient-probe'
```

and in the `cityGpu` object, next to `probeFacade`:

```ts
  probeGradient,
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npm run test:gpu -- tests/gpu/gradient.spec.ts`
Expected: PASS for all 8 tests (2 per variant: AO matches the mirror, AO is height independent; plus 1 rim-moves test and 3 sun cases).

If the rim-at-night test shows a non-zero top sample, check that `rimStrength` was computed as 0 and the probe passes it; a non-zero value means `uRimStrength` leaked between probe runs (each probe builds a fresh material, so it should not).

- [ ] **Step 5: Commit**

```bash
git add tests/gpu/gradient-probe.ts tests/gpu/gradient.spec.ts tests/gpu/harness.ts
git commit -m "test: gpu checks for wall gradient, height independence, and rim"
```

---

### Task 4: Contact shadow field

**Files:**
- Create: `app/journey/contact-shadows.ts`
- Test: `tests/journey/contact-shadows.test.ts`

**Interfaces:**
- Consumes: `Building` type from `app/journey/buildings.ts` (type import only); `smoothstep` from `sky-mirror.ts`.
- Produces:
  - Constants `SHADOW_Y = -0.995`, `SHADOW_OPACITY = 0.45`, `SHADOW_TEXTURE_SIZE = 64`, `SHADOW_NAME = 'journey-contact-shadows'`, `SHADOW_RENDER_ORDER = 1`, `ROAD_MARKING_RENDER_ORDER = 2`.
  - `type ShadowSource = Pick<Building, 'x' | 'z' | 'width' | 'depth'>`
  - `shadowTransform(building: ShadowSource, height: number, active: boolean): { x, y, z, sx, sz }`
  - `radialFalloffPixels(size: number): Uint8Array` (RGBA, length `size * size * 4`)
  - `interface ContactShadowField { mesh; write(index, building, height, active): void; commit(): void; dispose(): void }`
  - `createContactShadowField(totalBuildings: number): ContactShadowField`. `write` throws `RangeError` for an index outside `[0, totalBuildings)`.

- [ ] **Step 1: Write the failing test**

Create `tests/journey/contact-shadows.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createContactShadowField, radialFalloffPixels, ROAD_MARKING_RENDER_ORDER, SHADOW_NAME, SHADOW_OPACITY,
  SHADOW_RENDER_ORDER, SHADOW_TEXTURE_SIZE, SHADOW_Y, shadowTransform,
} from '../../app/journey/contact-shadows'

const building = { x: 3, z: -4, width: 1, depth: 0.8 }
const matrix = new THREE.Matrix4()

function scaleOf(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixScale(matrix)
}

describe('shadowTransform', () => {
  it('sits at SHADOW_Y under the building and sizes from the footprint and height', () => {
    const t = shadowTransform(building, 1, true)
    expect(t).toEqual({ x: 3, y: SHADOW_Y, z: -4, sx: 1 * 1.5 + 0.2 + 0.12, sz: 0.8 * 1.5 + 0.2 + 0.12 })
  })

  it('grows with height up to the 2.5 clamp', () => {
    const small = shadowTransform(building, 0.5, true)
    const tall = shadowTransform(building, 2.5, true)
    const taller = shadowTransform(building, 9, true)
    expect(tall.sx).toBeGreaterThan(small.sx)
    expect(taller.sx).toBe(tall.sx)
    expect(taller.sz).toBe(tall.sz)
  })

  it('is zero-size for an inactive building and for width 0, never NaN', () => {
    for (const t of [
      shadowTransform(building, 1, false),
      shadowTransform({ ...building, width: 0, depth: 0 }, 1, true),
      shadowTransform({ ...building, width: 0, depth: 0 }, 0, false),
    ]) {
      expect(t.sx).toBe(0)
      expect(t.sz).toBe(0)
      expect(Number.isNaN(t.x + t.y + t.z)).toBe(false)
    }
  })

  it('keeps a zero-height active building a valid quad', () => {
    const t = shadowTransform(building, 0, true)
    expect(t.sx).toBeCloseTo(1.7, 12)
    expect(Number.isFinite(t.sz)).toBe(true)
  })
})

describe('radialFalloffPixels', () => {
  const size = SHADOW_TEXTURE_SIZE
  const pixels = radialFalloffPixels(size)
  const at = (x: number, y: number) => Array.from(pixels.subarray(4 * (y * size + x), 4 * (y * size + x) + 4))

  it('is opaque grayscale: R = G = B, A = 255', () => {
    expect(pixels).toHaveLength(size * size * 4)
    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(pixels[i + 1])
      expect(pixels[i]).toBe(pixels[i + 2])
      expect(pixels[i + 3]).toBe(255)
    }
  })

  it('is white at the center and black at the corner', () => {
    expect(at(size / 2, size / 2)).toEqual([255, 255, 255, 255])
    expect(at(0, 0)).toEqual([0, 0, 0, 255])
    expect(at(size - 1, size - 1)).toEqual([0, 0, 0, 255])
  })

  it('falls monotonically from the center to the edge and is intermediate halfway', () => {
    let previous = 256
    for (let x = size / 2; x < size; x++) {
      const green = at(x, size / 2)[1]!
      expect(green).toBeLessThanOrEqual(previous)
      previous = green
    }
    const half = at(size / 2 + size / 4, size / 2)[1]!
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(255)
  })
})

describe('createContactShadowField', () => {
  it('allocates one instance per building in one flat, transparent mesh', () => {
    const field = createContactShadowField(96)
    const { mesh } = field
    expect(mesh.count).toBe(96)
    expect(mesh.name).toBe(SHADOW_NAME)
    expect(mesh.frustumCulled).toBe(false)
    expect(mesh.renderOrder).toBe(SHADOW_RENDER_ORDER)
    expect(SHADOW_RENDER_ORDER).toBeLessThan(ROAD_MARKING_RENDER_ORDER)
    const normal = mesh.geometry.getAttribute('normal')
    expect(normal.getY(0)).toBeCloseTo(1, 6)
    expect(mesh.geometry.getAttribute('position').getY(0)).toBeCloseTo(0, 6)
    const material = mesh.material
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.opacity).toBe(SHADOW_OPACITY)
    expect(material.polygonOffset).toBe(true)
    expect(material.polygonOffsetFactor).toBe(-1)
    expect(material.polygonOffsetUnits).toBe(-1)
    expect(material.fog).toBe(true)
    field.dispose()
  })

  it('builds a linear, mipmap-free, non-color-managed RGBA alpha map', () => {
    const field = createContactShadowField(1)
    const map = field.mesh.material.alphaMap!
    expect(map.colorSpace).toBe(THREE.NoColorSpace)
    expect(map.minFilter).toBe(THREE.LinearFilter)
    expect(map.magFilter).toBe(THREE.LinearFilter)
    expect(map.generateMipmaps).toBe(false)
    expect(map.image.width).toBe(SHADOW_TEXTURE_SIZE)
    expect(map.image.height).toBe(SHADOW_TEXTURE_SIZE)
    field.dispose()
  })

  it('starts with every instance hidden', () => {
    const field = createContactShadowField(3)
    for (let i = 0; i < 3; i++) expect(scaleOf(field.mesh, i).x).toBe(0)
    field.dispose()
  })

  it('writes a flat quad scaled to the footprint and hides an inactive one', () => {
    const field = createContactShadowField(2)
    field.write(0, building, 1, true)
    field.write(1, building, 1, false)
    const t = shadowTransform(building, 1, true)
    expect(scaleOf(field.mesh, 0).toArray()).toEqual([expect.closeTo(t.sx, 5), 1, expect.closeTo(t.sz, 5)])
    field.mesh.getMatrixAt(0, matrix)
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([3, expect.closeTo(SHADOW_Y, 5), -4])
    expect(scaleOf(field.mesh, 1).x).toBe(0)
    field.dispose()
  })

  it('rejects an index outside the field', () => {
    const field = createContactShadowField(2)
    expect(() => field.write(2, building, 1, true)).toThrow(RangeError)
    expect(() => field.write(-1, building, 1, true)).toThrow(RangeError)
    field.dispose()
  })

  it('flags the matrix buffer for upload only after a write', () => {
    const field = createContactShadowField(2)
    field.commit()
    const version = field.mesh.instanceMatrix.version
    field.commit()
    expect(field.mesh.instanceMatrix.version).toBe(version)
    field.write(0, building, 1, true)
    field.commit()
    expect(field.mesh.instanceMatrix.version).toBe(version + 1)
    field.commit()
    expect(field.mesh.instanceMatrix.version).toBe(version + 1)
    field.dispose()
  })

  it('disposes geometry, material, and the alpha map', () => {
    const field = createContactShadowField(1)
    const disposed: string[] = []
    field.mesh.geometry.addEventListener('dispose', () => disposed.push('geometry'))
    field.mesh.material.addEventListener('dispose', () => disposed.push('material'))
    field.mesh.material.alphaMap!.addEventListener('dispose', () => disposed.push('alphaMap'))
    field.dispose()
    expect(disposed.sort()).toEqual(['alphaMap', 'geometry', 'material'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/journey/contact-shadows.test.ts`
Expected: FAIL with "Failed to resolve import ../../app/journey/contact-shadows".

- [ ] **Step 3: Write minimal implementation**

Create `app/journey/contact-shadows.ts`:

```ts
import * as THREE from 'three'
import type { Building } from './buildings'
import { smoothstep } from './sky-mirror'

// Above the road (-1) and the ground (-1.01), below the road center line (-0.99).
export const SHADOW_Y = -0.995
export const SHADOW_OPACITY = 0.45
export const SHADOW_TEXTURE_SIZE = 64
export const SHADOW_NAME = 'journey-contact-shadows'
// Three sorts transparent objects by renderOrder first, so shadows always draw before the center line.
export const SHADOW_RENDER_ORDER = 1
export const ROAD_MARKING_RENDER_ORDER = 2

const FOOTPRINT_SCALE = 1.5
const FOOTPRINT_PAD = 0.2
const HEIGHT_GROWTH = 0.12
const HEIGHT_GROWTH_CAP = 2.5

export type ShadowSource = Pick<Building, 'x' | 'z' | 'width' | 'depth'>

export interface ShadowTransform {
  x: number
  y: number
  z: number
  sx: number
  sz: number
}

// An inactive or unplaced (`width === 0`) building gets scale 0.
export function shadowTransform(building: ShadowSource, height: number, active: boolean): ShadowTransform {
  const visible = active && building.width > 0
  const growth = HEIGHT_GROWTH * Math.min(Math.max(height, 0), HEIGHT_GROWTH_CAP)
  return {
    x: building.x,
    y: SHADOW_Y,
    z: building.z,
    sx: visible ? building.width * FOOTPRINT_SCALE + FOOTPRINT_PAD + growth : 0,
    sz: visible ? building.depth * FOOTPRINT_SCALE + FOOTPRINT_PAD + growth : 0,
  }
}

// r186 alphamap_fragment reads the GREEN channel only, so the falloff is stored as opaque grayscale.
export function radialFalloffPixels(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1
      const dy = ((y + 0.5) / size) * 2 - 1
      const value = Math.round(255 * (1 - smoothstep(0, 1, Math.hypot(dx, dy))))
      const offset = 4 * (y * size + x)
      pixels[offset] = value
      pixels[offset + 1] = value
      pixels[offset + 2] = value
      pixels[offset + 3] = 255
    }
  }
  return pixels
}

function createFalloffTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(radialFalloffPixels(SHADOW_TEXTURE_SIZE), SHADOW_TEXTURE_SIZE, SHADOW_TEXTURE_SIZE, THREE.RGBAFormat)
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export interface ContactShadowField {
  readonly mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  write(index: number, building: ShadowSource, height: number, active: boolean): void
  // Flags the matrix buffer for upload if anything was written since the last commit.
  commit(): void
  dispose(): void
}

// Module-level scratch objects: the per-frame update allocates nothing.
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const noRotation = new THREE.Quaternion()

export function createContactShadowField(totalBuildings: number): ContactShadowField {
  const geometry = new THREE.PlaneGeometry(1, 1)
  geometry.rotateX(-Math.PI / 2)
  const alphaMap = createFalloffTexture()
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: SHADOW_OPACITY, alphaMap, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  })
  material.name = 'journey-contact-shadow'
  const mesh = new THREE.InstancedMesh(geometry, material, totalBuildings)
  mesh.name = SHADOW_NAME
  mesh.frustumCulled = false
  mesh.renderOrder = SHADOW_RENDER_ORDER
  matrix.makeScale(0, 0, 0)
  for (let i = 0; i < totalBuildings; i++) mesh.setMatrixAt(i, matrix)
  let dirty = true

  return {
    mesh,
    write(index, building, height, active) {
      if (!(index >= 0 && index < totalBuildings)) throw new RangeError(`shadow index ${index} outside [0, ${totalBuildings})`)
      const t = shadowTransform(building, height, active)
      position.set(t.x, t.y, t.z)
      scale.set(t.sx, 1, t.sz)
      matrix.compose(position, noRotation, scale)
      mesh.setMatrixAt(index, matrix)
      dirty = true
    },
    commit() {
      if (!dirty) return
      mesh.instanceMatrix.needsUpdate = true
      dirty = false
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      alphaMap.dispose()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/journey/contact-shadows.test.ts`
Expected: PASS.

If "falls monotonically" fails at the first pixel, check that `at(size / 2, size / 2)` is read as the center-adjacent pixel: for size 64 its distance is about 0.022 and `Math.round(255 * 0.9986)` is 255.

- [ ] **Step 5: Commit**

```bash
git add app/journey/contact-shadows.ts tests/journey/contact-shadows.test.ts
git commit -m "feat: add contact shadow field with radial falloff alpha map"
```

---

### Task 5: Sync shadows from the building update

**Files:**
- Modify: `app/journey/buildings.ts` (`isActive` export, `applyBuildingState` return value)
- Modify: `app/journey/contact-shadows.ts` (add `writeLayerShadows`)
- Test: `tests/journey/building-layer.test.ts`, `tests/journey/contact-shadows.test.ts`

**Interfaces:**
- Consumes: `BuildingLayer`, `isActive`, `applyBuildingState` (existing); `ContactShadowField` (Task 4).
- Produces:
  - `export function isActive(building: Building, index: number, activeCount: number): boolean` in `buildings.ts`.
  - `applyBuildingState(...)` now returns `boolean`: `true` when it rewrote body matrices (the existing `moved` value).
  - `writeLayerShadows(field: Pick<ContactShadowField, 'write'>, offset: number, layer: Pick<BuildingLayer, 'buildings' | 'lastHeightScale' | 'lastActiveCount'>): void`. It writes `layer.buildings.length` quads from `offset`, using `building.baseHeight * layer.lastHeightScale`. It does nothing before the layer's first `applyBuildingState` (`lastActiveCount < 0`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/journey/building-layer.test.ts` inside `describe('applyBuildingState', ...)`:

```ts
  it('reports whether it rewrote the matrices', () => {
    const layer = layerFor(0)
    expect(run(layer, { density: 0.5 })).toBe(true)
    expect(run(layer, { density: 0.5 })).toBe(false)
    expect(run(layer, { density: 0.5, height: 1.2 })).toBe(true)
    expect(run(layer, { density: 0.9, height: 1.2 })).toBe(true)
  })
```

and change the `run` helper at the top of the file so it returns the call's result:

```ts
const run = (layer: BuildingLayer, o: { height?: number, density?: number, time?: number, steady?: boolean } = {}) =>
  applyBuildingState(layer, o.height ?? 1, o.density ?? 1, o.time ?? 0, o.steady ?? false)
```

(It already returns the call's value as an arrow expression; with the new return type the test above passes only once the function returns `boolean`.)

Append to `tests/journey/contact-shadows.test.ts`:

```ts
import { applyBuildingState, createBuildingLayer, isActive, LAYERS } from '../../app/journey/buildings'
import { createFacadeUniforms } from '../../app/journey/facade-material'
import { writeLayerShadows } from '../../app/journey/contact-shadows'

describe('writeLayerShadows', () => {
  // Fresh layers per test: applyBuildingState skips unchanged state, so shared layers would couple the tests.
  function setup() {
    const layers = [0, 1].map(i => createBuildingLayer(i, { lowPower: false, facade: createFacadeUniforms() }))
    const offsets = [0, layers[0]!.buildings.length]
    const total = layers.reduce((sum, layer) => sum + layer.buildings.length, 0)
    const field = createContactShadowField(total)
    const sync = (density: number, height = 1) => {
      layers.forEach((layer, i) => {
        if (applyBuildingState(layer, height, density, 0, true)) writeLayerShadows(field, offsets[i]!, layer)
      })
      field.commit()
    }
    const visibleCount = () =>
      Array.from({ length: total }, (_, i) => scaleOf(field.mesh, i).x).filter(x => x > 0).length
    return { layers, offsets, field, sync, visibleCount }
  }

  it('gives every active building a shadow and no inactive building one', () => {
    const { layers, offsets, field, sync, visibleCount } = setup()
    sync(0.35)
    let expected = 0
    layers.forEach((layer, l) => layer.buildings.forEach((building, i) => {
      const active = isActive(building, i, layer.lastActiveCount)
      expected += active ? 1 : 0
      expect(scaleOf(field.mesh, offsets[l]! + i).x > 0, `layer ${l} building ${i}`).toBe(active)
    }))
    expect(expected).toBeGreaterThan(0)
    expect(visibleCount()).toBe(expected)
    field.dispose()
  })

  it('hides every shadow at density 0 and shows them again as density rises', () => {
    const { field, sync, visibleCount } = setup()
    sync(1)
    const full = visibleCount()
    expect(full).toBeGreaterThan(0)
    sync(0)
    expect(visibleCount()).toBe(0)
    sync(1)
    expect(visibleCount()).toBe(full)
    field.dispose()
  })

  it('places each quad under its building and grows it with the height scale', () => {
    const { layers, field, sync } = setup()
    sync(1, 0.5)
    const index = layers[0]!.buildings.findIndex(b => b.width > 0)
    const building = layers[0]!.buildings[index]!
    const before = scaleOf(field.mesh, index).x
    field.mesh.getMatrixAt(index, matrix)
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).x).toBeCloseTo(building.x, 5)
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).z).toBeCloseTo(building.z, 5)
    sync(1, 1.5)
    expect(scaleOf(field.mesh, index).x).toBeGreaterThan(before)
    field.dispose()
  })

  it('does not rewrite shadows on an unchanged state', () => {
    const { field, sync } = setup()
    sync(0.6)
    const version = field.mesh.instanceMatrix.version
    sync(0.6)
    expect(field.mesh.instanceMatrix.version).toBe(version)
    field.dispose()
  })

  it('writes nothing for a layer that has not been applied yet', () => {
    const { field, visibleCount } = setup()
    const fresh = createBuildingLayer(2, { lowPower: false, facade: createFacadeUniforms() })
    writeLayerShadows(field, 0, fresh)
    expect(visibleCount()).toBe(0)
    expect(fresh.buildings).toHaveLength(LAYERS[2].count)
    field.dispose()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/journey/building-layer.test.ts tests/journey/contact-shadows.test.ts`
Expected: FAIL. `isActive` and `writeLayerShadows` are not exported, and `applyBuildingState` returns `undefined`.

- [ ] **Step 3: Write the implementation**

In `app/journey/buildings.ts`, export `isActive`:

```ts
export function isActive(building: Building, index: number, activeCount: number): boolean {
  return index < activeCount && building.width > 0
}
```

Change `applyBuildingState` to return the dirty flag. Update its signature and tail, and extend the comment above it with "Returns true when it rewrote the body matrices, so callers can refresh data derived from them (contact shadows)."

```ts
export function applyBuildingState(
  layer: BuildingLayer, heightScale: number, density: number, time: number, steadyBeacon: boolean,
): boolean {
```

and at the end of the function, after the beacon block, add `return moved`.

Append to `app/journey/contact-shadows.ts` (add `import { type BuildingLayer, isActive } from './buildings'` and change the existing `import type { Building }` to a combined import: `import { type Building, type BuildingLayer, isActive } from './buildings'`):

```ts
// Rewrites one layer's shadow quads from the state `applyBuildingState` just stored on the layer.
// Call it only when `applyBuildingState` returned true. Does nothing before the layer's first apply.
export function writeLayerShadows(
  field: Pick<ContactShadowField, 'write'>, offset: number,
  layer: Pick<BuildingLayer, 'buildings' | 'lastHeightScale' | 'lastActiveCount'>,
): void {
  if (layer.lastActiveCount < 0) return
  layer.buildings.forEach((building, i) => {
    field.write(offset + i, building, building.baseHeight * layer.lastHeightScale,
      isActive(building, i, layer.lastActiveCount))
  })
}
```

`buildings.ts` does not import `contact-shadows.ts`, so there is no import cycle.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (full Vitest suite).

- [ ] **Step 5: Commit**

```bash
git add app/journey/buildings.ts app/journey/contact-shadows.ts tests/journey/building-layer.test.ts tests/journey/contact-shadows.test.ts
git commit -m "feat: sync contact shadows from the building dirty check"
```

---

### Task 6: Wire the gradient uniforms and the shadow field into the scene

**Files:**
- Modify: `app/journey/scene.ts`
- Modify: `tests/gpu/facade.spec.ts:45-64`
- Modify: `tests/journey/facade-material.test.ts` (source-text guard, see Step 1)

**Interfaces:**
- Consumes: `facadeLookFor` (Task 1), `createFacadeUniforms` (Task 2), `createContactShadowField`, `writeLayerShadows`, `ROAD_MARKING_RENDER_ORDER` (Tasks 4 and 5), `sky.sunDirection` and `sky.sunVisibility` (existing, `app/journey/sky.ts`).
- Produces: a scene child named `journey-contact-shadows` (`SHADOW_NAME`) that every tier draws once; facade uniforms updated every `apply`.

- [ ] **Step 1: Write the failing tests**

Add a source-text guard to `tests/journey/facade-material.test.ts` (same style as the existing `scene.ts` guard):

```ts
it('wires the gradient uniforms and the shadow field into the scene', () => {
  const scene = readFileSync(new URL('../../app/journey/scene.ts', import.meta.url), 'utf8')
  expect(scene).toContain('facadeLookFor(state, sky.sunVisibility)')
  expect(scene).toContain('facade.uSunDir.value.copy(sky.sunDirection)')
  expect(scene).toContain('writeLayerShadows(shadows')
  expect(scene).toContain('shadows.commit()')
  expect(scene).toContain('centerLine.renderOrder = ROAD_MARKING_RENDER_ORDER')
  // The rim reads the unclamped sun direction, never the moonlight-clamped light position.
  expect(scene).not.toContain('uSunDir.value.copy(sun.position')
})
```

Update `tests/gpu/facade.spec.ts` for the extra draw call and the new plane-geometry mesh. In the `planeBatchCount` filter, exclude the shadow mesh by name:

```ts
      const planeBatchCount = window.cityGpu.getJourneyContext().scene.children.filter(object =>
        object.name !== 'journey-contact-shadows'
          && 'isInstancedMesh' in object && object.isInstancedMesh && 'geometry' in object
          && object.geometry instanceof Object && 'type' in object.geometry && object.geometry.type === 'PlaneGeometry').length
```

and replace the expected-call block (the comment and the two lines after it) with:

```ts
    // Parent be4b857 at 640x360, one exhibit: full 58/26/15 and lite 57/25/14 calls.
    // Reduced desktop adds one static star draw while the old reduced path omitted it.
    // City 05 adds four backdrop draws on every tier: dome, haze and two far rings.
    // City 04 adds one contact-shadow draw on every tier.
    const expectedCalls = (lowPower ? [60, 28, 17] : [61, 29, 18]).map(calls => calls + (lowPower ? 0 : LANDMARK_DRAW_CALLS) + 1)
    expect([result.frames[0]!.calls, result.frames[2]!.calls, result.frames[3]!.calls]).toEqual(expectedCalls)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/journey/facade-material.test.ts`
Expected: FAIL on the new source-text guard.

Run: `npm run test:gpu -- tests/gpu/facade.spec.ts`
Expected: FAIL on the call-count equality (counts are one short).

- [ ] **Step 3: Write the implementation**

In `app/journey/scene.ts`:

1. Imports. Add:

```ts
import { createContactShadowField, ROAD_MARKING_RENDER_ORDER, writeLayerShadows } from './contact-shadows'
import { facadeLookFor } from './facade-gradient'
```

2. In `createRoad`, after `flattenAndHeadPlane(centerLine, ...)` and before `centerLine.position.set(...)`:

```ts
    centerLine.renderOrder = ROAD_MARKING_RENDER_ORDER
```

3. After the layers loop (`for (const [i] of LAYERS.entries()) { ... }`), create the field and add it to the scene:

```ts
  const shadowOffsets: number[] = []
  let shadowTotal = 0
  for (const layer of layers) {
    shadowOffsets.push(shadowTotal)
    shadowTotal += layer.buildings.length
  }
  const shadows = createContactShadowField(shadowTotal)
  scene.add(shadows.mesh)
```

   `dispose()` needs no change. Its `scene.traverse` already disposes the mesh geometry, the material, and every `Texture` value on the material, which includes the `alphaMap`. `ContactShadowField.dispose()` stays for the unit test and for direct users. Remove `type ContactShadowField` from the import in item 1 if it is now unused.

4. In `apply`, replace the building loop line

```ts
    for (const layer of layers) applyBuildingState(layer, state.buildingHeight, state.buildingDensity, lastTime, tier === 'reduced')
```

   with

```ts
    layers.forEach((layer, i) => {
      if (applyBuildingState(layer, state.buildingHeight, state.buildingDensity, lastTime, tier === 'reduced')) {
        writeLayerShadows(shadows, shadowOffsets[i] ?? 0, layer)
      }
    })
    shadows.commit()
```

5. In `apply`, immediately after `sky.update(state, camera.position, lastTime)`, add the gradient uniforms. They must come after `sky.update`, because `sky.sunDirection` and `sky.sunVisibility` are set there, and after `sun.color.setRGB(...)`, which is earlier in `apply`:

```ts
    const gradient = facadeLookFor(state, sky.sunVisibility)
    facade.uAoStrength.value = gradient.uAoStrength
    facade.uRimStrength.value = gradient.uRimStrength
    facade.uBounce.value = gradient.uBounce
    facade.uSunDir.value.copy(sky.sunDirection)
    facade.uSunColor.value.copy(sun.color)
```

   `sun.color` is already linear (set from the stop with `THREE.SRGBColorSpace`), and `uSunDir` is the unclamped direction, not `sun.position`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run test:gpu -- tests/gpu/facade.spec.ts tests/gpu/buildings.spec.ts tests/gpu/windows.spec.ts tests/gpu/sky.spec.ts tests/gpu/post.spec.ts tests/gpu/theme-scene.spec.ts tests/gpu/shader-failure.spec.ts`
Expected: PASS. If `sky.spec.ts` or `theme-scene.spec.ts` fails on pixel comparisons, a gradient or shadow change leaked into a frame they pin. Read the failure: compare against the frame without `journey-contact-shadows` visible, and report which spec and which pixel region before editing it. Do not loosen a threshold without recording why in the commit body.

- [ ] **Step 5: Commit**

```bash
git add app/journey/scene.ts tests/journey/facade-material.test.ts tests/gpu/facade.spec.ts
git commit -m "feat: wire wall gradient uniforms and contact shadows into the journey scene"
```

---

### Task 7: GPU tests for contact shadows, tiers, and context restore

**Files:**
- Create: `tests/gpu/contact-shadow-probe.ts`, `tests/gpu/contact-shadows.spec.ts`
- Modify: `tests/gpu/harness.ts`

**Interfaces:**
- Consumes: `createContactShadowField`, `SHADOW_NAME` (Task 4); `window.cityGpu.mountJourney`, `renderJourney`, `readFrame`, `loseAndRestore`, `getJourneyContext`, `dispose` (existing harness).
- Produces:
  - `window.cityGpu.probeContactShadow()` returning `{ nearActive, nearInactive, far, shaderError, glError }` (floats in `[0, 1]`).
  - `window.cityGpu.contactShadowDrawCalls()` returning `{ calls, count, frustumCulled, renderOrder, shaderError, glError }`.
  - `window.cityGpu.contactShadowFrameDelta(chapters: number[])` returning the largest per-channel difference in a frame with and without the shadow mesh, per chapter.

- [ ] **Step 1: Write the failing spec**

Create `tests/gpu/contact-shadows.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

test('a ground pixel beside an active building is darker; beside an inactive one it matches the far pixel', async ({ page }) => {
  const result = await page.evaluate(() => window.cityGpu.probeContactShadow())
  expect(result.shaderError).toBeNull()
  expect(result.glError).toBe(0)
  expect(result.nearActive).toBeLessThan(result.far - 0.03)
  expect(Math.abs(result.nearInactive - result.far)).toBeLessThan(0.005)
})

for (const [tier, lowPower] of [
  ['full', false], ['reduced', false], ['lite', true], ['reduced', true],
] as const) {
  test(`${tier} lowPower=${lowPower}: one shadow draw call, culling off, restore keeps the alpha map`, async ({ page }) => {
    const result = await page.evaluate(async ({ tier, lowPower }) => {
      window.cityGpu.mountJourney({ tier, lowPower })
      window.cityGpu.renderJourney({ chapter: 3 })
      const measured = window.cityGpu.contactShadowDrawCalls()
      window.cityGpu.renderJourney({ chapter: 3 })
      const before = window.cityGpu.readFrame()
      const restore = await window.cityGpu.loseAndRestore()
      const after = window.cityGpu.readFrame()
      window.cityGpu.dispose()
      return { measured, before, after, restore }
    }, { tier, lowPower })
    const total = lowPower ? 14 + 19 + 24 : 24 + 32 + 40
    expect(result.measured.shaderError).toBeNull()
    expect(result.measured.glError).toBe(0)
    expect(result.measured.calls).toBe(1)
    expect(result.measured.count).toBe(total)
    expect(result.measured.frustumCulled).toBe(false)
    expect(result.measured.renderOrder).toBe(1)
    expect(result.restore.shaderError).toBeNull()
    expect(result.restore.glError).toBe(0)
    const maxDifference = result.before.reduce((max, byte, index) => Math.max(max, Math.abs(byte - result.after[index]!)), 0)
    expect(maxDifference).toBeLessThanOrEqual(1)
  })
}

test('the shadow quads change the rendered frame in at least one light-theme chapter', async ({ page }) => {
  const deltas = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: true, initialDark: false })
    const result = window.cityGpu.contactShadowFrameDelta([0, 1, 2, 3])
    window.cityGpu.dispose()
    return result
  })
  // The ground is nearly black and fog covers the far field, so the change is small. It must still exist.
  expect(Math.max(...deltas)).toBeGreaterThanOrEqual(1)
})

test('the shadow material keeps its transparent, no-depth-write, offset settings in the scene', async ({ page }) => {
  const result = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: true })
    window.cityGpu.renderJourney({ chapter: 1, frames: 2 })
    const { scene } = window.cityGpu.getJourneyContext()
    const mesh = scene.getObjectByName('journey-contact-shadows') as import('three').InstancedMesh
    const material = mesh.material as import('three').MeshBasicMaterial
    const out = { depthWrite: material.depthWrite, transparent: material.transparent, polygonOffset: material.polygonOffset,
      alphaMapColorSpace: material.alphaMap?.colorSpace }
    window.cityGpu.dispose()
    return out
  })
  expect(result.depthWrite).toBe(false)
  expect(result.transparent).toBe(true)
  expect(result.polygonOffset).toBe(true)
  expect(result.alphaMapColorSpace).toBe('')
})
```

(`THREE.NoColorSpace` is the empty string `''`.)

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npm run test:gpu -- tests/gpu/contact-shadows.spec.ts`
Expected: FAIL with "window.cityGpu.probeContactShadow is not a function".

- [ ] **Step 3: Write the probes and register them**

Create `tests/gpu/contact-shadow-probe.ts`:

```ts
import * as THREE from 'three'
import { createContactShadowField, SHADOW_NAME } from '../../app/journey/contact-shadows'
import { createTestRenderer, diagnostics } from './gpu-utils'

const WIDTH = 480
const HEIGHT = 240
const HALF_WIDTH = 6
const HALF_DEPTH = 3
const GROUND_Y = -1.01
const BUILDING = { width: 1.2, depth: 1.2 }
const ACTIVE_X = -3
const INACTIVE_X = 3
const BUILDING_HEIGHT = 1.5
// 0.2 units outside the building edge.
const OFFSET = BUILDING.width / 2 + 0.2

// Top-down render of white ground with one active and one inactive building shadow, into an 8-bit linear target.
export function probeContactShadow() {
  const gpu = createTestRenderer({ width: WIDTH, height: HEIGHT })
  const { renderer, recorder } = gpu
  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { depthBuffer: true, stencilBuffer: false })
  const field = createContactShadowField(2)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0xffffff }))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = GROUND_Y
  const scene = new THREE.Scene()
  scene.add(ground, field.mesh)
  field.write(0, { x: ACTIVE_X, z: 0, ...BUILDING }, BUILDING_HEIGHT, true)
  field.write(1, { x: INACTIVE_X, z: 0, ...BUILDING }, BUILDING_HEIGHT, false)
  field.commit()
  const camera = new THREE.OrthographicCamera(-HALF_WIDTH, HALF_WIDTH, HALF_DEPTH, -HALF_DEPTH, 0.1, 50)
  camera.position.set(0, 10, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  renderer.setPixelRatio(1)
  renderer.setSize(WIDTH, HEIGHT, false)
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  target.texture.colorSpace = THREE.LinearSRGBColorSpace
  try {
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    recorder.assertClean()
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
    renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels)
    const sample = (x: number) => {
      const column = Math.round(((x + HALF_WIDTH) / (2 * HALF_WIDTH)) * WIDTH)
      return pixels[4 * (Math.floor(HEIGHT / 2) * WIDTH + column)]! / 255
    }
    return {
      nearActive: sample(ACTIVE_X - OFFSET),
      nearInactive: sample(INACTIVE_X + OFFSET),
      far: sample(0),
      shaderError: recorder.error?.message ?? null,
      glError: renderer.getContext().getError(),
    }
  } finally {
    renderer.setRenderTarget(null)
    target.dispose()
    ground.geometry.dispose()
    ;(ground.material as THREE.Material).dispose()
    field.dispose()
    gpu.dispose()
  }
}

// Like buildingDrawCalls: hide everything except the shadow mesh and count the direct-path draw calls.
export function contactShadowDrawCalls() {
  const { scene, camera, renderer } = window.cityGpu.getJourneyContext()
  const mesh = scene.getObjectByName(SHADOW_NAME) as THREE.InstancedMesh
  const hidden: THREE.Object3D[] = []
  for (const child of scene.children) {
    if (child === mesh || !child.visible) continue
    child.visible = false
    hidden.push(child)
  }
  const autoReset = renderer.info.autoReset
  try {
    renderer.setRenderTarget(null)
    renderer.info.autoReset = false
    renderer.info.reset()
    renderer.render(scene, camera)
    const base = diagnostics(renderer)
    return {
      calls: renderer.info.render.calls, count: mesh.count, frustumCulled: mesh.frustumCulled,
      renderOrder: mesh.renderOrder, shaderError: base.shaderError, glError: base.glError,
    }
  } finally {
    renderer.info.autoReset = autoReset
    for (const object of hidden) object.visible = true
  }
}

// Largest per-channel byte difference between a frame with and without the shadow mesh, for each chapter.
export function contactShadowFrameDelta(chapters: number[]): number[] {
  return chapters.map(chapter => {
    const mesh = window.cityGpu.getJourneyContext().scene.getObjectByName(SHADOW_NAME) as THREE.InstancedMesh
    mesh.visible = true
    // `reduced` applies the target state directly (no damping), so two frames reach the final state.
    window.cityGpu.renderJourney({ chapter, frames: 2 })
    const withShadows = window.cityGpu.readFrame()
    mesh.visible = false
    window.cityGpu.renderJourney({ chapter, frames: 2 })
    const without = window.cityGpu.readFrame()
    mesh.visible = true
    return withShadows.reduce((max, byte, index) => Math.max(max, Math.abs(byte - without[index]!)), 0)
  })
}
```

In `tests/gpu/harness.ts`, add the import:

```ts
import { contactShadowDrawCalls, contactShadowFrameDelta, probeContactShadow } from './contact-shadow-probe'
```

and register next to `buildingDrawCalls`:

```ts
  probeContactShadow,
  contactShadowDrawCalls,
  contactShadowFrameDelta,
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npm run test:gpu -- tests/gpu/contact-shadows.spec.ts`
Expected: PASS.

If `the shadow quads change the rendered frame` fails with all-zero deltas, the shadow is invisible against the dark ground in every sampled chapter. Do not weaken the assertion. Capture the four frames with and without the mesh, report the ground color (`0x14141a`) and fog values, and ask the user whether to raise `SHADOW_OPACITY` or `ground` brightness before continuing.

If `nearActive` is not darker than `far`, check the `alphaMap` is read from the green channel: the probe's `ground` is white, so a missing or all-white falloff shows `nearActive === far`.

- [ ] **Step 5: Commit**

```bash
git add tests/gpu/contact-shadow-probe.ts tests/gpu/contact-shadows.spec.ts tests/gpu/harness.ts
git commit -m "test: gpu checks for contact shadows, draw calls, tiers, and context restore"
```

---

### Task 8: Final acceptance

**Files:** none new. This task runs every check, then hands off.

- [ ] **Step 1: Run the automated verification and the self-check**

**Automated verification:** run each command from `repos/portfolio`. All must pass.

- [ ] `npm test`
- [ ] `npm run test:gpu`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `wc -l app/journey/scene.ts` shows fewer than 800 lines.

If `npm run test:gpu` fails only on tests that already failed on `master` (for example sleep-induced failures from the repo history), rerun those spec files alone with the machine awake. Record any remaining failure with its output in the handoff. Do not mark this step passed with a failing test.

- [ ] **Step 2: Confirm spec coverage**

Confirm each line, with the test that proves it:

- Gradient AO ratio at most 0.70 on all eight stops: `tests/journey/facade-gradient.test.ts` and `tests/gpu/gradient.spec.ts` (AO matches the mirror, both variants).
- Rim at `intro` and `projects`, off at `about`: `tests/gpu/gradient.spec.ts` (`rim at day`, `rim at sunset`, `rim at night`).
- Every active building has a shadow and no inactive one does: `tests/journey/contact-shadows.test.ts` (`writeLayerShadows`).
- One extra draw call: `tests/gpu/contact-shadows.spec.ts` and the `+1` in `tests/gpu/facade.spec.ts`.
- Height independence: `tests/gpu/gradient.spec.ts` (`depends on world height`, `the rim moves with the roof`).
- No shader errors, no `glError`, and restore on all four tier combinations: `tests/gpu/contact-shadows.spec.ts`.

- [ ] **Step 3: Hand off the manual verification list**

**Manual verification:** these checks need a person and a device. Do not mark them done. List them in the final message as unconfirmed.

- [ ] Screenshots at all four chapters plus one mid-transition frame, desktop and iPhone 14 Pro Max emulation, light and dark theme, plus one frame halfway through a theme blend (`themeMix` 0.5). Check that base darkening reads as ground contact, the warm rim at day and sunset does not blow out, no silhouette is lost at `about`, no rectangle edge shows around a shadow, and no seam appears where a shadow meets the road edge.
- [ ] Look for z-fighting between shadow quads, the road, and the center line at 60 to 100 units from the camera.
- [ ] Render cost per shared conventions, section 8: uncapped 10-second loop with `gl.readPixels` sync, chapters 0, 2, and 3, three runs each on the commit before and after, compare medians. Budget +0.3 ms on the named reference desktop and +0.3 ms on a physical iPhone. Name the devices.
- [ ] Physical iPhone check of shadow overdraw (96 transparent quads) and of context-loss recovery.

- [ ] **Step 4: Report**

Report to the user: the branch name, the commit list, the automated results (counts, any failures verbatim), and the manual checklist above marked unconfirmed. Then ask whether to merge using `superpowers:finishing-a-development-branch`.

---

## Plan self-review

- **Spec coverage.** Part A uniforms and shader math: Tasks 1 and 2. Lite variant (AO only, no extra varyings): Task 2 test asserts `lite` lacks `uRimStrength`, `vTopY`, `vWorldNormal`. Part B module, geometry, material, alphaMap, draw order, height, size, inactive handling, dispose: Task 4. Integration with the dirty check: Task 5 and Task 6. Tier table: the gradient and shadow field are built for every tier; `reduced` has no time-driven term in either, so it is static by construction. Spec tests 1 to 4: Tasks 1, 4, 5. Spec tests 5, 6, 8: Task 3. Spec tests 7, 9: Task 7. Performance and manual checks: Task 8.
- **Deviations from the spec, each forced by merged work.** Per-building shadow quads on a multi-part layer; `depth` always present, so no `depth ?? width`; the "before spec 05" uniform tests are dropped because `sky.sunVisibility` exists; `applyBuildingState` returns `moved` instead of the field being passed into it; GPU tests split into two spec files; the the scene relies on the existing `scene.traverse` disposal and does not call `shadows.dispose()`.
- **Placeholder scan.** No TBD or "handle edge cases" steps. Every code step shows code.
- **Type consistency.** `FacadeUniforms` fields, `createFacadeUniforms`, `facadeLookFor` return keys (`uAoStrength`, `uRimStrength`, `uBounce`), `writeLayerShadows(field, offset, layer)`, `SHADOW_NAME`, and `FACADE_DEBUG_AO` values 1 and 2 are named identically in every task that uses them.
