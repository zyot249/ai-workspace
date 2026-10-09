---
date: 2026-10-09T15:07:11+0700
git_commit: ef03e9139578006d4698896d17fd054c10bfc0f1
branch: master
repository: ai-workspace
topic: "How is repos/portfolio structured and how does it work today?"
tags: [research, portfolio, nuxt, journey, scene, facade-material, post, tier, tests, gpu-harness]
status: complete
last_updated: 2026-10-09
---

# Research: repos/portfolio overview

All paths are relative to `repos/portfolio` unless noted.

## Research question

The request named a path (`repos/portfolio`), so it was rewritten as four factual questions:

1. How is the app structured: Nuxt config, pages, components, composables, plugins, content, site config, theme, deploy?
2. How does the 3D journey work: `app/journey/*`, scene build, scroll-to-camera path, stops, facade shader, post-processing, tiers, context loss, and the `JourneyCanvas` host?
3. How are tests and tooling set up: Vitest, Playwright GPU harness, configs, scripts?
4. Which patterns repeat across the code?

## Summary

The portfolio is a Nuxt 4 static site (`nitro.preset: 'static'`, `nuxt.config.ts:25-27`) deployed to Vercel through `npm run generate` (`vercel.json:2-3`). It has four routes (`/`, `/about`, `/projects`, `/projects/**`), Nuxt Content v3 collections `projects` and `about` (`content.config.ts:5-23`), and site data in a typed TS file (`site.config.ts:3-18`). Theme state lives on the `dark` class of `<html>`, set before first paint by a head script (`nuxt.config.ts:17-22`).

The home page mounts `JourneyCanvas` (`app/pages/index.vue:26-32`), a fixed full-screen canvas behind four `JourneyChapter` sections. Scroll position becomes `{chapter, progress}` (`app/composables/useJourneyProgress.ts:8-17`, `app/journey/progress.ts:13-29`). The component picks a quality tier (`app/journey/tier.ts:16-21`) and dynamically imports `createJourneyScene` (`app/components/JourneyCanvas.vue:164-167`). Each frame, the scene blends the four `STOPS` (`app/journey/stops.ts:40-104`) and applies the result to sky, fog, lights, the shared facade uniforms, building instances, stars and the camera path (`app/journey/scene.ts:630-658`). It renders through an HDR bloom composer or directly (`app/journey/scene.ts:670-674`, `app/journey/post.ts:113-174`). Any shader, creation, render or context-restore failure tears down the scene and emits `unavailable`, and the page falls back to a gradient hero (`app/pages/index.vue:31,36`).

Tests come in two suites. Vitest runs 67 unit tests in 10 files in a Node environment (`vitest.config.ts:4-7`; verified with `vitest run` at this commit, all passing). Playwright runs 22 `test()` calls, 37 after loop expansion, against a real-WebGL harness page on SwiftShader (`playwright.config.ts:4-22`).

The working tree has no uncommitted changes under `repos/portfolio`, so the commit hash describes the documented code.

## Detailed findings

### 1. App shell

**Config and layout**
- Modules: `@nuxtjs/tailwindcss` and `@nuxt/content` (`nuxt.config.ts:6-9`). Global CSS holds only the Tailwind directives (`app/assets/css/main.css:1-3`).
- No `runtimeConfig`, `routeRules`, `ssr` key, layouts, middleware or `server/` directory exist. SSR is on by default and output is static.
- `app/app.vue:2-7` renders `Nav`, `<main><NuxtPage/></main>` and `Footer`. Nav and Footer use `z-10` to sit above the `z-0` canvas (`app/components/JourneyCanvas.vue:198`).

**Pages**

| Route | File | Data | Renders |
|---|---|---|---|
| `/` | `app/pages/index.vue` | Featured projects, newest first (`:4-6`); `about` first entry (`:8-10`) | `JourneyCanvas` (`:26-32`); chapters `intro` (Hero), `projects` (ProjectCard grid), `skills` (SkillBadge per `siteConfig.skills`), `about` (description and résumé link) (`:34-99`) |
| `/about` | `app/pages/about.vue` | `about` first entry (`:2-4`) | `ContentRenderer` in `prose` (`:13-15`) |
| `/projects` | `app/pages/projects/index.vue` | All projects, newest first (`:2-4`) | ProjectCard grid (`:13-29`) |
| `/projects/**` | `app/pages/projects/[...slug].vue` | Project by `route.path` (`:2-6`); 404 when none (`:8-10`) | Cover, title, stack badges, repo and demo links, body (`:19-37`) |

**Components** (`app/components/`)
- `Nav.vue`: site name, links, theme toggle calling `useDarkMode().toggle` (`:4,8-23`). The toggle label is CSS-only (`dark:hidden`) so it matches the server HTML (`:15,21-22`).
- `Footer.vue`: social links that render only when set (`:9-14`), plus a year line (`:4,15`).
- `Hero.vue`: prop `transparent` (`:4-8`) switches between a translucent panel and a gradient section (`:13-27`).
- `JourneyChapter.vue`: `<section :id data-chapter class="min-h-screen">` (`:8-10`). The `data-chapter` attribute is the default selector of `useJourneyProgress`.
- `ProjectCard.vue` (`:2-26`) and `SkillBadge.vue` (`:2-8`).
- `JourneyCanvas.vue`: see section 2.

**Composables and plugin**
- `useDarkMode()` holds `useState('isDark', () => false)` and `toggle()` updates the state, the `<html>` class and `localStorage.theme` (`app/composables/useDarkMode.ts:4-18`).
- `useJourneyProgress()` measures section rects at most once per animation frame on scroll and resize and returns readonly `chapter` and `progress` (`app/composables/useJourneyProgress.ts:3-36`).
- `app/plugins/dark-mode.client.ts:3-8` copies the `dark` class into `isDark` on `app:mounted`.

**Content and site data**
- `projects` schema: required `title`, `description`, `stack`, `date`; optional `repoUrl`, `demoUrl`, `cover`; `featured` defaults to false (`content.config.ts:5-16`). `about` has an empty schema (`content.config.ts:19-23`).
- `content/projects/` holds four files, all `featured: true`, dated 2019-08 to 2022-08. None sets `cover`, `repoUrl` or `demoUrl`.
- `site.config.ts:4-17` sets the name, tagline, `resumeUrl: '/resume.pdf'`, LinkedIn and email socials, and five skill groups. Types are in `types/site.d.ts:1-19`.

**Dependencies** (`package.json:16-33`): `nuxt ^4.5.2`, `@nuxt/content ^3.16.1`, `three ^0.186.0`, `vue ^3.5.43`, `better-sqlite3`, `vitest ^5.0.1`, `@playwright/test ^1.64.0`, `vite ^8.3.0`, `vue-tsc`.

### 2. 3D journey

**Module inventory** (`app/journey/`, 1,386 lines; `scene.ts` is 721)

| Module | Main exports | Imported by |
|---|---|---|
| `camera.ts` | `BASE_FOV` 55, `MIN_HORIZONTAL_FOV` 70, `MAX_FOV` 100, `fovForAspect` (`:2-19`) | `scene.ts` |
| `facade-grid.ts` | `FACADE_CELL [0.16, 0.22]`, `FACADE_BASE_Y -1`, CPU grid helpers (`:1-16`) | `facade-material.ts`; helpers only by tests |
| `facade-material.ts` | `FacadeUniforms` (`:5-8`), `FacadeVariant` (`:9`), `createFacadeMaterial` (`:76-102`) | `scene.ts`, tests |
| `interpolate.ts` | `clamp01`, `easeInOut`, `lerp`, `lerpStop` (`:21-36`), `damp`, `dampState` (`:43-45`) | `scene.ts`, tests |
| `path.ts` | `PLACES`, `WAYPOINTS`, `PATH_SEGMENTS`, `PATH_TOTAL_LENGTH`, `pathPointAt`, `headingFor`, `clearsPath` (`:29-106`) | `scene.ts`, tests |
| `post.ts` | `TONE_MAPPING`, `POST_EMISSIVES`, `neutralToneMap`, `skyForDirectPipeline`, `PostPipeline`, `probePostSupport`, `createPostPipeline` (`:9-174`) | `scene.ts`, tests |
| `progress.ts` | `SectionRect`, `computeProgress` (`:1-29`) | `useJourneyProgress.ts`, tests |
| `scene.ts` | `Pointer`, `JourneyScene` (`:16-21`), `JourneySceneOptions` (`:23-27`), `hallPillarZs`, `hallFrameSlots`, `ExhibitItem`, `createJourneyScene` (`:547-721`) | `JourneyCanvas.vue`, tests |
| `shader-utils.ts` | `ShaderErrorRecorder`, `replaceOrThrow`, `getShaderErrorRecorder`, `createShaderErrorRecorder` (`:3-49`) | `scene.ts`, `post.ts`, `facade-material.ts`, tests |
| `stops.ts` | `Vec3`, `ChapterId`, `StopState` (`:5-21`), `Stop`, `CHAPTER_IDS`, `hexToRgb`, `STOPS` (`:40-104`) | `interpolate.ts`, `scene.ts`, `post.ts`, tests |
| `tier.ts` | `Tier`, `TierInput`, `LITE_MAX_WIDTH` 768, `lowPowerFor`, `pickTier` (`:1-21`) | `JourneyCanvas.vue`, tests |

The scene interface is `update(chapter, progress, t, pointer)`, `resize(width, height)`, `setTheme(isDark)` and `dispose()` (`app/journey/scene.ts:16-21`).

**Host lifecycle** (`app/components/JourneyCanvas.vue`)
- Props `chapter`, `progress`, `isDark`, `projectItems: ExhibitItem[]`; emits `unavailable` (`:5-14`). The template is one `fixed inset-0 z-0 pointer-events-none` canvas with `aria-hidden`, shown by `v-show="active"` (`:194-201`).
- It is not a `.client` component, so the canvas ref exists at `onMounted` (`:142-144`).
- Mount (`:145-183`): build the tier input from `hasWebGL()` (`:31-41`), reduced motion, coarse pointer and width; `pickTier`; emit `unavailable` for tier `none` or a missing canvas (`:153-162`); dynamically import the scene, check the `unmounted` flag, and create the scene with `lowPower: lowPowerFor(tierInput)` (`:164-167`). On success it sets `active`, resizes, calls `setTheme`, registers listeners and starts the loop.
- Loop: `render(now)` calls `scene.update(chapter, progress, now/1000, pointer)` and reschedules only when the scene exists, the context is live and the page is visible (`:43-58`).
- Context loss: `preventDefault`, stop, wait up to `RESTORE_TIMEOUT_MS = 5000` of visible time, then tear down and emit `unavailable` (`:27-29,98-125`). Restore resizes and restarts without rebuilding the scene (`:132-139`). A comment records that three.js keeps old dispose listeners on each restore (`:127-131`).
- Teardown removes five listeners, clears the timer, disposes and nulls the scene (`:85-96`). It runs on `onBeforeUnmount` (`:188-191`).

**Scene creation** (`app/journey/scene.ts:547-721`)
- `lowPower` defaults to `tier === 'lite'` (`:548`). The renderer uses `antialias: !lowPower` (`:549`), and the shader error recorder is attached on the next line (`:550`). The GPU Vite config injects its renderer observer after that line (`vite.gpu.config.ts:13-17`).
- Camera: `PerspectiveCamera(BASE_FOV, 1, 0.1, 120)` (`:552`). Pixel ratio cap 1.5 when low-power, otherwise 2; Neutral tone mapping; sRGB output (`:583-586`).
- Startup (`:676-693`): apply, resize, create the post pipeline unless low-power (`:679`), warm up bloom at strength 0.5 to compile every program (`:681-688`), render, and throw on any GL error (`:689-692`). Any throw disposes and rethrows (`:717-720`).

**Scroll to camera**
- `computeProgress` picks the last section whose top is at or above the anchor and returns progress `clamp((anchor - top) / height)` (`app/journey/progress.ts:13-29`).
- The `reduced` tier snaps to `stopAt(chapter)`. Other tiers blend `lerpStop(stop[c], stop[c+1], easeInOut(progress))` (`app/journey/scene.ts:623-628`) and damp toward it with `DAMPING = 0.08` (`:29,697-699`).
- The path is a polyline (0,8) → (0,-26) → (-26,-26) → (-26,-66) (`app/journey/path.ts:36-43`). The camera sits at `pathPointAt(cameraDistance)` and looks at `pathPointAt(cameraDistance + lookAheadDistance)` (`app/journey/scene.ts:649-657`). Pointer tilt applies only on the `full` tier (`:700-703`).

**STOPS** (`app/journey/stops.ts:40-104`): `StopState` has 12 fields: four camera fields, `skyColor`, `fogColor`, `fogDensity`, `buildingDensity`, `buildingHeight`, `windowLitRatio`, `exposure`, `bloomStrength` (`:5-21`).

| id | cameraDistance | sky | fog | fogDensity | windowLit | exposure | bloom |
|---|---|---|---|---|---|---|---|
| intro | 0 | #bfdbfe | #e0e7ff | 0.045 | 0.05 | 1 | 0 |
| projects | 8 | #fbbf9f | #f3a683 | 0.05 | 0.3 | 1 | 0.12 |
| skills | 40 | #7c6aa8 | #6b5b95 | 0.05 | 0.65 | 1.1 | 0.28 |
| about | 72 | #1e2340 | #141833 | 0.065 | 0.9 | 1.25 | 0.42 |

**Scene content**
- Buildings: three `InstancedMesh` layers named `journey-building-near/mid/far` with 24, 32 and 40 instances (60% when low-power), `BoxGeometry` with a per-instance `aSeed` attribute, `frustumCulled = false` (`app/journey/scene.ts:86-90,141-163`). Placement uses seeded candidates checked against road clearance and set-piece footprints (`:52-72,117-139`). `applyBuildingState` writes instance matrices on every apply (`:169-189`).
- Static pieces: ground (`:206-221`), road quads and center line (`:235-268`), corner blocks (`:77-80,270-279`), gate (`:286-298`), market with lamp glows at `POST_EMISSIVES.lamp` × 2.8 (`:466-497`), courtyard with windows at × 2.7 (`:502-537`).
- Gallery hall: `hallFrameSlots` returns up to 8 slots, left wall first (`:321-330`). Each project gets a 512×384 `CanvasTexture` with a word-wrapped title and formatted date (`:345-410,418-461`).
- Sky is a solid `scene.background` color (`:588-591`); there is no sky mesh or shader. Fog is `FogExp2` (`:592-593`). 800 star points fade in with `windowLitRatio`, not on low-power (`:191-204,611-612`). Lights: one hemisphere light and one directional light (`:614-617`).

**Facade shader** (`app/journey/facade-material.ts`)
- `MeshStandardMaterial` named `journey-facade-{variant}` with cache key `facade-{variant}` (`:80-82`). `onBeforeCompile` merges the shared uniforms object `{uLit, uSkyTint}` (`:84`).
- Vertex: `facadeScale` from the instance matrix columns, `vFacadePos` measured from the box bottom in world units, `vFacadeDepth = -mvPosition.z` (`:86-96`).
- Fragment: replaces `#include <color_fragment>` on side faces with a cell grid of size `FACADE_CELL` (`:32-74`). The `full` variant uses `fwidth` antialiasing and fade; `lite` uses hard edges and a depth fade from 6 to 14 (`:34-42`). A cell is lit when `facadeHash13(cell, vSeed) < uLit`. Emission is `0xffe1a8 × 2.7 × lit × coverage`, added after `<emissivemap_fragment>` (`:11-12,69-71,99`).
- Every patch goes through `replaceOrThrow` (`app/journey/shader-utils.ts:11-15`).
- One `facade` uniforms object is shared by all three layers (`app/journey/scene.ts:553-555,597`), so `apply` updates it once per frame (`:641-642`).

**Post-processing** (`app/journey/post.ts`)
- `probePostSupport` requires `EXT_color_buffer_float` or `EXT_color_buffer_half_float` and picks up to 4 MSAA samples for `RGBA16F`, or returns `null` (`:47,64-73`).
- `createPostPipeline` builds a `HalfFloatType` target, `EffectComposer`, `RenderPass`, `UnrealBloomPass(size, 0.5, 0.5, 1.0)` and `OutputPass` (`:122-147`). It probe-renders, asserts clean shaders and checks framebuffer status (`:149-154`). It returns `null` for a capability gap and throws for shader or JS errors (`:120-121,155,170-173`).
- `render()` runs inside `preservingState`, which restores renderer state in `finally` (`:82-97,158`). `setLook` sets exposure and bloom strength; bloom turns off below 0.01 (`:16-22,164-167`).
- With no composer, `apply` tone-maps sky and fog colors on the CPU through `skyForDirectPipeline` (`app/journey/scene.ts:631-636`, `app/journey/post.ts:38-45`).

**Tiers** (`app/journey/tier.ts:16-21`): `none` with no WebGL, then `reduced` with reduced motion, then `lite` with a coarse pointer or width under 768, otherwise `full`. `lowPower` is passed separately, so `reduced` can also be low-power (`app/components/JourneyCanvas.vue:167`).
- Low-power: no antialias, DPR 1.5, 60% buildings, `lite` facade, no stars, no post (`app/journey/scene.ts:142,147,549,583,611,679`).
- `reduced`: no blending or damping (`:626,697`). `full`: pointer tilt (`:700`).

**Theme in the scene**: `setTheme` changes only light intensities. In dark mode the sun is 0.5 and the hemisphere light 0.6; in light mode both are 0.9 (`app/journey/scene.ts:710-713`). Sky, fog and stop colors do not depend on the theme.

**Per-frame update** (`app/journey/scene.ts:696-706`): the `t` argument is named `_t` and is not used. Each frame damps the state, damps tilt on `full`, runs `apply` (`:630-658`), and renders, then calls `recorder.assertClean()` (`:670-674`).

### 3. Tests and tooling

**Scripts and configs**
- `test`: `vitest run`; `test:gpu`: Playwright; `test:gpu:serve`: Vite on `127.0.0.1:4175`; `typecheck`: `nuxt typecheck`; `build`: `nuxt build` (`package.json:6-14`).
- Vitest includes `tests/**/*.test.ts` in a Node environment with no setup file (`vitest.config.ts:4-7`). GPU `.spec.ts` files never run under Vitest.
- Playwright: `tests/gpu/**/*.spec.ts`, one worker, 60 s timeout, Chromium with ANGLE on SwiftShader, one project `chromium-webgl2`, and a web server waiting on `/tests/gpu/harness.html` (`playwright.config.ts:4-22`).
- `vite.gpu.config.ts` is a plain Vite server with `~` aliased to `./app` (`:7`). Its `pre` plugin injects `window.__cityGpuRendererObserver?.(renderer)` after the `createShaderErrorRecorder` line in `scene.ts`, throws if that marker is missing, and adds Vue imports to `JourneyCanvas.vue` (`:9-21`).

**Unit tests** (`tests/journey/`, 67 cases)

| File | Module | Cases |
|---|---|---|
| `camera.test.ts` | `camera` | 4 |
| `facade-grid.test.ts` | `facade-grid` | 1 |
| `facade-material.test.ts` | `facade-material` and `scene.ts` source text (`:32-38`) | 4 |
| `hall.test.ts` | `scene` hall helpers | 5 |
| `interpolate.test.ts` | `stops`, `interpolate` | 15 |
| `path.test.ts` | `path` | 10 |
| `post.test.ts` | `post` color contract, support probe with fake renderers (`:53-68`) | 9 |
| `progress.test.ts` | `progress` | 8 |
| `shader-utils.test.ts` | `shader-utils` with fake renderer and GL (`:11-16`) | 2 |
| `tier.test.ts` | `tier` | 9 |

**GPU tests** (`tests/gpu/`)
- `harness.html` loads `harness.ts` (`:3-4`), which defines `window.cityGpu`: `mountJourney`, `renderJourney`, `journeyLayers`, `measureJourney`, `loseAndRestore`, the component probes and more (`tests/gpu/harness.ts:28-134`). `sceneCalls` keeps the scene's draw-call count because composer passes reset `renderer.info` (`:14-15`).
- `post-probe.ts` defines `window.cityPost`, with synthetic, lifetime, actual-scene and fault-injection helpers (`:31-212`). `post-probe-checks.ts` holds parity, resize, restore and facade-halo checks (`:28-381`).
- `component-probe.ts` mounts the real `JourneyCanvas.vue` and injects creation and restore shader faults (`:17-133`). `render-cost.ts` measures CPU time and, when available, GPU timer queries (`:22-89`).

| Spec | `test()` calls | Expanded | Covers |
|---|---|---|---|
| `facade.spec.ts` | 6 | 13 | Real render; render cost; per-tier layer counts `[24,32,40]` or `[14,19,24]` low-power; draw calls `[57,25,14]` or `[56,24,13]` for chapters 0, 2 and 3 (`:53-59`); restore parity; reduced is static; facade grid pixels |
| `post.spec.ts` | 12 | 20 | HDR threshold and fallbacks; resource ownership; per-tier tone mapping; capability fallback; warm-up shader failure; sky and fog parity; resize; restore halo; facade halo; component `unavailable` paths |
| `shader-failure.spec.ts` | 4 | 4 | Creation failure; restored-context failure; missing marker; repeated unmount disposes once |

## Code references

- `nuxt.config.ts:17-22`: theme head script.
- `app/pages/index.vue:26-32`: `JourneyCanvas` mount and props.
- `app/composables/useJourneyProgress.ts:8-27`: scroll measurement.
- `app/components/JourneyCanvas.vue:142-183`: tier pick, dynamic import, scene creation, listeners.
- `app/components/JourneyCanvas.vue:98-139`: context loss and restore.
- `app/journey/scene.ts:16-27`: `JourneyScene` and options interfaces.
- `app/journey/scene.ts:547-721`: `createJourneyScene`.
- `app/journey/scene.ts:630-658`: `apply(state)`.
- `app/journey/scene.ts:696-713`: `update` and `setTheme`.
- `app/journey/stops.ts:5-21,40-104`: `StopState` and `STOPS`.
- `app/journey/facade-material.ts:32-102`: facade patches and factory.
- `app/journey/post.ts:113-174`: `createPostPipeline`.
- `app/journey/shader-utils.ts:21-49`: shader error recorder.
- `app/journey/tier.ts:10-21`: tier rules.
- `vite.gpu.config.ts:9-21`: GPU harness source injection.
- `tests/gpu/harness.ts:28-134`: `window.cityGpu`.
- `tests/gpu/facade.spec.ts:53-59`: layer and draw-call expectations.

## Architecture

- **Factories, not classes.** `createX` returns an object literal that implements an exported interface: `createJourneyScene` (`app/journey/scene.ts:547`), `createPostPipeline` (`app/journey/post.ts:113`), `createShaderErrorRecorder` (`app/journey/shader-utils.ts:21`), `createFacadeMaterial` (`app/journey/facade-material.ts:76`).
- **Framework-free journey modules.** `app/journey/` files are kebab-case TS modules that import each other with `./` (`app/journey/scene.ts:2-9`). Nuxt-specific code stays in components, composables and the plugin.
- **One failure path.** Errors in creation, render, shader compile or restore all end in teardown plus `emit('unavailable')` (`app/components/JourneyCanvas.vue:45-52,100-107,164-172`). Factories clean up and rethrow (`app/journey/scene.ts:717-720`, `app/journey/post.ts:170-173`). Warnings use a `[journey]` prefix (`app/components/JourneyCanvas.vue:48,159,169`).
- **Disposal runs once.** `disposed` flags guard repeated calls (`app/journey/scene.ts:558-561`, `app/journey/post.ts:130-133`, `app/journey/shader-utils.ts:40-41`). Scene dispose collects geometries, materials and textures into sets first (`app/journey/scene.ts:559-580`).
- **SSR guards.** Browser APIs run in `onMounted`. The code has no `import.meta.client`, `process.client` or `<ClientOnly>`. The theme uses a `.client.ts` plugin, `useState` and CSS-only labels (`app/plugins/dark-mode.client.ts:1-8`, `app/components/Nav.vue:15-23`).
- **Constants.** Module-level SCREAMING_SNAKE constants hold tuning values (`app/journey/scene.ts:29-33`, `app/journey/post.ts:9-18`, `app/journey/camera.ts:1-13`). Data tables are `readonly` or `as const` (`app/journey/stops.ts:40`, `app/journey/path.ts:29-43`). Some values are repeated in tests, for example `FACADE_CELL` at `tests/gpu/post-probe-checks.ts:9`.
- **Pure math, mutable frame state.** Interpolation, tone mapping, progress and path functions return new values (`app/journey/interpolate.ts:21-45`, `app/journey/progress.ts:13-29`). Per-frame scene state, the pointer and colors are mutated in place (`app/journey/scene.ts:619-657`, `app/components/JourneyCanvas.vue:18,81-82`).
- **Test seams.** The scene and post factories take optional callbacks (`app/journey/scene.ts:23-27`, `app/journey/post.ts:59-62`). Material and mesh names act as test selectors (`app/journey/facade-material.ts:81`, `app/journey/scene.ts:149`). GPU tests also inject source at build time and monkeypatch methods (`vite.gpu.config.ts:9-21`, `tests/gpu/post-probe.ts:187-207`).

## Related specs and plans

Specs and plans that describe this code: `docs/superpowers/specs/2026-10-09-city-00` through `city-10`, the index `docs/superpowers/specs/2026-10-09-city-polish-index.md`, and the plans in `docs/superpowers/plans/` (workspace root).

Statements the code no longer matches:

- `docs/superpowers/plans/2026-10-09-city-06-staggered-windows.md:39` says "`scene.ts` (692 lines), with separate window quads". `app/journey/scene.ts` has 721 lines. `tests/journey/facade-material.test.ts:32-38` asserts that `scene.ts` contains no `createWindows`, `applyWindowState`, `windowsMesh` or `interface WindowLight`.
- The same line says "There is no `facade-material.ts`, shader recorder, or GPU harness yet." All three exist: `app/journey/facade-material.ts:76-102`, `app/journey/shader-utils.ts:21-49`, `tests/gpu/harness.ts:28-134`.
- The same line's "ignored `_t` in `update`" still matches (`app/journey/scene.ts:696`).

The memory note for 2026-10-09 recorded "57 Node tests" after plan 01. At this commit the count is 67 in 10 files. Which commits added the extra 10 cases was not traced. This is a note, not a spec statement.

## Open questions

- The specs were not checked line by line against the code in this pass. Only the 06 plan's current-state paragraph was verified.
- The Playwright suite was not run for this research. The last recorded run (`test-results/.last-run.json`) shows "passed", and its date was not checked.
- `nuxt typecheck` covers `app/**` through the generated `.nuxt/tsconfig.app.json`. Whether it also type-checks `tests/journey` and `tests/gpu` was not confirmed.
