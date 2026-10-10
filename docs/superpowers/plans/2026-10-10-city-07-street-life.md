# City 07: Street Life Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lit lamp posts along both sides of the road, a glow halo and a light pool for each lamp, and a small amount of two-lane traffic with headlights and tail lights, in at most six extra draw calls.

**Architecture:** Two new modules own the street. `app/journey/lamps.ts` holds the pure placement and switching math plus four `InstancedMesh` objects (posts, heads, halos, pools). `app/journey/traffic.ts` holds the pure car model plus two `InstancedMesh` objects (bodies, lights). Halos and pools are additive quads. A shared helper in `shader-utils.ts` attenuates fog toward black on additive materials, and the radial falloff texture moves out of `contact-shadows.ts` into `falloff-texture.ts`. `scene.ts` only creates the modules and calls `update` from `apply`.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Three.js r186, Vitest 5, and the Playwright/Vite GPU harness in `tests/gpu`.

**Spec:** `docs/superpowers/specs/2026-10-09-city-07-street-life-design.md`. Read `docs/superpowers/specs/2026-10-09-city-00-shared-conventions.md` first.

**Research:** `docs/superpowers/research/2026-10-09-portfolio-overview-research.md` was written at commit `ef03e91`, before specs 01 to 06 and 09 merged. This plan does not rely on it. Every code reference below was checked against `HEAD` (`cbdacb5`).

## Global Constraints

- Colors written as hex in code (`new THREE.Color(0xffc983)`) are converted to linear by three. `StopState` colors are sRGB from `hexToRgb`; this plan reads only `windowLitRatio`, a plain number.
- Patch built-in materials with `onBeforeCompile` and `replaceOrThrow(source, marker, replacement)` from `app/journey/shader-utils.ts`. Never use a bare `String.replace` on shader source. A patched material sets `customProgramCacheKey`.
- Additive materials attenuate fog toward black with `attenuateAdditiveFog(material)`, never mix toward the fog color.
- `tier === 'reduced'` decides motion. `lowPower` decides cost and detail. `reduced` follows `lowPower` for lamp count.
- Every `InstancedMesh` whose matrices or colors change over time sets `frustumCulled = false`.
- No real point lights. Glow is additive sprites and quads.
- World anchors: road surface `y = -1`, road center line `y = -0.99`, ground `-1.01`, contact shadows `-0.995`, light pools `y = -0.992`. Road half width `ROAD_HALF_WIDTH = 3`. Path length `PATH_TOTAL_LENGTH = 100`.
- Lamp spacing: 6 units on `full`, 8 on `lowPower`. Lamps stand `ROAD_HALF_WIDTH + 0.3 = 3.3` units from the center line. Golden counts: 14 lamps (7 per side) at spacing 6, 8 lamps (4 per side) at spacing 8.
- A lamp position is dropped when `clearsFootprints(x, z, 0.2)`, `clearsCornerBlocks(x, z, 0.2)` or `clearsPath(x, z, ROAD_HALF_WIDTH + 0.2)` is false.
- Post: `CylinderGeometry(0.04, 0.05, 2.4, 6)` translated up by 1.2, merged with an arm box 0.5 x 0.05 x 0.05 centered at local `(0.25, 2.375, 0)`. Color `#2a2a2f`. Head: `SphereGeometry(1, 8, 6)`, scale 0.12, at `(x + 0.5 cos(armAngle), 1.4, z - 0.5 sin(armAngle))`. `armAngle = atan2(side * rightZ, -side * rightX)`.
- Lamp switch-on threshold `th = 0.15 + 0.2 * hash(i)`. `lampIntensity = smoothstep(th, th + 0.05, windowLitRatio)`. Every lamp is on at `windowLitRatio >= 0.40`.
- Light colors: lamp `#ffc983`, front car light `#fff1d6`, rear car light `#ff2a1a`, dark glass `#2a2a30`. Gain `gainFor(color, 2.3)`. Head color `mix(dark glass, warm * gain, intensity)`. Halo color `warm * intensity * 0.9`. Pool color `warm * intensity * 0.5`.
- Halo: `PlaneGeometry(1, 1)` scaled 0.9, additive, `transparent`, `depthWrite: false`, `fog: true`, camera-facing in the vertex shader, `customProgramCacheKey` `'street-halo'`. Pool: flat plane scaled 3.2, offset 1.2 toward the road, `polygonOffset` factor and units `-1`.
- Render order: contact shadows `1`, pools `1.5`, road markings `2`, halos `3`.
- Traffic: lanes 1.5 units from the center line, `+1` lane travels toward increasing path distance. 12 cars on `full`, 6 on `lowPower`, 0 on `reduced`. Speed 2.5 to 5.5 units per second. Cars hide near interior waypoints (scale 0 at 2.5 units, 1 at 3.5 units). Body `BoxGeometry(0.45, 0.28, 0.9)`, ride height 0.08, body center `y = -0.78`. Car lights `BoxGeometry(0.08, 0.06, 0.03)`, four per car, at local `(+-0.15, 0, -0.46)` front and `(+-0.15, 0, +0.46)` rear. Front lights follow the dusk ramp (threshold 0.2); rear lights stay at 20% minimum.
- Cost: at most 6 draw calls (4 without cars) and +0.4 ms on the named reference desktop and +0.4 ms on a physical iPhone (shared conventions, section 8).
- `scene.ts` stays below 800 lines. New logic goes in new modules.
- Every GPU test asserts an empty shader-error recorder and `glError === 0`.
- Commit messages use the repo format `<type>: <description>` with no `Co-Authored-By` trailer.

## Review Focus

1. **Same-lane cars overlapping.** The spec gives each car its own speed, so a fast car overtakes a slow one in the same lane and drives through it. A person expects cars not to pass through each other. Task 5 gives all cars in a lane one speed and tests a minimum gap between same-lane cars at many times.
2. **Cars popping in or out at the path ends.** Cars wrap from distance 100 to 0. The camera starts at distance 0 at chapter 0, so a car could appear or vanish beside the lens. Task 5 scales cars to 0 within 4 units of either end, and Task 6 asserts the matrix is hidden at distance 0.
3. **Lamps must follow the ratio down as well as up.** Scrolling back or switching theme lowers `windowLitRatio`. The dirty check must rewrite colors on any change in either direction, and a ratio at or below 0.15 must leave halos and pools exactly black. Task 4 tests up, down, and back up.
4. **A lit halo filling the screen.** The camera passes lamps at 3.3 units. A halo of 0.9 units must stay a small part of a portrait phone screen at that distance. Task 4 projects the halo and asserts under half the viewport.
5. **Reduced motion.** A phone with reduced motion must get no cars at all (no objects, no draw calls) and still get the 8-lamp `lowPower` layout. Task 6 tests the empty traffic, and Task 8 checks the real scene for all four tier and `lowPower` combinations.

---

## Scope and repository findings

- **Spec 06, 03, 04 and 05 are merged.** `gainFor(hex, target)` exists in `app/journey/window-look.ts`. `clearsFootprints(x, z, halfExtent)` and `clearsCornerBlocks(x, z, halfExtent)` exist in `app/journey/footprints.ts`. Spec 07 uses them as they are.
- **The falloff texture lives in `contact-shadows.ts`.** `radialFalloffPixels(size)` is exported there and `createFalloffTexture()` is private. Task 1 moves both into `app/journey/falloff-texture.ts`, as the spec asks. `radialFalloffPixels` is stored as opaque grayscale, so it works as an `alphaMap` (green channel) for shadows and as a `map` (RGB multiply) for halos and pools.
- **`attenuateAdditiveFog` does not exist yet.** Shared conventions say spec 07 introduces it. Task 2 adds it to `shader-utils.ts`.
- **Import path.** The repo imports three addons from `three/examples/jsm/...` (see `post.ts`). The spec writes `three/addons/...`. This plan uses the repo's path: `three/examples/jsm/utils/BufferGeometryUtils.js`.
- **`windowLitRatio` per stop.** Light theme: `intro` 0.05, `projects` 0.03, `skills` 0.02, `about` 0.05. Dark theme: `intro` 0.3, `projects` 0.55, `skills` 0.75, `about` 0.9. So "at `intro` (day) no light is visible" holds in the **light** theme. At dark `intro` (0.3) some lamps are already on. GPU tests use the light theme for the "all off" case and dark `about` for the "all on" case.
- **Lamp counts verified.** A scratch computation against the real path, footprints and corner blocks gives 14 lamps (7 per side) at spacing 6 and 8 lamps (4 per side) at spacing 8, matching the spec. The positions are pinned as golden values in Task 3. At spacing 8 the station at distance 60 lies on the segment boundary and keeps only side `-1`.
- **Draw-call baselines move.** `tests/gpu/facade.spec.ts` pins exact scene draw-call counts per tier and excludes only the contact-shadow mesh from its `PlaneGeometry` check. Task 7 adds the street calls (6, or 4 on `reduced`) and excludes the street meshes from the plane check.
- **Scene disposal.** `scene.ts` `dispose()` already traverses meshes and disposes geometry, material, and any `Texture` held by a material property. The street modules rely on that path. Their own `dispose()` methods exist for the isolated GPU probes.
- **Deviations from the spec**, each deliberate and listed again in Self-Review:
  1. One speed per lane instead of one per car (Review Focus 1).
  2. Cars also scale to 0 near the path ends (Review Focus 2).
  3. `Lamp` carries an extra `distance` field (the path distance of its station) so tests can verify the 3.3-unit offset.
  4. `createTraffic(cars)` takes a car list, not a count, so tests can place a car exactly.
  5. The "head center within 0.01 of the arm's far end" check is horizontal; vertically the head sits 0.025 above the arm center line (the arm top).

All commands run from `repos/portfolio` unless a step says otherwise. Work on an isolated branch `feat/city-07-street-life` (the executing skill sets up the worktree).

## File structure

| File | Responsibility |
| --- | --- |
| `app/journey/falloff-texture.ts` | New. `FALLOFF_TEXTURE_SIZE`, `radialFalloffPixels`, `createFalloffTexture`. Moved from `contact-shadows.ts`. |
| `app/journey/shader-utils.ts` | Modify. Add `attenuateAdditiveFog`. |
| `app/journey/contact-shadows.ts` | Modify. Import the falloff texture from the new module. |
| `app/journey/lamps.ts` | New. Pure placement, geometry and switching math, color helpers, `createLamps`. |
| `app/journey/traffic.ts` | New. Pure car model, `createCars`, `carPoseAt`, `createTraffic`. |
| `app/journey/scene.ts` | Modify. Create the modules, add their objects, call `update` from `apply`. |
| `tests/journey/falloff-texture.test.ts` | New. Moved falloff tests plus a texture test. |
| `tests/journey/contact-shadows.test.ts` | Modify. Remove the moved falloff tests. |
| `tests/journey/shader-utils.test.ts` | Modify. Tests for `attenuateAdditiveFog`. |
| `tests/journey/lamps.test.ts` | New. Placement, geometry, switching, gain, meshes, dirty check. |
| `tests/journey/traffic.test.ts` | New. Car model, corner and edge scale, light offsets, meshes. |
| `tests/gpu/street-probe.ts` | New. Isolated renders of lamps and traffic, and scene probes. |
| `tests/gpu/street.spec.ts` | New. Spec GPU tests 9 to 15. |
| `tests/gpu/harness.ts` | Modify. Register the street probes. |
| `tests/gpu/facade.spec.ts` | Modify. Add the street draw calls and exclude street meshes from the plane check. |

---

### Task 1: Move the falloff texture into its own module

**Files:**
- Create: `app/journey/falloff-texture.ts`
- Modify: `app/journey/contact-shadows.ts`
- Test: `tests/journey/falloff-texture.test.ts`
- Modify: `tests/journey/contact-shadows.test.ts`

**Interfaces:**
- Consumes: `smoothstep(edge0, edge1, x)` from `app/journey/sky-mirror.ts`.
- Produces (Tasks 4 and 6 and `contact-shadows.ts` rely on these):
  - `FALLOFF_TEXTURE_SIZE = 64`
  - `radialFalloffPixels(size: number): Uint8Array`
  - `createFalloffTexture(size?: number): THREE.DataTexture`

- [ ] **Step 1: Record the baseline**

Run: `npm test`
Expected: PASS. Write down the test count (it was 215 after city-04). Every later unit run must show at least this count plus the new tests.

- [ ] **Step 2: Write the failing test**

Create `tests/journey/falloff-texture.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createFalloffTexture, FALLOFF_TEXTURE_SIZE, radialFalloffPixels } from '../../app/journey/falloff-texture'

describe('radialFalloffPixels', () => {
  const size = FALLOFF_TEXTURE_SIZE
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

describe('createFalloffTexture', () => {
  it('builds a linear, mipmap-free, non-color-managed RGBA texture of the requested size', () => {
    const texture = createFalloffTexture(32)
    expect(texture.colorSpace).toBe(THREE.NoColorSpace)
    expect(texture.minFilter).toBe(THREE.LinearFilter)
    expect(texture.magFilter).toBe(THREE.LinearFilter)
    expect(texture.generateMipmaps).toBe(false)
    expect(texture.image.width).toBe(32)
    expect(texture.image.height).toBe(32)
    texture.dispose()
  })

  it('defaults to FALLOFF_TEXTURE_SIZE', () => {
    const texture = createFalloffTexture()
    expect(texture.image.width).toBe(FALLOFF_TEXTURE_SIZE)
    texture.dispose()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/journey/falloff-texture.test.ts`
Expected: FAIL. Vite reports it cannot resolve `../../app/journey/falloff-texture`.

- [ ] **Step 4: Create the module**

Create `app/journey/falloff-texture.ts`:

```ts
import * as THREE from 'three'
import { smoothstep } from './sky-mirror'

export const FALLOFF_TEXTURE_SIZE = 64

// Opaque grayscale: r186 alphamap_fragment reads the GREEN channel only, and a `map` multiplies
// the material color by RGB, so one texture serves contact shadows (alphaMap) and glow (map).
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

export function createFalloffTexture(size = FALLOFF_TEXTURE_SIZE): THREE.DataTexture {
  const texture = new THREE.DataTexture(radialFalloffPixels(size), size, size, THREE.RGBAFormat)
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}
```

- [ ] **Step 5: Point `contact-shadows.ts` at the new module**

In `app/journey/contact-shadows.ts`:

1. Replace the second import line. Before:

```ts
import { type Building, type BuildingLayer, isActive } from './buildings'
import { smoothstep } from './sky-mirror'
```

After:

```ts
import { type Building, type BuildingLayer, isActive } from './buildings'
import { createFalloffTexture, FALLOFF_TEXTURE_SIZE } from './falloff-texture'
```

2. Replace `export const SHADOW_TEXTURE_SIZE = 64` with `export const SHADOW_TEXTURE_SIZE = FALLOFF_TEXTURE_SIZE`.

3. Delete the whole block from the comment `// r186 alphamap_fragment reads the GREEN channel only, so the falloff is stored as opaque grayscale.` through the closing brace of `function createFalloffTexture(): THREE.DataTexture { ... }` (the `radialFalloffPixels` function and the private `createFalloffTexture`).

4. In `createContactShadowField`, replace `const alphaMap = createFalloffTexture()` with `const alphaMap = createFalloffTexture(SHADOW_TEXTURE_SIZE)`.

- [ ] **Step 6: Remove the moved tests from `contact-shadows.test.ts`**

In `tests/journey/contact-shadows.test.ts`:

1. In the import from `'../../app/journey/contact-shadows'`, remove `radialFalloffPixels,` so it reads:

```ts
import {
  createContactShadowField, ROAD_MARKING_RENDER_ORDER, SHADOW_NAME, SHADOW_OPACITY,
  SHADOW_RENDER_ORDER, SHADOW_TEXTURE_SIZE, SHADOW_Y, shadowTransform, writeLayerShadows,
} from '../../app/journey/contact-shadows'
```

2. Delete the entire `describe('radialFalloffPixels', () => { ... })` block (it now lives in `falloff-texture.test.ts`).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. The count equals the baseline plus the two new `createFalloffTexture` tests (the three moved tests keep the same count).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/journey/falloff-texture.ts app/journey/contact-shadows.ts tests/journey/falloff-texture.test.ts tests/journey/contact-shadows.test.ts
git commit -m "refactor: move the radial falloff texture into its own module"
```

---

### Task 2: Additive fog attenuation helper

**Files:**
- Modify: `app/journey/shader-utils.ts`
- Modify: `tests/journey/shader-utils.test.ts`

**Interfaces:**
- Consumes: `replaceOrThrow` (same file).
- Produces (Task 4 relies on this):
  - `ADDITIVE_FOG_GLSL: string`
  - `attenuateAdditiveFog(material: THREE.Material): void`. It chains onto the material's existing `onBeforeCompile`, then replaces `#include <fog_fragment>`. It appends `|additive-fog` to the existing `customProgramCacheKey`. Callers set their own `customProgramCacheKey` **before** calling it.

- [ ] **Step 1: Write the failing test**

In `tests/journey/shader-utils.test.ts`, change line 2 from `import type * as THREE from 'three'` to a value import, and add `attenuateAdditiveFog` to the import list:

```ts
import { expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { attenuateAdditiveFog, createShaderErrorRecorder, getShaderErrorRecorder, glslFloat, glslVec3, replaceOrThrow } from '../../app/journey/shader-utils'
```

Append at the end of the file:

```ts
function fakeShader(vertexShader: string, fragmentShader: string): THREE.WebGLProgramParametersWithUniforms {
  return { vertexShader, fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms
}

it('replaces the fog mix with an attenuation toward black', () => {
  const material = new THREE.MeshBasicMaterial()
  material.customProgramCacheKey = () => 'test-light'
  attenuateAdditiveFog(material)
  const shader = fakeShader('', 'before\n#include <fog_fragment>\nafter')
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
  expect(shader.fragmentShader).not.toContain('#include <fog_fragment>')
  expect(shader.fragmentShader).not.toContain('mix(')
  expect(shader.fragmentShader).toContain('gl_FragColor.rgb *= 1.0 - fogFactor;')
  expect(shader.fragmentShader).toContain('FOG_EXP2')
  expect(shader.fragmentShader.startsWith('before')).toBe(true)
  expect(shader.fragmentShader.endsWith('after')).toBe(true)
})

it('runs the earlier onBeforeCompile first and appends additive-fog to the cache key', () => {
  const material = new THREE.MeshBasicMaterial()
  const earlier = vi.fn((shader: THREE.WebGLProgramParametersWithUniforms) => { shader.vertexShader += '/* earlier */' })
  material.onBeforeCompile = earlier
  material.customProgramCacheKey = () => 'street-halo'
  attenuateAdditiveFog(material)
  const shader = fakeShader('v', '#include <fog_fragment>')
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
  expect(earlier).toHaveBeenCalledTimes(1)
  expect(shader.vertexShader).toBe('v/* earlier */')
  expect(material.customProgramCacheKey()).toBe('street-halo|additive-fog')
})

it('throws when the fog marker is missing', () => {
  const material = new THREE.MeshBasicMaterial()
  material.customProgramCacheKey = () => 'test-light'
  attenuateAdditiveFog(material)
  expect(() => material.onBeforeCompile(fakeShader('', 'void main() {}'), {} as THREE.WebGLRenderer))
    .toThrow('Missing shader marker: #include <fog_fragment>')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/journey/shader-utils.test.ts`
Expected: FAIL. The new tests report `attenuateAdditiveFog is not a function` (or a type error from the missing export).

- [ ] **Step 3: Implement the helper**

Append to `app/journey/shader-utils.ts`:

```ts
const FOG_FRAGMENT_MARKER = '#include <fog_fragment>'

// r186 fog_fragment mixes the output toward the fog colour. That is right for alpha-blended
// objects, but an additive object that outputs black would then add the fog colour to the frame.
// This version scales the output toward black instead, so a switched-off light adds exactly zero.
export const ADDITIVE_FOG_GLSL = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb *= 1.0 - fogFactor;
#endif
`

// Set `customProgramCacheKey` on the material BEFORE calling this: the default key is the text
// of `onBeforeCompile`, which this function replaces.
export function attenuateAdditiveFog(material: THREE.Material): void {
  const earlierCompile = material.onBeforeCompile
  const earlierKey = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    earlierCompile.call(material, shader, renderer)
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, FOG_FRAGMENT_MARKER, ADDITIVE_FOG_GLSL)
  }
  material.customProgramCacheKey = () => `${earlierKey.call(material)}|additive-fog`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/journey/shader-utils.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/journey/shader-utils.ts tests/journey/shader-utils.test.ts
git commit -m "feat: add attenuateAdditiveFog for additive light materials"
```

---

### Task 3: Lamp placement, geometry math, and switching

**Files:**
- Create: `app/journey/lamps.ts` (pure part only in this task)
- Test: `tests/journey/lamps.test.ts`

**Interfaces:**
- Consumes: `clearsFootprints`, `clearsCornerBlocks` (`footprints.ts`); `clearsPath`, `PATH_TOTAL_LENGTH`, `pathPointAt`, `ROAD_HALF_WIDTH` (`path.ts`); `seeded` (`random.ts`); `smoothstep` (`sky-mirror.ts`); `gainFor` (`window-look.ts`).
- Produces (Tasks 4 to 8 rely on these exact names):
  - Constants: `LAMP_SPACING_FULL = 6`, `LAMP_SPACING_LOW_POWER = 8`, `LAMP_OFFSET = 3.3`, `LAMP_BASE_Y = -1`, `POST_HEIGHT = 2.4`, `ARM_LENGTH = 0.5`, `LAMP_HEAD_Y = 1.4`, `LAMP_ON_MIN = 0.15`, `LAMP_ON_SPREAD = 0.2`, `LAMP_FADE = 0.05`, `STREET_LIGHT_LUMINANCE = 2.3`, `LAMP_LIGHT_HEX = 0xffc983`, `DARK_GLASS_HEX = 0x2a2a30`, `LAMP_LIGHT_GAIN: number`
  - `interface Lamp { distance: number; x: number; z: number; side: 1 | -1; armAngle: number }`
  - `armAngleFor(side: 1 | -1, rightX: number, rightZ: number): number`
  - `lampPositions(spacing: number): Lamp[]`
  - `lampHeadPosition(lamp: Pick<Lamp, 'x' | 'z' | 'armAngle'>): { x: number; y: number; z: number }`
  - `lampThreshold(index: number): number`
  - `lampIntensity(threshold: number, windowLitRatio: number): number`

- [ ] **Step 1: Write the failing test**

Create `tests/journey/lamps.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { clearsCornerBlocks, clearsFootprints } from '../../app/journey/footprints'
import {
  ARM_LENGTH, armAngleFor, DARK_GLASS_HEX, LAMP_BASE_Y, LAMP_HEAD_Y, LAMP_LIGHT_GAIN, LAMP_LIGHT_HEX,
  LAMP_OFFSET, LAMP_SPACING_FULL, LAMP_SPACING_LOW_POWER, lampHeadPosition, lampIntensity, lampPositions,
  lampThreshold, POST_HEIGHT, STREET_LIGHT_LUMINANCE,
} from '../../app/journey/lamps'
import { clearsPath, PATH_SEGMENTS, pathPointAt, ROAD_HALF_WIDTH } from '../../app/journey/path'
import { gainFor, linearLuminance } from '../../app/journey/window-look'

// [path distance of the station, side, x, z], computed from the real path, footprints and corner blocks.
const FULL_GOLDEN = [
  [3, 1, 3.3, 5], [3, -1, -3.3, 5], [9, 1, 3.3, -1], [9, -1, -3.3, -1], [33, 1, 3.3, -25],
  [39, 1, -5, -29.3], [57, -1, -23, -22.7], [63, -1, -29.3, -29], [69, 1, -22.7, -35], [69, -1, -29.3, -35],
  [87, 1, -22.7, -53], [87, -1, -29.3, -53], [93, 1, -22.7, -59], [93, -1, -29.3, -59],
] as const
const LOW_POWER_GOLDEN = [
  [4, 1, 3.3, 4], [4, -1, -3.3, 4], [36, 1, -2, -29.3], [60, -1, -29.3, -26],
  [68, 1, -22.7, -34], [68, -1, -29.3, -34], [92, 1, -22.7, -58], [92, -1, -29.3, -58],
] as const

function expectGolden(lamps: ReturnType<typeof lampPositions>, golden: ReadonlyArray<readonly [number, number, number, number]>) {
  expect(lamps).toHaveLength(golden.length)
  golden.forEach(([distance, side, x, z], i) => {
    expect(lamps[i]).toMatchObject({ distance, side })
    expect(lamps[i]!.x).toBeCloseTo(x, 6)
    expect(lamps[i]!.z).toBeCloseTo(z, 6)
  })
}

describe('lampPositions', () => {
  it('keeps 14 lamps (7 per side) at spacing 6, at the pinned positions', () => {
    const lamps = lampPositions(LAMP_SPACING_FULL)
    expectGolden(lamps, FULL_GOLDEN)
    expect(lamps.filter(l => l.side === 1)).toHaveLength(7)
    expect(lamps.filter(l => l.side === -1)).toHaveLength(7)
  })

  it('keeps 8 lamps (4 per side) at spacing 8, at the pinned positions', () => {
    const lamps = lampPositions(LAMP_SPACING_LOW_POWER)
    expectGolden(lamps, LOW_POWER_GOLDEN)
    expect(lamps.filter(l => l.side === 1)).toHaveLength(4)
    expect(lamps.filter(l => l.side === -1)).toHaveLength(4)
  })

  it('stands every lamp 3.3 from the center line at its station and clear of footprints, corner blocks and every road leg', () => {
    for (const spacing of [1, LAMP_SPACING_FULL, LAMP_SPACING_LOW_POWER]) {
      for (const lamp of lampPositions(spacing)) {
        const station = pathPointAt(lamp.distance)
        expect(Math.hypot(lamp.x - station.x, lamp.z - station.z)).toBeCloseTo(LAMP_OFFSET, 2)
        expect(clearsPath(lamp.x, lamp.z, 3.2)).toBe(true)
        expect(clearsFootprints(lamp.x, lamp.z, 0.2)).toBe(true)
        expect(clearsCornerBlocks(lamp.x, lamp.z, 0.2)).toBe(true)
      }
    }
  })

  it('rejects the fixture lamp at path distance 59.5 on side +1, which sits 0.5 units from the next road leg', () => {
    const station = pathPointAt(59.5)
    const x = station.x + station.rightX * LAMP_OFFSET
    const z = station.z + station.rightZ * LAMP_OFFSET
    expect(x).toBeCloseTo(-25.5, 6)
    expect(z).toBeCloseTo(-29.3, 6)
    expect(clearsPath(x, z, ROAD_HALF_WIDTH + 0.2)).toBe(false)
    const near = lampPositions(1).filter(l => Math.hypot(l.x - x, l.z - z) < 0.01)
    expect(near).toHaveLength(0)
  })

  it('rejects a spacing that is not positive', () => {
    expect(() => lampPositions(0)).toThrow(RangeError)
    expect(() => lampPositions(-6)).toThrow(RangeError)
  })
})

describe('armAngleFor and lampHeadPosition', () => {
  it('turns the arm toward the road center for both sides and all three segments', () => {
    for (const segment of PATH_SEGMENTS) {
      for (const side of [1, -1] as const) {
        const angle = armAngleFor(side, segment.rightX, segment.rightZ)
        // Rotation by theta about Y maps local +X to (cos theta, 0, -sin theta).
        const arm = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle)
        const toRoad = new THREE.Vector3(-side * segment.rightX, 0, -side * segment.rightZ)
        expect(arm.dot(toRoad)).toBeGreaterThan(0.99)
      }
    }
  })

  it('matches the worked example: segment 1, side +1, angle pi', () => {
    const [first] = PATH_SEGMENTS
    expect(armAngleFor(1, first!.rightX, first!.rightZ)).toBeCloseTo(Math.PI, 12)
  })

  it('puts the post base at y -1 and the head at the arm tip, y 1.4', () => {
    expect(LAMP_BASE_Y).toBe(-1)
    expect(LAMP_HEAD_Y).toBeCloseTo(LAMP_BASE_Y + POST_HEIGHT, 12)
    expect(LAMP_HEAD_Y).toBeCloseTo(1.4, 12)
    for (const lamp of lampPositions(LAMP_SPACING_FULL)) {
      const head = lampHeadPosition(lamp)
      expect(head.y).toBeCloseTo(1.4, 12)
      expect(head.x).toBeCloseTo(lamp.x + ARM_LENGTH * Math.cos(lamp.armAngle), 12)
      expect(head.z).toBeCloseTo(lamp.z - ARM_LENGTH * Math.sin(lamp.armAngle), 12)
      // The arm box spans local x 0..0.5 at height 2.375, so its far end is the head, horizontally.
      const tip = new THREE.Vector3(ARM_LENGTH, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), lamp.armAngle)
      expect(Math.hypot(head.x - (lamp.x + tip.x), head.z - (lamp.z + tip.z))).toBeLessThan(0.01)
      expect(Math.abs(head.y - (LAMP_BASE_Y + 2.375))).toBeLessThanOrEqual(0.025 + 1e-9)
    }
  })

  it('points every head toward the road: closer to the center line than its post', () => {
    for (const lamp of lampPositions(LAMP_SPACING_FULL)) {
      const station = pathPointAt(lamp.distance)
      const head = lampHeadPosition(lamp)
      expect(Math.hypot(head.x - station.x, head.z - station.z)).toBeCloseTo(LAMP_OFFSET - ARM_LENGTH, 6)
    }
  })
})

describe('lampThreshold and lampIntensity', () => {
  const thresholds = Array.from({ length: 64 }, (_, i) => lampThreshold(i))

  it('draws every threshold from [0.15, 0.35)', () => {
    for (const th of thresholds) {
      expect(th).toBeGreaterThanOrEqual(0.15)
      expect(th).toBeLessThan(0.35)
    }
  })

  it('is 0 at ratio 0.15 and 1 at ratio 0.40 for every threshold', () => {
    for (const th of thresholds) {
      expect(lampIntensity(th, 0.15)).toBe(0)
      expect(lampIntensity(th, 0.4)).toBe(1)
      expect(lampIntensity(th, 0)).toBe(0)
      expect(lampIntensity(th, 1)).toBe(1)
    }
  })

  it('is monotonic non-decreasing in the ratio', () => {
    for (const th of thresholds) {
      let previous = 0
      for (let ratio = 0; ratio <= 0.5; ratio += 0.005) {
        const value = lampIntensity(th, ratio)
        expect(value).toBeGreaterThanOrEqual(previous - 1e-12)
        previous = value
      }
    }
  })

  it('lights lamps one by one: the lit count rises monotonically from none to all', () => {
    const lit = (ratio: number) => thresholds.filter(th => lampIntensity(th, ratio) > 0.5).length
    let previous = 0
    for (let ratio = 0; ratio <= 0.5; ratio += 0.005) {
      const count = lit(ratio)
      expect(count).toBeGreaterThanOrEqual(previous)
      previous = count
    }
    expect(lit(0.15)).toBe(0)
    expect(lit(0.4)).toBe(thresholds.length)
    // Lamps switch at different ratios, not all together.
    expect(lit(0.25)).toBeGreaterThan(0)
    expect(lit(0.25)).toBeLessThan(thresholds.length)
  })

  it('depends only on the ratio, so scrolling back turns a lamp off again', () => {
    const th = lampThreshold(0)
    const up = lampIntensity(th, 0.3)
    lampIntensity(th, 0.1)
    expect(lampIntensity(th, 0.3)).toBe(up)
    expect(lampIntensity(th, 0.1)).toBe(0)
  })
})

describe('light gains', () => {
  it('brings warm lamp light to luminance 2.3 (about 3.56)', () => {
    expect(STREET_LIGHT_LUMINANCE).toBe(2.3)
    const color = new THREE.Color(LAMP_LIGHT_HEX)
    expect(LAMP_LIGHT_GAIN).toBeCloseTo(3.556, 1)
    expect(LAMP_LIGHT_GAIN).toBeCloseTo(gainFor(LAMP_LIGHT_HEX, 2.3), 12)
    expect(linearLuminance([color.r * LAMP_LIGHT_GAIN, color.g * LAMP_LIGHT_GAIN, color.b * LAMP_LIGHT_GAIN])).toBeCloseTo(2.3, 3)
  })

  it('brings the front (about 2.58) and rear (about 10.0) car light colors to luminance 2.3', () => {
    for (const [hex, expected] of [[0xfff1d6, 2.584], [0xff2a1a, 10.004]] as const) {
      const gain = gainFor(hex, STREET_LIGHT_LUMINANCE)
      const color = new THREE.Color(hex)
      expect(gain).toBeCloseTo(expected, 1)
      expect(linearLuminance([color.r * gain, color.g * gain, color.b * gain])).toBeCloseTo(2.3, 3)
    }
  })

  it('keeps the dark glass color dim', () => {
    const glass = new THREE.Color(DARK_GLASS_HEX)
    expect(linearLuminance([glass.r, glass.g, glass.b])).toBeLessThan(0.05)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/journey/lamps.test.ts`
Expected: FAIL. Vite cannot resolve `../../app/journey/lamps`.

- [ ] **Step 3: Write the pure part of `lamps.ts`**

Create `app/journey/lamps.ts`:

```ts
import { clearsCornerBlocks, clearsFootprints } from './footprints'
import { clearsPath, PATH_TOTAL_LENGTH, pathPointAt, ROAD_HALF_WIDTH } from './path'
import { seeded } from './random'
import { smoothstep } from './sky-mirror'
import { gainFor } from './window-look'

export const LAMP_SPACING_FULL = 6
export const LAMP_SPACING_LOW_POWER = 8
// Distance from the road center line to a lamp post.
export const LAMP_OFFSET = ROAD_HALF_WIDTH + 0.3
export const LAMP_BASE_Y = -1
export const POST_HEIGHT = 2.4
export const ARM_LENGTH = 0.5
export const LAMP_HEAD_Y = LAMP_BASE_Y + POST_HEIGHT
// Switch-on thresholds fall in [LAMP_ON_MIN, LAMP_ON_MIN + LAMP_ON_SPREAD); a lamp fades in over LAMP_FADE.
export const LAMP_ON_MIN = 0.15
export const LAMP_ON_SPREAD = 0.2
export const LAMP_FADE = 0.05
// Linear luminance every bloom-capable street light reaches (spec 02's brightness contract).
export const STREET_LIGHT_LUMINANCE = 2.3
export const LAMP_LIGHT_HEX = 0xffc983
export const DARK_GLASS_HEX = 0x2a2a30
export const LAMP_LIGHT_GAIN = gainFor(LAMP_LIGHT_HEX, STREET_LIGHT_LUMINANCE)

const FOOTPRINT_PAD = 0.2
const PATH_CLEARANCE = ROAD_HALF_WIDTH + 0.2
const THRESHOLD_SEED = 9100
const STATION_EPSILON = 1e-9

export interface Lamp {
  // Path distance of the station the lamp belongs to.
  distance: number
  x: number
  z: number
  side: 1 | -1
  armAngle: number
}

// The arm points along local +X; a rotation by `theta` about Y maps +X to (cos theta, 0, -sin theta).
// It must point at the road center, which is -side * (rightX, rightZ) from the post.
export function armAngleFor(side: 1 | -1, rightX: number, rightZ: number): number {
  return Math.atan2(side * rightZ, -side * rightX)
}

// One lamp per side at every station, minus positions inside a set-piece footprint, a corner
// block, or within PATH_CLEARANCE of ANY road leg (a lamp near a corner can sit on the next leg).
export function lampPositions(spacing: number): Lamp[] {
  if (!(spacing > 0)) throw new RangeError(`lamp spacing must be positive, got ${spacing}`)
  const lamps: Lamp[] = []
  const first = spacing / 2
  const last = PATH_TOTAL_LENGTH - spacing / 2
  for (let i = 0; first + i * spacing <= last + STATION_EPSILON; i++) {
    const distance = first + i * spacing
    const point = pathPointAt(distance)
    for (const side of [1, -1] as const) {
      const x = point.x + point.rightX * LAMP_OFFSET * side
      const z = point.z + point.rightZ * LAMP_OFFSET * side
      if (!clearsFootprints(x, z, FOOTPRINT_PAD)) continue
      if (!clearsCornerBlocks(x, z, FOOTPRINT_PAD)) continue
      if (!clearsPath(x, z, PATH_CLEARANCE)) continue
      lamps.push({ distance, x, z, side, armAngle: armAngleFor(side, point.rightX, point.rightZ) })
    }
  }
  return lamps
}

// World position of the lamp head: the far end of the arm, at the top of the post.
export function lampHeadPosition(lamp: Pick<Lamp, 'x' | 'z' | 'armAngle'>): { x: number; y: number; z: number } {
  return {
    x: lamp.x + ARM_LENGTH * Math.cos(lamp.armAngle),
    y: LAMP_HEAD_Y,
    z: lamp.z - ARM_LENGTH * Math.sin(lamp.armAngle),
  }
}

export function lampThreshold(index: number): number {
  return LAMP_ON_MIN + LAMP_ON_SPREAD * seeded(THRESHOLD_SEED + index)
}

// smoothstep(threshold, threshold + LAMP_FADE, windowLitRatio): 0 at or below the threshold, 1 above it plus the fade.
export function lampIntensity(threshold: number, windowLitRatio: number): number {
  return smoothstep(threshold, threshold + LAMP_FADE, windowLitRatio)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/journey/lamps.test.ts`
Expected: PASS.

If the golden positions fail, do not edit the golden values. Print `lampPositions(6)` and compare with the table in "Scope and repository findings". A mismatch means placement drifted from the spec.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/journey/lamps.ts tests/journey/lamps.test.ts
git commit -m "feat: add lamp placement and per-lamp switching math"
```

---

### Task 4: Lamp meshes

**Files:**
- Modify: `app/journey/lamps.ts`
- Modify: `tests/journey/lamps.test.ts`

**Interfaces:**
- Consumes: Task 1 `createFalloffTexture`; Task 2 `attenuateAdditiveFog`; Task 3 exports; `replaceOrThrow`; `fovForAspect` (`camera.ts`) in a test.
- Produces (Tasks 6, 7, 8 rely on these):
  - `STREET_NAMES = { posts, heads, halos, pools, carBodies, carLights }` (mesh names, all start with `STREET_NAME_PREFIX = 'journey-street-'`)
  - `POOL_RENDER_ORDER = 1.5`, `HALO_RENDER_ORDER = 3`
  - `headColor(intensity: number, out: THREE.Color): THREE.Color`
  - `glowColor(intensity: number, brightness: number, out: THREE.Color): THREE.Color`
  - `interface LampField { readonly lamps: readonly Lamp[]; readonly objects: readonly THREE.InstancedMesh[]; update(windowLitRatio: number): void; dispose(): void }`
  - `createLamps(spacing: number): LampField`. `objects` is `[posts, heads, pools, halos]`.

- [ ] **Step 1: Write the failing test**

In `tests/journey/lamps.test.ts`, replace the first import lines with this block (the existing imports stay; new names are added), then append the new `describe`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { fovForAspect } from '../../app/journey/camera'
import { ROAD_MARKING_RENDER_ORDER, SHADOW_RENDER_ORDER } from '../../app/journey/contact-shadows'
import { clearsCornerBlocks, clearsFootprints } from '../../app/journey/footprints'
import {
  ARM_LENGTH, armAngleFor, createLamps, DARK_GLASS_HEX, glowColor, HALO_RENDER_ORDER, headColor, LAMP_BASE_Y,
  LAMP_HEAD_Y, LAMP_LIGHT_GAIN, LAMP_LIGHT_HEX, LAMP_OFFSET, LAMP_SPACING_FULL, LAMP_SPACING_LOW_POWER,
  lampHeadPosition, lampIntensity, lampPositions, lampThreshold, POOL_RENDER_ORDER, POST_HEIGHT,
  STREET_LIGHT_LUMINANCE, STREET_NAME_PREFIX, STREET_NAMES,
} from '../../app/journey/lamps'
```

Append at the end of the file:

```ts
function meshNamed(field: ReturnType<typeof createLamps>, name: string): THREE.InstancedMesh {
  const mesh = field.objects.find(object => object.name === name)
  if (!mesh) throw new Error(`missing mesh ${name}`)
  return mesh
}

// Instance colors are stored as float32, so compare through Math.fround or with a tolerance.
function colorAt(mesh: THREE.InstancedMesh, index: number): THREE.Color {
  const color = new THREE.Color()
  mesh.getColorAt(index, color)
  return color
}

describe('createLamps', () => {
  it('creates four named instanced meshes, one instance per lamp, culling off', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    expect(field.objects).toHaveLength(4)
    expect(field.lamps).toHaveLength(14)
    for (const name of [STREET_NAMES.posts, STREET_NAMES.heads, STREET_NAMES.halos, STREET_NAMES.pools]) {
      const mesh = meshNamed(field, name)
      expect(name.startsWith(STREET_NAME_PREFIX)).toBe(true)
      expect(mesh.count).toBe(14)
      expect(mesh.frustumCulled).toBe(false)
    }
    expect(createLamps(LAMP_SPACING_LOW_POWER).lamps).toHaveLength(8)
    field.dispose()
  })

  it('draws pools after shadows and before road markings, and halos after markings', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    expect(SHADOW_RENDER_ORDER).toBeLessThan(POOL_RENDER_ORDER)
    expect(POOL_RENDER_ORDER).toBeLessThan(ROAD_MARKING_RENDER_ORDER)
    expect(ROAD_MARKING_RENDER_ORDER).toBeLessThan(HALO_RENDER_ORDER)
    expect(meshNamed(field, STREET_NAMES.pools).renderOrder).toBe(1.5)
    expect(meshNamed(field, STREET_NAMES.halos).renderOrder).toBe(3)
    field.dispose()
  })

  it('merges the post and arm into one geometry that stands on y -1 and reaches the head height', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    const posts = meshNamed(field, STREET_NAMES.posts)
    posts.geometry.computeBoundingBox()
    const box = posts.geometry.boundingBox!
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(POST_HEIGHT, 6)
    expect(box.min.x).toBeCloseTo(-0.05, 6)
    expect(box.max.x).toBeCloseTo(ARM_LENGTH, 6)
    field.dispose()
  })

  it('places posts at y -1, heads and halos at the head position, and pools on the road toward the lane', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const posts = meshNamed(field, STREET_NAMES.posts)
    const heads = meshNamed(field, STREET_NAMES.heads)
    const halos = meshNamed(field, STREET_NAMES.halos)
    const pools = meshNamed(field, STREET_NAMES.pools)
    field.lamps.forEach((lamp, i) => {
      const head = lampHeadPosition(lamp)
      posts.getMatrixAt(i, matrix)
      expect(position.setFromMatrixPosition(matrix).toArray()).toEqual([lamp.x, LAMP_BASE_Y, lamp.z])
      heads.getMatrixAt(i, matrix)
      expect(position.setFromMatrixPosition(matrix).toArray()).toEqual([head.x, head.y, head.z])
      expect(new THREE.Vector3().setFromMatrixScale(matrix).x).toBeCloseTo(0.12, 12)
      halos.getMatrixAt(i, matrix)
      expect(position.setFromMatrixPosition(matrix).toArray()).toEqual([head.x, head.y, head.z])
      expect(new THREE.Vector3().setFromMatrixScale(matrix).x).toBeCloseTo(0.9, 12)
      pools.getMatrixAt(i, matrix)
      position.setFromMatrixPosition(matrix)
      expect(position.y).toBeCloseTo(-0.992, 12)
      expect(position.x).toBeCloseTo(lamp.x + 1.2 * Math.cos(lamp.armAngle), 12)
      expect(position.z).toBeCloseTo(lamp.z - 1.2 * Math.sin(lamp.armAngle), 12)
      expect(new THREE.Vector3().setFromMatrixScale(matrix).x).toBeCloseTo(3.2, 12)
      // The pool lies flat: its normal points up.
      expect(pools.geometry.getAttribute('normal').getY(0)).toBeCloseTo(1, 6)
    })
    field.dispose()
  })

  it('gives halos and pools additive, depth-write-off materials with the falloff map and distinct cache keys', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    const halo = meshNamed(field, STREET_NAMES.halos).material as THREE.MeshBasicMaterial
    const pool = meshNamed(field, STREET_NAMES.pools).material as THREE.MeshBasicMaterial
    for (const material of [halo, pool]) {
      expect(material.blending).toBe(THREE.AdditiveBlending)
      expect(material.transparent).toBe(true)
      expect(material.depthWrite).toBe(false)
      expect(material.fog).toBe(true)
      expect(material.map).not.toBeNull()
      expect(material.map!.colorSpace).toBe(THREE.NoColorSpace)
    }
    expect(pool.polygonOffset).toBe(true)
    expect(pool.polygonOffsetFactor).toBe(-1)
    expect(pool.polygonOffsetUnits).toBe(-1)
    expect(halo.customProgramCacheKey()).toBe('street-halo|additive-fog')
    expect(pool.customProgramCacheKey()).toBe('street-pool|additive-fog')
    field.dispose()
  })

  it('patches the halo vertex shader into a view-space billboard and both fog fragments to attenuate', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    const halo = meshNamed(field, STREET_NAMES.halos).material as THREE.MeshBasicMaterial
    const pool = meshNamed(field, STREET_NAMES.pools).material as THREE.MeshBasicMaterial
    const shader = () => ({ vertexShader: '#include <project_vertex>', fragmentShader: '#include <fog_fragment>', uniforms: {} }) as unknown as THREE.WebGLProgramParametersWithUniforms
    const haloShader = shader()
    halo.onBeforeCompile(haloShader, {} as THREE.WebGLRenderer)
    expect(haloShader.vertexShader).not.toContain('#include <project_vertex>')
    expect(haloShader.vertexShader).toContain('instanceMatrix')
    expect(haloShader.vertexShader).toContain('mvPosition.xy +=')
    expect(haloShader.fragmentShader).toContain('1.0 - fogFactor')
    const poolShader = shader()
    pool.onBeforeCompile(poolShader, {} as THREE.WebGLRenderer)
    expect(poolShader.vertexShader).toBe('#include <project_vertex>')
    expect(poolShader.fragmentShader).toContain('1.0 - fogFactor')
    field.dispose()
  })

  it('shows dark glass on a head and exactly black halos and pools when every lamp is off', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    field.update(0.05)
    const dark = new THREE.Color(DARK_GLASS_HEX)
    for (let i = 0; i < field.lamps.length; i++) {
      expect(colorAt(meshNamed(field, STREET_NAMES.heads), i).toArray()).toEqual(dark.toArray().map(Math.fround))
      expect(colorAt(meshNamed(field, STREET_NAMES.halos), i).toArray()).toEqual([0, 0, 0])
      expect(colorAt(meshNamed(field, STREET_NAMES.pools), i).toArray()).toEqual([0, 0, 0])
    }
    field.dispose()
  })

  it('lights every head to warm * gain, every halo to warm * 0.9 and every pool to warm * 0.5 at ratio 0.40', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    field.update(0.4)
    const warm = new THREE.Color(LAMP_LIGHT_HEX)
    const lit = warm.clone().multiplyScalar(LAMP_LIGHT_GAIN)
    const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    for (let i = 0; i < field.lamps.length; i++) {
      const head = colorAt(meshNamed(field, STREET_NAMES.heads), i)
      expect(head.r).toBeCloseTo(lit.r, 5)
      expect(head.g).toBeCloseTo(lit.g, 5)
      expect(head.b).toBeCloseTo(lit.b, 5)
      expect(luminance(colorAt(meshNamed(field, STREET_NAMES.heads), i))).toBeGreaterThanOrEqual(STREET_LIGHT_LUMINANCE - 0.01)
      expect(colorAt(meshNamed(field, STREET_NAMES.halos), i).r).toBeCloseTo(warm.r * 0.9, 6)
      expect(colorAt(meshNamed(field, STREET_NAMES.pools), i).r).toBeCloseTo(warm.r * 0.5, 6)
    }
    field.dispose()
  })

  it('rewrites colors only when the quantised ratio changes, in both directions', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    const heads = meshNamed(field, STREET_NAMES.heads)
    const version = () => heads.instanceColor!.version
    field.update(0.3)
    const afterFirst = version()
    field.update(0.3)
    expect(version()).toBe(afterFirst)
    field.update(0.3004)
    expect(version()).toBe(afterFirst)
    field.update(0.25)
    const afterDown = version()
    expect(afterDown).toBeGreaterThan(afterFirst)
    field.update(0.25)
    expect(version()).toBe(afterDown)
    field.update(0.3)
    expect(version()).toBeGreaterThan(afterDown)
    field.dispose()
  })

  it('turns lamps off again when the ratio falls back to the day value', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    const halos = meshNamed(field, STREET_NAMES.halos)
    field.update(0.9)
    expect(colorAt(halos, 0).r).toBeGreaterThan(0.5)
    field.update(0.05)
    for (let i = 0; i < field.lamps.length; i++) expect(colorAt(halos, i).toArray()).toEqual([0, 0, 0])
    field.dispose()
  })

  it('keeps a lit halo under half the viewport at the 3.3 units a lamp passes the camera, on a portrait phone', () => {
    const aspect = 390 / 844
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, 0.1, 200)
    const corner = new THREE.Vector3(0.45, 0.45, -(LAMP_OFFSET)).applyMatrix4(camera.projectionMatrix)
    // NDC spans 2 units across the viewport, so the half-extent in NDC is the full fraction of the viewport.
    expect(Math.abs(corner.x)).toBeLessThan(0.5)
    expect(Math.abs(corner.y)).toBeLessThan(0.5)
  })

  it('dispose releases geometry, material and texture without throwing twice', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    field.dispose()
    expect(() => field.dispose()).not.toThrow()
  })
})

describe('light color helpers', () => {
  it('mixes dark glass to warm * gain with the intensity', () => {
    const out = new THREE.Color()
    expect(headColor(0, out).toArray()).toEqual(new THREE.Color(DARK_GLASS_HEX).toArray())
    const lit = new THREE.Color(LAMP_LIGHT_HEX).multiplyScalar(LAMP_LIGHT_GAIN)
    expect(headColor(1, out).r).toBeCloseTo(lit.r, 12)
    const half = headColor(0.5, out)
    expect(half.r).toBeCloseTo((new THREE.Color(DARK_GLASS_HEX).r + lit.r) / 2, 12)
  })

  it('scales warm light by intensity * brightness', () => {
    const out = new THREE.Color()
    expect(glowColor(0, 0.9, out).toArray()).toEqual([0, 0, 0])
    expect(glowColor(1, 0.9, out).r).toBeCloseTo(new THREE.Color(LAMP_LIGHT_HEX).r * 0.9, 12)
  })
})
```

Note: the first three unused imports from the earlier block (`DARK_GLASS_HEX`, `LAMP_LIGHT_GAIN`, ...) stay used by the tests above and by the Task 3 tests. Remove any import that your linter reports as unused.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/journey/lamps.test.ts`
Expected: FAIL. `createLamps`, `glowColor`, `headColor`, `STREET_NAMES` and the render-order constants are not exported.

- [ ] **Step 3: Implement the lamp meshes**

In `app/journey/lamps.ts`, replace the import block at the top with:

```ts
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createFalloffTexture } from './falloff-texture'
import { clearsCornerBlocks, clearsFootprints } from './footprints'
import { clearsPath, PATH_TOTAL_LENGTH, pathPointAt, ROAD_HALF_WIDTH } from './path'
import { seeded } from './random'
import { attenuateAdditiveFog, replaceOrThrow } from './shader-utils'
import { smoothstep } from './sky-mirror'
import { gainFor } from './window-look'
```

Append to the end of `app/journey/lamps.ts`:

```ts
export const STREET_NAME_PREFIX = 'journey-street-'
export const STREET_NAMES = {
  posts: 'journey-street-posts',
  heads: 'journey-street-heads',
  halos: 'journey-street-halos',
  pools: 'journey-street-pools',
  carBodies: 'journey-street-car-bodies',
  carLights: 'journey-street-car-lights',
} as const
// After spec 04's shadow quads (1), before the road markings (2); halos draw over the markings.
export const POOL_RENDER_ORDER = 1.5
export const HALO_RENDER_ORDER = 3

const HEAD_RADIUS = 0.12
const HALO_SIZE = 0.9
const POOL_SIZE = 3.2
const POOL_Y = -0.992
const POOL_OFFSET = 1.2
const HALO_BRIGHTNESS = 0.9
const POOL_BRIGHTNESS = 0.5
const RATIO_QUANTUM = 1e-3
const POST_COLOR = 0x2a2a2f
const ARM_THICKNESS = 0.05

const warm = new THREE.Color(LAMP_LIGHT_HEX)
const litHead = new THREE.Color(LAMP_LIGHT_HEX).multiplyScalar(LAMP_LIGHT_GAIN)
const darkGlass = new THREE.Color(DARK_GLASS_HEX)

// mix(dark glass, warm * gain, intensity)
export function headColor(intensity: number, out: THREE.Color): THREE.Color {
  return out.copy(darkGlass).lerp(litHead, intensity)
}

// Additive light needs no HDR: it adds on top. Zero intensity is exactly black, which adds nothing.
export function glowColor(intensity: number, brightness: number, out: THREE.Color): THREE.Color {
  return out.copy(warm).multiplyScalar(intensity * brightness)
}

// View-space billboard: the instance center goes through the model-view matrix, then the quad
// corner is added in view space, scaled by the instance scale. A Points sprite was rejected
// because the GPU clamps point size, which would shrink the halo when the camera passes close.
const BILLBOARD_PROJECT = /* glsl */ `
vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
vec2 billboardScale = vec2( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ) );
mvPosition.xy += transformed.xy * billboardScale;
gl_Position = projectionMatrix * mvPosition;
`

function createHaloMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  })
  material.name = 'journey-street-halo'
  material.onBeforeCompile = shader => {
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <project_vertex>', BILLBOARD_PROJECT)
  }
  material.customProgramCacheKey = () => 'street-halo'
  attenuateAdditiveFog(material)
  return material
}

function createPoolMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  })
  material.name = 'journey-street-pool'
  material.customProgramCacheKey = () => 'street-pool'
  attenuateAdditiveFog(material)
  return material
}

// Cylinder translated up so its bottom is at y = 0, merged with the arm box at the top.
function createPostGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.04, 0.05, POST_HEIGHT, 6)
  pole.translate(0, POST_HEIGHT / 2, 0)
  const arm = new THREE.BoxGeometry(ARM_LENGTH, ARM_THICKNESS, ARM_THICKNESS)
  arm.translate(ARM_LENGTH / 2, POST_HEIGHT - ARM_THICKNESS / 2, 0)
  const merged = mergeGeometries([pole, arm])
  pole.dispose()
  arm.dispose()
  if (!merged) throw new Error('Lamp post and arm geometries do not share attributes')
  return merged
}

export interface LampField {
  readonly lamps: readonly Lamp[]
  // Posts, heads, pools, halos: four draw calls.
  readonly objects: readonly THREE.InstancedMesh[]
  update(windowLitRatio: number): void
  dispose(): void
}

// Module-level scratch objects: the per-frame update allocates nothing.
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const noRotation = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)
const scratchColor = new THREE.Color()

function place(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, size: number, quaternion: THREE.Quaternion) {
  position.set(x, y, z)
  scale.setScalar(size)
  matrix.compose(position, quaternion, scale)
  mesh.setMatrixAt(index, matrix)
}

export function createLamps(spacing: number): LampField {
  const lamps = lampPositions(spacing)
  const thresholds = lamps.map((_, i) => lampThreshold(i))
  const falloff = createFalloffTexture()

  const postMaterial = new THREE.MeshStandardMaterial({ color: POST_COLOR, roughness: 0.7 })
  postMaterial.name = 'journey-street-post'
  const headMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  headMaterial.name = 'journey-street-head'
  const poolGeometry = new THREE.PlaneGeometry(1, 1)
  poolGeometry.rotateX(-Math.PI / 2)

  const posts = new THREE.InstancedMesh(createPostGeometry(), postMaterial, lamps.length)
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), headMaterial, lamps.length)
  const pools = new THREE.InstancedMesh(poolGeometry, createPoolMaterial(falloff), lamps.length)
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), createHaloMaterial(falloff), lamps.length)
  posts.name = STREET_NAMES.posts
  heads.name = STREET_NAMES.heads
  pools.name = STREET_NAMES.pools
  halos.name = STREET_NAMES.halos
  pools.renderOrder = POOL_RENDER_ORDER
  halos.renderOrder = HALO_RENDER_ORDER
  const objects = [posts, heads, pools, halos] as const
  for (const mesh of objects) mesh.frustumCulled = false

  lamps.forEach((lamp, i) => {
    const head = lampHeadPosition(lamp)
    place(posts, i, lamp.x, LAMP_BASE_Y, lamp.z, 1, rotation.setFromAxisAngle(UP, lamp.armAngle))
    place(heads, i, head.x, head.y, head.z, HEAD_RADIUS, noRotation)
    place(halos, i, head.x, head.y, head.z, HALO_SIZE, noRotation)
    place(pools, i, lamp.x + POOL_OFFSET * Math.cos(lamp.armAngle), POOL_Y,
      lamp.z - POOL_OFFSET * Math.sin(lamp.armAngle), POOL_SIZE, noRotation)
  })
  for (const mesh of objects) mesh.instanceMatrix.needsUpdate = true

  function writeColors(windowLitRatio: number) {
    for (const [i, threshold] of thresholds.entries()) {
      const intensity = lampIntensity(threshold, windowLitRatio)
      heads.setColorAt(i, headColor(intensity, scratchColor))
      halos.setColorAt(i, glowColor(intensity, HALO_BRIGHTNESS, scratchColor))
      pools.setColorAt(i, glowColor(intensity, POOL_BRIGHTNESS, scratchColor))
    }
    for (const mesh of [heads, halos, pools]) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }
  // Create the color attributes before the first render: three decides USE_INSTANCING_COLOR from them.
  writeColors(0)
  let lastKey = 0

  return {
    lamps,
    objects,
    update(windowLitRatio) {
      const key = Math.round(windowLitRatio / RATIO_QUANTUM)
      if (key === lastKey) return
      lastKey = key
      writeColors(windowLitRatio)
    },
    dispose() {
      for (const mesh of objects) {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
      falloff.dispose()
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/journey/lamps.test.ts`
Expected: PASS.

If `posts.geometry.boundingBox.max.x` is off, check that `arm.translate(ARM_LENGTH / 2, ...)` runs before the merge. If the dirty-check test fails on the second `update(0.3)`, check that `lastKey` is updated before `writeColors`.

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/journey/lamps.ts tests/journey/lamps.test.ts
git commit -m "feat: add instanced lamp posts, heads, halos and light pools"
```

---

### Task 5: Traffic model

**Files:**
- Create: `app/journey/traffic.ts` (pure part only in this task)
- Test: `tests/journey/traffic.test.ts`

**Interfaces:**
- Consumes: `headingFor`, `PATH_SEGMENTS`, `PATH_TOTAL_LENGTH`, `pathPointAt` (`path.ts`); `seeded`; `smoothstep`; `lampIntensity`, `STREET_LIGHT_LUMINANCE`, `DARK_GLASS_HEX` (`lamps.ts`); `gainFor`.
- Produces (Task 6 relies on these):
  - Constants: `LANE_OFFSET = 1.5`, `CAR_COUNT_FULL = 12`, `CAR_COUNT_LOW_POWER = 6`, `SPEED_MIN = 2.5`, `SPEED_MAX = 5.5`, `CORNER_HIDE = 2.5`, `CORNER_SHOW = 3.5`, `EDGE_SHOW = 4`, `CAR_SIZE`, `CAR_RIDE_HEIGHT = 0.08`, `CAR_CENTER_Y`, `FRONT_LIGHT_HEX = 0xfff1d6`, `REAR_LIGHT_HEX = 0xff2a1a`, `FRONT_LIGHT_THRESHOLD = 0.2`, `REAR_MIN_INTENSITY = 0.2`
  - `interface Car { lane: 1 | -1; speed: number; startDistance: number; bodyColor: number }`
  - `interface CarPose { x: number; z: number; yaw: number; distance: number; scale: number }`
  - `carCountFor(reducedMotion: boolean, lowPower: boolean): number`
  - `createCars(count: number): Car[]`
  - `carPoseAt(car: Car, t: number, out?: CarPose): CarPose`
  - `cornerScale(distance: number): number`, `edgeScale(distance: number): number`, `visibilityScale(distance: number): number`
  - `type CarLightKind = 'front' | 'rear'`, `CAR_LIGHT_OFFSETS: readonly { x: number; z: number; kind: CarLightKind }[]`
  - `carLightIntensity(kind: CarLightKind, windowLitRatio: number): number`
  - `carLightColor(kind: CarLightKind, windowLitRatio: number, out: THREE.Color): THREE.Color`

- [ ] **Step 1: Write the failing test**

Create `tests/journey/traffic.test.ts`:

```ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DARK_GLASS_HEX, STREET_LIGHT_LUMINANCE } from '../../app/journey/lamps'
import { headingFor, PATH_SEGMENTS, PATH_TOTAL_LENGTH, pathPointAt } from '../../app/journey/path'
import {
  CAR_CENTER_Y, CAR_COUNT_FULL, CAR_COUNT_LOW_POWER, CAR_LIGHT_OFFSETS, CAR_RIDE_HEIGHT, CAR_SIZE, type Car,
  carCountFor, carLightColor, carLightIntensity, carPoseAt, CORNER_HIDE, CORNER_SHOW, cornerScale, createCars,
  EDGE_SHOW, edgeScale, FRONT_LIGHT_HEX, LANE_OFFSET, REAR_LIGHT_HEX, REAR_MIN_INTENSITY, SPEED_MAX, SPEED_MIN,
  visibilityScale,
} from '../../app/journey/traffic'
import { gainFor, linearLuminance } from '../../app/journey/window-look'

const INTERIOR_WAYPOINTS = PATH_SEGMENTS.slice(1).map(segment => segment.cumStart)

function car(lane: 1 | -1, startDistance: number, speed = 3): Car {
  return { lane, speed, startDistance, bodyColor: 0x3a3a40 }
}

describe('carCountFor', () => {
  it('gives 12 cars on full, 6 on lowPower and none under reduced motion', () => {
    expect(carCountFor(false, false)).toBe(CAR_COUNT_FULL)
    expect(carCountFor(false, true)).toBe(CAR_COUNT_LOW_POWER)
    expect(carCountFor(true, false)).toBe(0)
    expect(carCountFor(true, true)).toBe(0)
    expect(CAR_COUNT_FULL).toBe(12)
    expect(CAR_COUNT_LOW_POWER).toBe(6)
  })
})

describe('createCars', () => {
  it('splits the cars evenly between the two lanes and keeps speeds in range', () => {
    for (const count of [CAR_COUNT_FULL, CAR_COUNT_LOW_POWER]) {
      const cars = createCars(count)
      expect(cars).toHaveLength(count)
      expect(cars.filter(c => c.lane === 1)).toHaveLength(count / 2)
      expect(cars.filter(c => c.lane === -1)).toHaveLength(count / 2)
      for (const c of cars) {
        expect(c.speed).toBeGreaterThanOrEqual(SPEED_MIN)
        expect(c.speed).toBeLessThanOrEqual(SPEED_MAX)
        expect(c.startDistance).toBeGreaterThanOrEqual(0)
        expect(c.startDistance).toBeLessThan(PATH_TOTAL_LENGTH)
      }
    }
  })

  it('returns no cars for a count of 0', () => {
    expect(createCars(0)).toEqual([])
  })

  it('is deterministic', () => {
    expect(createCars(CAR_COUNT_FULL)).toEqual(createCars(CAR_COUNT_FULL))
  })

  it('gives every car in a lane the same speed, so cars in one lane never overtake each other', () => {
    for (const lane of [1, -1] as const) {
      const speeds = new Set(createCars(CAR_COUNT_FULL).filter(c => c.lane === lane).map(c => c.speed))
      expect(speeds.size).toBe(1)
    }
  })

  it('keeps same-lane cars at least 4 units apart at every sampled time, wrapping included', () => {
    for (const count of [CAR_COUNT_FULL, CAR_COUNT_LOW_POWER]) {
      const cars = createCars(count)
      for (const lane of [1, -1] as const) {
        const inLane = cars.filter(c => c.lane === lane)
        for (const t of [0, 1.7, 13, 60, 1e4, 1e6]) {
          const distances = inLane.map(c => carPoseAt(c, t).distance).sort((a, b) => a - b)
          for (let i = 0; i < distances.length; i++) {
            const next = distances[(i + 1) % distances.length]!
            const gap = (next - distances[i]! + PATH_TOTAL_LENGTH) % PATH_TOTAL_LENGTH
            expect(gap, `count ${count} lane ${lane} t ${t}`).toBeGreaterThanOrEqual(4)
          }
        }
      }
    }
  })
})

describe('carPoseAt', () => {
  it('wraps past the end of the path in both directions', () => {
    expect(carPoseAt(car(1, 99, 3), 1).distance).toBeCloseTo(2, 9)
    expect(carPoseAt(car(-1, 1, 3), 1).distance).toBeCloseTo(98, 9)
    expect(carPoseAt(car(1, 10, 3), 0).distance).toBe(10)
  })

  it('keeps the car LANE_OFFSET from the center line, on its own side of travel', () => {
    for (const lane of [1, -1] as const) {
      for (let d = 5; d < PATH_TOTAL_LENGTH; d += 7.3) {
        const pose = carPoseAt(car(lane, d, 3), 0)
        const point = pathPointAt(pose.distance)
        expect(Math.hypot(pose.x - point.x, pose.z - point.z)).toBeCloseTo(LANE_OFFSET, 2)
        // Signed offset along the path's right vector: +1 lane on the right, -1 lane on the left.
        expect((pose.x - point.x) * point.rightX + (pose.z - point.z) * point.rightZ).toBeCloseTo(lane * LANE_OFFSET, 6)
      }
    }
  })

  it('moves the +1 lane toward increasing distance and the -1 lane toward decreasing distance', () => {
    const forward = carPoseAt(car(1, 50, 4), 0.5).distance
    const backward = carPoseAt(car(-1, 50, 4), 0.5).distance
    expect(forward).toBeCloseTo(52, 9)
    expect(backward).toBeCloseTo(48, 9)
  })

  it('faces the direction of travel and flips by 180 degrees between lanes', () => {
    for (const d of [10, 45, 80]) {
      const point = pathPointAt(d)
      const a = carPoseAt(car(1, d, 3), 0).yaw
      const b = carPoseAt(car(-1, d, 3), 0).yaw
      expect(a).toBeCloseTo(headingFor(point.dirX, point.dirZ), 9)
      expect(b).toBeCloseTo(headingFor(-point.dirX, -point.dirZ), 9)
      expect(Math.cos(a - b)).toBeCloseTo(-1, 9)
    }
  })

  it('gives the same position at t = 1e6 as at the reduced time modulo the lap period', () => {
    for (const c of createCars(CAR_COUNT_FULL)) {
      const period = PATH_TOTAL_LENGTH / c.speed
      const big = carPoseAt(c, 1e6)
      const small = carPoseAt(c, 1e6 % period)
      expect(big.x).toBeCloseTo(small.x, 3)
      expect(big.z).toBeCloseTo(small.z, 3)
    }
  })

  it('writes into the provided pose and returns it', () => {
    const out = { x: 0, z: 0, yaw: 0, distance: 0, scale: 0 }
    expect(carPoseAt(car(1, 50, 3), 0, out)).toBe(out)
    expect(out.distance).toBe(50)
    expect(out.scale).toBe(1)
  })
})

describe('cornerScale, edgeScale and visibilityScale', () => {
  it('hides cars within 2.5 units of each interior waypoint and shows them beyond 3.5', () => {
    expect(INTERIOR_WAYPOINTS).toEqual([34, 60])
    for (const corner of INTERIOR_WAYPOINTS) {
      for (const offset of [0, 1, CORNER_HIDE]) {
        expect(cornerScale(corner + offset)).toBe(0)
        expect(cornerScale(corner - offset)).toBe(0)
      }
      for (const offset of [CORNER_SHOW, CORNER_SHOW + 0.1, 8]) {
        expect(cornerScale(corner + offset)).toBe(1)
        expect(cornerScale(corner - offset)).toBe(1)
      }
    }
  })

  it('grows monotonically between 2.5 and 3.5 units from a corner', () => {
    let previous = 0
    for (let offset = CORNER_HIDE; offset <= CORNER_SHOW; offset += 0.05) {
      const value = cornerScale(34 + offset)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
    expect(cornerScale(34 + 3)).toBeGreaterThan(0)
    expect(cornerScale(34 + 3)).toBeLessThan(1)
  })

  it('hides cars at both path ends and shows them from 4 units in, so a wrap never pops beside the lens', () => {
    expect(edgeScale(0)).toBe(0)
    expect(edgeScale(PATH_TOTAL_LENGTH)).toBe(0)
    expect(edgeScale(EDGE_SHOW)).toBe(1)
    expect(edgeScale(PATH_TOTAL_LENGTH - EDGE_SHOW)).toBe(1)
    expect(edgeScale(PATH_TOTAL_LENGTH / 2)).toBe(1)
    expect(edgeScale(2)).toBeGreaterThan(0)
    expect(edgeScale(2)).toBeLessThan(1)
    expect(carPoseAt(car(1, 0, 3), 0).scale).toBe(0)
  })

  it('combines both: a car is visible only away from corners and ends', () => {
    expect(visibilityScale(50)).toBe(1)
    expect(visibilityScale(34)).toBe(0)
    expect(visibilityScale(0)).toBe(0)
    expect(visibilityScale(99.5)).toBe(0)
  })
})

describe('car geometry constants', () => {
  it('rests the body on a ride height of 0.08, so its center is at y -0.78', () => {
    expect(CAR_SIZE).toEqual({ width: 0.45, height: 0.28, length: 0.9 })
    expect(CAR_RIDE_HEIGHT).toBe(0.08)
    expect(CAR_CENTER_Y).toBeCloseTo(-0.78, 12)
  })

  it('puts two front lights ahead (-Z) and two rear lights behind (+Z) the body center', () => {
    expect(CAR_LIGHT_OFFSETS).toHaveLength(4)
    expect(CAR_LIGHT_OFFSETS.filter(l => l.kind === 'front').map(l => [l.x, l.z])).toEqual([[-0.15, -0.46], [0.15, -0.46]])
    expect(CAR_LIGHT_OFFSETS.filter(l => l.kind === 'rear').map(l => [l.x, l.z])).toEqual([[-0.15, 0.46], [0.15, 0.46]])
  })
})

describe('car light intensity and color', () => {
  it('ramps the front lights with the dusk ramp: off at 0.2, fully on at 0.25', () => {
    expect(carLightIntensity('front', 0)).toBe(0)
    expect(carLightIntensity('front', 0.2)).toBe(0)
    expect(carLightIntensity('front', 0.25)).toBe(1)
    expect(carLightIntensity('front', 0.9)).toBe(1)
  })

  it('keeps the rear lights at 20% minimum and follows the same ramp above it', () => {
    expect(REAR_MIN_INTENSITY).toBe(0.2)
    expect(carLightIntensity('rear', 0)).toBe(0.2)
    expect(carLightIntensity('rear', 0.2)).toBe(0.2)
    expect(carLightIntensity('rear', 0.25)).toBe(1)
  })

  it('reaches luminance 2.3 for a fully lit light and dark glass for an unlit front light', () => {
    const out = new THREE.Color()
    for (const [kind, hex] of [['front', FRONT_LIGHT_HEX], ['rear', REAR_LIGHT_HEX]] as const) {
      const lit = carLightColor(kind, 1, out)
      expect(linearLuminance([lit.r, lit.g, lit.b])).toBeCloseTo(STREET_LIGHT_LUMINANCE, 3)
      expect(gainFor(hex, STREET_LIGHT_LUMINANCE)).toBeGreaterThan(1)
    }
    expect(carLightColor('front', 0, out).toArray()).toEqual(new THREE.Color(DARK_GLASS_HEX).toArray())
    const rearDay = carLightColor('rear', 0, out)
    const rearLit = carLightColor('rear', 1, new THREE.Color())
    expect(rearDay.r).toBeGreaterThan(new THREE.Color(DARK_GLASS_HEX).r)
    expect(rearDay.r).toBeLessThan(rearLit.r)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/journey/traffic.test.ts`
Expected: FAIL. Vite cannot resolve `../../app/journey/traffic`.

- [ ] **Step 3: Write the pure part of `traffic.ts`**

Create `app/journey/traffic.ts`:

```ts
import * as THREE from 'three'
import { DARK_GLASS_HEX, lampIntensity, STREET_LIGHT_LUMINANCE } from './lamps'
import { headingFor, PATH_SEGMENTS, PATH_TOTAL_LENGTH, pathPointAt } from './path'
import { seeded } from './random'
import { smoothstep } from './sky-mirror'
import { gainFor } from './window-look'

export const LANE_OFFSET = 1.5
export const CAR_COUNT_FULL = 12
export const CAR_COUNT_LOW_POWER = 6
export const SPEED_MIN = 2.5
export const SPEED_MAX = 5.5
// Scale is 0 within CORNER_HIDE of an interior waypoint and 1 beyond CORNER_SHOW.
export const CORNER_HIDE = 2.5
export const CORNER_SHOW = 3.5
// Scale is 0 at either path end and 1 from EDGE_SHOW in, so the wrap from 100 to 0 never pops.
export const EDGE_SHOW = 4
export const CAR_SIZE = { width: 0.45, height: 0.28, length: 0.9 } as const
export const CAR_RIDE_HEIGHT = 0.08
// Road surface is at y = -1.
export const CAR_CENTER_Y = -1 + CAR_RIDE_HEIGHT + CAR_SIZE.height / 2
export const FRONT_LIGHT_HEX = 0xfff1d6
export const REAR_LIGHT_HEX = 0xff2a1a
export const FRONT_LIGHT_THRESHOLD = 0.2
export const REAR_MIN_INTENSITY = 0.2

const CAR_SEED = 9300
const LANES = [1, -1] as const
// Jitter is a fraction of the spacing between cars, so same-lane gaps stay at least (1 - JITTER) * spacing.
const START_JITTER = 0.7
const BODY_COLORS = [0x3a3a40, 0x52525a, 0x6a6a72, 0x1f2a44, 0x4a1c1c, 0x2c2c30] as const
const INTERIOR_DISTANCES = PATH_SEGMENTS.slice(1).map(segment => segment.cumStart)

export interface Car {
  lane: 1 | -1
  speed: number
  startDistance: number
  bodyColor: number
}

export interface CarPose {
  x: number
  z: number
  yaw: number
  distance: number
  scale: number
}

export function carCountFor(reducedMotion: boolean, lowPower: boolean): number {
  if (reducedMotion) return 0
  return lowPower ? CAR_COUNT_LOW_POWER : CAR_COUNT_FULL
}

// All cars in a lane share one speed, so they keep their spacing and never drive through each other.
export function createCars(count: number): Car[] {
  const perLane = Math.floor(count / 2)
  const cars: Car[] = []
  for (const [laneIndex, lane] of LANES.entries()) {
    const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * seeded(CAR_SEED + laneIndex)
    for (let i = 0; i < perLane; i++) {
      const seed = CAR_SEED + 10 + laneIndex * 50 + i
      const colorIndex = Math.floor(seeded(seed + 100) * BODY_COLORS.length)
      cars.push({
        lane,
        speed,
        startDistance: ((i + START_JITTER * seeded(seed)) / perLane) * PATH_TOTAL_LENGTH,
        bodyColor: BODY_COLORS[colorIndex] ?? BODY_COLORS[0],
      })
    }
  }
  return cars
}

// Distance from the nearest interior waypoint, in path units: 0 hides the car, CORNER_SHOW shows it.
export function cornerScale(distance: number): number {
  let nearest = Infinity
  for (const corner of INTERIOR_DISTANCES) nearest = Math.min(nearest, Math.abs(distance - corner))
  return smoothstep(CORNER_HIDE, CORNER_SHOW, nearest)
}

export function edgeScale(distance: number): number {
  return smoothstep(0, EDGE_SHOW, Math.min(distance, PATH_TOTAL_LENGTH - distance))
}

export function visibilityScale(distance: number): number {
  return cornerScale(distance) * edgeScale(distance)
}

// The modulo runs in double precision before anything is written to a float matrix, so a large
// `t` (performance.now() / 1000 after hours) does not lose precision.
export function carPoseAt(car: Car, t: number, out: CarPose = { x: 0, z: 0, yaw: 0, distance: 0, scale: 0 }): CarPose {
  const raw = (car.startDistance + car.lane * car.speed * t) % PATH_TOTAL_LENGTH
  const distance = raw < 0 ? raw + PATH_TOTAL_LENGTH : raw
  const point = pathPointAt(distance)
  out.x = point.x + point.rightX * car.lane * LANE_OFFSET
  out.z = point.z + point.rightZ * car.lane * LANE_OFFSET
  out.yaw = headingFor(car.lane * point.dirX, car.lane * point.dirZ)
  out.distance = distance
  out.scale = visibilityScale(distance)
  return out
}

export type CarLightKind = 'front' | 'rear'

// Authored facing -Z: the front is at -Z, the rear at +Z, at body-center height.
export const CAR_LIGHT_OFFSETS: readonly { x: number; z: number; kind: CarLightKind }[] = [
  { x: -0.15, z: -0.46, kind: 'front' },
  { x: 0.15, z: -0.46, kind: 'front' },
  { x: -0.15, z: 0.46, kind: 'rear' },
  { x: 0.15, z: 0.46, kind: 'rear' },
]

const litFront = new THREE.Color(FRONT_LIGHT_HEX).multiplyScalar(gainFor(FRONT_LIGHT_HEX, STREET_LIGHT_LUMINANCE))
const litRear = new THREE.Color(REAR_LIGHT_HEX).multiplyScalar(gainFor(REAR_LIGHT_HEX, STREET_LIGHT_LUMINANCE))
const darkGlass = new THREE.Color(DARK_GLASS_HEX)

// Front lights follow the dusk ramp. Rear lights are running and brake lights: never below 20%.
export function carLightIntensity(kind: CarLightKind, windowLitRatio: number): number {
  const ramp = lampIntensity(FRONT_LIGHT_THRESHOLD, windowLitRatio)
  return kind === 'rear' ? Math.max(REAR_MIN_INTENSITY, ramp) : ramp
}

// mix(dark glass, color * gain, intensity)
export function carLightColor(kind: CarLightKind, windowLitRatio: number, out: THREE.Color): THREE.Color {
  return out.copy(darkGlass).lerp(kind === 'rear' ? litRear : litFront, carLightIntensity(kind, windowLitRatio))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/journey/traffic.test.ts`
Expected: PASS.

If the same-lane gap test fails, print `createCars(12)` start distances and check `START_JITTER`. The minimum gap is `(1 - 0.7) * 100 / 6 = 5` for 12 cars and `10` for 6 cars.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/journey/traffic.ts tests/journey/traffic.test.ts
git commit -m "feat: add the traffic model with lane speeds, corner hiding and light ramps"
```

---

### Task 6: Traffic meshes

**Files:**
- Modify: `app/journey/traffic.ts`
- Modify: `tests/journey/traffic.test.ts`

**Interfaces:**
- Consumes: Task 5 exports; `STREET_NAMES` (`lamps.ts`).
- Produces (Tasks 7 and 8 rely on these):
  - `interface Traffic { readonly objects: readonly THREE.InstancedMesh[]; update(windowLitRatio: number, t: number): void; dispose(): void }`
  - `createTraffic(cars: readonly Car[]): Traffic`. `objects` is `[bodies, lights]` (named `STREET_NAMES.carBodies` and `STREET_NAMES.carLights`), or `[]` for an empty car list.

- [ ] **Step 1: Write the failing test**

In `tests/journey/traffic.test.ts`, add `createTraffic` and `Traffic` to the traffic import, add `STREET_NAMES` to a new lamps import, and append:

```ts
import { STREET_NAMES } from '../../app/journey/lamps'
```

(Merge it with the existing `lamps` import: `import { DARK_GLASS_HEX, STREET_LIGHT_LUMINANCE, STREET_NAMES } from '../../app/journey/lamps'`.)

```ts
function meshNamed(traffic: Traffic, name: string): THREE.InstancedMesh {
  const mesh = traffic.objects.find(object => object.name === name)
  if (!mesh) throw new Error(`missing mesh ${name}`)
  return mesh
}

const matrix = new THREE.Matrix4()
function positionOf(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixPosition(matrix)
}
function scaleOf(mesh: THREE.InstancedMesh, index: number): number {
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixScale(matrix).x
}

describe('createTraffic', () => {
  it('creates no objects for an empty car list, and update does nothing', () => {
    const traffic = createTraffic([])
    expect(traffic.objects).toEqual([])
    expect(() => traffic.update(0.5, 12)).not.toThrow()
    expect(() => traffic.dispose()).not.toThrow()
  })

  it('creates no objects under reduced motion, where the car count is 0', () => {
    expect(createTraffic(createCars(carCountFor(true, false))).objects).toEqual([])
    expect(createTraffic(createCars(carCountFor(true, true))).objects).toEqual([])
  })

  it('creates one body per car and four lights per car, culling off, two draw calls', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    expect(traffic.objects).toHaveLength(2)
    const bodies = meshNamed(traffic, STREET_NAMES.carBodies)
    const lights = meshNamed(traffic, STREET_NAMES.carLights)
    expect(bodies.count).toBe(12)
    expect(lights.count).toBe(48)
    expect(bodies.frustumCulled).toBe(false)
    expect(lights.frustumCulled).toBe(false)
    expect(createTraffic(createCars(CAR_COUNT_LOW_POWER)).objects[0]!.count).toBe(6)
    traffic.dispose()
  })

  it('puts a visible car body center at y -0.78 on its lane position', () => {
    const fixture = car(1, 50, 3)
    const traffic = createTraffic([fixture])
    traffic.update(1, 0)
    const bodies = meshNamed(traffic, STREET_NAMES.carBodies)
    const pose = carPoseAt(fixture, 0)
    const body = positionOf(bodies, 0)
    expect(body.y).toBeCloseTo(CAR_CENTER_Y, 6)
    expect(body.x).toBeCloseTo(pose.x, 6)
    expect(body.z).toBeCloseTo(pose.z, 6)
    expect(scaleOf(bodies, 0)).toBeCloseTo(1, 6)
    traffic.dispose()
  })

  it('places front lights ahead of the body center along travel and rear lights behind, in both lanes', () => {
    for (const lane of [1, -1] as const) {
      const fixture = car(lane, 50, 3)
      const traffic = createTraffic([fixture])
      traffic.update(1, 0)
      const bodies = meshNamed(traffic, STREET_NAMES.carBodies)
      const lights = meshNamed(traffic, STREET_NAMES.carLights)
      const body = positionOf(bodies, 0)
      const point = pathPointAt(50)
      const travel = new THREE.Vector3(lane * point.dirX, 0, lane * point.dirZ)
      CAR_LIGHT_OFFSETS.forEach((offset, k) => {
        const light = positionOf(lights, k)
        expect(light.y).toBeCloseTo(CAR_CENTER_Y, 6)
        const ahead = light.clone().sub(body).dot(travel)
        if (offset.kind === 'front') expect(ahead, `lane ${lane} light ${k}`).toBeGreaterThan(0.4)
        else expect(ahead, `lane ${lane} light ${k}`).toBeLessThan(-0.4)
      })
      traffic.dispose()
    }
  })

  it('hides a car on an interior waypoint and at both path ends, lights included', () => {
    for (const distance of [34, 60, 0]) {
      const traffic = createTraffic([car(1, distance, 3)])
      traffic.update(1, 0)
      expect(scaleOf(meshNamed(traffic, STREET_NAMES.carBodies), 0)).toBe(0)
      for (let k = 0; k < 4; k++) expect(scaleOf(meshNamed(traffic, STREET_NAMES.carLights), k)).toBe(0)
      traffic.dispose()
    }
  })

  it('moves the cars every update but rewrites colors only when the quantised ratio changes', () => {
    const traffic = createTraffic([car(1, 50, 3)])
    const bodies = meshNamed(traffic, STREET_NAMES.carBodies)
    const lights = meshNamed(traffic, STREET_NAMES.carLights)
    traffic.update(0.3, 0)
    const matrixVersion = bodies.instanceMatrix.version
    const colorVersion = lights.instanceColor!.version
    traffic.update(0.3, 1)
    expect(bodies.instanceMatrix.version).toBeGreaterThan(matrixVersion)
    expect(positionOf(bodies, 0).x).not.toBe(Number.NaN)
    expect(lights.instanceColor!.version).toBe(colorVersion)
    traffic.update(0.1, 2)
    expect(lights.instanceColor!.version).toBeGreaterThan(colorVersion)
    traffic.dispose()
  })

  it('colors lights by kind: unlit front lights show dark glass, rear lights keep their 20% glow', () => {
    const traffic = createTraffic([car(1, 50, 3)])
    traffic.update(0.05, 0)
    const lights = meshNamed(traffic, STREET_NAMES.carLights)
    const out = new THREE.Color()
    CAR_LIGHT_OFFSETS.forEach((offset, k) => {
      lights.getColorAt(k, out)
      const expected = carLightColor(offset.kind, 0.05, new THREE.Color())
      expect(out.r).toBeCloseTo(expected.r, 6)
      expect(out.g).toBeCloseTo(expected.g, 6)
      expect(out.b).toBeCloseTo(expected.b, 6)
    })
    traffic.dispose()
  })

  it('keeps each car body color from the palette entry it was created with', () => {
    const cars = createCars(CAR_COUNT_LOW_POWER)
    const traffic = createTraffic(cars)
    const bodies = meshNamed(traffic, STREET_NAMES.carBodies)
    const out = new THREE.Color()
    cars.forEach((c, i) => {
      bodies.getColorAt(i, out)
      expect(out.getHex()).toBe(new THREE.Color(c.bodyColor).getHex())
    })
    traffic.dispose()
  })

  it('does not touch matrices when there are no cars to move', () => {
    const traffic = createTraffic([])
    expect(() => { for (let t = 0; t < 5; t++) traffic.update(0.9, t) }).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/journey/traffic.test.ts`
Expected: FAIL. `createTraffic` is not exported.

- [ ] **Step 3: Implement the traffic meshes**

In `app/journey/traffic.ts`, change the lamps import to:

```ts
import { DARK_GLASS_HEX, lampIntensity, STREET_LIGHT_LUMINANCE, STREET_NAMES } from './lamps'
```

Append to the end of `app/journey/traffic.ts`:

```ts
const LIGHT_SIZE = { width: 0.08, height: 0.06, depth: 0.03 } as const
const RATIO_QUANTUM = 1e-3
const LIGHTS_PER_CAR = CAR_LIGHT_OFFSETS.length

export interface Traffic {
  // Car bodies, then car lights: two draw calls. Empty when there are no cars.
  readonly objects: readonly THREE.InstancedMesh[]
  update(windowLitRatio: number, t: number): void
  dispose(): void
}

// Module-level scratch objects: the per-frame writer reuses them. `pathPointAt` still returns one
// small object per car per frame, which is negligible next to the matrix work.
const matrix = new THREE.Matrix4()
const bodyPosition = new THREE.Vector3()
const lightOffset = new THREE.Vector3()
const bodyScale = new THREE.Vector3()
const bodyRotation = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)
const pose: CarPose = { x: 0, z: 0, yaw: 0, distance: 0, scale: 0 }
const scratchColor = new THREE.Color()

export function createTraffic(cars: readonly Car[]): Traffic {
  if (cars.length === 0) return { objects: [], update() {}, dispose() {} }

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.3 })
  bodyMaterial.name = 'journey-street-car-body'
  const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  lightMaterial.name = 'journey-street-car-light'
  const bodies = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CAR_SIZE.width, CAR_SIZE.height, CAR_SIZE.length), bodyMaterial, cars.length)
  const lights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(LIGHT_SIZE.width, LIGHT_SIZE.height, LIGHT_SIZE.depth), lightMaterial, cars.length * LIGHTS_PER_CAR)
  bodies.name = STREET_NAMES.carBodies
  lights.name = STREET_NAMES.carLights
  const objects = [bodies, lights] as const
  for (const mesh of objects) mesh.frustumCulled = false

  cars.forEach((car, i) => bodies.setColorAt(i, scratchColor.set(car.bodyColor)))
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true

  function writeLightColors(windowLitRatio: number) {
    for (let i = 0; i < cars.length; i++) {
      for (let k = 0; k < LIGHTS_PER_CAR; k++) {
        const light = CAR_LIGHT_OFFSETS[k]
        if (!light) continue
        lights.setColorAt(i * LIGHTS_PER_CAR + k, carLightColor(light.kind, windowLitRatio, scratchColor))
      }
    }
    if (lights.instanceColor) lights.instanceColor.needsUpdate = true
  }
  // Create the color attribute before the first render: three decides USE_INSTANCING_COLOR from it.
  writeLightColors(0)
  let lastKey = 0

  return {
    objects,
    update(windowLitRatio, t) {
      const key = Math.round(windowLitRatio / RATIO_QUANTUM)
      if (key !== lastKey) {
        lastKey = key
        writeLightColors(windowLitRatio)
      }
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]
        if (!car) continue
        carPoseAt(car, t, pose)
        bodyRotation.setFromAxisAngle(UP, pose.yaw)
        bodyScale.setScalar(pose.scale)
        bodyPosition.set(pose.x, CAR_CENTER_Y, pose.z)
        matrix.compose(bodyPosition, bodyRotation, bodyScale)
        bodies.setMatrixAt(i, matrix)
        for (let k = 0; k < LIGHTS_PER_CAR; k++) {
          const light = CAR_LIGHT_OFFSETS[k]
          if (!light) continue
          lightOffset.set(light.x, 0, light.z).applyQuaternion(bodyRotation).multiplyScalar(pose.scale).add(bodyPosition)
          matrix.compose(lightOffset, bodyRotation, bodyScale)
          lights.setMatrixAt(i * LIGHTS_PER_CAR + k, matrix)
        }
      }
      bodies.instanceMatrix.needsUpdate = true
      lights.instanceMatrix.needsUpdate = true
    },
    dispose() {
      for (const mesh of objects) {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/journey/traffic.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/journey/traffic.ts tests/journey/traffic.test.ts
git commit -m "feat: add instanced car bodies and lights with the per-frame writer"
```

---

### Task 7: Wire the street into the scene

**Files:**
- Modify: `app/journey/scene.ts`
- Modify: `tests/gpu/facade.spec.ts`

**Interfaces:**
- Consumes: `createLamps`, `LAMP_SPACING_FULL`, `LAMP_SPACING_LOW_POWER` (`lamps.ts`); `carCountFor`, `createCars`, `createTraffic` (`traffic.ts`).
- Produces: street objects in `scene.children` (names start with `journey-street-`), updated from `apply`.

- [ ] **Step 1: Update the GPU draw-call test first (it must fail)**

In `tests/gpu/facade.spec.ts`:

1. Under `const LANDMARK_DRAW_CALLS = 4` add:

```ts
// Street life (spec 07): posts, heads, pools and halos, plus car bodies and car lights unless reduced motion removes the cars.
const STREET_DRAW_CALLS = 6
const STREET_DRAW_CALLS_REDUCED = 4
```

2. In the `planeBatchCount` filter, change the name check from `object.name !== 'journey-contact-shadows'` to:

```ts
        object.name !== 'journey-contact-shadows' && !object.name.startsWith('journey-street-')
```

3. Replace the `expectedCalls` line:

```ts
    // City 07 adds four lamp draws on every tier and two car draws unless motion is reduced.
    const streetCalls = tier === 'reduced' ? STREET_DRAW_CALLS_REDUCED : STREET_DRAW_CALLS
    const expectedCalls = (lowPower ? [60, 28, 17] : [61, 29, 18]).map(calls => calls + (lowPower ? 0 : LANDMARK_DRAW_CALLS) + 1 + streetCalls)
```

(Keep the existing `// City 05 ...` and `// City 04 ...` comment lines above it.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:gpu -- facade.spec.ts`
Expected: FAIL. The `chapters, mid-transition and restore` tests report calls that are 6 (or 4) lower than expected, because the scene has no street yet.

- [ ] **Step 3: Wire the modules into `scene.ts`**

In `app/journey/scene.ts`:

1. Add imports in alphabetical position. After `import { damp, dampState, lerpLook } from './interpolate'` add:

```ts
import { createLamps, LAMP_SPACING_FULL, LAMP_SPACING_LOW_POWER } from './lamps'
```

After `import type { Tier } from './tier'` add:

```ts
import { carCountFor, createCars, createTraffic } from './traffic'
```

2. After the line `scene.add(placeOnPath(createCourtyard(), PLACES.courtyard, seg3.dirX, seg3.dirZ))` add:

```ts

  // Street life: lamps follow `lowPower` for count, cars follow reduced motion (none) and `lowPower`.
  const lamps = createLamps(lowPower ? LAMP_SPACING_LOW_POWER : LAMP_SPACING_FULL)
  const traffic = createTraffic(createCars(carCountFor(tier === 'reduced', lowPower)))
  scene.add(...lamps.objects, ...traffic.objects)
```

3. In `apply`, after the line `facade.uLit.value = state.windowLitRatio` add:

```ts
    lamps.update(state.windowLitRatio)
    traffic.update(state.windowLitRatio, lastTime)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:gpu -- facade.spec.ts`
Expected: PASS for all tier and `lowPower` combinations.

If the call count is off by a different amount, print `result.frames[0].calls` and subtract the old baseline. Posts, heads, pools and halos are 4 calls; bodies and lights are 2 more. A count 1 too high usually means the street meshes are not direct children of the scene. A count 2 too low on a non-reduced tier means `carCountFor` returned 0.

Run: `wc -l app/journey/scene.ts`
Expected: fewer than 800 lines.

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/journey/scene.ts tests/gpu/facade.spec.ts
git commit -m "feat: add lamps and traffic to the journey scene"
```

---

### Task 8: GPU checks for the street

**Files:**
- Create: `tests/gpu/street-probe.ts`
- Create: `tests/gpu/street.spec.ts`
- Modify: `tests/gpu/harness.ts`

**Interfaces:**
- Consumes: `createLamps`, `lampHeadPosition`, `lampPositions`, `LAMP_SPACING_FULL`, `LampField`, `STREET_NAME_PREFIX`, `STREET_NAMES` (`lamps.ts`); `createCars`, `createTraffic` (`traffic.ts`); `WAYPOINTS` (`path.ts`); `linearLuminance` (`window-look.ts`); `createTestRenderer` (`gpu-utils.ts`); the existing `window.cityGpu` harness.
- Produces: `window.cityGpu.probeStreetFog`, `probeStreetHeads`, `probeStreetPools`, `probeStreetHalo`, `probeTraffic`, `streetState`, `streetDrawCalls`.

- [ ] **Step 1: Write the failing spec**

Create `tests/gpu/street.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import * as THREE from 'three'
import { DARK_GLASS_HEX } from '../../app/journey/lamps'
import { linearLuminance } from '../../app/journey/window-look'

const TIERS = [['full', false], ['lite', true], ['reduced', false], ['reduced', true]] as const
const HALO_FOV = 40
const HALO_IMAGE = 400
// Half-intensity width of the falloff texture: smoothstep(0.5) = 0.5, so half the plane width.
const HALO_HALF_INTENSITY_WIDTH = 0.45
const BILLBOARD_DISTANCE = 4

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

for (const [tier, lowPower] of TIERS) {
  test(`${tier} lowPower=${lowPower}: no shader errors, the pinned object counts and at most 6 street draw calls (4 with no cars)`, async ({ page }) => {
    const result = await page.evaluate(({ tier, lowPower }) => {
      window.cityGpu.mountJourney({ tier, lowPower })
      const frames = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter }))
      const state = window.cityGpu.streetState()
      const calls = window.cityGpu.streetDrawCalls()
      window.cityGpu.dispose()
      return { frames, state, calls }
    }, { tier, lowPower })
    for (const frame of result.frames) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
    }
    expect(result.calls.shaderError).toBeNull()
    expect(result.calls.glError).toBe(0)
    const lamps = lowPower ? 8 : 14
    const cars = tier === 'reduced' ? 0 : lowPower ? 6 : 12
    for (const part of [result.state.posts, result.state.heads, result.state.halos, result.state.pools]) {
      expect(part?.count).toBe(lamps)
      expect(part?.frustumCulled).toBe(false)
    }
    expect(result.state.halos?.renderOrder).toBe(3)
    expect(result.state.pools?.renderOrder).toBe(1.5)
    if (cars === 0) {
      expect(result.state.carBodies).toBeNull()
      expect(result.state.carLights).toBeNull()
      expect(result.calls.calls).toBe(4)
    } else {
      expect(result.state.carBodies?.count).toBe(cars)
      expect(result.state.carLights?.count).toBe(cars * 4)
      expect(result.calls.calls).toBe(6)
    }
  })
}

test('at the light-theme intro no halo or pool glows; at the dark-theme about chapter every one does', async ({ page }) => {
  const result = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: false, initialDark: false })
    window.cityGpu.renderJourney({ chapter: 0, frames: 2 })
    const day = window.cityGpu.streetState()
    window.cityGpu.setJourneyTheme(true, { animate: false })
    window.cityGpu.renderJourney({ chapter: 3, frames: 2 })
    const night = window.cityGpu.streetState()
    window.cityGpu.dispose()
    return { day, night }
  })
  expect(Math.max(...result.day.halos!.colors)).toBe(0)
  expect(Math.max(...result.day.pools!.colors)).toBe(0)
  const triples = (colors: number[]) => Array.from({ length: colors.length / 3 }, (_, i) => Math.max(...colors.slice(3 * i, 3 * i + 3)))
  for (const peak of [...triples(result.night.halos!.colors), ...triples(result.night.pools!.colors)]) expect(peak).toBeGreaterThan(0.4)
})

for (const density of [0.045, 0.065]) {
  for (const distance of [5, 20, 40]) {
    test(`fog ${density} at ${distance} units: a switched-off halo and pool add nothing`, async ({ page }) => {
      const result = await page.evaluate(input => window.cityGpu.probeStreetFog(input), { density, distance, ratio: 0 })
      expect(result.shaderError).toBeNull()
      expect(result.glError).toBe(0)
      expect(result.maxDifference).toBeLessThanOrEqual(1)
    })
  }
}

test('a lit halo fades with distance and vanishes once the fog factor passes 0.99', async ({ page }) => {
  const density = 0.065
  const gains = []
  for (const distance of [5, 20, 40]) {
    const result = await page.evaluate(input => window.cityGpu.probeStreetFog(input), { density, distance, ratio: 0.4 })
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
    gains.push(result.centerGain)
  }
  expect(gains[0]).toBeGreaterThan(gains[1]!)
  expect(gains[1]).toBeGreaterThan(gains[2]!)
  expect(1 - Math.exp(-((density * 40) ** 2))).toBeGreaterThan(0.99)
  expect(gains[2]).toBeLessThan(1 / 255)
})

test('the halo faces the camera: its width barely changes as the camera circles the lamp head', async ({ page }) => {
  const widths: number[] = []
  const expected = (HALO_HALF_INTENSITY_WIDTH / (2 * BILLBOARD_DISTANCE * Math.tan((HALO_FOV * Math.PI) / 360))) * HALO_IMAGE
  for (const yaw of [0, 45, 90]) {
    const result = await page.evaluate(input => window.cityGpu.probeStreetHalo(input), { yawDegrees: yaw, distance: BILLBOARD_DISTANCE })
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
    expect(Math.abs(result.centerColumn - HALO_IMAGE / 2)).toBeLessThanOrEqual(2)
    expect(Math.abs(result.widthPx - expected) / expected).toBeLessThan(0.08)
    widths.push(result.widthPx)
  }
  expect((Math.max(...widths) - Math.min(...widths)) / Math.max(...widths)).toBeLessThan(0.05)
})

test('head brightness: at least luminance 2.0 when lit, dark glass by day, a mix at ratio 0.25', async ({ page }) => {
  const lit = await page.evaluate(() => window.cityGpu.probeStreetHeads(0.4))
  const day = await page.evaluate(() => window.cityGpu.probeStreetHeads(0.05))
  const dusk = await page.evaluate(() => window.cityGpu.probeStreetHeads(0.25))
  for (const result of [lit, day, dusk]) {
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
  }
  const glass = new THREE.Color(DARK_GLASS_HEX)
  const glassLuminance = linearLuminance([glass.r, glass.g, glass.b])
  for (const value of lit.luminance) expect(value).toBeGreaterThanOrEqual(2.0)
  for (const value of day.luminance) expect(Math.abs(value - glassLuminance)).toBeLessThan(1e-3)
  expect(dusk.luminance.some(value => value >= 2.0)).toBe(true)
  expect(dusk.luminance.some(value => value < 0.5)).toBe(true)
})

test('pools: a road pixel under a lamp is brighter than one 4 units away when lit, and equal by day', async ({ page }) => {
  const lit = await page.evaluate(() => window.cityGpu.probeStreetPools(0.4))
  const day = await page.evaluate(() => window.cityGpu.probeStreetPools(0.05))
  for (const result of [lit, day]) {
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
  }
  expect(lit.under).toBeGreaterThan(lit.away + 0.2)
  expect(Math.abs(day.under - day.away)).toBeLessThanOrEqual(2 / 255)
})

test('traffic moves between t = 0 and t = 0.75, and no car is visible next to a corner at any of 80 times', async ({ page }) => {
  const times = Array.from({ length: 80 }, (_, i) => i * 0.75)
  const result = await page.evaluate(input => window.cityGpu.probeTraffic(input), { cars: 12, times })
  expect(result.shaderError).toBeNull()
  expect(result.glError).toBe(0)
  expect(result.objects).toBe(2)
  expect(result.lit[0]).toBeGreaterThan(0)
  expect(result.changed).toBeGreaterThan(0)
  expect(result.nearCorner).toBe(0)
})

test('with no cars (reduced motion) nothing is drawn and two renders match', async ({ page }) => {
  const result = await page.evaluate(() => window.cityGpu.probeTraffic({ cars: 0, times: [0, 2] }))
  expect(result.objects).toBe(0)
  expect(result.lit).toEqual([0, 0])
  expect(result.changed).toBe(0)
})

for (const [tier, lowPower] of TIERS) {
  test(`${tier} lowPower=${lowPower}: lamps, halos, pools and the falloff texture survive context loss`, async ({ page }) => {
    const result = await page.evaluate(async ({ tier, lowPower }) => {
      window.cityGpu.mountJourney({ tier, lowPower })
      window.cityGpu.renderJourney({ chapter: 3 })
      const before = window.cityGpu.readFrame()
      const restore = await window.cityGpu.loseAndRestore()
      const after = window.cityGpu.readFrame()
      const state = window.cityGpu.streetState()
      window.cityGpu.dispose()
      return { before, after, restore, state }
    }, { tier, lowPower })
    expect(result.restore.shaderError).toBeNull()
    expect(result.restore.glError).toBe(0)
    expect(result.state.halos?.count).toBe(lowPower ? 8 : 14)
    const maxDifference = result.before.reduce((max, byte, index) => Math.max(max, Math.abs(byte - result.after[index]!)), 0)
    expect(maxDifference).toBeLessThanOrEqual(1)
  })
}
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npm run test:gpu -- street.spec.ts`
Expected: FAIL. Every test that calls a probe reports `window.cityGpu.probeStreet... is not a function`.

- [ ] **Step 3: Write the probes**

Create `tests/gpu/street-probe.ts`:

```ts
import * as THREE from 'three'
import {
  createLamps, lampHeadPosition, lampPositions, LAMP_SPACING_FULL, type LampField, STREET_NAME_PREFIX, STREET_NAMES,
} from '../../app/journey/lamps'
import { WAYPOINTS } from '../../app/journey/path'
import { createCars, createTraffic } from '../../app/journey/traffic'
import { linearLuminance } from '../../app/journey/window-look'
import { createTestRenderer, diagnostics } from './gpu-utils'

type Part = 'posts' | 'heads' | 'halos' | 'pools'
type Pixels = Float32Array | Uint8Array

// Top-down map of the whole street: x from -36 to 8, z from -74 to 14, 12 pixels per unit.
const MAP = { left: -36, right: 8, centerZ: -30, halfDepth: 44, pixelsPerUnit: 12 } as const
const MAP_WIDTH = (MAP.right - MAP.left) * MAP.pixelsPerUnit
const MAP_HEIGHT = 2 * MAP.halfDepth * MAP.pixelsPerUnit
const TRAFFIC_PIXELS_PER_UNIT = 8
const CORNER_RADIUS = 2.2
const LIT_BYTE = 2
const POOL_AWAY = 4

function topDownCamera(): THREE.OrthographicCamera {
  const centerX = (MAP.left + MAP.right) / 2
  const camera = new THREE.OrthographicCamera(MAP.left, MAP.right, MAP.halfDepth, -MAP.halfDepth, 0.1, 50)
  camera.position.set(centerX, 10, MAP.centerZ)
  camera.up.set(0, 0, -1)
  camera.lookAt(centerX, 0, MAP.centerZ)
  return camera
}

// Pixel of a world point in the top-down map. Row 0 is the bottom, so it is the largest z.
function mapPixel(x: number, z: number, pixelsPerUnit: number = MAP.pixelsPerUnit): { col: number; row: number } {
  return {
    col: Math.floor((x - MAP.left) * pixelsPerUnit),
    row: Math.floor((MAP.centerZ + MAP.halfDepth - z) * pixelsPerUnit),
  }
}

function partOf(mesh: THREE.Object3D): Part | null {
  for (const part of ['posts', 'heads', 'halos', 'pools'] as const) if (STREET_NAMES[part] === mesh.name) return part
  return null
}

interface Shot {
  width: number
  height: number
  camera: THREE.Camera
  ratio: number
  show: readonly Part[]
  fogDensity?: number
  // Float targets keep HDR head colors. Additive blending needs 8-bit targets: 32-bit float blending needs an extension.
  float?: boolean
  // Collapse every instance except this lamp's, so a neighbouring halo cannot sit behind it on the view axis.
  onlyLamp?: number
}

// Renders the real lamp field alone, into a linear target with no tone mapping, and hands the pixels to `read`.
function renderShot<T>(shot: Shot, read: (pixels: Pixels, field: LampField) => T): { value: T; shaderError: string | null; glError: number } {
  const gpu = createTestRenderer({ width: shot.width, height: shot.height })
  const { renderer, recorder } = gpu
  const target = new THREE.WebGLRenderTarget(shot.width, shot.height, shot.float
    ? { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false }
    : { depthBuffer: true, stencilBuffer: false })
  const field = createLamps(LAMP_SPACING_FULL)
  const scene = new THREE.Scene()
  if (shot.fogDensity !== undefined) scene.fog = new THREE.FogExp2(0x808080, shot.fogDensity)
  field.update(shot.ratio)
  const collapsed = new THREE.Matrix4().makeScale(0, 0, 0)
  for (const mesh of field.objects) {
    if (shot.onlyLamp !== undefined) {
      for (let i = 0; i < mesh.count; i++) if (i !== shot.onlyLamp) mesh.setMatrixAt(i, collapsed)
      mesh.instanceMatrix.needsUpdate = true
    }
    const part = partOf(mesh)
    mesh.visible = part !== null && shot.show.includes(part)
    scene.add(mesh)
  }
  renderer.setPixelRatio(1)
  renderer.setSize(shot.width, shot.height, false)
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  renderer.setClearColor(0x000000, 1)
  target.texture.colorSpace = THREE.LinearSRGBColorSpace
  try {
    if (shot.float && !renderer.getContext().getExtension('EXT_color_buffer_float')) {
      throw new Error('Street GPU tests require readable float color targets')
    }
    renderer.setRenderTarget(target)
    renderer.render(scene, shot.camera)
    recorder.assertClean()
    const pixels: Pixels = shot.float ? new Float32Array(shot.width * shot.height * 4) : new Uint8Array(shot.width * shot.height * 4)
    renderer.readRenderTargetPixels(target, 0, 0, shot.width, shot.height, pixels)
    return { value: read(pixels, field), shaderError: recorder.error?.message ?? null, glError: renderer.getContext().getError() }
  } finally {
    renderer.setRenderTarget(null)
    target.dispose()
    field.dispose()
    gpu.dispose()
  }
}

// Spec test 9b. A camera `distance` units in front of lamp 0's head, in fog, with and without the halo and pool meshes.
export function probeStreetFog(input: { density: number; distance: number; ratio: number }) {
  const size = 64
  const head = lampHeadPosition(lampPositions(LAMP_SPACING_FULL)[0]!)
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)
  camera.position.set(head.x, head.y, head.z + input.distance)
  camera.lookAt(head.x, head.y, head.z)
  camera.updateMatrixWorld()
  const shot = { width: size, height: size, camera, ratio: input.ratio, fogDensity: input.density, onlyLamp: 0 }
  const withLights = renderShot({ ...shot, show: ['halos', 'pools'] }, pixels => Uint8Array.from(pixels as Uint8Array))
  const without = renderShot({ ...shot, show: [] }, pixels => Uint8Array.from(pixels as Uint8Array))
  let maxDifference = 0
  let centerGain = 0
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const i = 4 * (row * size + col)
      for (let c = 0; c < 3; c++) maxDifference = Math.max(maxDifference, Math.abs(withLights.value[i + c]! - without.value[i + c]!))
      if (Math.abs(row - size / 2) <= 1 && Math.abs(col - size / 2) <= 1) {
        centerGain = Math.max(centerGain, (withLights.value[i]! - without.value[i]!) / 255)
      }
    }
  }
  return {
    maxDifference, centerGain,
    shaderError: withLights.shaderError ?? without.shaderError,
    glError: withLights.glError || without.glError,
  }
}

// Spec test 11. Linear luminance of every lamp head's center pixel, looking straight down.
export function probeStreetHeads(ratio: number) {
  const result = renderShot({ width: MAP_WIDTH, height: MAP_HEIGHT, camera: topDownCamera(), ratio, show: ['heads'], float: true },
    (pixels, field) => field.lamps.map(lamp => {
      const head = lampHeadPosition(lamp)
      const { col, row } = mapPixel(head.x, head.z)
      const i = 4 * (row * MAP_WIDTH + col)
      return linearLuminance([pixels[i]!, pixels[i + 1]!, pixels[i + 2]!])
    }))
  return { luminance: result.value, shaderError: result.shaderError, glError: result.glError }
}

// Spec test 12. The pool of lamp 0, at its center and POOL_AWAY units further along the road.
export function probeStreetPools(ratio: number) {
  const lamp = lampPositions(LAMP_SPACING_FULL)[0]!
  const centerX = lamp.x + 1.2 * Math.cos(lamp.armAngle)
  const centerZ = lamp.z - 1.2 * Math.sin(lamp.armAngle)
  // Lamp 0 stands on the first leg, which runs toward -Z.
  const result = renderShot({ width: MAP_WIDTH, height: MAP_HEIGHT, camera: topDownCamera(), ratio, show: ['pools'] }, pixels => {
    const red = (x: number, z: number) => {
      const { col, row } = mapPixel(x, z)
      return pixels[4 * (row * MAP_WIDTH + col)]! / 255
    }
    return { under: red(centerX, centerZ), away: red(centerX, centerZ - POOL_AWAY) }
  })
  return { ...result.value, shaderError: result.shaderError, glError: result.glError }
}

// Spec test 10. Camera `distance` from lamp 0's head at a yaw around it; the halo's half-intensity width along the center row.
export function probeStreetHalo(input: { yawDegrees: number; distance: number }) {
  const size = 400
  const head = lampHeadPosition(lampPositions(LAMP_SPACING_FULL)[0]!)
  const yaw = (input.yawDegrees * Math.PI) / 180
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)
  camera.position.set(head.x + input.distance * Math.sin(yaw), head.y, head.z + input.distance * Math.cos(yaw))
  camera.lookAt(head.x, head.y, head.z)
  camera.updateMatrixWorld()
  // Only lamp 0: at yaw 0 and 90 another lamp's halo would sit exactly behind it on the view axis.
  const result = renderShot({ width: size, height: size, camera, ratio: 1, show: ['halos'], onlyLamp: 0 }, pixels => {
    const row = size / 2
    const red = (col: number) => pixels[4 * (row * size + col)]!
    let peak = 0
    for (let col = 0; col < size; col++) peak = Math.max(peak, red(col))
    const center = size / 2
    let left = center
    let right = center
    while (left > 0 && red(left - 1) >= peak / 2) left--
    while (right < size - 1 && red(right + 1) >= peak / 2) right++
    return { widthPx: right - left + 1, centerColumn: (left + right + 1) / 2, peak }
  })
  return { ...result.value, shaderError: result.shaderError, glError: result.glError }
}

// Spec test 14. Top-down renders of the traffic alone at each time. Bodies are drawn unlit so only their instance color shows.
export function probeTraffic(input: { cars: number; times: readonly number[] }) {
  const width = (MAP.right - MAP.left) * TRAFFIC_PIXELS_PER_UNIT
  const height = 2 * MAP.halfDepth * TRAFFIC_PIXELS_PER_UNIT
  const gpu = createTestRenderer({ width, height })
  const { renderer, recorder } = gpu
  const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, stencilBuffer: false })
  const traffic = createTraffic(createCars(input.cars))
  const flat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const scene = new THREE.Scene()
  for (const mesh of traffic.objects) {
    if (mesh.name === STREET_NAMES.carBodies) {
      ;(mesh.material as THREE.Material).dispose()
      mesh.material = flat
    } else {
      mesh.visible = false
    }
    scene.add(mesh)
  }
  const camera = topDownCamera()
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  renderer.setClearColor(0x000000, 1)
  target.texture.colorSpace = THREE.LinearSRGBColorSpace
  const corners = WAYPOINTS.slice(1, -1)
  try {
    const masks: Uint8Array[] = []
    let nearCorner = 0
    for (const t of input.times) {
      traffic.update(1, t)
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      recorder.assertClean()
      const pixels = new Uint8Array(width * height * 4)
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
      const mask = new Uint8Array(width * height)
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const i = 4 * (row * width + col)
          if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) < LIT_BYTE) continue
          mask[row * width + col] = 1
          const x = MAP.left + (col + 0.5) / TRAFFIC_PIXELS_PER_UNIT
          const z = MAP.centerZ + MAP.halfDepth - (row + 0.5) / TRAFFIC_PIXELS_PER_UNIT
          if (corners.some(corner => Math.hypot(x - corner.x, z - corner.z) <= CORNER_RADIUS)) nearCorner++
        }
      }
      masks.push(mask)
    }
    let changed = 0
    const [first, second] = masks
    if (first && second) for (let i = 0; i < first.length; i++) if (first[i] !== second[i]) changed++
    return {
      objects: traffic.objects.length,
      lit: masks.map(mask => mask.reduce((sum, value) => sum + value, 0)),
      changed, nearCorner,
      shaderError: recorder.error?.message ?? null,
      glError: renderer.getContext().getError(),
    }
  } finally {
    renderer.setRenderTarget(null)
    target.dispose()
    flat.dispose()
    traffic.dispose()
    gpu.dispose()
  }
}

// The street meshes in the mounted journey: counts, culling, render order and instance colors.
export function streetState() {
  const { scene } = window.cityGpu.getJourneyContext()
  const read = (name: string) => {
    const mesh = scene.getObjectByName(name) as THREE.InstancedMesh | undefined
    if (!mesh) return null
    return {
      count: mesh.count, frustumCulled: mesh.frustumCulled, renderOrder: mesh.renderOrder,
      colors: Array.from(mesh.instanceColor?.array ?? []),
    }
  }
  return {
    posts: read(STREET_NAMES.posts), heads: read(STREET_NAMES.heads), halos: read(STREET_NAMES.halos),
    pools: read(STREET_NAMES.pools), carBodies: read(STREET_NAMES.carBodies), carLights: read(STREET_NAMES.carLights),
  }
}

// Like contactShadowDrawCalls: hide everything except the street meshes and count direct-path draw calls.
export function streetDrawCalls() {
  const { scene, camera, renderer } = window.cityGpu.getJourneyContext()
  const hidden: THREE.Object3D[] = []
  for (const child of scene.children) {
    if (child.name.startsWith(STREET_NAME_PREFIX) || !child.visible) continue
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
    return { calls: renderer.info.render.calls, shaderError: base.shaderError, glError: base.glError }
  } finally {
    renderer.info.autoReset = autoReset
    for (const object of hidden) object.visible = true
  }
}
```

- [ ] **Step 4: Register the probes in the harness**

In `tests/gpu/harness.ts`:

1. Add after the `import { skyProbe } from './sky-probe'` line:

```ts
import { probeStreetFog, probeStreetHalo, probeStreetHeads, probeStreetPools, probeTraffic, streetDrawCalls, streetState } from './street-probe'
```

2. In the `cityGpu` object, after `contactShadowFrameDelta,` add:

```ts
  probeStreetFog,
  probeStreetHeads,
  probeStreetPools,
  probeStreetHalo,
  probeTraffic,
  streetState,
  streetDrawCalls,
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `npm run test:gpu -- street.spec.ts`
Expected: PASS.

If a probe test fails, check these in order:

- `probeStreetHeads` returns 0 luminance for every lamp: the head center pixel is outside the sphere. Print `mapPixel` for lamp 0 and compare with `MAP`. The row index is counted from the bottom.
- `probeStreetFog` `maxDifference` is above 1 at intensity 0: the fog fragment patch did not apply, or the halo texture is multiplied after the fog line. Check that the shader contains `1.0 - fogFactor`.
- `probeStreetHalo` width differs between yaws: the billboard patch did not apply. A fixed (non-billboard) halo narrows with `cos(yaw)`.
- `probeTraffic` `nearCorner` is above 0: check `cornerScale` in `traffic.ts` and that the writer scales the lights as well as the body.

Do not loosen a tolerance until the cause is known.

Run: `npm run test:gpu`
Expected: the whole suite passes. If a failure appears only in a file this task did not touch, run that file alone with the machine awake and record the result (the repo has a history of sleep-induced failures).

- [ ] **Step 6: Commit**

```bash
git add tests/gpu/street-probe.ts tests/gpu/street.spec.ts tests/gpu/harness.ts
git commit -m "test: gpu checks for street lamps, fog, billboards, traffic and context restore"
```

---

### Task 9: Final acceptance

**Files:** none new. This task runs every check, then hands off.

- [ ] **Step 1: Run the automated verification**

**Automated verification:** run each command from `repos/portfolio`. All must pass.

- [ ] `npm test`
- [ ] `npm run test:gpu`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `wc -l app/journey/scene.ts` shows fewer than 800 lines.

If `npm run test:gpu` fails only on tests that already failed on `master` (for example sleep-induced failures from the repo history), rerun those spec files alone with the machine awake. Record any remaining failure with its output in the handoff. Do not mark this step passed with a failing test.

- [ ] **Step 2: Confirm spec coverage**

Confirm each line, with the test that proves it:

- 14 lamps (7 per side) on `full` and 8 (4 per side) on `lowPower`, pinned from the real path; lamps skip footprints, corner blocks and other road legs; the fixture at distance 59.5 is rejected: `tests/journey/lamps.test.ts` (`lampPositions`).
- Lamp geometry (arm angle, head position, post base `y = -1`, head `y = 1.4`): `tests/journey/lamps.test.ts` (`armAngleFor and lampHeadPosition`).
- Lamps switch one by one, all on at 0.40, off at or below 0.15, monotonic lit count: `tests/journey/lamps.test.ts` (`lampThreshold and lampIntensity`).
- Warm lamp, front and rear gains reach luminance 2.3: `tests/journey/lamps.test.ts` (`light gains`).
- Dirty check writes once per quantised ratio: `tests/journey/lamps.test.ts` (`rewrites colors only when the quantised ratio changes`).
- Cars wrap, stay in lane, move in opposite directions, flip heading, are precise at `t = 1e6`: `tests/journey/traffic.test.ts` (`carPoseAt`).
- Corner scale 0 within 2.5 and 1 beyond 3.5: `tests/journey/traffic.test.ts` (`cornerScale`), and no pixel near a corner in `tests/gpu/street.spec.ts` (`traffic moves...`).
- Front lights ahead and rear lights behind the body center, body center `y = -0.78`: `tests/journey/traffic.test.ts` (`createTraffic`).
- No cars under reduced motion: `tests/journey/traffic.test.ts` and the tier loop in `tests/gpu/street.spec.ts`.
- Shader errors, counts, and draw calls (6, or 4 without cars): `tests/gpu/street.spec.ts` (tier loop) and `tests/gpu/facade.spec.ts`.
- Fog on additive lights (zero when off, fades with distance): `tests/gpu/street.spec.ts` (`fog ...`, `a lit halo fades...`).
- Billboard width: `tests/gpu/street.spec.ts` (`the halo faces the camera`).
- Head brightness, pools, day versus night: `tests/gpu/street.spec.ts` (`head brightness`, `pools`, `at the light-theme intro ...`).
- Context restore: `tests/gpu/street.spec.ts` (`survive context loss`).

- [ ] **Step 3: Hand off the manual verification list**

**Manual verification:** these checks need a person and a device. Do not mark them done. List them in the final message as unconfirmed.

- [ ] Screenshots at all four chapters plus one mid-transition frame, desktop and iPhone 14 Pro Max emulation, light and dark theme, plus one frame halfway through a theme blend (`themeMix` 0.5). Check that the lamps switch on one by one as the dark theme scrolls from `intro` to `about`, not all together.
- [ ] Scrub the camera past a lamp at 3.3 units. Check there is no clipping through the post and that the halo is not a huge bright disc.
- [ ] Look for z-fighting between the light pools, the road center line, and the contact shadows at 50 to 100 units from the camera.
- [ ] Watch the traffic for at least a minute at each chapter. Check that cars stay in their lanes, none visibly drives through a building at a corner, and none appears or vanishes beside the lens at the start of the path. If a car passing 1.5 units from the camera is intrusive, widen the lane offset to 1.9 (the spec's fallback).
- [ ] On the `lowPower` build without bloom, check the red rear lights (gain about 10) do not look blown out. If they do, reduce the `lowPower` gains to 1.5 as the spec suggests.
- [ ] Render cost per shared conventions, section 8: uncapped 10-second loop with `gl.readPixels` sync, chapters 0, 2, and 3, three runs each on the commit before and after, compare medians. Budget +0.4 ms on the named reference desktop and +0.4 ms on a physical iPhone. Name the devices.
- [ ] Physical iPhone check of halo overdraw when a lamp is close to the lens, and of context-loss recovery.
- [ ] Decide whether 14 generic lamps feel sparse. The spec's fallback is spacing 4 (about 20 lamps) in `LAMP_SPACING_FULL`.

- [ ] **Step 4: Report**

Report to the user: the branch name, the commit list, the automated results (counts, any failures verbatim), the manual checklist above marked unconfirmed, and the two deliberate deviations that change behavior (one speed per lane, cars hidden near the path ends). Then ask whether to merge using `superpowers:finishing-a-development-branch`.

---

## Self-Review

- **Spec coverage.**
  - Goals 1 to 3 and the success criteria: lamp placement and golden counts (Task 3), switching (Tasks 3 and 4), halos and pools with day/night behavior (Tasks 4 and 8), two-lane traffic with corner hiding and reduced motion (Tasks 5, 6, 8), the draw-call and cost budget (Tasks 7, 8, 9).
  - Modules: `falloff-texture.ts` (Task 1), `lamps.ts` (Tasks 3, 4), `traffic.ts` (Tasks 5, 6); `scene.ts` gains a few lines (Task 7); `attenuateAdditiveFog` in `shader-utils.ts` (Task 2).
  - Spec unit tests 1 to 8 and 6b: Tasks 3 to 6. GPU tests 9 to 15: Task 8 (9 in the tier loop, 9b in the fog tests, 10 billboard, 11 brightness, 12 pools, 13 in the tier loop plus `facade.spec.ts`, 14 traffic, 15 context restore).
  - Non-goals respected: no pedestrians, no real lights, the market's two lamps are untouched, no road reflections.
- **Deviations from the spec, each deliberate.**
  1. **One speed per lane, not per car.** The spec says speed is per car in 2.5 to 5.5, which lets a fast car drive through a slow one in the same lane. Each lane now has one speed inside that range. Both lanes still differ from each other. Reverse this by drawing the speed inside the car loop, at the cost of overlap.
  2. **Cars scale to 0 within 4 units of either path end.** The spec only hides cars at interior waypoints. The camera sits at distance 0 in chapter 0, so a wrap would pop a car beside the lens.
  3. `Lamp` has an extra `distance` field.
  4. `createTraffic` takes a car list so tests can place a car exactly. The scene passes `createCars(carCountFor(...))`.
  5. The horizontal "within 0.01" arm-tip check, because the head sits 0.025 above the arm center line.
  6. Import path `three/examples/jsm/utils/BufferGeometryUtils.js` instead of `three/addons/...`, matching `post.ts`.
- **Placeholder scan.** No TBD or "handle edge cases" steps. Every code step shows code. The troubleshooting notes in Tasks 4 and 8 name concrete checks.
- **Type consistency.** `Lamp`, `LampField`, `createLamps`, `lampPositions`, `lampHeadPosition`, `lampIntensity`, `lampThreshold`, `headColor`, `glowColor`, `STREET_NAMES` (keys `posts`, `heads`, `halos`, `pools`, `carBodies`, `carLights`), `STREET_NAME_PREFIX`, `POOL_RENDER_ORDER`, `HALO_RENDER_ORDER`, `Car`, `CarPose`, `carPoseAt`, `cornerScale`, `edgeScale`, `visibilityScale`, `CAR_LIGHT_OFFSETS`, `carLightColor`, `carLightIntensity`, `carCountFor`, `createCars`, `createTraffic`, `Traffic`, `attenuateAdditiveFog`, `createFalloffTexture`, `radialFalloffPixels`, `FALLOFF_TEXTURE_SIZE` are named identically in every task that uses them. Harness probe names (`probeStreetFog`, `probeStreetHeads`, `probeStreetPools`, `probeStreetHalo`, `probeTraffic`, `streetState`, `streetDrawCalls`) match between `street-probe.ts`, `harness.ts` and `street.spec.ts`.
- **Review Focus mapping.** Item 1 (same-lane overlap): Task 5 tests. Item 2 (path ends): Tasks 5 and 6 tests. Item 3 (ratio falls): Tasks 3 and 4 tests. Item 4 (halo size): Task 4 test. Item 5 (reduced motion): Task 6 and Task 8 tests.
