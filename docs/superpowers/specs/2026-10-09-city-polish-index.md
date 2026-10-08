# City polish: series index

Date: 2026-10-09
Status: Draft specs, waiting for prioritization
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

## Suggested order

This order puts the largest visual change first and builds shared pieces early. You decide.

1. **01 Facade shader.** Biggest change for the least code. It also adds the shared pieces the others reuse (`shader-utils.ts`, the compile guard, the Playwright harness).
2. **02 Tone mapping and bloom.** Turns lit windows into glowing windows. Needs 01 to look right.
3. **05 Sky dome and haze.** Gives the dusk its light and depth. Independent.
4. **06 Staggered night windows.** Finishes the night look on top of 01 and 02.
5. **03 Building shapes.** Fixes the silhouette. Independent, so it can move earlier.
6. **04 Gradient and contact shadows.** Polish on the buildings, uses 05's sun.
7. **07 Street life.** Adds motion and warm lights.
8. **08 Wet road.** Last because its reflection reuses almost every other piece.

Smallest useful set if time is short: **01 + 02 + 06**. Together they turn grey boxes into a lit city at dusk.

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
