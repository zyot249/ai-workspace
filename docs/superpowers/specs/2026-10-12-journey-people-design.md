# Journey people: walkers, talkers, and hall guides

Date: 2026-10-12
Status: Draft, pending review
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
- Added download weight is about 750 KB (three characters), loaded in the background after the scene starts.
- The scene never waits for the models and never breaks if they fail.
- No person overlaps the road surface, a building footprint, a lamp post, or another person.

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Walk route | Sidewalks only | Chosen by the user. Cars use the lanes, so walkers need no avoidance logic. |
| Guide behavior | Talk animation only | Chosen by the user. No text, no pointer handling. |
| Rendering | One skinned mesh per person, cloned with `SkeletonUtils.clone`, one `AnimationMixer` per person | About 16 people. Baked vertex-animation instancing is cheaper at runtime but needs a bake tool and a custom shader on top of the existing material patches. It is the fallback if the iPhone check fails. |
| Model source | Quaternius Ultimate Modular Men/Women pack via Poly Pizza | CC0, GLB, casual clothes that suit a city, one shared rig. See "Models". |
| Material | `MeshStandardMaterial` with the pack's palette texture | Fog, tone mapping, and the day-to-night ramp apply with no custom shader. |
| Reflections | People are not drawn in the wet-road pass | They are small. The pass is capped at 16 draw calls and the cars already use part of it. |
| Reduced motion | No people | Matches cars. Frozen figures would look like statues. |

## Design

### New modules

| Module | Contents |
|---|---|
| `app/journey/people-specs.ts` | Constants only: character files, clip names, scale and height, per-tier counts, distance cutoffs, emissive floor. |
| `app/journey/people-models.ts` | Lazy GLB load, normalization, skinned-mesh merge, and the stage/warm/show swap. Mirrors `vehicle-models.ts`. |
| `app/journey/people-layout.ts` | Pure placement and walker motion from `path.ts` and `road-layout.ts`. Seeded RNG from `random.ts`. |
| `app/journey/people.ts` | Creates the group, mixers, and clones. Per-frame `update(time, cameraDistance)`. `dispose()`. |

`scene.ts` creates people after traffic and calls `update` each frame. It gains about 10 lines. The hall guides use the hall's frame geometry, so `hallFrameSlots` and the hall constants move from `scene.ts` to a small exported module if the guide placement needs them (the plan decides after reading the file; `scene.ts` is already 658 lines).

### Placement: `people-layout.ts`

All functions are pure and deterministic from a seed (`PEOPLE_SEED`).

- **Sidewalk lane.** A walker's line is the path offset by `SIDEWALK_WALK_OFFSET` (3.45, the middle of the 3.0 to 3.9 strip) on one side. Corners are rounded with a quarter-circle arc, reusing the idea in `lane.ts` so there is no position jump.
- **Walkers.** Each walker has a side, a direction, a speed (0.5 to 0.9 units per second), and a start phase. A walker walks to the end of its route, turns about, and walks back. Speeds are slow so that walk-cycle foot speed matches ground speed.
- **Talkers.** Groups of 2 to 3 stand on a sidewalk stretch that the lamp layout skips and that is at least 1.5 units from any lamp. Members stand about 0.6 units apart on a small circle and face its center.
- **Guides.** One guide stands on the sidewalk beside a hall frame, facing the wall. The hall wall sits at 4.1 units off the center line and the sidewalk ends at 3.9, so a guide stands at about 3.5 and turns toward the frame at its bay. Guides use bays that hold a project frame (see `hallFrameSlots`), so a site with few projects has fewer guides.
- **Rejection.** A position is dropped if it falls inside a road rectangle, within a building footprint margin, or closer than 0.5 units to another person.

### Models: `people-models.ts` and `people-specs.ts`

- Load three characters from `public/models/people/` with `GLTFLoader`. Candidates are Casual Character, Business Man, Hoodie Character, and Worker. The plan picks three after the inspection task.
- For each model: merge the four modular parts into one skinned mesh sharing one skeleton, scale to `PERSON_HEIGHT` (0.5 units, close to the car height scale), and set feet at y = 0.
- Return `{ templates, clips }`: one template per character, plus the clips `walk`, `idle`, and `talk` by name. Clip names, height, and bounds are constants in `people-specs.ts`. The loader rejects a model whose measured height drifts from the spec, as the vehicle loader does.
- Per-person variation comes from picking one of the three characters, a tint on the material color, and a random clip time offset.
- Pure normalization and merge logic is separate from the loader call, so unit tests run without WebGL or network.
- Provenance: `public/models/people/LICENSE.txt` names the pack, the author, and CC0, as the vehicles file does.

### Animation and per-frame cost

- Walkers play `walk`. Talkers and guides play `talk`, with `idle` mixed in on a random timer (crossfade 0.3 s) so groups do not move in sync.
- Only people within `PEOPLE_ANIMATE_DISTANCE` (25 units) of the camera's position along the path get a mixer update. Others hold their last pose.
- Walkers keep advancing their position when far away, so they are in the right place when the camera arrives. Only their skeleton update is skipped.
- People beyond the fog distance are hidden.
- One `THREE.Clock`-free time source: `update` receives the scene time, and mixers call `setTime`, so scroll scrubbing and tests are deterministic.

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
- Each person has a contact shadow using the existing contact-shadow blob (spec 04). No new shadow maps.
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

Not yet verified: the clip names in the Modular pack, the file sizes, and the triangle counts. The first plan task downloads the files and records these. If the pack lacks a `talk` clip, talkers use `idle` with a head-turn offset. If it lacks `walk`, the plan retargets from the Universal Animation Library or picks another pack.

## Testing

Write each test first and watch it fail.

Unit (`tests/journey/`):

- Layout is deterministic from the seed.
- Walkers stay inside the sidewalk strip along their whole route, including corners. Positions are continuous (no jump larger than one step).
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
- Walkers do not clip lamps, buildings, or the sidewalk edge at corners.
- Hall guides stand sensibly beside the frames, and the projects panel does not cover them.
- Talking groups look natural and are not in sync.
- iPhone frame rate does not drop against the current build.

## Out of scope

- Clickable people, speech bubbles, project text, or sound.
- Walkers crossing the road, or avoiding each other or cars.
- People in the wet-road reflection.
- More than four distinct characters.
- Baked vertex-animation instancing (kept as a fallback if the iPhone check fails).

## Risks

- **Clips:** the Modular pack may have no `talk` or `walk` clip. Mitigation: the first plan task inspects the files, and the fallbacks above apply.
- **iPhone cost:** skinning 16 meshes may cost frames. Mitigation: tier caps, the distance cutoff, and the baked fallback.
- **Scale:** people may be too small to read from the street camera. Mitigation: `PERSON_HEIGHT` is one constant, tuned in the browser.
- **Hall space:** guides stand in a 0.4 unit-wide gap between the sidewalk edge and the wall. Mitigation: they stand on the sidewalk at 3.5, and the layout tests check clearance.
- **File size:** a character may exceed 250 KB. Mitigation: decimate or pick another.
