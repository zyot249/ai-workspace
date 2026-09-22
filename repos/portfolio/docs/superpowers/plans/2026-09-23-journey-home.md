# Journey Home Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the portfolio home page into a scroll-driven four-chapter journey with a fixed Three.js morphing blob behind HTML content.

**Architecture:** Pure TypeScript modules (`tier`, `progress`, `stops`, `interpolate`) hold all logic and are unit tested with Vitest. `scene.ts` wraps Three.js with no Vue code. A client-only Vue component (`JourneyCanvas.client.vue`) owns the render loop and lifecycle. A composable (`useJourneyProgress`) turns scroll position into `{ chapter, progress }`, which drives the scene.

**Tech Stack:** Nuxt 4, Vue 3.5, TypeScript (strict, `noUncheckedIndexedAccess`), Tailwind CSS v3, `three` (0.186.x), Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-23-journey-home-design.md`

## Global Constraints

- All paths are relative to `repos/portfolio/`. Run every command from that directory. The git root is the parent `ai-workspace` repo.
- Commit messages: plain imperative sentence, matching existing history (for example `Add project detail page`). **No `Co-Authored-By` trailer** (user preference).
- 3D applies to the home page only. `/projects/*` and `/about` must not change.
- No GSAP, no Lenis, no TresJS. Only new runtime dependency: `three`.
- Tier order: no WebGL → `none`; reduced motion → `reduced`; coarse pointer or width < 768 → `lite`; else `full`.
- Pixel ratio cap: 2 (`full`, `reduced`), 1.5 (`lite`). Blob detail: 64 (`full`, `reduced`), 24 (`lite`).
- Particles (800) and mouse parallax: `full` tier only.
- Damping factor: 0.08.
- Canvas: `fixed inset-0 z-0`, `aria-hidden="true"`, `pointer-events: none`. Page content `relative z-10`.
- Scene failure never breaks the page: catch, `console.warn` once, fall back to the `none` tier.
- TypeScript runs with `noUncheckedIndexedAccess: true`. Array index reads return `T | undefined`. Handle it; do not disable the flag.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `vitest.config.ts` | Create | Vitest config, node environment, `tests/**/*.test.ts` |
| `app/journey/tier.ts` | Create | `pickTier()` |
| `app/journey/progress.ts` | Create | `computeProgress()` |
| `app/journey/stops.ts` | Create | `Stop` types and `STOPS` data |
| `app/journey/interpolate.ts` | Create | `easeInOut`, `lerp`, `lerpStop`, `damp`, `dampState` |
| `app/journey/scene.ts` | Create | Three.js scene factory `createJourneyScene()` |
| `app/composables/useJourneyProgress.ts` | Create | Scroll → reactive `{ chapter, progress }` |
| `app/components/JourneyChapter.vue` | Create | Full-height chapter section wrapper |
| `app/components/JourneyCanvas.client.vue` | Create | Canvas, tier selection, render loop, lifecycle |
| `tests/journey/tier.test.ts` | Create | Tests for `pickTier` |
| `tests/journey/progress.test.ts` | Create | Tests for `computeProgress` |
| `tests/journey/interpolate.test.ts` | Create | Tests for stops data and interpolation |
| `app/components/Hero.vue` | Modify | Add `transparent` prop |
| `app/app.vue` | Modify | `Nav` and `Footer` above canvas |
| `app/pages/index.vue` | Modify | Four chapters plus canvas |
| `package.json` | Modify | Dependencies and `test` script |

---

### Task 1: Vitest setup and tier selection

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `app/journey/tier.ts`
- Test: `tests/journey/tier.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type Tier = 'full' | 'lite' | 'reduced' | 'none'
  export interface TierInput { webgl: boolean; reducedMotion: boolean; coarsePointer: boolean; width: number }
  export const LITE_MAX_WIDTH = 768
  export function pickTier(input: TierInput): Tier
  ```

- [ ] **Step 1: Install Vitest and add the test script**

Run:
```bash
npm install -D vitest@^5
npm pkg set scripts.test="vitest run"
```
Expected: `package.json` has `"vitest"` in `devDependencies` and `"test": "vitest run"` in `scripts`.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 3: Write the failing test**

Create `tests/journey/tier.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LITE_MAX_WIDTH, pickTier, type TierInput } from '../../app/journey/tier'

const desktop: TierInput = { webgl: true, reducedMotion: false, coarsePointer: false, width: 1440 }

describe('pickTier', () => {
  it('returns full on a capable desktop', () => {
    expect(pickTier(desktop)).toBe('full')
  })

  it('returns none without WebGL, regardless of other flags', () => {
    expect(pickTier({ webgl: false, reducedMotion: true, coarsePointer: true, width: 320 })).toBe('none')
  })

  it('returns reduced when reduced motion is set, even on a small touch device', () => {
    expect(pickTier({ ...desktop, reducedMotion: true, coarsePointer: true, width: 320 })).toBe('reduced')
  })

  it('returns lite for a coarse pointer on a wide screen', () => {
    expect(pickTier({ ...desktop, coarsePointer: true })).toBe('lite')
  })

  it('returns lite just below the width threshold', () => {
    expect(pickTier({ ...desktop, width: LITE_MAX_WIDTH - 1 })).toBe('lite')
  })

  it('returns full exactly at the width threshold', () => {
    expect(pickTier({ ...desktop, width: LITE_MAX_WIDTH })).toBe('full')
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/journey/tier.test.ts`
Expected: FAIL, error resolving `../../app/journey/tier`.

- [ ] **Step 5: Write the implementation**

Create `app/journey/tier.ts`:

```ts
export type Tier = 'full' | 'lite' | 'reduced' | 'none'

export interface TierInput {
  webgl: boolean
  reducedMotion: boolean
  coarsePointer: boolean
  width: number
}

export const LITE_MAX_WIDTH = 768

export function pickTier(input: TierInput): Tier {
  if (!input.webgl) return 'none'
  if (input.reducedMotion) return 'reduced'
  if (input.coarsePointer || input.width < LITE_MAX_WIDTH) return 'lite'
  return 'full'
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts app/journey/tier.ts tests/journey/tier.test.ts
git commit -m "Add Vitest and journey tier selection"
```

---

### Task 2: Scroll progress calculation

**Files:**
- Create: `app/journey/progress.ts`
- Test: `tests/journey/progress.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface SectionRect { top: number; height: number }
  export interface JourneyProgress { chapter: number; progress: number }
  export function computeProgress(rects: readonly SectionRect[], anchor?: number): JourneyProgress
  ```
  `anchor` defaults to `0` (top of viewport). `chapter` is an index into `rects`. `progress` is in `[0, 1]`.

- [ ] **Step 1: Write the failing test**

Create `tests/journey/progress.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeProgress, type SectionRect } from '../../app/journey/progress'

// Builds consecutive sections starting at `firstTop`.
function sections(firstTop: number, heights: number[]): SectionRect[] {
  let top = firstTop
  return heights.map((height) => {
    const rect = { top, height }
    top += height
    return rect
  })
}

const FOUR = [800, 800, 800, 800]

describe('computeProgress', () => {
  it('returns chapter 0, progress 0 for no sections', () => {
    expect(computeProgress([])).toEqual({ chapter: 0, progress: 0 })
  })

  it('returns chapter 0, progress 0 before the first section reaches the anchor', () => {
    expect(computeProgress(sections(65, FOUR))).toEqual({ chapter: 0, progress: 0 })
  })

  it('reports progress halfway through the first section', () => {
    expect(computeProgress(sections(-400, FOUR))).toEqual({ chapter: 0, progress: 0.5 })
  })

  it('switches to the next chapter at progress 0 on the boundary', () => {
    expect(computeProgress(sections(-800, FOUR))).toEqual({ chapter: 1, progress: 0 })
  })

  it('reports the third chapter mid-way', () => {
    expect(computeProgress(sections(-2000, FOUR))).toEqual({ chapter: 2, progress: 0.5 })
  })

  it('clamps to the last chapter at progress 1 after the last section', () => {
    expect(computeProgress(sections(-4000, FOUR))).toEqual({ chapter: 3, progress: 1 })
  })

  it('treats a zero-height active section as complete', () => {
    expect(computeProgress([{ top: -100, height: 0 }, { top: 200, height: 800 }])).toEqual({ chapter: 0, progress: 1 })
  })

  it('measures from a custom anchor', () => {
    expect(computeProgress([{ top: 100, height: 800 }], 500)).toEqual({ chapter: 0, progress: 0.5 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/journey/progress.test.ts`
Expected: FAIL, error resolving `../../app/journey/progress`.

- [ ] **Step 3: Write the implementation**

Create `app/journey/progress.ts`:

```ts
export interface SectionRect {
  top: number
  height: number
}

export interface JourneyProgress {
  chapter: number
  progress: number
}

// The active chapter is the last section whose top has reached the anchor line.
// Progress is how far that section has scrolled past the anchor, from 0 to 1.
export function computeProgress(rects: readonly SectionRect[], anchor = 0): JourneyProgress {
  let chapter = -1
  let active: SectionRect | undefined
  rects.forEach((rect, index) => {
    if (rect.top <= anchor) {
      chapter = index
      active = rect
    }
  })

  if (!active) return { chapter: 0, progress: 0 }

  const progress = active.height > 0
    ? Math.min(1, Math.max(0, (anchor - active.top) / active.height))
    : 1
  return { chapter, progress }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: 14 passed (6 tier + 8 progress).

- [ ] **Step 5: Commit**

```bash
git add app/journey/progress.ts tests/journey/progress.test.ts
git commit -m "Add journey scroll progress calculation"
```

---

### Task 3: Chapter stops and interpolation

**Files:**
- Create: `app/journey/stops.ts`
- Create: `app/journey/interpolate.ts`
- Test: `tests/journey/interpolate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`stops.ts`):
  ```ts
  export type Vec3 = readonly [number, number, number]
  export type ChapterId = 'intro' | 'projects' | 'skills' | 'about'
  export interface StopState {
    camera: Vec3        // camera position
    lookAt: Vec3        // camera target
    color: Vec3         // blob color, sRGB components 0..1
    strength: number    // vertex distortion amplitude
    speed: number       // wobble speed multiplier
    scale: number       // blob uniform scale
    offsetWide: Vec3    // blob position when viewport >= 768 px
    offsetNarrow: Vec3  // blob position when viewport < 768 px
  }
  export interface Stop extends StopState { id: ChapterId }
  export const CHAPTER_IDS: readonly ChapterId[]
  export const STOPS: readonly Stop[]   // length 4, same order as CHAPTER_IDS
  export function hexToRgb(hex: string): Vec3
  ```
- Produces (`interpolate.ts`):
  ```ts
  export function clamp01(value: number): number
  export function easeInOut(p: number): number
  export function lerp(a: number, b: number, p: number): number
  export function lerpStop(a: StopState, b: StopState, p: number): StopState
  export function damp(current: number, target: number, factor: number): number
  export function dampState(current: StopState, target: StopState, factor: number): StopState
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/journey/interpolate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CHAPTER_IDS, STOPS, hexToRgb, type StopState } from '../../app/journey/stops'
import { clamp01, damp, dampState, easeInOut, lerp, lerpStop } from '../../app/journey/interpolate'

function state(stop: StopState): StopState {
  const { camera, lookAt, color, strength, speed, scale, offsetWide, offsetNarrow } = stop
  return { camera, lookAt, color, strength, speed, scale, offsetWide, offsetNarrow }
}

const [intro, projects] = STOPS
if (!intro || !projects) throw new Error('STOPS must have at least two entries')

describe('STOPS', () => {
  it('has one stop per chapter, in chapter order', () => {
    expect(STOPS.map(s => s.id)).toEqual([...CHAPTER_IDS])
    expect(STOPS).toHaveLength(4)
  })

  it('uses color components between 0 and 1 and non-negative motion values', () => {
    for (const stop of STOPS) {
      for (const c of stop.color) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
      }
      expect(stop.strength).toBeGreaterThanOrEqual(0)
      expect(stop.speed).toBeGreaterThanOrEqual(0)
      expect(stop.scale).toBeGreaterThan(0)
    }
  })
})

describe('hexToRgb', () => {
  it('converts a hex color to 0..1 components', () => {
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0])
  })
})

describe('clamp01', () => {
  it('clamps below 0 and above 1', () => {
    expect(clamp01(-2)).toBe(0)
    expect(clamp01(0.3)).toBe(0.3)
    expect(clamp01(5)).toBe(1)
  })
})

describe('easeInOut', () => {
  it('maps endpoints and midpoint exactly', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(0.5)).toBe(0.5)
    expect(easeInOut(1)).toBe(1)
  })

  it('starts slow and clamps out-of-range input', () => {
    expect(easeInOut(0.25)).toBeLessThan(0.25)
    expect(easeInOut(-1)).toBe(0)
    expect(easeInOut(2)).toBe(1)
  })
})

describe('lerp', () => {
  it('interpolates linearly', () => {
    expect(lerp(0, 10, 0.3)).toBeCloseTo(3)
  })
})

describe('lerpStop', () => {
  it('returns the first stop at 0 and the second at 1', () => {
    expect(lerpStop(intro, projects, 0)).toEqual(state(intro))
    expect(lerpStop(intro, projects, 1)).toEqual(state(projects))
  })

  it('returns midpoints at 0.5', () => {
    const mid = lerpStop(intro, projects, 0.5)
    expect(mid.camera[0]).toBeCloseTo((intro.camera[0] + projects.camera[0]) / 2)
    expect(mid.strength).toBeCloseTo((intro.strength + projects.strength) / 2)
    expect(mid.color[2]).toBeCloseTo((intro.color[2] + projects.color[2]) / 2)
  })

  it('does not include the chapter id', () => {
    expect(lerpStop(intro, projects, 0.5)).not.toHaveProperty('id')
  })
})

describe('damp', () => {
  it('moves a fraction of the way to the target', () => {
    expect(damp(0, 10, 0.5)).toBe(5)
  })

  it('converges on the target after repeated steps', () => {
    let value = 0
    for (let i = 0; i < 100; i++) value = damp(value, 10, 0.08)
    expect(value).toBeCloseTo(10, 2)
  })
})

describe('dampState', () => {
  it('reaches the target with factor 1', () => {
    expect(dampState(state(intro), state(projects), 1)).toEqual(state(projects))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/journey/interpolate.test.ts`
Expected: FAIL, error resolving `../../app/journey/stops`.

- [ ] **Step 3: Write `app/journey/stops.ts`**

These are starting values. Task 7 tunes them in the browser.

```ts
export type Vec3 = readonly [number, number, number]

export type ChapterId = 'intro' | 'projects' | 'skills' | 'about'

export interface StopState {
  camera: Vec3
  lookAt: Vec3
  color: Vec3
  strength: number
  speed: number
  scale: number
  offsetWide: Vec3
  offsetNarrow: Vec3
}

export interface Stop extends StopState {
  id: ChapterId
}

export const CHAPTER_IDS: readonly ChapterId[] = ['intro', 'projects', 'skills', 'about']

export function hexToRgb(hex: string): Vec3 {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

// Wide offsets place the blob opposite the chapter's text panel.
export const STOPS: readonly Stop[] = [
  {
    id: 'intro',
    camera: [0, 0, 5],
    lookAt: [0, 0, 0],
    color: hexToRgb('#6366f1'),
    strength: 0.15,
    speed: 1,
    scale: 1,
    offsetWide: [0, 0, -1.5],
    offsetNarrow: [0, 0, -1.5],
  },
  {
    id: 'projects',
    camera: [1.2, 0.3, 5],
    lookAt: [0, 0, 0],
    color: hexToRgb('#a855f7'),
    strength: 0.28,
    speed: 1.4,
    scale: 1,
    offsetWide: [-2.2, 0, 0],
    offsetNarrow: [0, 0.3, -1],
  },
  {
    id: 'skills',
    camera: [0, 1.2, 6.5],
    lookAt: [0, -0.2, 0],
    color: hexToRgb('#ec4899'),
    strength: 0.35,
    speed: 2,
    scale: 1.1,
    offsetWide: [2.2, 0, 0],
    offsetNarrow: [0, 0, -1],
  },
  {
    id: 'about',
    camera: [0, -0.4, 4],
    lookAt: [0, 0, 0],
    color: hexToRgb('#818cf8'),
    strength: 0.1,
    speed: 0.6,
    scale: 0.9,
    offsetWide: [-1.8, -0.2, 0],
    offsetNarrow: [0, 0, -1],
  },
]
```

- [ ] **Step 4: Write `app/journey/interpolate.ts`**

```ts
import type { StopState, Vec3 } from './stops'

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function easeInOut(p: number): number {
  const x = clamp01(p)
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
}

export function lerp(a: number, b: number, p: number): number {
  // Written as a weighted sum so p = 0 and p = 1 return a and b exactly.
  return a * (1 - p) + b * p
}

function lerp3(a: Vec3, b: Vec3, p: number): Vec3 {
  return [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p)]
}

export function lerpStop(a: StopState, b: StopState, p: number): StopState {
  return {
    camera: lerp3(a.camera, b.camera, p),
    lookAt: lerp3(a.lookAt, b.lookAt, p),
    color: lerp3(a.color, b.color, p),
    strength: lerp(a.strength, b.strength, p),
    speed: lerp(a.speed, b.speed, p),
    scale: lerp(a.scale, b.scale, p),
    offsetWide: lerp3(a.offsetWide, b.offsetWide, p),
    offsetNarrow: lerp3(a.offsetNarrow, b.offsetNarrow, p),
  }
}

// Moves `current` a fixed fraction toward `target`. Called once per frame.
export function damp(current: number, target: number, factor: number): number {
  return lerp(current, target, factor)
}

export function dampState(current: StopState, target: StopState, factor: number): StopState {
  return lerpStop(current, target, factor)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass (6 tier + 8 progress + 13 interpolate = 27).

- [ ] **Step 6: Commit**

```bash
git add app/journey/stops.ts app/journey/interpolate.ts tests/journey/interpolate.test.ts
git commit -m "Add journey chapter stops and interpolation"
```

---

### Task 4: Three.js scene

**Files:**
- Modify: `package.json` (dependency)
- Create: `app/journey/scene.ts`

**Interfaces:**
- Consumes: `Tier`, `LITE_MAX_WIDTH` from `tier.ts`; `STOPS`, `StopState` from `stops.ts`; `damp`, `dampState`, `easeInOut`, `lerpStop` from `interpolate.ts`.
- Produces:
  ```ts
  export interface Pointer { x: number; y: number }   // each in -1..1, y up
  export interface JourneyScene {
    update(chapter: number, progress: number, t: number, pointer: Pointer): void  // t in seconds
    resize(width: number, height: number): void
    setTheme(isDark: boolean): void
    dispose(): void
  }
  export function createJourneyScene(canvas: HTMLCanvasElement, tier: Exclude<Tier, 'none'>): JourneyScene
  ```
  `createJourneyScene` throws if WebGL renderer creation fails. `update` renders a frame.

This module needs a WebGL context, so it has no unit test. Typecheck verifies it here. Task 7 verifies it in the browser.

- [ ] **Step 1: Install Three.js**

Run:
```bash
npm install three@^0.186.0
npm install -D @types/three@^0.186.0
```
Expected: `three` in `dependencies`, `@types/three` in `devDependencies`. If `@types/three@^0.186.0` does not exist, install the latest `@types/three` whose minor version is closest to 0.186 and note it in the commit message.

- [ ] **Step 2: Write `app/journey/scene.ts`**

```ts
import * as THREE from 'three'
import { damp, dampState, easeInOut, lerpStop } from './interpolate'
import { STOPS, type Stop, type StopState } from './stops'
import { LITE_MAX_WIDTH, type Tier } from './tier'

export interface Pointer {
  x: number
  y: number
}

export interface JourneyScene {
  update(chapter: number, progress: number, t: number, pointer: Pointer): void
  resize(width: number, height: number): void
  setTheme(isDark: boolean): void
  dispose(): void
}

const DAMPING = 0.08
const PARTICLE_COUNT = 800
const NARROW_OPACITY = 0.55
const MAX_FRAME_SECONDS = 0.1

function stopAt(index: number): Stop {
  const last = STOPS.length - 1
  const stop = STOPS[Math.min(Math.max(index, 0), last)]
  if (!stop) throw new Error('STOPS is empty')
  return stop
}

function createParticles(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (Math.random() - 0.5) * 14
    positions[i + 1] = (Math.random() - 0.5) * 10
    positions[i + 2] = (Math.random() - 0.5) * 8
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({ size: 0.03, transparent: true, depthWrite: false })
  return new THREE.Points(geometry, material)
}

export function createJourneyScene(canvas: HTMLCanvasElement, tier: Exclude<Tier, 'none'>): JourneyScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'lite', alpha: true })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier === 'lite' ? 1.5 : 2))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)

  // Blob: an icosphere displaced along its normals in the vertex shader.
  const uniforms = { uTime: { value: 0 }, uStrength: { value: 0 } }
  const material = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.3, transparent: true })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.uniforms.uStrength = uniforms.uStrength
    shader.vertexShader = 'uniform float uTime;\nuniform float uStrength;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vec3 transformed = position + normal * uStrength
        * sin(position.x * 3.0 + uTime)
        * sin(position.y * 2.5 + uTime * 0.8)
        * cos(position.z * 2.0 + uTime * 0.7);`,
    )
  }
  const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, tier === 'lite' ? 24 : 64), material)
  scene.add(blob)

  const ambient = new THREE.AmbientLight(0xffffff, 0.4)
  const pinkLight = new THREE.PointLight(0xec4899, 40)
  pinkLight.position.set(3, 2, 3)
  const indigoLight = new THREE.PointLight(0x6366f1, 40)
  indigoLight.position.set(-3, -2, 2)
  scene.add(ambient, pinkLight, indigoLight)

  const particles = tier === 'full' ? createParticles() : null
  if (particles) scene.add(particles)

  const first = stopAt(0)
  let current: StopState = lerpStop(first, first, 0)
  let narrow = false
  let phase = 0
  let lastT = 0
  const tilt = { x: 0, y: 0 }
  const lookAt = new THREE.Vector3()

  function target(chapter: number, progress: number): StopState {
    const state = lerpStop(stopAt(chapter), stopAt(chapter + 1), easeInOut(progress))
    if (tier === 'reduced') {
      // No motion: keep the first stop's framing and only let the color change.
      return { ...lerpStop(first, first, 0), color: state.color, strength: 0 }
    }
    return state
  }

  function apply(state: StopState) {
    const offset = narrow ? state.offsetNarrow : state.offsetWide
    blob.position.set(offset[0], offset[1], offset[2])
    blob.scale.setScalar(state.scale)
    material.color.setRGB(state.color[0], state.color[1], state.color[2], THREE.SRGBColorSpace)
    uniforms.uStrength.value = state.strength
    camera.position.set(state.camera[0] + tilt.x, state.camera[1] + tilt.y, state.camera[2])
    lookAt.set(state.lookAt[0], state.lookAt[1], state.lookAt[2])
    camera.lookAt(lookAt)
  }

  return {
    update(chapter, progress, t, pointer) {
      const dt = Math.min(Math.max(t - lastT, 0), MAX_FRAME_SECONDS)
      lastT = t
      current = dampState(current, target(chapter, progress), DAMPING)
      // Accumulate phase so a speed change does not make the wobble jump.
      phase += dt * current.speed
      uniforms.uTime.value = phase
      if (tier === 'full') {
        tilt.x = damp(tilt.x, pointer.x * 0.3, DAMPING)
        tilt.y = damp(tilt.y, pointer.y * 0.2, DAMPING)
      }
      if (particles) particles.rotation.y = t * 0.02
      apply(current)
      renderer.render(scene, camera)
    },

    resize(width, height) {
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      narrow = width < LITE_MAX_WIDTH
      material.opacity = narrow ? NARROW_OPACITY : 1
    },

    setTheme(isDark) {
      ambient.intensity = isDark ? 0.35 : 0.8
      if (particles) {
        particles.material.color.set(isDark ? 0xffffff : 0x6366f1)
        particles.material.opacity = isDark ? 0.6 : 0.35
      }
    },

    dispose() {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          for (const m of materials) m.dispose()
        }
      })
      renderer.dispose()
    },
  }
}
```

- [ ] **Step 3: Typecheck and run tests**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0 with no errors; 27 tests pass.

If typecheck reports errors in `scene.ts`, fix them without `any` casts or `@ts-ignore`. The most likely cause is an `@types/three` API difference (for example the `setRGB` color space argument). Check the installed type definition under `node_modules/@types/three/src/` and adapt.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app/journey/scene.ts
git commit -m "Add Three.js journey scene"
```

---

### Task 5: Vue integration units

**Files:**
- Create: `app/composables/useJourneyProgress.ts`
- Create: `app/components/JourneyChapter.vue`
- Create: `app/components/JourneyCanvas.client.vue`

**Interfaces:**
- Consumes: `computeProgress` from `progress.ts`; `pickTier` from `tier.ts`; `createJourneyScene`, `JourneyScene`, `Pointer` from `scene.ts`.
- Produces:
  - `useJourneyProgress(selector?: string): { chapter: Readonly<Ref<number>>; progress: Readonly<Ref<number>> }`. Default selector `'[data-chapter]'`. Auto-imported by Nuxt.
  - `<JourneyChapter chapter="intro">…</JourneyChapter>`: renders `<section :id="chapter" data-chapter class="min-h-screen flex flex-col justify-center">`.
  - `<JourneyCanvas :chapter :progress :is-dark @unavailable>`: emits `unavailable` (no payload) when the scene cannot run or stops running.

These units depend on the DOM and WebGL, so they have no unit test. Typecheck verifies them here. Task 7 verifies them in the browser.

- [ ] **Step 1: Write `app/composables/useJourneyProgress.ts`**

```ts
import { computeProgress } from '~/journey/progress'

export function useJourneyProgress(selector = '[data-chapter]') {
  const chapter = ref(0)
  const progress = ref(0)
  let frame = 0

  function measure() {
    frame = 0
    const rects = Array.from(document.querySelectorAll<HTMLElement>(selector), (el) => {
      const { top, height } = el.getBoundingClientRect()
      return { top, height }
    })
    const result = computeProgress(rects)
    chapter.value = result.chapter
    progress.value = result.progress
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(measure)
  }

  onMounted(() => {
    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    cancelAnimationFrame(frame)
  })

  return { chapter: readonly(chapter), progress: readonly(progress) }
}
```

- [ ] **Step 2: Write `app/components/JourneyChapter.vue`**

```vue
<script setup lang="ts">
defineProps<{
  chapter: string
}>()
</script>

<template>
  <section :id="chapter" data-chapter class="min-h-screen flex flex-col justify-center">
    <slot />
  </section>
</template>
```

- [ ] **Step 3: Write `app/components/JourneyCanvas.client.vue`**

```vue
<script setup lang="ts">
import { createJourneyScene, type JourneyScene, type Pointer } from '~/journey/scene'
import { pickTier } from '~/journey/tier'

const props = defineProps<{
  chapter: number
  progress: number
  isDark: boolean
}>()

const emit = defineEmits<{
  unavailable: []
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const active = ref(false)
const pointer: Pointer = { x: 0, y: 0 }
let scene: JourneyScene | null = null
let frame = 0

function hasWebGL(): boolean {
  try {
    const probe = document.createElement('canvas')
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'))
  } catch {
    return false
  }
}

function render(now: number) {
  scene?.update(props.chapter, props.progress, now / 1000, pointer)
  frame = requestAnimationFrame(render)
}

function start() {
  if (scene && !frame && !document.hidden) frame = requestAnimationFrame(render)
}

function stop() {
  cancelAnimationFrame(frame)
  frame = 0
}

function onResize() {
  scene?.resize(window.innerWidth, window.innerHeight)
}

function onVisibility() {
  if (document.hidden) stop()
  else start()
}

function onPointer(event: PointerEvent) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1
  pointer.y = -((event.clientY / window.innerHeight) * 2 - 1)
}

function teardown() {
  stop()
  window.removeEventListener('resize', onResize)
  window.removeEventListener('pointermove', onPointer)
  document.removeEventListener('visibilitychange', onVisibility)
  canvas.value?.removeEventListener('webglcontextlost', onContextLost)
  scene?.dispose()
  scene = null
  active.value = false
}

function onContextLost(event: Event) {
  event.preventDefault()
  teardown()
  emit('unavailable')
}

onMounted(() => {
  const tier = pickTier({
    webgl: hasWebGL(),
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    width: window.innerWidth,
  })

  if (tier === 'none' || !canvas.value) {
    emit('unavailable')
    return
  }

  try {
    scene = createJourneyScene(canvas.value, tier)
  } catch (error) {
    console.warn('[journey] 3D scene disabled:', error)
    emit('unavailable')
    return
  }

  active.value = true
  onResize()
  scene.setTheme(props.isDark)
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)
  if (tier === 'full') window.addEventListener('pointermove', onPointer, { passive: true })
  canvas.value.addEventListener('webglcontextlost', onContextLost)
  start()
})

watch(() => props.isDark, isDark => scene?.setTheme(isDark))

onBeforeUnmount(teardown)
</script>

<template>
  <canvas
    v-show="active"
    ref="canvas"
    class="fixed inset-0 z-0 h-full w-full pointer-events-none"
    aria-hidden="true"
  />
</template>
```

- [ ] **Step 4: Typecheck and run tests**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0; 27 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/composables/useJourneyProgress.ts app/components/JourneyChapter.vue app/components/JourneyCanvas.client.vue
git commit -m "Add journey canvas, chapter, and progress composable"
```

---

### Task 6: Home page journey layout

**Files:**
- Modify: `app/app.vue`
- Modify: `app/components/Hero.vue`
- Modify: `app/pages/index.vue`

**Interfaces:**
- Consumes: `JourneyCanvas`, `JourneyChapter`, `useJourneyProgress` (Task 5); `useDarkMode` (existing, returns `{ isDark, toggle }`).
- Produces: `Hero` accepts `transparent?: boolean` (default `false`).

- [ ] **Step 1: Lift `Nav` and `Footer` above the canvas in `app/app.vue`**

Replace the template with:

```vue
<template>
  <div class="min-h-screen flex flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
    <Nav class="relative z-10" />
    <main class="flex-1">
      <NuxtPage />
    </main>
    <Footer class="relative z-10" />
  </div>
</template>
```

`<main>` must not get a `z-index`. A `z-index` would make it a stacking context and trap the fixed canvas above `Nav`.

- [ ] **Step 2: Add the `transparent` prop to `app/components/Hero.vue`**

Replace the whole file with:

```vue
<script setup lang="ts">
import { siteConfig } from '~~/site.config'

const props = withDefaults(defineProps<{
  transparent?: boolean
}>(), {
  transparent: false,
})

const isExternalResume = siteConfig.resumeUrl.startsWith('http')

// Transparent mode sits over the 3D scene on the page background, so it uses theme colors.
const theme = computed(() => props.transparent
  ? {
      section: 'text-neutral-900 dark:text-white',
      tagline: 'text-neutral-600 dark:text-white/80',
      primary: 'bg-indigo-600 text-white hover:bg-indigo-500',
      secondary: 'border-neutral-400 hover:bg-neutral-900/5 dark:border-white/70 dark:hover:bg-white/10',
    }
  : {
      section: 'bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white',
      tagline: 'text-white/90',
      primary: 'bg-white text-indigo-700 hover:bg-white/90',
      secondary: 'border-white/70 hover:bg-white/10',
    })
</script>

<template>
  <section class="px-6 py-24 text-center" :class="theme.section">
    <h1 class="text-5xl font-extrabold tracking-tight">{{ siteConfig.name }}</h1>
    <p class="mt-4 text-xl" :class="theme.tagline">{{ siteConfig.tagline }}</p>
    <div class="mt-8 flex justify-center gap-4">
      <NuxtLink
        to="/projects"
        class="rounded-lg font-semibold px-6 py-3"
        :class="theme.primary"
      >
        View Projects
      </NuxtLink>
      <a
        :href="siteConfig.resumeUrl"
        :target="isExternalResume ? '_blank' : undefined"
        :rel="isExternalResume ? 'noopener' : undefined"
        class="rounded-lg border px-6 py-3 font-semibold"
        :class="theme.secondary"
      >
        Resume
      </a>
    </div>
  </section>
</template>
```

- [ ] **Step 3: Restructure `app/pages/index.vue`**

Replace the whole file with:

```vue
<script setup lang="ts">
import { siteConfig } from '~~/site.config'

const { data: featured } = await useAsyncData('home-featured-projects', () =>
  queryCollection('projects').where('featured', '=', true).all()
)

const { data: about } = await useAsyncData('home-about-teaser', () =>
  queryCollection('about').first()
)

useSeoMeta({
  title: siteConfig.tagline,
  description: siteConfig.tagline,
})

const { isDark } = useDarkMode()
const { chapter, progress } = useJourneyProgress()
const sceneAvailable = ref(true)

const panel = 'rounded-2xl p-6 md:p-8 md:max-w-2xl bg-white/75 dark:bg-neutral-950/60 backdrop-blur'
</script>

<template>
  <div>
    <JourneyCanvas
      :chapter="chapter"
      :progress="progress"
      :is-dark="isDark"
      @unavailable="sceneAvailable = false"
    />

    <div class="relative z-10">
      <JourneyChapter chapter="intro">
        <Hero :transparent="sceneAvailable" class="flex-1 flex flex-col justify-center" />
      </JourneyChapter>

      <JourneyChapter chapter="projects">
        <div class="px-6 py-16 w-full max-w-5xl mx-auto">
          <div :class="[panel, 'md:ml-auto']">
            <h2 class="text-2xl font-bold mb-6">Featured Projects</h2>
            <div v-if="featured?.length" class="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <ProjectCard
                v-for="project in featured"
                :key="project.path"
                :project="{
                  title: project.title,
                  description: project.description,
                  stack: project.stack,
                  path: project.path,
                  cover: project.cover,
                }"
              />
            </div>
            <p v-else class="text-neutral-500 dark:text-neutral-400">No projects yet.</p>
            <NuxtLink to="/projects" class="inline-block mt-6 text-indigo-600 dark:text-indigo-400 font-medium">
              See all projects &rarr;
            </NuxtLink>
          </div>
        </div>
      </JourneyChapter>

      <JourneyChapter chapter="skills">
        <div class="px-6 py-16 w-full max-w-5xl mx-auto">
          <div :class="[panel, 'md:mr-auto']">
            <h2 class="text-2xl font-bold mb-6">Skills</h2>
            <div v-for="group in siteConfig.skills" :key="group.category" class="mb-6">
              <h3 class="text-sm font-semibold uppercase text-neutral-500 mb-2">{{ group.category }}</h3>
              <div class="flex flex-wrap gap-2">
                <SkillBadge v-for="item in group.items" :key="item" :label="item" />
              </div>
            </div>
          </div>
        </div>
      </JourneyChapter>

      <JourneyChapter chapter="about">
        <div class="px-6 py-16 w-full max-w-5xl mx-auto">
          <div :class="[panel, 'md:ml-auto']">
            <h2 class="text-2xl font-bold mb-4">About</h2>
            <p v-if="about" class="text-neutral-600 dark:text-neutral-400">{{ about.title }}</p>
            <div class="mt-4 flex flex-wrap gap-6">
              <NuxtLink to="/about" class="text-indigo-600 dark:text-indigo-400 font-medium">
                Read more about me &rarr;
              </NuxtLink>
              <a
                :href="siteConfig.resumeUrl"
                :target="siteConfig.resumeUrl.startsWith('http') ? '_blank' : undefined"
                :rel="siteConfig.resumeUrl.startsWith('http') ? 'noopener' : undefined"
                class="text-indigo-600 dark:text-indigo-400 font-medium"
              >
                Resume &rarr;
              </a>
            </div>
          </div>
        </div>
      </JourneyChapter>
    </div>
  </div>
</template>
```

Panel alignment (`md:ml-auto` / `md:mr-auto`) puts each panel on the side opposite the blob's `offsetWide` in `stops.ts`: projects right (blob left), skills left (blob right), about right (blob left).

The about chapter always renders, even without about content, because the page needs exactly four chapters to match the four stops.

- [ ] **Step 4: Typecheck and run tests**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0; 27 tests pass.

- [ ] **Step 5: Generate the static site and check the SEO content**

Run:
```bash
npm run generate
grep -o 'data-chapter' .output/public/index.html | wc -l
grep -c 'Featured Projects' .output/public/index.html
grep -c 'Skills' .output/public/index.html
grep -c 'Read more about me' .output/public/index.html
grep -c 'Building things for the web.' .output/public/index.html
```
Expected: generate succeeds. First count is `4`. Every other count is at least `1`.

- [ ] **Step 6: Check that the other pages are unchanged**

Run: `git diff --stat HEAD -- app/pages/projects app/pages/about.vue`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add app/app.vue app/components/Hero.vue app/pages/index.vue
git commit -m "Turn home page into scroll-driven journey"
```

---

### Task 7: Browser verification and tuning

**Files:**
- Modify (tuning only, if needed): `app/journey/stops.ts`, `app/pages/index.vue`

**Interfaces:**
- Consumes: the whole feature.
- Produces: tuned stop values; screenshots or a GIF for the user.

Use the `claude-in-chrome` skill for browser steps. Record the scroll-through with `gif_creator` and name it `journey_scroll.gif`.

- [ ] **Step 1: Start the dev server**

Run in the background: `npm run dev`
Expected: server listening on `http://localhost:3000`.

- [ ] **Step 2: Desktop scroll-through (full tier)**

Open `http://localhost:3000` in a new tab at a width of 1280 px or more. Check:
- The blob is visible behind the intro text, and the name stays readable.
- Scrolling moves the blob left (projects), right (skills), then left (about). Its color changes indigo → purple → pink → soft indigo.
- The blob never covers a text panel's content in a way that hurts readability.
- Moving the mouse tilts the camera slightly.
- `read_console_messages` shows no errors and no `[journey]` warnings.

If a stop looks wrong, adjust only the values in `app/journey/stops.ts`, re-run `npm test`, and re-check.

- [ ] **Step 3: Dark mode**

Click the Nav's Dark/Light toggle in both directions. Check that the blob and particles stay visible against both backgrounds and that panel text stays readable.

- [ ] **Step 4: Mobile viewport (lite tier)**

Resize the window to 390 × 844. Reload. Check:
- The blob is centered behind the text at reduced opacity.
- No particles are visible.
- Scrolling stays smooth.

- [ ] **Step 5: Navigation cleanup**

From the home page, click "View Projects", then use the Nav logo to return home. Repeat twice. Check with `read_console_messages` that no errors appear and the scene still renders after returning.

- [ ] **Step 6: Reduced motion (manual, user-assisted)**

Chrome extension tools cannot emulate `prefers-reduced-motion`. Ask the user either to turn on macOS System Settings → Accessibility → Display → Reduce motion, or to use DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce". Then reload and check:
- The blob does not wobble, and the camera does not move while scrolling.
- The blob's color still changes between chapters.

The unit tests in Task 1 already cover tier selection. This step confirms the scene honors the `reduced` tier.

- [ ] **Step 7: Final checks**

Run: `npm run typecheck && npm test && npm run generate`
Expected: all pass.

- [ ] **Step 8: Commit tuning changes (if any)**

```bash
git add app/journey/stops.ts app/pages/index.vue
git commit -m "Tune journey stop values"
```

Skip this commit if no files changed.

- [ ] **Step 9: Stop the dev server**

Stop the background `npm run dev` process.
