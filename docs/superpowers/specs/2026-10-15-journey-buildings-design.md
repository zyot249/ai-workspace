# Journey buildings: GLB set-pieces and near skyline

Date: 2026-10-15
Status: Implemented, pending manual checks
Builds on: [journey vehicles](2026-10-11-journey-vehicles-design.md), [journey people](2026-10-12-journey-people-design.md), [city-03 building shapes](2026-10-09-city-03-building-shapes-design.md)

## Problem

The buildings and set-pieces in the journey scene are boxes, cylinders, and cones built in code. The entrance gate is two pillars and a beam. The hall is plain pillars and walls. Market stalls are boxes with pyramid roofs. The home house is a box with a cone roof. They look crude next to the animated cars and people.

## Goal

Replace the set-pieces and the near skyline layer with stylized low-poly GLB models in a classic European town style.

Success criteria:

- The gate, hall, market stalls, home house, and near-layer buildings read as real buildings from the street camera, in both themes and at night.
- The scene never waits for the models and never breaks if they fail. On failure the current look stays.
- Set-pieces add at most 12 draw calls. The near layer adds at most 6 instanced meshes.
- Added download weight is about 1.5 MB or less, Meshopt compressed, loaded in the background.
- Layout code is unchanged: `hall.ts` pillar spacing and frame slots, `footprints.ts`, people placement, lamp placement.
- Every model is CC0 or equivalent, with a `LICENSE.txt` naming the pack, author, and license.

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Realism level | Stylized low-poly GLBs | Chosen by the user. Matches the cars and people. Small files, safe on iPhone. |
| Skyline scope | Near layer GLB, mid and far layers stay shader boxes | Chosen by the user. Mid and far layers read as silhouettes. Keeps the facade shader, density, and height animation there. |
| Set-piece flavor | Classic European town | Chosen by the user. |
| Near-layer style | Classic European town | Chosen by the user. One coherent town beside the set-pieces. |
| Set-piece method | Modular kit pieces assembled in code | Chosen by the user. A single model per piece would force changes to hall layout, frames, and guide placement. |
| Fallback | Keep current primitives, hide them on swap | Same pattern as vehicles and people. |

## Design

### New modules

| Module | Contents |
|---|---|
| `app/journey/building-specs.ts` | Constants only: file names, kit piece names, target sizes, bounds tolerance, per-tier counts. |
| `app/journey/building-models.ts` | Lazy GLB load, normalize scale and pivot, merge static meshes by material, reject a model whose bounds drift from spec. Uses `attachModels` from `model-swap.ts`. |
| `app/journey/setpiece-layout.ts` | Pure functions. Turn existing constants into a list of `{piece, x, z, rotY, scale}` for the gate, hall, market, and house. No WebGL. |

`scene.ts` is already about 660 lines. The set-piece builders and the swap wiring move into small modules if the plan finds `scene.ts` would pass the 800-line ceiling.

### Set-pieces

- `createGate`, `createColonnade`, `createMarket`, and `createCourtyard` stay as the fallback. When the models are ready their primitives hide and the GLB groups show.
- Stalls and the house load as whole models. The gate and hall are assembled from modular pieces (columns, wall segments, arch, roof, trim) at the positions in `hall.ts` and `footprints.ts`.
- Picture frames in the hall and the lamp glow in the market stay procedural. The courtyard windows keep their emissive material so the always-lit windows still work.
- Placement is deterministic from the existing seeds, so stall positions do not jump.
- Static meshes merge by material. Set-pieces add at most 12 draw calls.

### Near-layer skyline

- The near layer (24 buildings on `full`, 14 on `lite`) becomes instanced GLB variants. Mid and far layers are unchanged.
- Placement keeps the current rules (`placeBuilding`, `clearsFootprints`, `clearsPath`, corner blocks). Each GLB is scaled uniformly to fit inside the building's already-placed width and depth rectangle. Placement is unchanged, so clearance and shadows hold.
- Height: only the Y axis scales, clamped to a small range around 1 so facades do not stretch. The scroll `buildingHeight` and density still drive the Y scale and visibility.
- Contact shadows and the wet-road reflection read the same per-instance matrices. Instances keep the existing `Building` records, so contact shadows need no adapter.
- Night windows: if a model puts its windows in a separate material, that material's emissive follows `windowLitRatio`, as the courtyard windows do. Otherwise every kit material gets a faint uniform glow. There is no shader patch.
- The near box mesh stays until the models are ready, then hides.

### Loading and failure

1. The scene starts with the current look.
2. `loadBuildingModels()` runs in the background after the scene starts.
3. Models are staged hidden. The scene compiles shaders with `renderer.compileAsync`, then shows them and hides the primitives and near boxes.
4. If a load, stage, or warmup fails, the current look stays, staged models are disposed, and the error is logged once.
5. If the scene is disposed during the load or warmup, nothing shows, the models are disposed, and no error is reported.
6. `dispose()` releases geometries, materials, and textures.
7. Reduced motion still loads set-pieces, because they are static.

### Models

The user chose a classic European town style. The shipped set is Kenney's Fantasy Town Kit 2.0 (CC0). `public/models/buildings/LICENSE.txt` records the source models and the modifications. The candidate sources below were evaluated before that choice:

- Kenney kits (City Kit, Fantasy Town Kit, Castle Kit): CC0, believed to ship GLB. Not verified.
- Quaternius Medieval Village MegaKit: CC0. Format not verified. Some Quaternius packs ship only FBX, OBJ, and Blend.
- Poly Pizza and Poly Haven for single props.

The plan's first task downloads candidates into a scratch directory, inspects each file (format, license, size, materials, pivots, window materials), and picks the final set. Models that need conversion to GLB, or have no CC0 license, are dropped. The plan records the choice and provenance.

## Testing

TDD for pure logic, per `testing.md`.

- Unit: `setpiece-layout.ts` positions match the hall pillar spacing, footprints, and courtyard width. Near-layer placement still clears paths and footprints. Normalization and bounds rejection with fake GLTF sources.
- GPU (`npm run test:gpu`): swap shows models, a failed load keeps the primitives, dispose releases resources, draw-call and instanced-mesh budgets hold.
- Automated gate: `npm test`, `npm run test:gpu`, `npm run typecheck`, `npm run build` in `repos/portfolio`.
- Manual, left open until the user confirms: screenshots in both themes and at night, near-layer facades not stretched, night windows lit, iPhone frame time, contact shadows and wet-road reflection on near buildings, hall frames and guides still aligned.

## Risks

- **Near-layer adapter.** Contact shadows and wet-road reflection assume box instances. If the adapter is large, the plan splits near-layer GLBs into a second plan after the set-pieces ship.
- **Kit availability.** No verified classic European GLB kit with enough variety yet. If none passes inspection, fall back to the best available and report.
- **Night windows.** Palette textures may bake windows into one material.
- **Style seam.** Classic near buildings sit in front of modern mid and far boxes. The manual screenshot review judges this.

## Out of scope

- Mid and far skyline layers.
- Hall picture frames, lamps, road, sky, and people or vehicle changes.
- Animated or interactive buildings.
