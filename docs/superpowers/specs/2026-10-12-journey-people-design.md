# Journey people: walkers, talkers, and hall guides

Date: 2026-10-12
Status: Implemented, pending manual checks
Builds on: [journey vehicles](2026-10-11-journey-vehicles-design.md), [city-07 street life](2026-10-09-city-07-street-life-design.md)

## Problem

The journey street has lamps and cars but no people. The city feels empty, and the exhibition hall has nobody presenting the projects.

## Goal

Add animated human figures to the journey scene in three roles:

- **Walkers** pace along the sidewalks.
- **Talkers** stand in small groups on the sidewalks and talk to each other.
- **Guides** stand beside the project frames in the exhibition hall and "talk about the projects" with a talking animation. There is no text.

Success criteria:

- People read as human figures from the street camera, in both themes and at night.
- Counts per tier: see the table under "Tiers". Reduced motion shows no people and fetches no models.
- People add at most 16 draw calls on `full`, and none to the wet-road reflection pass.
- Added download weight is about 615 KB (three characters, Meshopt compressed), loaded in the background after the scene starts.
- The scene never waits for the models and never breaks if they fail.
- No person overlaps the road surface, a building footprint, a lamp post, or another person.

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Walk route | Sidewalks only | Chosen by the user. Cars use the lanes, so walkers need no avoidance logic. |
| Guide behavior | Talk animation only | Chosen by the user. No text, no pointer handling. |
| Rendering | One skinned mesh per person, cloned with `SkeletonUtils.clone`, one `AnimationMixer` per person | About 16 people. Baked vertex-animation instancing is cheaper at runtime but needs a bake tool and a custom shader on top of the existing material patches. It is the fallback if the iPhone check fails. |
| Model source | Quaternius Ultimate Modular Men/Women pack via Poly Pizza | CC0, GLB, casual clothes that suit a city, one shared rig. See "Models". |
| Material | `MeshStandardMaterial` with flat colors baked to vertex colors | Fog, tone mapping, and the day-to-night ramp apply with no custom shader. |
| Reflections | People are not drawn in the wet-road pass | They are small. The pass is capped at 16 draw calls and the cars already use part of it. |
| Reduced motion | No people | Matches cars. Frozen figures would look like statues. |

## Design

### New modules

| Module | Contents |
|---|---|
| `app/journey/people-specs.ts` | Constants only: character files, clip names, scale and height, per-tier counts, distance cutoffs, emissive floor. |
| `app/journey/people-models.ts` | Lazy GLB load, normalization, skinned-mesh merge, and the stage/warm/show swap. Mirrors `vehicle-models.ts`. |
| `app/journey/people-layout.ts` | Pure placement and walker motion from `path.ts` and `road-layout.ts`. Seeded RNG from `random.ts`. |
| `app/journey/people-rig.ts` | Skinned-part merge, normalization, clip lookup. |
| `app/journey/model-swap.ts` | Generic stage/warm/show flow shared with vehicles. |
| `app/journey/hall.ts` | Hall constants and frame slots extracted from scene.ts. |
| `app/journey/people.ts` | Creates the group, mixers, and clones. Per-frame `update(time, cameraDistance)`. `dispose()`. |

`scene.ts` creates people after traffic and calls `update` each frame. It gains about 10 lines. The hall guides use the hall's frame geometry, so `hallFrameSlots` and the hall constants move from `scene.ts` to a small exported module if the guide placement needs them (the plan decides after reading the file; `scene.ts` is already 658 lines).

### Placement: `people-layout.ts`

All functions are pure and deterministic from a seed (`PEOPLE_SEED`).

- **Sidewalk lane.** Walkers patrol fixed straight stretches listed in `WALK_STRETCHES`, avoiding corners, gate pillars, courtyard walls, and corner blocks. Their constant lateral offset is 3.65 normally and 3.15 inside the hall, clear of its pillars at 3.6 with radius 0.26.
- **Walkers.** Each has a side, speed (0.5 to 0.9 units per second), and phase. They turn in place for 0.6 seconds at each end, then walk back.
- **Talkers.** Groups of 2 to 3 stand on a sidewalk stretch that the lamp layout skips and that is at least 1.5 units from any lamp. Members stand about 0.6 units apart on a small circle and face its center.
- **Guides.** Guides stand at 3.7 off the center line in bay centers between pillars, facing the wall. Per side, the first occupied bay in order 1, 0, 2, 3 is used.
- **Rejection.** A position is dropped if it falls inside a road rectangle, within a building footprint margin, or closer than 0.5 units to another person.

### Models: `people-models.ts` and `people-specs.ts`

- Load three characters from `public/models/people/` with `GLTFLoader`. Candidates are Casual Character, Business Man, Hoodie Character, and Worker. The plan picks three after the inspection task.
- For each model: merge the modular parts into one skinned mesh, remapping bones by name and baking material colors to vertex colors (a shared texture is retained when all parts use the same texture), scale to `PERSON_HEIGHT` (0.5 units, close to the car height scale), and set feet at y = 0.
- Return `{ templates }`: one template per character, each with the clips `walk`, `idle`, and `talk` by name. Clip names, height, and bounds are constants in `people-specs.ts`. The loader rejects a model whose measured height drifts from the spec, as the vehicle loader does.
- Per-person variation comes from choosing one of the three characters and a random clip time offset; material tinting is omitted to preserve skin and clothes colors.
- Pure normalization and merge logic is separate from the loader call, so unit tests run without WebGL or network.
- Provenance: `public/models/people/LICENSE.txt` names the pack, the author, and CC0, as the vehicles file does.

### Animation and per-frame cost

- Walkers play `walk`. Talkers and guides play `talk`, for 6 seconds of every 9 seconds, with `idle` for the rest (crossfade 0.3 s) so groups do not move in sync.
- Only people within `PEOPLE_ANIMATE_DISTANCE` (25 units) of the camera's position along the path get a mixer update. Others hold their last pose.
- Walkers keep advancing their position when far away, so they are in the right place when the camera arrives. Only their skeleton update is skipped.
- People beyond the fog distance are hidden.
- Walker position and yaw are pure functions of scene time. Mixers advance by the frame step, clamped to 0.1 seconds. When no separate talk clip exists, talk uses the idle clip.

### Tiers

| | `full` | `lite` | `reduced` |
|---|---|---|---|
| Walkers | 6 | 3 | 0 |
| Talker groups | 3 groups of 2 to 3 (8 people) | 1 group of 2 | 0 |
| Guides | 2 (one per hall wall) | 1 | 0 |
| Total | 16 | 6 | 0, no model fetch |

`full` has 16 people, so at most 16 draw calls. The tier names come from `tier.ts`.

### Lighting and reflections

- Standard material with a small emissive floor, ramped up with `windowLitRatio` the way the car lights ramp up at dusk, so figures do not vanish at night. Streetlights already light the sidewalks.
- A uniform faint emissive glow (`NIGHT_GLOW` 0.12) ramps at night. Contact shadows can be added later if the manual check shows floating figures.
- The wet-road pass collects traffic by the `journey-street-car-` name prefix. People use the prefix `journey-street-person-` and the pass does not collect it.

### Loading and failure

Same flow as vehicles:

1. The scene starts with no people.
2. `loadPeopleModels()` runs in the background. When it resolves, people are created and staged hidden.
3. The scene compiles the shaders with `renderer.compileAsync`, then shows the people.
4. If a load, stage, or warmup fails, the street stays empty, the staged models are disposed, and the error is logged once.
5. If the scene is disposed during the load or warmup, nothing shows, the models are disposed, and no error is reported.
6. `dispose()` releases geometries, materials, textures, mixers, and skeletons.

### Models

Research on 2026-10-12:

| Pack | License | Formats | Verdict |
|---|---|---|---|
| Quaternius Ultimate Modular Men/Women (Poly Pizza bundle) | CC0 | FBX, GLB | Chosen. 10 to 11 casual characters, 24 shared animations, four swappable parts each. |
| Quaternius Universal Animation Library | CC0 | GLB | Fallback for clips. 120+ animations on a universal rig, no characters. |
| Kenney Animated Characters 1 and 3 | CC0 | not confirmed | Blocky, same author as the cars. Idle, jump, and run only. |
| KayKit Adventurers | CC0 | glTF, FBX | Fantasy outfits clash with a city. |

Verified model data (2026-10-12; original GLBs downloaded from the individual Poly Pizza model pages):

| Character | Original bytes | Shipped bytes | Triangles | Skins / joints | Clips |
|---|---:|---:|---:|---|---|
| Casual | 1430660 | 197080 | 5776 | 4 / 62 each | Walk, Idle, Wave |
| Business | 1529248 | 211436 | 6634 | 4 / 62 each | Walk, Idle, Wave |
| Hoodie | 1456760 | 206064 | 6206 | 4 / 62 each | Walk, Idle, Wave |

All use flat material colors with no base-color texture and zero images. The four modular meshes have multiple material primitives. Exact retained clip names are `CharacterArmature|Walk` (1.3333 s), `CharacterArmature|Idle` (1.6667 s), and `CharacterArmature|Wave` (1.6667 s); Wave serves the talk role. Unused animations were removed, then glTF Transform 4.5.1 optimized with Meshopt compression and default quantization, without simplification, flattening, joining, instancing, or palette textures. Three.js's MeshoptDecoder is required. Human appearance and waving remain subject to manual review.

## Testing

Write each test first and watch it fail.

Unit (`tests/journey/`):

- Layout is deterministic from the seed.
- Walkers stay inside the sidewalk strip along their straight stretches and endpoint turns. Positions are continuous (no jump larger than one step).
- No person stands inside a road rectangle, a building footprint margin, or within 0.5 units of another person or a lamp.
- Talkers in a group face the group center and stand within the spacing range.
- Guides stand inside the sidewalk strip beside a bay that holds a frame, and face the wall.
- Per-tier counts match the table. `reduced` yields zero.
- Draw calls from people are at most 16 on `full`.
- Fallback: a rejected load leaves no people and does not throw.
- Swap order: staged, warmed, shown. A failed warmup or a dispose during it keeps the street empty.
- Normalization: height matches `PERSON_HEIGHT` and feet sit at y = 0.
- Distance cutoff: a person beyond `PEOPLE_ANIMATE_DISTANCE` does not update its mixer. A walker still advances.

GPU (`tests/gpu/`): the street and wet-road tests pass with people present. A new `people.spec.ts` checks that drawing shown people builds no new shader program and that the reflection pass draws none of them.

## Verification

Automated: `npm test`, `npm run test:gpu`, `npm run typecheck`, `npm run build`.

Manual (a person checks):

- People look like people from the journey camera, in both themes and at night.
- Walkers do not clip lamps, buildings, gate pillars, courtyard walls, hall pillars, or sidewalk edges.
- Hall guides stand sensibly beside the frames, and the projects panel does not cover them.
- Talking groups look natural and are not in sync.
- iPhone frame rate does not drop against the current build.

## Out of scope

- Contact shadows.
- Clickable people, speech bubbles, project text, or sound.
- Walkers crossing the road, or avoiding each other or cars.
- People in the wet-road reflection.
- More than four distinct characters.
- Baked vertex-animation instancing (kept as a fallback if the iPhone check fails).

## Risks

- **Clips:** the Modular pack may have no `talk` or `walk` clip. Mitigation: the first plan task inspects the files, and the fallbacks above apply.
- **iPhone cost:** skinning 16 meshes may cost frames. Mitigation: tier caps, the distance cutoff, and the baked fallback.
- **Scale:** people may be too small to read from the street camera. Mitigation: `PERSON_HEIGHT` is one constant, tuned in the browser.
- **Hall space:** guides stand in a 0.2 unit-wide gap between the sidewalk edge and the wall. Mitigation: they stand on the sidewalk at 3.5, and the layout tests check clearance.
- **File size:** a character may exceed 250 KB. Mitigation: decimate or pick another.
