# Journey Home Page — Design

Date: 2026-09-23
Status: Approved (brainstorming)

## Goal

Turn the portfolio home page into a scroll-driven "career journey". A fixed
Three.js canvas renders a morphing blob behind the page. As the visitor
scrolls through four chapters, the camera moves between stops and the blob
changes color, shape, and position. All content stays as HTML.

## Scope

In scope:

- Home page (`app/pages/index.vue`) only.
- One Three.js scene: a shader-distorted blob plus a faint particle layer.
- Four chapters: intro, projects, skills, about.
- Performance tiers, reduced-motion support, and a no-WebGL fallback.
- Vitest setup for pure logic.

Out of scope:

- 3D on `/projects/*` or `/about`. These pages stay unchanged.
- 3D models, sound, smooth-scroll libraries (Lenis), GSAP.
- CMS-driven stop configuration.
- Content rendered inside the 3D scene.

## Decisions

| Question | Decision |
|---|---|
| 3D coverage | Home page only |
| Journey metaphor | Career timeline; camera travels between chapter stops |
| Visual | Morphing blob (vertex-shader wobble), brand palette |
| Content placement | HTML sections scroll over a fixed canvas |
| Device handling | Tiers: full, lite, reduced, none |
| Implementation | Plain `three` with a hand-written scroll mapping; no GSAP, no TresJS |

## Architecture

```
pages/index.vue
├─ <JourneyCanvas />            fixed, full-viewport, z-0, aria-hidden
│    └─ props: chapter, progress, isDark
└─ <div class="relative z-10">    (inside app.vue <main>)
     <JourneyChapter id="intro">     Hero content (name, tagline, buttons)
     <JourneyChapter id="projects">  featured ProjectCards
     <JourneyChapter id="skills">    SkillBadge groups
     <JourneyChapter id="about">     about teaser + resume CTA
```

### New units

| Unit | Responsibility | Depends on |
|---|---|---|
| `app/components/JourneyCanvas.client.vue` | Creates the renderer. Picks the tier. Runs the render loop. Handles resize, visibility, and context loss. Disposes everything on unmount. | `three`, `journey/scene.ts`, `journey/tier.ts` |
| `app/journey/scene.ts` | Pure Three.js, no Vue. `createJourneyScene(canvas, tier)` returns `{ update(chapter, progress, t, pointer), resize(w, h), setTheme(isDark), dispose() }`. | `three`, `journey/stops.ts`, `journey/interpolate.ts` |
| `app/journey/stops.ts` | Data only. One entry per chapter: camera position, camera look-at, blob color, blob distortion strength, blob speed, blob scale, blob offset (wide and narrow). | none |
| `app/journey/interpolate.ts` | Pure math. `easeInOut(p)`, `lerpStop(a, b, p)`, `damp(current, target, factor)`. | `journey/stops.ts` types |
| `app/journey/tier.ts` | Pure function `pickTier({ webgl, reducedMotion, coarsePointer, width })` returning `'full' \| 'lite' \| 'reduced' \| 'none'`. | none |
| `app/journey/progress.ts` | Pure function `computeProgress(sectionRects, anchor = 0)` returning `{ chapter, progress }`. `anchor` is the reference line's y-position in the viewport. | none |
| `app/composables/useJourneyProgress.ts` | Reads chapter section rects on scroll and resize (passive listener, rAF-throttled). Calls `computeProgress`. Exposes reactive `chapter` and `progress`. | `journey/progress.ts` |
| `app/components/JourneyChapter.vue` | Section wrapper: `min-h-screen`, `id`, `data-chapter`, slot. Plain HTML. | none |

The pure modules (`tier`, `progress`, `interpolate`, `stops`) contain no DOM
or Three.js code, so they can be unit tested.

### Changes to existing files

- `app/pages/index.vue`: restructured into four `JourneyChapter` sections.
  Content and data queries stay the same. Mounts `JourneyCanvas`.
- `app/app.vue`: `Nav` and `Footer` get `relative z-10` so the fixed canvas
  (z-0) paints behind them.
- `app/components/Hero.vue`: gains a `transparent` prop. When true it drops
  the gradient background so the canvas shows through. The gradient remains
  the default and the `none`-tier fallback. In transparent mode, text and
  buttons switch to theme colors so they stay readable on light and dark
  backgrounds. `JourneyCanvas` emits `unavailable` when it falls back to the
  `none` tier; the home page then sets `transparent` to false.
- `package.json`: add `three`, `@types/three`, `vitest`, and a `test` script.
- `.gitignore`: add `.superpowers/`.

`JourneyCanvas` is a `.client.vue` component. SSR and `nuxt generate` output
plain HTML with all chapter text. Three.js loads only on the home page.

## Data flow

```
scroll / resize ──► useJourneyProgress ──► { chapter: 0..3, progress: 0..1 }
                                                  │ props
isDark (useDarkMode) ─────────────────────► JourneyCanvas
                                                  │ requestAnimationFrame
                                                  ▼
                              scene.update(chapter, progress, t, pointer)
                                 target = lerpStop(stops[chapter], stops[chapter+1], easeInOut(progress))
                                 current = damp(current, target, 0.08)
```

- `progress` is how far the visitor has scrolled through the current chapter
  section, from 0 to 1. At 1 the scene has reached the next stop. Transitions
  follow scroll position, not timers.
- For the last chapter, `stops[chapter+1]` clamps to the last stop.
- Damping moves the scene a fraction of the way to the target each frame, so
  fast scrolling glides instead of jumping.

### Progress calculation

The reference line (`anchor`) is the top of the viewport (y = 0). The active
chapter is the last section whose top is at or above the anchor. `progress` is
`(anchor - top) / height` for that section, clamped to `[0, 1]`; a zero-height
section counts as `1`. Before the first section reaches the anchor, the result
is `{ chapter: 0, progress: 0 }`. After the last section, it is
`{ chapter: 3, progress: 1 }`.

With a top-of-viewport anchor, the blob arrives at stop `i + 1` exactly when
section `i + 1` fills the screen. A center anchor would put the blob partway
to the second stop on first load.

## Scene

### Blob

- `IcosahedronGeometry(1.3, detail)` with `MeshStandardMaterial`
  (roughness 0.25, metalness 0.3).
- Vertex distortion via `onBeforeCompile`: displace along the normal by
  `strength * sin(x*3 + t*speed) * sin(y*2.5 + t*speed*0.8) * cos(z*2 + t*speed*0.7)`.
  Uniforms: `uTime`, `uStrength`.
- Two colored point lights (pink, indigo) plus ambient light.

### Stops (initial values, tuned during build)

| Chapter | Camera | Blob |
|---|---|---|
| intro | front, z = 5 | indigo `#6366f1`, calm wobble, centered |
| projects | orbits right; blob sits left of text | purple `#a855f7`, stronger wobble |
| skills | pulls back, looks down slightly | pink `#ec4899`, faster, spikier |
| about | close and low; blob settles | soft indigo, slow breathing |

Wide viewports (768 px and up) offset the blob to the side of the text
column. Narrow viewports keep it centered behind the text at reduced opacity.

### Extras

- Mouse parallax: small camera tilt from the pointer position. `full` tier only.
- Particles: about 800 faint points for depth. `full` tier only.

### Theme

The renderer uses `alpha: true` and a transparent clear color, so the page's
light or dark background shows through. `setTheme(isDark)` adjusts light
intensity and particle opacity for contrast.

### Performance

- Pixel ratio capped at 2 (`full`) or 1.5 (`lite`).
- Render loop pauses on `document.hidden` and resumes on `visibilitychange`.

## Tiers

`pickTier()` runs once on mount.

| Condition (checked in order) | Tier | Behavior |
|---|---|---|
| WebGL context creation fails | `none` | No canvas. Intro shows the CSS gradient. |
| `prefers-reduced-motion: reduce` | `reduced` | Static blob, no wobble, no camera travel, no parallax. Color still changes per chapter. |
| Coarse pointer, or viewport width < 768 px | `lite` | Blob detail 24 instead of 64. No particles. No parallax. Pixel ratio 1.5. |
| Otherwise | `full` | Everything. |

## Error handling

- Any exception during scene creation is caught. The component switches to
  the `none` tier and logs one `console.warn`. The page never breaks because
  of the 3D layer.
- On `webglcontextlost`, the render loop stops and the component switches to
  the `none` tier.
- On unmount: cancel the animation frame, remove all listeners, dispose
  geometries, materials, and the renderer. Navigating away and back must not
  leak GPU memory.

## Accessibility and SEO

- Canvas is `aria-hidden="true"` and `pointer-events: none`.
- All content is HTML in document order. Headings keep their current levels.
- Text sits on a translucent panel where needed so contrast holds over the blob
  in both themes.

## Testing

Unit tests (Vitest, written test-first):

- `pickTier()`: each condition and the precedence order.
- `computeProgress()`: before the first section, mid-chapter, at a boundary,
  after the last section, zero-height sections.
- `interpolate.ts`: `easeInOut` endpoints and midpoint, `lerpStop` at 0, 0.5,
  and 1, `damp` convergence.
- `stops.ts`: exactly four stops, each with every required field.

Build checks:

- `npm run typecheck` passes.
- `npm run generate` passes, and `.output/public/index.html` contains the
  text of all four chapters.

Browser check (Chrome, dev server):

- Scroll through all chapters; the blob moves and changes color at each stop.
- Reduced motion emulated: the blob is static and the color still changes.
- Mobile viewport: lite tier, no stutter.
- Dark mode toggle: the blob stays readable against both backgrounds.
- Navigate to `/projects` and back: no console errors.

## Success criteria

- The home page reads as a four-stop journey driven by scroll.
- The page works and is fully readable without WebGL.
- All unit tests, typecheck, and generate pass.
- No console errors during navigation.
