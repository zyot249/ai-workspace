# City polish: series index

Date: 2026-10-09
Status: 01 and 02 built and merged to local `master`. 03 to 09 are drafts. Build order below.
Direction chosen: B, realistic dusk/dawn skyline
Target: the journey city in `repos/portfolio/app/journey/`

Read [00 shared conventions](2026-10-09-city-00-shared-conventions.md) once. Every spec links to it.

## The specs

| # | Spec | What the user sees | New or changed files | Relative cost | Depends on |
| --- | --- | --- | --- | --- | --- |
| 01 | [Facade shader](2026-10-09-city-01-facade-shader-design.md) | Real window grids on every building face instead of floating quads. | `facade-material.ts`, `shader-utils.ts`, Playwright harness | Low GPU (+10% lite budget) | None |
| 02 | [Tone mapping and bloom](2026-10-09-city-02-tonemap-bloom-design.md) | Filmic highlights, halos on lit windows and lamps. | `post.ts`, `stops.ts` (`exposure`, `bloomStrength`) | Highest GPU on desktop (+2 ms), none on phones | Best with 01 |
| 03 | [Building shapes](2026-10-09-city-03-building-shapes-design.md) | Setback towers, rooftop equipment, antenna spires, non-square footprints. | `buildings.ts`, `random.ts`, `footprints.ts` | Low (also makes the per-frame update cheaper) | None |
| 04 | [Gradient and contact shadows](2026-10-09-city-04-gradient-contact-shadows-design.md) | Darker bases, warm roof rims, soft shadows under buildings. | `contact-shadows.ts`, facade shader | Low (+0.3 ms) | 01 (part A) |
| 05 | [Sky dome and haze](2026-10-09-city-05-sky-haze-design.md) | Gradient sky with a low sun, horizon glow, distant silhouettes, no ground edge. | `sky.ts`, `skyline-far.ts`, `stops.ts` (5 fields) | Low (+0.4 ms) | None |
| 06 | [Staggered night windows](2026-10-09-city-06-staggered-windows-design.md) | Windows light up one by one; mixed colors, flicker, dusk glass reflections. | `window-look.ts`, facade shader | Low (+0.2 ms) | 01 (part C also needs 04) |
| 07 | [Street life](2026-10-09-city-07-street-life-design.md) | Lamp posts that switch on in sequence, light pools, cars with lights. | `lamps.ts`, `traffic.ts`, `falloff-texture.ts` | Low (+0.4 ms, 6 draw calls) | None |
| 08 | [Wet road and road detail](2026-10-09-city-08-wet-road-design.md) | Asphalt grain, sidewalks, dashed lines, wet sheen, puddle reflections. | `road.ts`, `wet-road.ts`, `asphalt.ts`, `stops.ts` (`wetness`) | Medium (+1.2 ms desktop, +0.3 ms phone) | Reflection needs 02 |
| 09 | [Theme-aware sky with clouds](2026-10-09-city-09-theme-sky-design.md) | Light theme: blue morning-to-afternoon sky with drifting clouds. Dark theme: sunset-to-night arc. Theme toggle blends in 1.2 s. | `theme-blend.ts`, `sky-mirror.ts`, `stops.ts` (`PathState`/`LookState`, `LOOKS`) | Low (+0.3 ms on top of 05) | 05 (build together) |

## Build order

Decided 2026-10-09. Follow it top to bottom. Tick a row when it is merged. Each step gets its own implementation plan in `docs/superpowers/plans/` before any code.

| Step | Build | Plan | Why here | Done |
| --- | --- | --- | --- | --- |
| 0 | 01 Facade shader, 02 Tone mapping and bloom | written | Base for everything else. | [x] |
| 1 | 06 Staggered windows, parts A and B | written (`2026-10-09-city-06-staggered-windows.md`) | Needs only 01. Build it before 09, because its plan uses `STOPS`, which 09 removes. Leave part C for step 6. | [ ] |
| 2 | 09 sections 1 to 5: theme arcs | to write | Light theme becomes a blue day, dark theme a sunset-to-night arc. Creates `PathState` and `LookState`, so later specs add their fields there (shared conventions, section 4). Update 06's tests from `STOPS[i]` to `LOOKS.dark[...]` and add 06's theme-blend exception (spec 09, section 7). | [ ] |
| 3 | 05 Sky dome and haze, then 09 section 6: clouds | to write (one plan) | 05 uses 09's palettes from the start; do not build 05's own palette table. Clouds go into 05's dome shader. | [ ] |
| 4 | 03 Building shapes | to write | Independent. Goes before 04 (shared building update loop) and 08 (changes 03's placement). | [ ] |
| 5 | 04 Gradient and contact shadows | to write | Needs 01. Uses 05's sun and 03's update loop. | [ ] |
| 6 | 06 part C: dusk glass reflections | to write | Needs 04's sun uniforms. | [ ] |
| 7 | 07 Street life | to write | Uses 03's placement checks, 06's `gainFor`, 04's falloff texture. Lamps follow `windowLitRatio`, so they stay off in the light theme. | [ ] |
| 8 | 08 Wet road | to write | Last, because its reflections show every other piece. Before planning: `wetness` is a look field, so decide whether the road is wet in the light theme. | [ ] |
| any | [Journey music](2026-10-09-journey-music-design.md) | to write | Independent of every city spec. Ships with empty playlists. Build at any point, for example in a parallel worktree. If it lands before step 2, it declares the `Theme` type itself. | [ ] |

**Short path** if time runs out: steps 1, 2, and 3. With step 0 that gives a lit city whose sky follows the theme. Steps 4 to 8 are polish.

Outstanding from step 0: physical iPhone and desktop performance checks, screenshot and palette review, bundle-size check, and pushing `master` to origin.

## Shared changes to know about

These affect more than one spec. They are all in the shared conventions file:

- `lowPower` flag. Motion preference (`reduced`) and device power are separate. A phone with reduced motion now gets the cheap rendering and no animation. Today it gets desktop-size counts.
- Compile guard. Shader errors are caught by real warm-up renders and a per-frame check, and the page falls back to the hero gradient if a shader fails.
- Playwright GPU tests. `npm run test:gpu` is new and is not part of `npm test`.
- Render-cost procedure. Budgets are measured with an uncapped, GPU-synced loop on a physical iPhone and a named desktop, not with frame deltas.

## Visible changes from today, beyond "more detail"

- The day sky becomes slightly darker and less saturated (tone mapping, spec 02). Retune the hex values in `stops.ts` if it looks wrong.
- Buildings stand 0.9 units farther from the road (sidewalks, spec 08), which narrows the street canyon.
- Phones with reduced motion get lower building counts (spec 03, from the `lowPower` rule).
- The hall gallery pictures are not reflected in puddles (spec 08).

## Review history

Each spec was reviewed by the Herdr reviewer agent (Codex, pane `w1:p2`) after it was written, and again after fixes. Findings were applied in place. Statuses stay "Draft" until you choose what to build.
