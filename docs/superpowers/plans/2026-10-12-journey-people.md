# Journey People Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work in an isolated worktree (`superpowers:using-git-worktrees`) on branch `feat/journey-people` cut from `master`. All paths and commands below are relative to `repos/portfolio` unless a path starts with `docs/`.

**Goal:** Add animated CC0 GLB humans to the journey scene: walkers on the sidewalks, small standing groups that talk, and guides who "talk about the projects" beside the hall's picture frames.

**Architecture:** Each character GLB is merged into one skinned mesh (bones remapped by name, material colors baked to vertex colors), normalized to a fixed height, then cloned per person with `SkeletonUtils.clone` and driven by its own `AnimationMixer`. Placement and walker motion are pure functions of the path. The scene starts with no people. The GLBs load in the background and are staged hidden, shader-warmed, then shown, using the same swap flow as the vehicles (generalized into `model-swap.ts`). People are not drawn in the wet-road reflection.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Three.js r186 (`GLTFLoader`, `SkinnedMesh`, `AnimationMixer`, `SkeletonUtils`, `BufferGeometryUtils.mergeGeometries`), Vitest (node environment), Playwright GPU harness (`tests/gpu/`).

**Spec:** `docs/superpowers/specs/2026-10-12-journey-people-design.md`. Research doc: none covers this code (the only one, `docs/superpowers/research/2026-10-09-portfolio-overview-research.md`, predates the vehicles and lane work). Related: `docs/superpowers/specs/2026-10-11-journey-vehicles-design.md` (the swap flow), `docs/superpowers/specs/2026-10-09-city-07-street-life-design.md` (lamps).

## Global Constraints

- Models are CC0 Quaternius characters from the "Ultimate Modular Men/Women" pack, downloaded as GLB (Poly Pizza bundle `Ultimate-Modular-Men-Pack-ZiH8muWqwQ`). Three characters ship in `public/models/people/`. Attribution is not required; `LICENSE.txt` records the source anyway.
- People per tier (tier names come from `app/journey/tier.ts`): `full` = 6 walkers + 3 talker groups of 3, 3, and 2 + 2 guides = 16. `lite` = 3 walkers + 1 talker group of 2 + 1 guide = 6. `reduced` = 0, and no model is fetched.
- Draw calls from people: at most 16 (one merged skinned mesh per person). People are never drawn in the wet-road reflection pass.
- Download budget: all people GLBs together at most 800 KB.
- Walkers stay on sidewalks (strip 3.0 to 3.9 off the center line). They never enter the road, never cross it, and never share a lane with cars.
- Guides and talkers show a talk animation only: no text, no pointer handling.
- A failed load, stage, or warmup leaves the street empty, logs one `console.warn`, and never throws into the scene. A scene disposed during the load or warmup shows nothing, disposes the models, and reports no error.
- `PERSON_HEIGHT` = 0.5 scene units, feet on the sidewalk top (`-1 + SIDEWALK_HEIGHT` = -0.85). `PERSON_RADIUS` = 0.1.
- Follow `.claude/rules/common/coding-style.md`: small files (under 400 lines typical), no mutation outside render-loop scratch objects and per-instance closures, no magic numbers. TDD: every behavior starts with a failing test.

## Review Focus

1. No projects, or more than eight: `hallFrameSlots(0)` is empty (no guides, no crash) and `hallFrameSlots(12)` is capped at eight (guides still pick a valid bay). Pinned in Task 3.
2. The scene is disposed while the models load or while the shaders warm: nothing shows, the models are disposed, no error is reported. Pinned in Task 5 and Task 7.
3. Time jumps: a huge `t`, `t` going backwards (scroll scrubbing), or the first update with a large `t`. Walker poses stay finite and continuous, and the mixer step is clamped. Pinned in Task 3 and Task 6.
4. Camera at the path ends or past them (`cameraDistance` 0 or above 100), and people crossing the visible and animate distance thresholds: `update` before `showModels` is a no-op, nobody pops or throws. Pinned in Task 6.
5. A model with no separate talk clip (talk and idle are the same clip) and a model whose parts list their bones in different orders: neither breaks the swap or the pose. Pinned in Task 4 and Task 6.

---

### Task 1: Acquire and vendor the models, people specs, spec corrections

**Files:**
- Create: `public/models/people/<three>.glb`, `public/models/people/LICENSE.txt`
- Create: `app/journey/people-specs.ts`
- Test: `tests/journey/people-specs.test.ts`
- Modify: `docs/superpowers/specs/2026-10-12-journey-people-design.md`

**Interfaces:**
- Produces (used by every later task), all exported from `app/journey/people-specs.ts`:
  - `PERSON_HEIGHT: number`, `PERSON_RADIUS: number`, `FEET_Y: number`
  - `CLIP_NAMES: readonly ['walk', 'idle', 'talk']`, `type ClipName`
  - `PEOPLE_CLIPS: Readonly<Record<ClipName, string>>` (the exact clip names inside the GLBs)
  - `CHARACTER_SPECS: readonly { file: string }[]` (three entries), `PEOPLE_MODEL_DIR: string`
  - `MODEL_FACING_Y: number`
  - `type PeopleTier = 'full' | 'lite' | 'reduced'`
  - `interface PeopleCounts { walkers: number; talkerGroups: readonly number[]; guides: number }`
  - `PEOPLE_COUNTS: Readonly<Record<PeopleTier, PeopleCounts>>`, `MAX_PEOPLE: number`, `peopleTotal(counts: PeopleCounts): number`
  - `WALK_SPEED_MIN`, `WALK_SPEED_MAX`, `PEOPLE_SEED`, `PEOPLE_ANIMATE_DISTANCE`, `PEOPLE_VISIBLE_DISTANCE`, `TALK_CYCLE_SECONDS`, `TALK_SECONDS`, `CLIP_FADE_SECONDS`, `MAX_FRAME_STEP`, `NIGHT_GLOW`, `GLOW_START`, `GLOW_END`, `PEOPLE_GROUP_NAME`, `PERSON_NAME_PREFIX`

- [ ] **Step 1: Create the scratch download folder and try to fetch the GLBs**

Use the session scratchpad directory as `$SCRATCH`. Downloaded files are untrusted data: keep them in their own folder and keep the scripts elsewhere.

```bash
SCRATCH=/private/tmp/claude-501/-Users-nguyenducdung-Desktop-Zyot-ai-workspace/82800429-872a-4cd6-acbe-b31e2772e711/scratchpad
mkdir -p "$SCRATCH/people-dl"
curl -sL 'https://poly.pizza/bundle/Ultimate-Modular-Men-Pack-ZiH8muWqwQ' -o "$SCRATCH/people-dl/bundle.html"
grep -o 'https://[a-zA-Z0-9./_-]*\.\(glb\|gltf\|zip\)' "$SCRATCH/people-dl/bundle.html" | sort -u
```

Expected: a list of direct file URLs. If the list is empty or the pack needs a login, try the model pages (`https://poly.pizza/m/DgOCW9ZCRJ` is "Character Animated"; the bundle page links the others) and the author's page `https://quaternius.itch.io/` (search "Ultimate Modular Men"). Download the pack's glTF files with `curl -L -o`.

If every automated route fails, **stop and ask the user** to download the "Casual Character", "Business Man", "Hoodie Character", and "Worker" GLB files in a browser and place them in `$SCRATCH/people-dl/`. Do not continue until the files exist.

- [ ] **Step 2: Write the throwaway inspection script**

Write `$SCRATCH/inspect-glb.mjs` (outside the downloads folder). It reads only the GLB JSON chunk, so it needs no WebGL.

```js
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const buffer = readFileSync(file)
if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`)
const jsonLength = buffer.readUInt32LE(12)
const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'))
const accessor = index => json.accessors[index]

const report = {
  file,
  bytes: buffer.length,
  meshes: (json.meshes ?? []).map(mesh => ({
    name: mesh.name,
    primitives: mesh.primitives.length,
    triangles: mesh.primitives.reduce((sum, primitive) => sum
      + (primitive.indices !== undefined ? accessor(primitive.indices).count : accessor(primitive.attributes.POSITION).count) / 3, 0),
    attributes: Object.keys(mesh.primitives[0].attributes),
    min: accessor(mesh.primitives[0].attributes.POSITION).min,
    max: accessor(mesh.primitives[0].attributes.POSITION).max,
    material: json.materials?.[mesh.primitives[0].material]?.name,
    baseColorTexture: json.materials?.[mesh.primitives[0].material]?.pbrMetallicRoughness?.baseColorTexture !== undefined,
  })),
  skins: (json.skins ?? []).map(skin => ({ name: skin.name, joints: skin.joints.length,
    firstJoints: skin.joints.slice(0, 4).map(joint => json.nodes[joint].name) })),
  animations: (json.animations ?? []).map(animation => ({ name: animation.name,
    seconds: Math.max(...animation.samplers.map(sampler => accessor(sampler.input).max[0])) })),
  images: (json.images ?? []).length,
  rootNodes: json.scenes[json.scene ?? 0].nodes.map(node => ({ name: json.nodes[node].name,
    scale: json.nodes[node].scale, rotation: json.nodes[node].rotation })),
}
console.log(JSON.stringify(report, null, 2))
```

- [ ] **Step 3: Run it on every candidate and record the findings**

```bash
for f in "$SCRATCH"/people-dl/*.glb; do node -I "$SCRATCH/inspect-glb.mjs" "$f"; done
```

Record, for each file: size in bytes, triangle count, mesh names, skin joint counts (a mesh per modular part, each with its own skin?), animation names with durations, whether materials have a `baseColorTexture`, and image count.

Pick three characters with these rules, in order:
1. Every GLB contains clips that can serve as walk and idle. A talk clip is a bonus.
2. Each file is at most 250 KB, and the three together at most 800 KB.
3. Prefer casual outfits (Casual Character, Business Man, Hoodie Character, Worker) that look different from each other.

If no usable walk clip exists in any candidate, **stop and report** to the user. The spec's fallback is retargeting from the Universal Animation Library, which is a separate decision.

Name the clips for `PEOPLE_CLIPS`: `walk` = the walking loop, `idle` = the standing loop, `talk` = a gesturing or talking loop if one exists (for example a "Wave" or "Talk" clip), otherwise **the same name as `idle`**.

- [ ] **Step 4: Write the failing specs test**

```ts
// tests/journey/people-specs.test.ts
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CHARACTER_SPECS, CLIP_NAMES, MAX_PEOPLE, PEOPLE_CLIPS, PEOPLE_COUNTS, PERSON_HEIGHT, PERSON_RADIUS, peopleTotal,
} from '../../app/journey/people-specs'

const MODEL_DIR = fileURLToPath(new URL('../../public/models/people/', import.meta.url))
const MAX_TOTAL_BYTES = 800 * 1024
const GLB_MAGIC = 'glTF'

describe('people specs', () => {
  it('ships three characters as GLB files', () => {
    expect(CHARACTER_SPECS).toHaveLength(3)
    for (const { file } of CHARACTER_SPECS) {
      const path = MODEL_DIR + file
      expect(existsSync(path), file).toBe(true)
      expect(readFileSync(path).subarray(0, 4).toString('latin1'), file).toBe(GLB_MAGIC)
    }
  })

  it('keeps the download under the budget', () => {
    const total = CHARACTER_SPECS.reduce((sum, { file }) => sum + statSync(MODEL_DIR + file).size, 0)
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
  })

  it('records the license', () => {
    const text = readFileSync(MODEL_DIR + 'LICENSE.txt', 'utf8')
    expect(text).toContain('Quaternius')
    expect(text).toContain('CC0')
  })

  it('names a clip for every role', () => {
    for (const name of CLIP_NAMES) expect(PEOPLE_CLIPS[name].length).toBeGreaterThan(0)
  })

  it('gives 16, 6, and 0 people per tier, within the cap', () => {
    expect(peopleTotal(PEOPLE_COUNTS.full)).toBe(16)
    expect(peopleTotal(PEOPLE_COUNTS.lite)).toBe(6)
    expect(peopleTotal(PEOPLE_COUNTS.reduced)).toBe(0)
    for (const counts of Object.values(PEOPLE_COUNTS)) expect(peopleTotal(counts)).toBeLessThanOrEqual(MAX_PEOPLE)
  })

  it('uses a person radius that fits inside the height', () => {
    expect(PERSON_RADIUS).toBeLessThan(PERSON_HEIGHT / 2)
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run tests/journey/people-specs.test.ts`
Expected: FAIL, "Failed to resolve import ../../app/journey/people-specs".

- [ ] **Step 6: Write `app/journey/people-specs.ts`**

Fill `CHARACTER_SPECS[].file` and `PEOPLE_CLIPS` from Step 3. The names below are placeholders for the shape only: replace every `file` and every clip name with the measured values.

```ts
import { SIDEWALK_HEIGHT } from './path'

// A person is 0.5 scene units tall. The Kenney cars are 0.9 long (about 4.5 m), so a real 1.7 m person
// would be 0.35; 0.5 reads better from the street camera. Tuned by eye in the browser.
export const PERSON_HEIGHT = 0.5
// Half the width of a person. Layout keeps this much clear of every obstacle.
export const PERSON_RADIUS = 0.1
// Road surface is at y = -1. People stand on the sidewalk top.
export const FEET_Y = -1 + SIDEWALK_HEIGHT

export const CLIP_NAMES = ['walk', 'idle', 'talk'] as const
export type ClipName = (typeof CLIP_NAMES)[number]
// The exact clip names inside the GLBs, from the inspection in plan task 1. Without a separate talk clip,
// `talk` has the same name as `idle` and talkers simply idle.
export const PEOPLE_CLIPS: Readonly<Record<ClipName, string>> = {
  walk: 'Walk',
  idle: 'Idle',
  talk: 'Idle',
}

export interface CharacterSpec {
  file: string
}

// Absolute path: it assumes the site is deployed at the domain root, as the vehicles do.
export const PEOPLE_MODEL_DIR = '/models/people/'
export const CHARACTER_SPECS: readonly CharacterSpec[] = [
  { file: 'casual.glb' },
  { file: 'business.glb' },
  { file: 'hoodie.glb' },
]

// glTF characters face +Z. The scene authors things facing -Z, so the model turns half a circle.
// If people walk backward in the browser check, set this to 0.
export const MODEL_FACING_Y = Math.PI

export type PeopleTier = 'full' | 'lite' | 'reduced'

export interface PeopleCounts {
  walkers: number
  // Size of each standing group, in the order the groups take their spots.
  talkerGroups: readonly number[]
  guides: number
}

export const PEOPLE_COUNTS: Readonly<Record<PeopleTier, PeopleCounts>> = {
  full: { walkers: 6, talkerGroups: [3, 3, 2], guides: 2 },
  lite: { walkers: 3, talkerGroups: [2], guides: 1 },
  reduced: { walkers: 0, talkerGroups: [], guides: 0 },
}

// One merged skinned mesh per person, so people cost at most this many draw calls.
export const MAX_PEOPLE = 16

export function peopleTotal(counts: PeopleCounts): number {
  return counts.walkers + counts.talkerGroups.reduce((sum, size) => sum + size, 0) + counts.guides
}

// Units per second. Slow, so the walk cycle's foot speed roughly matches the ground speed.
export const WALK_SPEED_MIN = 0.5
export const WALK_SPEED_MAX = 0.9
export const PEOPLE_SEED = 9500

// Distance along the path between the camera and a person. Inside ANIMATE the person animates. Outside
// VISIBLE (past the fog) the person is hidden.
export const PEOPLE_ANIMATE_DISTANCE = 25
export const PEOPLE_VISIBLE_DISTANCE = 45

// Talkers and guides talk for TALK_SECONDS of every TALK_CYCLE_SECONDS, then idle for the rest.
export const TALK_CYCLE_SECONDS = 9
export const TALK_SECONDS = 6
export const CLIP_FADE_SECONDS = 0.3
// The mixer never advances more than this per frame, so a scroll jump or a hidden tab does not fast-forward.
export const MAX_FRAME_STEP = 0.1

// A faint uniform emissive floor so figures stay readable at night. Ramps with the window-lit ratio.
export const NIGHT_GLOW = 0.12
export const GLOW_START = 0.15
export const GLOW_END = 0.6

export const PEOPLE_GROUP_NAME = 'journey-street-people'
export const PERSON_NAME_PREFIX = 'journey-street-person-'
```

- [ ] **Step 7: Vendor the files**

```bash
mkdir -p public/models/people
cp "$SCRATCH/people-dl/<chosen-casual>.glb" public/models/people/casual.glb
cp "$SCRATCH/people-dl/<chosen-business>.glb" public/models/people/business.glb
cp "$SCRATCH/people-dl/<chosen-third>.glb" public/models/people/hoodie.glb
```

Use the three chosen files; rename to match `CHARACTER_SPECS` (or change the `file` values to the real names). Then write `public/models/people/LICENSE.txt`:

```
People models: Quaternius, Ultimate Modular Men / Women pack (casual, business, hoodie characters)
Created and distributed by Quaternius (quaternius.com), via Poly Pizza (poly.pizza)
License: Creative Commons Zero (CC0), http://creativecommons.org/publicdomain/zero/1.0/
Source: https://poly.pizza/bundle/Ultimate-Modular-Men-Pack-ZiH8muWqwQ
Attribution is not required.
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/journey/people-specs.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Correct the spec**

Edit `docs/superpowers/specs/2026-10-12-journey-people-design.md` to match what the planning pass learned from the code. Read the file, then apply each change by editing the named section:

1. **Decisions table, "Material" row, and Design > "Models" section:** per-person variation is the character choice and a random clip time offset only. There is no per-person tint (a tint would darken skin and clothes together). Parts are merged with their bones remapped by name and their material colors baked to vertex colors (the pack uses flat material colors, or one shared texture; the merge keeps the texture when all parts share one).
2. **Design > "Placement" > "Sidewalk lane" and "Walkers" bullets:** replace with: walkers patrol fixed straight stretches of sidewalk (no corners), listed in `WALK_STRETCHES`. They walk to the end of a stretch, turn in place for 0.6 s, and walk back. A stretch has a constant lateral offset: 3.65 off the center line normally (clear of the lamp posts at 3.3), and 3.15 inside the hall, because the hall's pillars stand at 3.6 with radius 0.26 and the gap between the road edge and the pillars is only 0.34 wide. Entrance gate pillars (at 3.4, half width 0.3), courtyard walls (at 3.5), and the corner blocks are avoided by choosing stretch ends. Remove "turning at corners" and "round the corners" everywhere, including the Testing bullet about corners.
3. **Design > "Placement" > "Guides" bullet:** guides stand at 3.7 off the center line (not 3.5), in the bay centers between pillars, and face the wall. Per side they use the first bay in the order 1, 0, 2, 3 that holds a frame.
4. **Design > "Animation and per-frame cost":** the mixer advances by the frame step (clamped to 0.1 s), not `setTime`. Walker position and yaw are still pure functions of `t`. Talkers and guides talk for 6 s of every 9 s and idle for the rest. When the model has no talk clip, talk is the idle clip.
5. **Design > "Lighting and reflections":** remove the contact-shadow bullet and add "Contact shadows" to Out of scope (add them later if the manual check shows floating figures). The night emissive is a uniform faint glow (`NIGHT_GLOW` 0.12), not albedo-based.
6. **Design > "New modules":** add `app/journey/people-rig.ts` (skinned-part merge, normalization, clip lookup), `app/journey/model-swap.ts` (the generic stage, warm, show flow shared with the vehicles), and `app/journey/hall.ts` (the hall constants and frame slots moved out of `scene.ts`).
7. **Design > "Models" > "Not yet verified" paragraph:** replace with the measured table from Step 3 of this task: the three chosen characters with file size, triangle count, clip names, and what the talk clip is.

- [ ] **Step 10: Commit**

```bash
git add public/models/people app/journey/people-specs.ts tests/journey/people-specs.test.ts ../../docs/superpowers/specs/2026-10-12-journey-people-design.md
git commit -m "feat: add the people models and specs"
```

---

### Task 2: Move the hall constants and frame slots into `hall.ts`

**Files:**
- Create: `app/journey/hall.ts`
- Modify: `app/journey/scene.ts` (remove the moved block at lines ~116-146, import from `./hall`, use `HALL_PILLAR_X` in `createColonnade`)
- Modify: `tests/journey/hall.test.ts` (import path)

**Interfaces:**
- Produces, from `app/journey/hall.ts`:
  - `HALL_LENGTH = 16`, `HALL_WALL_X: number`, `HALL_PILLAR_SPACING = 3.5`, `HALL_PILLAR_X: number`, `HALL_PILLAR_RADIUS = 0.26`
  - `interface FrameSlot { side: -1 | 1; z: number }`
  - `hallPillarZs(): number[]`, `hallFrameSlots(projectCount: number): FrameSlot[]` (identical behavior to today)

- [ ] **Step 1: Change the test import first**

In `tests/journey/hall.test.ts` replace
`import { hallFrameSlots, hallPillarZs } from '../../app/journey/scene'`
with
`import { hallFrameSlots, hallPillarZs } from '../../app/journey/hall'`

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/journey/hall.test.ts`
Expected: FAIL, "Failed to resolve import ../../app/journey/hall".

- [ ] **Step 3: Create `app/journey/hall.ts`**

Move these from `scene.ts` unchanged, and add the two pillar constants:

```ts
import { ROAD_HALF_WIDTH } from './path'

export const HALL_LENGTH = 16
export const HALL_WALL_X = ROAD_HALF_WIDTH + 1.1
export const HALL_PILLAR_SPACING = 3.5
// The colonnade pillars stand 0.6 off the road edge. Their base radius is 0.26.
export const HALL_PILLAR_X = ROAD_HALF_WIDTH + 0.6
export const HALL_PILLAR_RADIUS = 0.26

export interface FrameSlot {
  side: -1 | 1
  z: number
}

// z (in the hall's own local frame, center = 0) of each pillar along one wall.
export function hallPillarZs(): number[] {
  const pillarCount = Math.floor(HALL_LENGTH / HALL_PILLAR_SPACING)
  const zs: number[] = []
  for (let i = 0; i <= pillarCount; i++) zs.push(HALL_LENGTH / 2 - i * HALL_PILLAR_SPACING)
  return zs
}

// One slot per bay between pillars, left wall first (the projects HTML panel
// covers the right wall's screen position at the projects camera stop — see
// `stops.ts`). At most 8 projects fit (4 bays per wall at HALL_LENGTH 16);
// beyond that, extra projects are simply not given a frame.
export function hallFrameSlots(projectCount: number): FrameSlot[] {
  const bayCount = Math.floor(HALL_LENGTH / HALL_PILLAR_SPACING)
  const slots: FrameSlot[] = []
  for (const side of [-1, 1] as const) {
    for (let k = 0; k < bayCount; k++) {
      slots.push({ side, z: HALL_LENGTH / 2 - (k + 0.5) * HALL_PILLAR_SPACING })
    }
  }
  return slots.slice(0, Math.min(projectCount, slots.length))
}
```

- [ ] **Step 4: Update `scene.ts`**

Delete the moved constants, `FrameSlot`, `hallPillarZs`, and `hallFrameSlots` from `scene.ts`. Add `import { HALL_LENGTH, HALL_PILLAR_X, HALL_WALL_X, hallFrameSlots, hallPillarZs } from './hall'`. In `createColonnade`, replace both `side * (ROAD_HALF_WIDTH + 0.6)` with `side * HALL_PILLAR_X`. Remove `ROAD_HALF_WIDTH` from the `./path` import only if nothing else in `scene.ts` still uses it (the gate and market do, so it stays).

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run tests/journey/hall.test.ts && npm run typecheck`
Expected: PASS and no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/journey/hall.ts app/journey/scene.ts tests/journey/hall.test.ts
git commit -m "refactor: move the hall constants and frame slots into hall.ts"
```

---

### Task 3: People layout and walker motion

**Files:**
- Create: `app/journey/people-layout.ts`
- Test: `tests/journey/people-layout.test.ts`

**Interfaces:**
- Consumes: `pathPointAt`, `headingFor`, `PATH_SEGMENTS`, `PLACES`, `ROAD_HALF_WIDTH`, `SIDEWALK_OUTER`, `clearsPath`, `roadRects` from `./path`; `seeded` from `./random`; `FrameSlot`, `hallPillarZs`, `hallFrameSlots`, `HALL_PILLAR_X`, `HALL_PILLAR_RADIUS` from `./hall`; `lampPositions`, `LAMP_SPACING_FULL`, `LAMP_SPACING_LOW_POWER` from `./lamps`; `CORNER_BLOCKS` from `./footprints`; constants from `./people-specs`.
- Produces:
  - `interface WalkStretch { side: 1 | -1; from: number; to: number; offset: number }`; `WALK_STRETCHES: readonly WalkStretch[]` (six entries); `WALK_OFFSET = 3.65`, `HALL_WALK_OFFSET = 3.15`, `WALK_TURN_SECONDS = 0.6`
  - `interface Walker { stretch: WalkStretch; speed: number; phase: number; character: number }`; `createWalkers(count: number, characterCount: number): Walker[]`
  - `interface WalkerPose { x: number; z: number; yaw: number; moving: boolean; distance: number }`
  - `walkerPoseAt(walker: Walker, t: number, out?: WalkerPose): WalkerPose`
  - `stretchSegment(stretch: WalkStretch): { ax: number; az: number; bx: number; bz: number }`
  - `interface Talker { x: number; z: number; yaw: number; character: number; distance: number; group: number }`; `createTalkers(groupSizes: readonly number[], characterCount: number): Talker[]`; `TALKER_SPOTS`, `TALKER_LATERAL`, `TALKER_RING_RADIUS`
  - `interface Guide { x: number; z: number; yaw: number; character: number; distance: number }`; `guideSlots(frameSlots: readonly FrameSlot[], count: number): FrameSlot[]`; `createGuides(count: number, frameSlots: readonly FrameSlot[], characterCount: number): Guide[]`; `GUIDE_X = 3.7`
  - `interface PeopleLayout { walkers: readonly Walker[]; talkers: readonly Talker[]; guides: readonly Guide[] }`
  - `peopleLayout(counts: PeopleCounts, frameSlots: readonly FrameSlot[], characterCount?: number): PeopleLayout`
  - `layoutPeopleCount(layout: PeopleLayout): number`

Geometry notes the code relies on (verified against `path.ts`): leg 1 runs from (0, 8) to (0, -26) heading -Z with `right` = +X, path distance 0 to 34. Leg 2 runs from (0, -26) to (-26, -26) heading -X with `right` = -Z, distance 34 to 60. Leg 3 runs from (-26, -26) to (-26, -66) heading -Z with `right` = +X, distance 60 to 100. The hall's group is unrotated, so a frame slot's world z is `PLACES.hall.z + slot.z`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/journey/people-layout.test.ts
import { describe, expect, it } from 'vitest'
import { CORNER_BLOCKS } from '../../app/journey/footprints'
import { HALL_PILLAR_RADIUS, HALL_PILLAR_X, hallFrameSlots, hallPillarZs } from '../../app/journey/hall'
import { LAMP_SPACING_FULL, LAMP_SPACING_LOW_POWER, lampPositions } from '../../app/journey/lamps'
import {
  createGuides, createTalkers, GUIDE_X, guideSlots, layoutPeopleCount, peopleLayout, stretchSegment,
  TALKER_LATERAL, TALKER_RING_RADIUS, WALK_STRETCHES, walkerPoseAt, WALK_TURN_SECONDS, type Walker,
} from '../../app/journey/people-layout'
import { PEOPLE_COUNTS, PERSON_RADIUS, peopleTotal, WALK_SPEED_MAX, WALK_SPEED_MIN } from '../../app/journey/people-specs'
import {
  clearsPath, COURTYARD_DEPTH, PATH_SEGMENTS, PLACES, ROAD_HALF_WIDTH, roadRects, SIDEWALK_OUTER,
} from '../../app/journey/path'

const CHARACTERS = 3
const HALL_FRAMES = hallFrameSlots(8)

interface Circle { x: number; z: number; r: number }
interface Box { x: number; z: number; hx: number; hz: number }

const GATE_PILLAR_HALF = 0.3
const LAMP_POST_RADIUS = 0.05
const COURTYARD_WALL_HALF_THICKNESS = 0.15
const COURTYARD_WALL_OFFSET = 3.5
const MARKET_LAMP_OFFSET = ROAD_HALF_WIDTH + 0.3
// Both lamp layouts, plus the two market posts, which sit at the market center +-3.3 across the road.
const POST_CIRCLES: Circle[] = [
  ...lampPositions(LAMP_SPACING_FULL), ...lampPositions(LAMP_SPACING_LOW_POWER),
  { x: PLACES.market.x, z: PLACES.market.z - MARKET_LAMP_OFFSET }, { x: PLACES.market.x, z: PLACES.market.z + MARKET_LAMP_OFFSET },
].map(point => ({ x: point.x, z: point.z, r: LAMP_POST_RADIUS }))
const PILLAR_CIRCLES: Circle[] = [-1, 1].flatMap(side => hallPillarZs().map(z => (
  { x: side * HALL_PILLAR_X, z: PLACES.hall.z + z, r: HALL_PILLAR_RADIUS })))
const BOXES: Box[] = [
  ...[-1, 1].map(side => ({ x: side * (ROAD_HALF_WIDTH + 0.4), z: PLACES.entrance.z, hx: GATE_PILLAR_HALF, hz: GATE_PILLAR_HALF })),
  ...[-1, 1].map(side => ({ x: PLACES.courtyard.x + side * COURTYARD_WALL_OFFSET, z: PLACES.courtyard.z,
    hx: COURTYARD_WALL_HALF_THICKNESS, hz: COURTYARD_DEPTH / 2 })),
  { x: PLACES.courtyard.x, z: PLACES.courtyard.z - COURTYARD_DEPTH / 2, hx: 3.5, hz: COURTYARD_WALL_HALF_THICKNESS },
  ...CORNER_BLOCKS.map(block => ({ x: block.x, z: block.z, hx: block.width / 2, hz: block.depth / 2 })),
]

function clearanceAt(x: number, z: number): number {
  const circles = [...POST_CIRCLES, ...PILLAR_CIRCLES].map(c => Math.hypot(x - c.x, z - c.z) - c.r)
  const boxes = BOXES.map(b => Math.hypot(Math.max(Math.abs(x - b.x) - b.hx, 0), Math.max(Math.abs(z - b.z) - b.hz, 0)))
  return Math.min(...circles, ...boxes)
}

function insideRoad(x: number, z: number): boolean {
  return roadRects().some(([minX, minZ, maxX, maxZ]) =>
    x > minX - PERSON_RADIUS && x < maxX + PERSON_RADIUS && z > minZ - PERSON_RADIUS && z < maxZ + PERSON_RADIUS)
}

function expectOnSidewalk(x: number, z: number) {
  expect(clearanceAt(x, z)).toBeGreaterThanOrEqual(PERSON_RADIUS)
  expect(insideRoad(x, z)).toBe(false)
  expect(clearsPath(x, z, SIDEWALK_OUTER + PERSON_RADIUS)).toBe(false)
}

function stretchLeg(from: number, to: number): number {
  return PATH_SEGMENTS.findIndex(segment => from >= segment.cumStart && to <= segment.cumStart + segment.length)
}

describe('walk stretches', () => {
  it('lies on one leg each and keeps the road, obstacles, and the sidewalk edge clear', () => {
    for (const stretch of WALK_STRETCHES) {
      expect(stretchLeg(stretch.from, stretch.to), JSON.stringify(stretch)).toBeGreaterThanOrEqual(0)
      const { ax, az, bx, bz } = stretchSegment(stretch)
      for (let i = 0; i <= 20; i++) {
        const f = i / 20
        expectOnSidewalk(ax + (bx - ax) * f, az + (bz - az) * f)
      }
    }
  })
})

function walker(stretch = WALK_STRETCHES[0]!, speed = 0.7, phase = 0): Walker {
  return { stretch, speed, phase, character: 0 }
}

describe('walkerPoseAt', () => {
  it('stays on its stretch, finite, and continuous through turns, even for huge or negative t', () => {
    for (const stretch of WALK_STRETCHES) {
      for (const t0 of [0, 1e7, -3.3]) {
        let previous = walkerPoseAt(walker(stretch), t0)
        const cycle = 2 * ((stretch.to - stretch.from) / 0.7 + WALK_TURN_SECONDS)
        for (let t = t0 + 0.05; t < t0 + cycle + 1; t += 0.05) {
          const pose = walkerPoseAt(walker(stretch), t)
          expect(Number.isFinite(pose.x) && Number.isFinite(pose.z) && Number.isFinite(pose.yaw)).toBe(true)
          expect(pose.distance).toBeGreaterThanOrEqual(stretch.from - 1e-6)
          expect(pose.distance).toBeLessThanOrEqual(stretch.to + 1e-6)
          expect(Math.hypot(pose.x - previous.x, pose.z - previous.z)).toBeLessThanOrEqual(0.7 * 0.05 + 1e-6)
          const turn = Math.atan2(Math.sin(pose.yaw - previous.yaw), Math.cos(pose.yaw - previous.yaw))
          expect(Math.abs(turn)).toBeLessThanOrEqual(0.4)
          previous = { ...pose }
        }
      }
    }
  })

  it('walks forward, turns in place, walks back, and turns again', () => {
    const w = walker(WALK_STRETCHES[0]!, 1, 0)
    const length = w.stretch.to - w.stretch.from
    expect(walkerPoseAt(w, 0).moving).toBe(true)
    const turning = walkerPoseAt(w, length + WALK_TURN_SECONDS / 2)
    expect(turning.moving).toBe(false)
    expect(turning.distance).toBeCloseTo(w.stretch.to, 6)
    expect(walkerPoseAt(w, length + WALK_TURN_SECONDS + length / 2).distance).toBeCloseTo(w.stretch.to - length / 2, 6)
    expect(walkerPoseAt(w, 2 * (length + WALK_TURN_SECONDS)).distance).toBeCloseTo(w.stretch.from, 6)
  })

  it('writes into the pose it is given', () => {
    const out = { x: 0, z: 0, yaw: 0, moving: false, distance: 0 }
    expect(walkerPoseAt(walker(), 4, out)).toBe(out)
  })
})

describe('createTalkers', () => {
  it('stands each group on a sidewalk spot, facing its center, clear of obstacles and each other', () => {
    const talkers = createTalkers(PEOPLE_COUNTS.full.talkerGroups, CHARACTERS)
    expect(talkers).toHaveLength(8)
    for (const talker of talkers) expectOnSidewalk(talker.x, talker.z)
    for (const group of [0, 1, 2]) {
      const members = talkers.filter(talker => talker.group === group)
      const cx = members.reduce((sum, m) => sum + m.x, 0) / members.length
      const cz = members.reduce((sum, m) => sum + m.z, 0) / members.length
      for (const m of members) {
        expect(Math.hypot(m.x - cx, m.z - cz)).toBeCloseTo(TALKER_RING_RADIUS, 6)
        // yaw turns a -Z-facing object toward the center: facing = (-sin yaw, -cos yaw)
        const facing = { x: -Math.sin(m.yaw), z: -Math.cos(m.yaw) }
        expect(facing.x * (cx - m.x) + facing.z * (cz - m.z)).toBeCloseTo(TALKER_RING_RADIUS, 6)
      }
      for (const a of members) for (const b of members) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(2 * PERSON_RADIUS + 0.1)
      }
      expect(new Set(members.map(m => m.character)).size).toBe(members.length)
    }
    expect(TALKER_LATERAL + TALKER_RING_RADIUS + PERSON_RADIUS).toBeLessThanOrEqual(SIDEWALK_OUTER)
  })

  it('throws when there are more groups than spots', () => {
    expect(() => createTalkers([2, 2, 2, 2], CHARACTERS)).toThrow(RangeError)
  })
})

describe('guides', () => {
  it('picks one frame per side, preferring the second bay, and none when there are no frames', () => {
    expect(guideSlots([], 2)).toEqual([])
    const picked = guideSlots(HALL_FRAMES, 2)
    expect(picked.map(slot => slot.side)).toEqual([-1, 1])
    expect(picked[0]).toBe(HALL_FRAMES[1])
    expect(picked[1]).toBe(HALL_FRAMES[5])
  })

  it('uses what exists: a single frame, only the left wall, and the cap of eight', () => {
    expect(guideSlots(hallFrameSlots(1), 2)).toEqual([hallFrameSlots(1)[0]])
    expect(guideSlots(hallFrameSlots(3), 2).map(slot => slot.side)).toEqual([-1])
    expect(guideSlots(hallFrameSlots(12), 2)).toHaveLength(2)
    expect(guideSlots(HALL_FRAMES, 1)).toHaveLength(1)
  })

  it('stands in a bay center, off the road and clear of pillars, facing the wall', () => {
    const guides = createGuides(2, HALL_FRAMES, CHARACTERS)
    expect(guides).toHaveLength(2)
    for (const guide of guides) {
      expectOnSidewalk(guide.x, guide.z)
      expect(Math.abs(guide.x)).toBe(GUIDE_X)
      const facing = { x: -Math.sin(guide.yaw), z: -Math.cos(guide.yaw) }
      expect(facing.x * Math.sign(guide.x)).toBeCloseTo(1, 6)
      expect(Math.abs(facing.z)).toBeLessThan(1e-9)
    }
  })
})

describe('peopleLayout', () => {
  it('matches the per-tier counts and is deterministic', () => {
    const full = peopleLayout(PEOPLE_COUNTS.full, HALL_FRAMES)
    expect(layoutPeopleCount(full)).toBe(peopleTotal(PEOPLE_COUNTS.full))
    expect(peopleLayout(PEOPLE_COUNTS.full, HALL_FRAMES)).toEqual(full)
    expect(layoutPeopleCount(peopleLayout(PEOPLE_COUNTS.lite, HALL_FRAMES))).toBe(peopleTotal(PEOPLE_COUNTS.lite))
    expect(layoutPeopleCount(peopleLayout(PEOPLE_COUNTS.reduced, HALL_FRAMES))).toBe(0)
  })

  it('has no guides without projects, and one with a single project', () => {
    expect(peopleLayout(PEOPLE_COUNTS.full, hallFrameSlots(0)).guides).toHaveLength(0)
    expect(peopleLayout(PEOPLE_COUNTS.full, hallFrameSlots(1)).guides).toHaveLength(1)
  })

  it('gives walkers a speed in range and every person a valid character', () => {
    const layout = peopleLayout(PEOPLE_COUNTS.full, HALL_FRAMES)
    for (const w of layout.walkers) {
      expect(w.speed).toBeGreaterThanOrEqual(WALK_SPEED_MIN)
      expect(w.speed).toBeLessThanOrEqual(WALK_SPEED_MAX)
    }
    const characters = [...layout.walkers, ...layout.talkers, ...layout.guides].map(person => person.character)
    for (const character of characters) expect(character).toBeLessThan(CHARACTERS)
  })

  it('keeps standing people clear of every walker stretch', () => {
    const layout = peopleLayout(PEOPLE_COUNTS.full, HALL_FRAMES)
    const minimum = 2 * PERSON_RADIUS + 0.1
    for (const person of [...layout.talkers, ...layout.guides]) {
      for (const stretch of WALK_STRETCHES) {
        const { ax, az, bx, bz } = stretchSegment(stretch)
        const dx = bx - ax
        const dz = bz - az
        const f = Math.min(Math.max(((person.x - ax) * dx + (person.z - az) * dz) / (dx * dx + dz * dz), 0), 1)
        expect(Math.hypot(person.x - (ax + dx * f), person.z - (az + dz * f))).toBeGreaterThanOrEqual(minimum)
      }
    }
  })

  it('rejects more walkers than stretches', () => {
    expect(() => peopleLayout({ walkers: 7, talkerGroups: [], guides: 0 }, HALL_FRAMES)).toThrow(RangeError)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/journey/people-layout.test.ts`
Expected: FAIL, "Failed to resolve import ../../app/journey/people-layout".

- [ ] **Step 3: Write `app/journey/people-layout.ts`**

```ts
import { type FrameSlot } from './hall'
import { headingFor, PATH_SEGMENTS, pathPointAt, PLACES } from './path'
import { CHARACTER_SPECS, type PeopleCounts, PEOPLE_SEED, WALK_SPEED_MAX, WALK_SPEED_MIN } from './people-specs'
import { seeded } from './random'

// Lateral offset of a walker from the road center line. The sidewalk strip is 3.0 to 3.9 wide and the lamp
// posts stand at 3.3, so walkers use the outer part of the strip.
export const WALK_OFFSET = 3.65
// Inside the hall the pillars stand at 3.6 with radius 0.26. A walker keeps to the road side of them.
export const HALL_WALK_OFFSET = 3.15
export const WALK_TURN_SECONDS = 0.6

// A straight piece of sidewalk, in path distance, that one walker patrols. Each lies on a single leg and
// stops short of the entrance gate pillars, the courtyard walls, the corner blocks, and the road corners.
// Ordered so the first three (the `lite` count) are spread over the street.
export interface WalkStretch {
  side: 1 | -1
  from: number
  to: number
  offset: number
}

// The two stretches on a side that also holds a talker spot end 3.5 units short of it.
export const WALK_STRETCHES: readonly WalkStretch[] = [
  { side: -1, from: 40, to: 51, offset: WALK_OFFSET },
  { side: -1, from: 12.4, to: 27.6, offset: HALL_WALK_OFFSET },
  { side: 1, from: 63.5, to: 75, offset: WALK_OFFSET },
  { side: 1, from: 37.5, to: 53.5, offset: WALK_OFFSET },
  { side: 1, from: 12.4, to: 27.6, offset: HALL_WALK_OFFSET },
  { side: -1, from: 69.5, to: 75, offset: WALK_OFFSET },
]

export interface Walker {
  stretch: WalkStretch
  // Units per second.
  speed: number
  // Seconds added to `t`, so walkers do not start together.
  phase: number
  character: number
}

export interface WalkerPose {
  x: number
  z: number
  yaw: number
  // False while the walker turns in place at an end.
  moving: boolean
  // Path distance of the walker, for the camera-distance checks.
  distance: number
}

const PHASE_RANGE = 60

function pointOn(stretch: WalkStretch, distance: number): { x: number; z: number } {
  const point = pathPointAt(distance)
  return {
    x: point.x + point.rightX * stretch.side * stretch.offset,
    z: point.z + point.rightZ * stretch.side * stretch.offset,
  }
}

export function stretchSegment(stretch: WalkStretch): { ax: number; az: number; bx: number; bz: number } {
  const a = pointOn(stretch, stretch.from)
  const b = pointOn(stretch, stretch.to)
  return { ax: a.x, az: a.z, bx: b.x, bz: b.z }
}

// A pure function of `t`: walk to the far end, turn in place, walk back, turn in place, repeat. The modulo
// runs in double precision, so a large `t` loses nothing, and a negative `t` wraps.
export function walkerPoseAt(
  walker: Walker,
  t: number,
  out: WalkerPose = { x: 0, z: 0, yaw: 0, moving: true, distance: 0 },
): WalkerPose {
  const { stretch, speed } = walker
  const length = stretch.to - stretch.from
  const walkTime = length / speed
  const half = walkTime + WALK_TURN_SECONDS
  const cycle = 2 * half
  const raw = (t + walker.phase) % cycle
  const clock = raw < 0 ? raw + cycle : raw
  const outbound = clock < half
  const local = outbound ? clock : clock - half
  const fraction = Math.min(local, walkTime) / walkTime
  const along = outbound ? fraction * length : length - fraction * length
  const distance = stretch.from + along
  const point = pathPointAt(distance)
  const sign = outbound ? 1 : -1
  const baseYaw = headingFor(sign * point.dirX, sign * point.dirZ)
  const position = pointOn(stretch, distance)
  const walking = local < walkTime
  out.x = position.x
  out.z = position.z
  out.yaw = walking ? baseYaw : baseYaw + Math.PI * ((local - walkTime) / WALK_TURN_SECONDS)
  out.moving = walking
  out.distance = distance
  return out
}

export function createWalkers(count: number, characterCount: number): Walker[] {
  if (count > WALK_STRETCHES.length) throw new RangeError(`There are ${WALK_STRETCHES.length} walk stretches, not ${count}`)
  return WALK_STRETCHES.slice(0, count).map((stretch, i) => ({
    stretch,
    speed: WALK_SPEED_MIN + (WALK_SPEED_MAX - WALK_SPEED_MIN) * seeded(PEOPLE_SEED + i),
    phase: seeded(PEOPLE_SEED + 50 + i) * PHASE_RANGE,
    character: i % characterCount,
  }))
}

// Where a standing group's center sits: a path distance and a side. The three spots keep clear of the
// lamp stations (every 6 from 3), the gate pillars, and the hall.
export interface TalkerSpot {
  distance: number
  side: 1 | -1
}

export const TALKER_SPOTS: readonly TalkerSpot[] = [
  { distance: 54.5, side: -1 },
  { distance: 65.5, side: -1 },
  { distance: 7.8, side: 1 },
]
// Group center lateral offset and the ring the members stand on. The ring stays inside the 3.0 to 3.9 strip.
export const TALKER_LATERAL = 3.45
export const TALKER_RING_RADIUS = 0.28

export interface Talker {
  x: number
  z: number
  yaw: number
  character: number
  distance: number
  group: number
}

export function createTalkers(groupSizes: readonly number[], characterCount: number): Talker[] {
  if (groupSizes.length > TALKER_SPOTS.length) throw new RangeError(`There are ${TALKER_SPOTS.length} talker spots, not ${groupSizes.length}`)
  const talkers: Talker[] = []
  groupSizes.forEach((size, group) => {
    const spot = TALKER_SPOTS[group]
    if (!spot) return
    const point = pathPointAt(spot.distance)
    const centerX = point.x + point.rightX * spot.side * TALKER_LATERAL
    const centerZ = point.z + point.rightZ * spot.side * TALKER_LATERAL
    const phase = seeded(PEOPLE_SEED + 100 + group) * Math.PI * 2
    for (let member = 0; member < size; member++) {
      const angle = phase + (2 * Math.PI * member) / size
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      talkers.push({
        x: centerX + TALKER_RING_RADIUS * cos,
        z: centerZ + TALKER_RING_RADIUS * sin,
        yaw: headingFor(-cos, -sin),
        character: (group + member) % characterCount,
        distance: spot.distance,
        group,
      })
    }
  })
  return talkers
}

// Guides stand between the pillars and the wall, a little off the sidewalk's outer edge of the pillars.
export const GUIDE_X = 3.7
// Per side, the first bay in this order that holds a frame.
const BAY_PREFERENCE = [1, 0, 2, 3] as const

export interface Guide {
  x: number
  z: number
  yaw: number
  character: number
  distance: number
}

export function guideSlots(frameSlots: readonly FrameSlot[], count: number): FrameSlot[] {
  const picked: FrameSlot[] = []
  for (const side of [-1, 1] as const) {
    const sideSlots = frameSlots.filter(slot => slot.side === side)
    const slot = BAY_PREFERENCE.map(bay => sideSlots[bay]).find(candidate => candidate !== undefined)
    if (slot) picked.push(slot)
  }
  return picked.slice(0, count)
}

const LEG_ONE = PATH_SEGMENTS[0]

export function createGuides(count: number, frameSlots: readonly FrameSlot[], characterCount: number): Guide[] {
  if (!LEG_ONE) throw new Error('expected path segment 0')
  return guideSlots(frameSlots, count).map((slot, i) => {
    const z = PLACES.hall.z + slot.z
    return {
      x: slot.side * GUIDE_X,
      z,
      yaw: headingFor(slot.side, 0),
      character: (i + 1) % characterCount,
      // The hall stands on leg 1, which runs toward -Z from its start.
      distance: LEG_ONE.fromZ - z,
    }
  })
}

export interface PeopleLayout {
  walkers: readonly Walker[]
  talkers: readonly Talker[]
  guides: readonly Guide[]
}

export function peopleLayout(
  counts: PeopleCounts,
  frameSlots: readonly FrameSlot[],
  characterCount = CHARACTER_SPECS.length,
): PeopleLayout {
  return {
    walkers: createWalkers(counts.walkers, characterCount),
    talkers: createTalkers(counts.talkerGroups, characterCount),
    guides: createGuides(counts.guides, frameSlots, characterCount),
  }
}

export function layoutPeopleCount(layout: PeopleLayout): number {
  return layout.walkers.length + layout.talkers.length + layout.guides.length
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/journey/people-layout.test.ts`
Expected: PASS.

If a clearance or sidewalk test fails, the failure message names the stretch or person. Fix by moving that stretch's `from`/`to` or that spot's `distance` by 0.5 units away from the named obstacle, and run again. Do not loosen `PERSON_RADIUS` or the thresholds in the tests.

- [ ] **Step 5: Commit**

```bash
git add app/journey/people-layout.ts tests/journey/people-layout.test.ts
git commit -m "feat: place walkers, talkers, and hall guides on the sidewalks"
```

---

### Task 4: Skinned rig merge and normalization

**Files:**
- Create: `app/journey/people-rig.ts`
- Create: `tests/journey/support/fake-rig.ts`
- Test: `tests/journey/people-rig.test.ts`

**Interfaces:**
- Consumes: `CLIP_NAMES`, `ClipName`, `PEOPLE_CLIPS`, `PERSON_HEIGHT`, `MODEL_FACING_Y` from `./people-specs`.
- Produces, from `app/journey/people-rig.ts`:
  - `interface PersonTemplate { readonly root: THREE.Group; readonly clips: Readonly<Record<ClipName, THREE.AnimationClip>>; readonly material: THREE.MeshStandardMaterial; readonly geometry: THREE.BufferGeometry; readonly map: THREE.Texture | null }`
  - `collectSkinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[]`
  - `mergeSkinnedParts(meshes: readonly THREE.SkinnedMesh[]): { geometry: THREE.BufferGeometry; map: THREE.Texture | null }`
  - `buildPersonTemplate(scene: THREE.Object3D, animations: readonly THREE.AnimationClip[]): PersonTemplate`
  - `disposePersonTemplate(template: PersonTemplate): void`
  - The merged mesh is named `'person-body'`.
- Produces, from `tests/journey/support/fake-rig.ts` (used by Tasks 4, 5, 6):
  - `RIG_HEIGHT = 1.8`; `fakeRigScene(): THREE.Group`; `fakeClips(): THREE.AnimationClip[]`; `fakeTemplate(): PersonTemplate`

- [ ] **Step 1: Write the test support file**

```ts
// tests/journey/support/fake-rig.ts
import * as THREE from 'three'
import { buildPersonTemplate, type PersonTemplate } from '../../../app/journey/people-rig'
import { CLIP_NAMES, PEOPLE_CLIPS } from '../../../app/journey/people-specs'

export const RIG_HEIGHT = 1.8
const HIPS_HEIGHT = 0.9

function skinned(skeleton: THREE.Skeleton, boneIndex: number, box: THREE.BoxGeometry, color: number): THREE.SkinnedMesh {
  const count = box.getAttribute('position').count
  box.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? boneIndex : 0)), 4))
  box.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4))
  return new THREE.SkinnedMesh(box, new THREE.MeshStandardMaterial({ color }))
}

// A stand-in character: legs and a torso as two skinned parts with different skeleton bone orders, so the
// merge must remap bones by name. Feet at y = 0, head top at RIG_HEIGHT, facing +Z like a glTF character.
export function fakeRigScene(): THREE.Group {
  const hips = new THREE.Bone()
  hips.name = 'Hips'
  hips.position.y = HIPS_HEIGHT
  const head = new THREE.Bone()
  head.name = 'Head'
  head.position.y = HIPS_HEIGHT
  hips.add(head)
  const scene = new THREE.Group()
  scene.add(hips)
  scene.updateMatrixWorld(true)

  const legs = skinned(new THREE.Skeleton([hips, head]), 0, new THREE.BoxGeometry(0.3, HIPS_HEIGHT, 0.2), 0x3355aa)
  legs.geometry.translate(0, HIPS_HEIGHT / 2, 0)
  const torso = skinned(new THREE.Skeleton([head, hips]), 1, new THREE.BoxGeometry(0.4, HIPS_HEIGHT, 0.2), 0xaa3333)
  torso.geometry.translate(0, HIPS_HEIGHT * 1.5, 0)
  scene.add(legs, torso)
  scene.updateMatrixWorld(true)
  legs.bind(legs.skeleton)
  torso.bind(torso.skeleton)
  return scene
}

// One clip per distinct name, so a model whose talk clip is its idle clip works too.
export function fakeClips(): THREE.AnimationClip[] {
  return [...new Set(CLIP_NAMES.map(name => PEOPLE_CLIPS[name]))].map(name =>
    new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack('Hips.position[y]', [0, 1], [HIPS_HEIGHT, HIPS_HEIGHT + 0.05])]))
}

export function fakeTemplate(): PersonTemplate {
  return buildPersonTemplate(fakeRigScene(), fakeClips())
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/journey/people-rig.test.ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  buildPersonTemplate, collectSkinnedMeshes, disposePersonTemplate, mergeSkinnedParts,
} from '../../app/journey/people-rig'
import { CLIP_NAMES, PEOPLE_CLIPS, PERSON_HEIGHT } from '../../app/journey/people-specs'
import { fakeClips, fakeRigScene } from './support/fake-rig'

describe('mergeSkinnedParts', () => {
  it('merges the parts into one geometry and remaps bones by name', () => {
    const scene = fakeRigScene()
    const parts = collectSkinnedMeshes(scene)
    expect(parts).toHaveLength(2)
    const { geometry, map } = mergeSkinnedParts(parts)
    const reference = parts[0]!.skeleton.bones.map(bone => bone.name)
    const index = geometry.getAttribute('skinIndex')
    const weight = geometry.getAttribute('skinWeight')
    const total = geometry.getAttribute('position').count
    expect(total).toBe(parts.reduce((sum, part) => sum + part.geometry.toNonIndexed().getAttribute('position').count, 0))
    for (let i = 0; i < total; i++) {
      // Every vertex is fully weighted to Hips, the same bone by name in both parts, whichever order they list it.
      expect(weight.getComponent(i, 0)).toBe(1)
      expect(reference[index.getComponent(i, 0)]).toBe('Hips')
    }
    expect(geometry.getAttribute('color')).toBeDefined()
    expect(map).toBeNull()
  })

  it('bakes each part material color into vertex colors', () => {
    const { geometry } = mergeSkinnedParts(collectSkinnedMeshes(fakeRigScene()))
    const colors = new Set<string>()
    const color = geometry.getAttribute('color')
    for (let i = 0; i < color.count; i++) colors.add([color.getX(i), color.getY(i), color.getZ(i)].map(v => v.toFixed(3)).join(','))
    expect(colors.size).toBe(2)
  })

  it('throws when a part uses a bone the reference skeleton lacks', () => {
    const parts = collectSkinnedMeshes(fakeRigScene())
    // Bone objects are shared between skeletons, so swap in a new bone instead of renaming one.
    const stranger = new THREE.Bone()
    stranger.name = 'Stranger'
    parts[1]!.skeleton.bones[1] = stranger
    expect(() => mergeSkinnedParts(parts)).toThrow(/Stranger/)
  })

  it('throws when the parts use different textures', () => {
    const parts = collectSkinnedMeshes(fakeRigScene())
    ;(parts[0]!.material as THREE.MeshStandardMaterial).map = new THREE.Texture()
    expect(() => mergeSkinnedParts(parts)).toThrow(/textures/)
  })

  it('throws when there are no parts', () => {
    expect(() => mergeSkinnedParts([])).toThrow(/no skinned meshes/)
  })
})

function bodyBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true)
  const body = root.getObjectByName('person-body') as THREE.SkinnedMesh
  body.computeBoundingBox()
  return body.boundingBox!.clone().applyMatrix4(body.matrixWorld)
}

describe('buildPersonTemplate', () => {
  it('leaves one skinned mesh, scales to PERSON_HEIGHT, and stands the feet on y = 0', () => {
    const template = buildPersonTemplate(fakeRigScene(), fakeClips())
    expect(collectSkinnedMeshes(template.root)).toHaveLength(1)
    const box = bodyBox(template.root)
    expect(box.max.y - box.min.y).toBeCloseTo(PERSON_HEIGHT, 4)
    expect(box.min.y).toBeCloseTo(0, 4)
    disposePersonTemplate(template)
  })

  it('turns a +Z-facing model to face -Z', () => {
    const scene = fakeRigScene()
    const template = buildPersonTemplate(scene, fakeClips())
    template.root.updateMatrixWorld(true)
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(scene.getWorldQuaternion(new THREE.Quaternion()))
    expect(forward.z).toBeLessThan(-0.99)
    disposePersonTemplate(template)
  })

  it('returns the clips by role and shares one for talk and idle when they are the same', () => {
    const template = buildPersonTemplate(fakeRigScene(), fakeClips())
    for (const name of CLIP_NAMES) expect(template.clips[name].name).toBe(PEOPLE_CLIPS[name])
    if (PEOPLE_CLIPS.talk === PEOPLE_CLIPS.idle) expect(template.clips.talk).toBe(template.clips.idle)
    disposePersonTemplate(template)
  })

  it('names the missing clip and the ones it has', () => {
    const clips = fakeClips().filter(clip => clip.name !== PEOPLE_CLIPS.walk)
    expect(() => buildPersonTemplate(fakeRigScene(), clips)).toThrow(new RegExp(`"${PEOPLE_CLIPS.walk}"`))
  })

  it('does not scale by the source height: a taller rig ends up the same height', () => {
    const scene = fakeRigScene()
    scene.scale.setScalar(2)
    const template = buildPersonTemplate(scene, fakeClips())
    const box = bodyBox(template.root)
    expect(box.max.y - box.min.y).toBeCloseTo(PERSON_HEIGHT, 4)
    disposePersonTemplate(template)
  })
})
```

Note on the last test: `buildPersonTemplate` resets the scene's scale and position (`scene.scale.setScalar(1)` before measuring), so a pre-scaled source ends at the same height. If the real GLB scene root has a meaningful transform (it normally does not), the implementer notes it in the commit message.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/journey/people-rig.test.ts`
Expected: FAIL, "Failed to resolve import ../../app/journey/people-rig".

- [ ] **Step 4: Write `app/journey/people-rig.ts`**

```ts
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { type ClipName, MODEL_FACING_Y, PEOPLE_CLIPS, PERSON_HEIGHT } from './people-specs'

export interface PersonTemplate {
  // Group holding the normalized model: facing -Z, PERSON_HEIGHT tall, feet on y = 0. Clone it per person.
  readonly root: THREE.Group
  readonly clips: Readonly<Record<ClipName, THREE.AnimationClip>>
  readonly material: THREE.MeshStandardMaterial
  readonly geometry: THREE.BufferGeometry
  readonly map: THREE.Texture | null
}

const KEPT_ATTRIBUTES = new Set(['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'color'])
const MATRIX_TOLERANCE = 1e-5
const SKIN_COMPONENTS = 4
export const BODY_NAME = 'person-body'

export function collectSkinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = []
  root.traverse(object => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh)
  })
  return meshes
}

function sameMatrix(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  return a.elements.every((value, i) => Math.abs(value - (b.elements[i] ?? Number.NaN)) <= MATRIX_TOLERANCE)
}

function materialOf(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  const standard = material as THREE.MeshStandardMaterial | undefined
  if (!standard?.color) throw new Error('A person part has no color material')
  return standard
}

// Rewrites the part's bone indices so they point into the reference skeleton's bone list, by bone name.
function remapSkinIndices(geometry: THREE.BufferGeometry, from: readonly THREE.Bone[], to: ReadonlyMap<string, number>): void {
  const indices = geometry.getAttribute('skinIndex')
  const weights = geometry.getAttribute('skinWeight')
  for (let i = 0; i < indices.count; i++) {
    for (let c = 0; c < SKIN_COMPONENTS; c++) {
      if (weights.getComponent(i, c) === 0) {
        indices.setComponent(i, c, 0)
        continue
      }
      const local = indices.getComponent(i, c)
      const name = from[local]?.name
      const target = name === undefined ? undefined : to.get(name)
      if (target === undefined) throw new Error(`Bone "${name ?? local}" is not in the reference skeleton`)
      indices.setComponent(i, c, target)
    }
  }
}

function bakeColor(geometry: THREE.BufferGeometry, color: THREE.Color): void {
  const count = geometry.getAttribute('position').count
  const data = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    data[i * 3] = color.r
    data[i * 3 + 1] = color.g
    data[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(data, 3))
}

// Merges the modular parts of one character into a single geometry that skins against the first part's
// skeleton. The parts must share a frame and a texture (or have none); their flat material colors become
// vertex colors, so one material draws the whole person.
export function mergeSkinnedParts(meshes: readonly THREE.SkinnedMesh[]): { geometry: THREE.BufferGeometry; map: THREE.Texture | null } {
  const reference = meshes[0]
  if (!reference) throw new Error('The person model has no skinned meshes')
  const indexByName = new Map<string, number>()
  reference.skeleton.bones.forEach((bone, i) => {
    if (indexByName.has(bone.name)) throw new Error(`The skeleton has two bones named "${bone.name}"`)
    indexByName.set(bone.name, i)
  })
  const map = materialOf(reference).map ?? null
  const prepared: THREE.BufferGeometry[] = []
  try {
    for (const mesh of meshes) {
      if (mesh.parent !== reference.parent || !sameMatrix(mesh.matrix, reference.matrix) || !sameMatrix(mesh.bindMatrix, reference.bindMatrix)) {
        throw new Error('The person parts do not share one frame')
      }
      const material = materialOf(mesh)
      if ((material.map ?? null) !== map) throw new Error('The person parts use different textures')
      const copy = mesh.geometry.clone()
      for (const name of Object.keys(copy.attributes)) if (!KEPT_ATTRIBUTES.has(name)) copy.deleteAttribute(name)
      remapSkinIndices(copy, mesh.skeleton.bones, indexByName)
      bakeColor(copy, material.color)
      // mergeGeometries needs every part indexed or none; flattening keeps it simple at these polygon counts.
      const flat = copy.index ? copy.toNonIndexed() : copy
      if (flat !== copy) copy.dispose()
      prepared.push(flat)
    }
    const merged = mergeGeometries(prepared, false)
    if (!merged) throw new Error('The person parts have incompatible attributes')
    return { geometry: merged, map }
  } finally {
    for (const geometry of prepared) geometry.dispose()
  }
}

export function createPersonMaterial(map: THREE.Texture | null): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map, vertexColors: true, roughness: 0.85, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0,
  })
  material.name = 'journey-street-person'
  return material
}

function pickClips(animations: readonly THREE.AnimationClip[]): Record<ClipName, THREE.AnimationClip> {
  const byName = new Map(animations.map(clip => [clip.name, clip] as const))
  function pick(role: ClipName): THREE.AnimationClip {
    const clip = byName.get(PEOPLE_CLIPS[role])
    if (!clip) throw new Error(`The person model has no "${PEOPLE_CLIPS[role]}" clip for ${role}. It has: ${[...byName.keys()].join(', ')}`)
    return clip
  }
  return { walk: pick('walk'), idle: pick('idle'), talk: pick('talk') }
}

// Turns a loaded character into a template: one skinned mesh, facing -Z, PERSON_HEIGHT tall, feet on y = 0.
// Takes ownership of `scene`: it removes the original parts and disposes their geometries and materials.
export function buildPersonTemplate(scene: THREE.Object3D, animations: readonly THREE.AnimationClip[]): PersonTemplate {
  const clips = pickClips(animations)
  const parts = collectSkinnedMeshes(scene)
  const reference = parts[0]
  const parent = reference?.parent
  if (!reference || !parent) throw new Error('The person model has no skinned meshes')
  scene.updateWorldMatrix(true, true)
  const { geometry, map } = mergeSkinnedParts(parts)
  const material = createPersonMaterial(map)
  try {
    const body = new THREE.SkinnedMesh(geometry, material)
    body.name = BODY_NAME
    body.frustumCulled = false
    reference.matrix.decompose(body.position, body.quaternion, body.scale)
    parent.add(body)
    body.bind(reference.skeleton, reference.bindMatrix)
    for (const part of parts) {
      part.parent?.remove(part)
      part.geometry.dispose()
      materialOf(part).dispose()
    }

    const root = new THREE.Group()
    root.name = 'person'
    root.add(scene)
    scene.position.set(0, 0, 0)
    scene.scale.setScalar(1)
    scene.rotateY(MODEL_FACING_Y)
    root.updateMatrixWorld(true)
    body.computeBoundingBox()
    const box = (body.boundingBox ?? new THREE.Box3()).clone().applyMatrix4(body.matrixWorld)
    const height = box.max.y - box.min.y
    if (!(height > 0) || !Number.isFinite(height)) throw new Error(`The person model has no usable height (${height})`)
    const scale = PERSON_HEIGHT / height
    scene.scale.setScalar(scale)
    scene.position.y = -box.min.y * scale
    return { root, clips, material, geometry, map }
  } catch (error) {
    geometry.dispose()
    material.dispose()
    throw error
  }
}

export function disposePersonTemplate(template: PersonTemplate): void {
  template.geometry.dispose()
  template.material.dispose()
  template.map?.dispose()
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/journey/people-rig.test.ts`
Expected: PASS.

If `SkinnedMesh.computeBoundingBox` or `bind` behaves differently in the node environment, read the failing assertion before changing code. The merge test (bone remap) and the height test are the two that pin the behavior.

- [ ] **Step 6: Commit**

```bash
git add app/journey/people-rig.ts tests/journey/people-rig.test.ts tests/journey/support/fake-rig.ts
git commit -m "feat: merge and normalize skinned person models"
```

---

### Task 5: Generic model swap and the people loader

**Files:**
- Create: `app/journey/model-swap.ts`
- Create: `app/journey/people-models.ts`
- Modify: `app/journey/vehicle-models.ts` (`attachVehicleModels` becomes a thin wrapper over `attachModels`)
- Test: `tests/journey/model-swap.test.ts`, `tests/journey/people-models.test.ts`

**Interfaces:**
- Consumes: `buildPersonTemplate`, `disposePersonTemplate`, `PersonTemplate` from `./people-rig`; `CHARACTER_SPECS`, `PEOPLE_MODEL_DIR` from `./people-specs`; test support `fakeRigScene`, `fakeClips` from Task 4.
- Produces:
  - From `model-swap.ts`: `interface ModelSwapTarget<TModels> { stageModels(models: TModels): void; showModels(): void; discardModels(): void }`; `interface AttachModelsOptions<TModels> { target: ModelSwapTarget<TModels>; load: () => Promise<TModels>; disposeModels: (models: TModels) => void; isDisposed: () => boolean; warm?: () => Promise<void>; onReady?: () => void; onError?: (error: unknown) => void }`; `attachModels<TModels>(options: AttachModelsOptions<TModels>): Promise<void>` (never rejects)
  - From `people-models.ts`: `interface PeopleModels { readonly templates: readonly PersonTemplate[] }`; `type PeopleGltfSource = (url: string) => Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>`; `loadPeopleModels(source?: PeopleGltfSource): Promise<PeopleModels>`; `disposePeopleModels(models: PeopleModels): void`; `type PeopleModelTarget = ModelSwapTarget<PeopleModels>`; `attachPeopleModels(options: AttachPeopleModelsOptions): Promise<void>` with `AttachPeopleModelsOptions { people: PeopleModelTarget; load; isDisposed; warm?; onReady?; onError? }`

- [ ] **Step 1: Write the failing generic swap tests**

```ts
// tests/journey/model-swap.test.ts
import { describe, expect, it, vi } from 'vitest'
import { attachModels, type ModelSwapTarget } from '../../app/journey/model-swap'

interface Models { id: string }
const models: Models = { id: 'm' }

function setup(overrides: Partial<{ stage: () => void; load: () => Promise<Models>; warm: () => Promise<void>; disposed: () => boolean }> = {}) {
  const calls: string[] = []
  const target: ModelSwapTarget<Models> = {
    stageModels: () => { calls.push('stage'); overrides.stage?.() },
    showModels: () => calls.push('show'),
    discardModels: () => calls.push('discard'),
  }
  const options = {
    target,
    load: overrides.load ?? (async () => models),
    disposeModels: () => calls.push('dispose'),
    isDisposed: overrides.disposed ?? (() => false),
    warm: overrides.warm ?? (async () => { calls.push('warm') }),
    onReady: vi.fn(() => calls.push('ready')),
    onError: vi.fn(),
  }
  return { calls, options }
}

describe('attachModels', () => {
  it('stages, warms, shows, then reports ready', async () => {
    const { calls, options } = setup()
    await attachModels(options)
    expect(calls).toEqual(['stage', 'warm', 'show', 'ready'])
    expect(options.onError).not.toHaveBeenCalled()
  })

  it('reports a failed load once and stages nothing', async () => {
    const { calls, options } = setup({ load: async () => { throw new Error('404') } })
    await attachModels(options)
    expect(calls).toEqual([])
    expect(options.onError).toHaveBeenCalledTimes(1)
  })

  it('disposes the models when the scene is disposed during the load, and reports nothing', async () => {
    const { calls, options } = setup({ disposed: () => true })
    await attachModels(options)
    expect(calls).toEqual(['dispose'])
    expect(options.onError).not.toHaveBeenCalled()
  })

  it('disposes the models and reports when staging throws', async () => {
    const { calls, options } = setup({ stage: () => { throw new Error('stage') } })
    await attachModels(options)
    expect(calls).toEqual(['stage', 'dispose'])
    expect(options.onError).toHaveBeenCalledTimes(1)
  })

  it('discards and reports when the warmup fails', async () => {
    const { calls, options } = setup({ warm: async () => { throw new Error('compile') } })
    await attachModels(options)
    expect(calls).toEqual(['stage', 'discard'])
    expect(options.onError).toHaveBeenCalledTimes(1)
  })

  it('discards without reporting when the scene is disposed during the warmup', async () => {
    let disposed = false
    const { calls, options } = setup({ disposed: () => disposed, warm: async () => { disposed = true } })
    await attachModels(options)
    expect(calls).toEqual(['stage', 'discard'])
    expect(options.onError).not.toHaveBeenCalled()
    expect(options.onReady).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/journey/model-swap.test.ts`
Expected: FAIL, "Failed to resolve import ../../app/journey/model-swap".

- [ ] **Step 3: Write `app/journey/model-swap.ts`**

```ts
// The part of a model owner (traffic, people) that the swap drives. Kept structural so tests pass fakes.
export interface ModelSwapTarget<TModels> {
  stageModels(models: TModels): void
  showModels(): void
  discardModels(): void
}

export interface AttachModelsOptions<TModels> {
  target: ModelSwapTarget<TModels>
  load: () => Promise<TModels>
  disposeModels: (models: TModels) => void
  isDisposed: () => boolean
  // Runs after the models are staged (hidden) and before they show. The scene compiles their shaders here.
  warm?: () => Promise<void>
  onReady?: () => void
  // Called at most once, and never after the scene is disposed.
  onError?: (error: unknown) => void
}

// Never rejects. A failed load, a rejected stage, or a failed warmup leaves the scene as it was. After the
// scene is disposed it reports nothing and shows nothing.
export async function attachModels<TModels>(options: AttachModelsOptions<TModels>): Promise<void> {
  const { target, load, disposeModels, isDisposed, warm, onReady, onError } = options
  const report = (error: unknown) => { if (!isDisposed()) onError?.(error) }
  let models: TModels
  try {
    models = await load()
  } catch (error) {
    report(error)
    return
  }
  if (isDisposed()) {
    disposeModels(models)
    return
  }
  try {
    target.stageModels(models)
  } catch (error) {
    disposeModels(models)
    report(error)
    return
  }
  // From here the target owns the models: `discardModels` disposes them.
  try {
    await warm?.()
    if (isDisposed()) {
      target.discardModels()
      return
    }
    target.showModels()
  } catch (error) {
    target.discardModels()
    report(error)
    return
  }
  onReady?.()
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/journey/model-swap.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Make `attachVehicleModels` use it**

In `app/journey/vehicle-models.ts`, replace the body of `attachVehicleModels` (everything from `const { traffic, load, isDisposed, warm, onReady, onError } = options` to the closing brace) with:

```ts
export async function attachVehicleModels(options: AttachVehicleModelsOptions): Promise<void> {
  const { traffic, load, isDisposed, warm, onReady, onError } = options
  return attachModels({ target: traffic, load, disposeModels: disposeVehicleModels, isDisposed, warm, onReady, onError })
}
```

Keep the doc comment above it. Add `import { attachModels } from './model-swap'`. Make `VehicleModelTarget` stay as declared (it is structurally a `ModelSwapTarget<VehicleModels>`).

- [ ] **Step 6: Run the existing vehicle tests as the regression check**

Run: `npx vitest run tests/journey/vehicle-models.test.ts tests/journey/traffic.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 7: Write the failing people loader tests**

```ts
// tests/journey/people-models.test.ts
import { describe, expect, it } from 'vitest'
import { disposePeopleModels, loadPeopleModels, type PeopleGltfSource } from '../../app/journey/people-models'
import { CHARACTER_SPECS, PEOPLE_CLIPS, PEOPLE_MODEL_DIR } from '../../app/journey/people-specs'
import { fakeClips, fakeRigScene } from './support/fake-rig'

const goodSource: PeopleGltfSource = async () => ({ scene: fakeRigScene(), animations: fakeClips() })

describe('loadPeopleModels', () => {
  it('builds one template per character from the model directory', async () => {
    const urls: string[] = []
    const models = await loadPeopleModels(async url => { urls.push(url); return goodSource(url) })
    expect(urls.sort()).toEqual(CHARACTER_SPECS.map(spec => PEOPLE_MODEL_DIR + spec.file).sort())
    expect(models.templates).toHaveLength(CHARACTER_SPECS.length)
    disposePeopleModels(models)
  })

  it('rejects when a download fails', async () => {
    const source: PeopleGltfSource = async url => {
      if (url.endsWith(CHARACTER_SPECS[1]!.file)) throw new Error('404')
      return goodSource(url)
    }
    await expect(loadPeopleModels(source)).rejects.toThrow('404')
  })

  it('rejects, naming the clip, when a model lacks one', async () => {
    const source: PeopleGltfSource = async () => ({
      scene: fakeRigScene(), animations: fakeClips().filter(clip => clip.name !== PEOPLE_CLIPS.walk),
    })
    await expect(loadPeopleModels(source)).rejects.toThrow(new RegExp(`"${PEOPLE_CLIPS.walk}"`))
  })

  it('rejects when only the last model is bad, after the earlier templates were built', async () => {
    let call = 0
    const source: PeopleGltfSource = async () => {
      call += 1
      return { scene: fakeRigScene(), animations: call === CHARACTER_SPECS.length ? [] : fakeClips() }
    }
    await expect(loadPeopleModels(source)).rejects.toThrow(/clip/)
  })
})
```

- [ ] **Step 8: Run to verify it fails**

Run: `npx vitest run tests/journey/people-models.test.ts`
Expected: FAIL, "Failed to resolve import ../../app/journey/people-models".

- [ ] **Step 9: Write `app/journey/people-models.ts`**

```ts
import * as THREE from 'three'
import { attachModels, type ModelSwapTarget } from './model-swap'
import { buildPersonTemplate, disposePersonTemplate, type PersonTemplate } from './people-rig'
import { CHARACTER_SPECS, PEOPLE_MODEL_DIR } from './people-specs'

export interface PeopleModels {
  readonly templates: readonly PersonTemplate[]
}

export type PeopleGltfSource = (url: string) => Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>

async function loadGltf(url: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  return new GLTFLoader().loadAsync(url)
}

export async function loadPeopleModels(source: PeopleGltfSource = loadGltf): Promise<PeopleModels> {
  const loaded = await Promise.all(CHARACTER_SPECS.map(spec => source(PEOPLE_MODEL_DIR + spec.file)))
  const templates: PersonTemplate[] = []
  try {
    for (const gltf of loaded) templates.push(buildPersonTemplate(gltf.scene, gltf.animations))
  } catch (error) {
    for (const template of templates) disposePersonTemplate(template)
    throw error
  }
  return { templates }
}

export function disposePeopleModels(models: PeopleModels): void {
  for (const template of models.templates) disposePersonTemplate(template)
}

export type PeopleModelTarget = ModelSwapTarget<PeopleModels>

export interface AttachPeopleModelsOptions {
  people: PeopleModelTarget
  load: () => Promise<PeopleModels>
  isDisposed: () => boolean
  warm?: () => Promise<void>
  onReady?: () => void
  onError?: (error: unknown) => void
}

export async function attachPeopleModels(options: AttachPeopleModelsOptions): Promise<void> {
  const { people, load, isDisposed, warm, onReady, onError } = options
  return attachModels({ target: people, load, disposeModels: disposePeopleModels, isDisposed, warm, onReady, onError })
}
```

- [ ] **Step 10: Run the tests and typecheck**

Run: `npx vitest run tests/journey/people-models.test.ts tests/journey/model-swap.test.ts tests/journey/vehicle-models.test.ts && npm run typecheck`
Expected: PASS and no type errors.

- [ ] **Step 11: Commit**

```bash
git add app/journey/model-swap.ts app/journey/people-models.ts app/journey/vehicle-models.ts tests/journey/model-swap.test.ts tests/journey/people-models.test.ts
git commit -m "feat: load people models through a shared stage, warm, show swap"
```

---

### Task 6: The people runtime

**Files:**
- Create: `app/journey/people.ts`
- Test: `tests/journey/people.test.ts`

**Interfaces:**
- Consumes: `PeopleLayout`, `Walker`, `walkerPoseAt`, `WalkerPose` from `./people-layout`; `PeopleModels`, `disposePeopleModels` from `./people-models`; `PersonTemplate`, `collectSkinnedMeshes` from `./people-rig`; constants from `./people-specs`; `seeded` from `./random`; `smoothstep` from `./sky-mirror`; test support `fakeTemplate` from Task 4.
- Produces:
  - `interface People { readonly group: THREE.Group; readonly objects: readonly THREE.SkinnedMesh[]; stageModels(models: PeopleModels): void; showModels(): void; discardModels(): void; update(windowLitRatio: number, t: number, cameraDistance: number): void; dispose(): void }`
  - `createPeople(layout: PeopleLayout): People`
  - The group is named `PEOPLE_GROUP_NAME`; each person's wrapper group is named `${PERSON_NAME_PREFIX}${index}`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/journey/people.test.ts
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hallFrameSlots } from '../../app/journey/hall'
import { peopleLayout, walkerPoseAt } from '../../app/journey/people-layout'
import type { PeopleModels } from '../../app/journey/people-models'
import { createPeople } from '../../app/journey/people'
import {
  FEET_Y, MAX_FRAME_STEP, MAX_PEOPLE, PEOPLE_ANIMATE_DISTANCE, PEOPLE_COUNTS, PEOPLE_GROUP_NAME, PEOPLE_VISIBLE_DISTANCE,
  PERSON_NAME_PREFIX,
} from '../../app/journey/people-specs'
import { fakeTemplate } from './support/fake-rig'

const FULL = peopleLayout(PEOPLE_COUNTS.full, hallFrameSlots(8))
const FULL_COUNT = FULL.walkers.length + FULL.talkers.length + FULL.guides.length

function fakeModels(): PeopleModels {
  return { templates: [fakeTemplate(), fakeTemplate(), fakeTemplate()] }
}

afterEach(() => { vi.restoreAllMocks() })

describe('createPeople', () => {
  it('is empty and inert for an empty layout', () => {
    const people = createPeople({ walkers: [], talkers: [], guides: [] })
    expect(people.group.name).toBe(PEOPLE_GROUP_NAME)
    people.stageModels(fakeModels())
    people.showModels()
    people.update(0.5, 3, 10)
    expect(people.group.children).toHaveLength(0)
    expect(people.objects).toHaveLength(0)
    people.dispose()
  })

  it('stages hidden people without listing them, and update before show does nothing', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    expect(people.group.children).toHaveLength(FULL_COUNT)
    expect(people.group.children.every(child => !child.visible)).toBe(true)
    expect(people.objects).toHaveLength(0)
    expect(() => people.update(0.5, 3, 10)).not.toThrow()
    expect(people.group.children.every(child => !child.visible)).toBe(true)
    people.dispose()
  })

  it('shows one skinned mesh per person, within the draw-call cap, and names them', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.showModels()
    expect(people.objects).toHaveLength(FULL_COUNT)
    expect(people.objects.length).toBeLessThanOrEqual(MAX_PEOPLE)
    people.group.children.forEach((child, i) => expect(child.name).toBe(`${PERSON_NAME_PREFIX}${i}`))
    people.dispose()
  })

  it('ignores a second stageModels, and ignores everything after dispose', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.stageModels(fakeModels())
    expect(people.group.children).toHaveLength(FULL_COUNT)
    people.dispose()
    people.dispose()
    people.stageModels(fakeModels())
    people.showModels()
    expect(people.group.children).toHaveLength(0)
    expect(people.objects).toHaveLength(0)
  })

  it('discards staged people and leaves the group empty', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.discardModels()
    expect(people.group.children).toHaveLength(0)
    people.showModels()
    expect(people.objects).toHaveLength(0)
    people.dispose()
  })

  it('stands standing people on the sidewalk and walkers on their poses', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.showModels()
    people.update(0.5, 7.5, 20)
    const first = people.group.children[0]!
    const pose = walkerPoseAt(FULL.walkers[0]!, 7.5)
    expect(first.position.x).toBeCloseTo(pose.x, 6)
    expect(first.position.z).toBeCloseTo(pose.z, 6)
    expect(first.position.y).toBeCloseTo(FEET_Y, 6)
    const talker = people.group.children[FULL.walkers.length]!
    expect(talker.position.x).toBeCloseTo(FULL.talkers[0]!.x, 6)
    expect(talker.position.z).toBeCloseTo(FULL.talkers[0]!.z, 6)
    people.dispose()
  })

  it('hides people beyond the visible distance and animates only those within the animate distance', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.showModels()
    const update = vi.spyOn(THREE.AnimationMixer.prototype, 'update')
    const cameraDistance = 30
    people.update(0.5, 1, cameraDistance)
    const distances = [...FULL.walkers.map(w => walkerPoseAt(w, 1).distance), ...FULL.talkers.map(t => t.distance), ...FULL.guides.map(g => g.distance)]
    distances.forEach((distance, i) => {
      expect(people.group.children[i]!.visible, `person ${i}`).toBe(Math.abs(distance - cameraDistance) <= PEOPLE_VISIBLE_DISTANCE)
    })
    const near = distances.filter(distance => Math.abs(distance - cameraDistance) <= PEOPLE_ANIMATE_DISTANCE).length
    expect(near).toBeGreaterThan(0)
    expect(near).toBeLessThan(FULL_COUNT)
    expect(update).toHaveBeenCalledTimes(near)
    people.dispose()
  })

  it('clamps the mixer step for a jump in time, and the first update does not advance', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.showModels()
    const update = vi.spyOn(THREE.AnimationMixer.prototype, 'update')
    people.update(0.5, 1e7, 30)
    expect(update.mock.calls.every(([step]) => step === 0)).toBe(true)
    update.mockClear()
    people.update(0.5, 1e7 + 5, 30)
    expect(update.mock.calls.every(([step]) => step === MAX_FRAME_STEP)).toBe(true)
    update.mockClear()
    people.update(0.5, 1e7 - 5, 30)
    expect(update.mock.calls.every(([step]) => step === 0)).toBe(true)
    people.dispose()
  })

  it('survives a camera at the path ends and far past them', () => {
    const people = createPeople(FULL)
    people.stageModels(fakeModels())
    people.showModels()
    for (const cameraDistance of [-10, 0, 100, 250]) expect(() => people.update(0.5, 2, cameraDistance)).not.toThrow()
    people.dispose()
  })

  it('ramps the night glow with the window-lit ratio', () => {
    const models = fakeModels()
    const people = createPeople(FULL)
    people.stageModels(models)
    people.showModels()
    people.update(0, 1, 30)
    expect(models.templates[0]!.material.emissiveIntensity).toBe(0)
    people.update(1, 1, 30)
    expect(models.templates[0]!.material.emissiveIntensity).toBeGreaterThan(0)
    people.dispose()
  })

  it('releases the models on dispose, staged or shown', () => {
    for (const show of [false, true]) {
      const models = fakeModels()
      const geometryDispose = vi.spyOn(models.templates[0]!.geometry, 'dispose')
      const people = createPeople(FULL)
      people.stageModels(models)
      if (show) people.showModels()
      people.dispose()
      expect(geometryDispose).toHaveBeenCalled()
      expect(people.group.children).toHaveLength(0)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/journey/people.test.ts`
Expected: FAIL, "Failed to resolve import ../../app/journey/people".

- [ ] **Step 3: Write `app/journey/people.ts`**

```ts
import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { type PeopleLayout, type Walker, walkerPoseAt, type WalkerPose } from './people-layout'
import { disposePeopleModels, type PeopleModels } from './people-models'
import { collectSkinnedMeshes, type PersonTemplate } from './people-rig'
import {
  CLIP_FADE_SECONDS, type ClipName, FEET_Y, GLOW_END, GLOW_START, MAX_FRAME_STEP, NIGHT_GLOW, PEOPLE_ANIMATE_DISTANCE,
  PEOPLE_GROUP_NAME, PEOPLE_SEED, PEOPLE_VISIBLE_DISTANCE, PERSON_NAME_PREFIX, TALK_CYCLE_SECONDS, TALK_SECONDS,
} from './people-specs'
import { seeded } from './random'
import { smoothstep } from './sky-mirror'

export interface People {
  // Stable parent of the people. The scene adds it once.
  readonly group: THREE.Group
  // The skinned meshes that draw: one per person. Empty until `showModels`.
  readonly objects: readonly THREE.SkinnedMesh[]
  // Clones the templates once per person and adds them to the group hidden, so their shaders can compile
  // before they show. Ignored when the layout is empty, after dispose, or after the first call. People owns
  // the models from then on and disposes them in `discardModels` or `dispose`.
  stageModels(models: PeopleModels): void
  // Lets update() show people. Does nothing unless models are staged.
  showModels(): void
  // Removes the staged people and disposes the models. Does nothing unless models are staged.
  discardModels(): void
  update(windowLitRatio: number, t: number, cameraDistance: number): void
  dispose(): void
}

type Entry =
  | { kind: 'walker'; character: number; offset: number; walker: Walker }
  | { kind: 'fixed'; character: number; offset: number; x: number; z: number; yaw: number; distance: number }

interface Person {
  entry: Entry
  outer: THREE.Group
  model: THREE.Object3D
  mixer: THREE.AnimationMixer
  actions: Readonly<Record<ClipName, THREE.AnimationAction>>
  current: THREE.AnimationAction
  skinned: readonly THREE.SkinnedMesh[]
  distance: number
  moving: boolean
}

interface Staged {
  models: PeopleModels
  people: Person[]
}

const RATIO_QUANTUM = 1e-3
const OFFSET_SEED = PEOPLE_SEED + 200
const walkPose: WalkerPose = { x: 0, z: 0, yaw: 0, moving: true, distance: 0 }

function entriesFor(layout: PeopleLayout): Entry[] {
  const entries: Entry[] = []
  const offset = () => seeded(OFFSET_SEED + entries.length)
  for (const walker of layout.walkers) entries.push({ kind: 'walker', character: walker.character, offset: offset(), walker })
  for (const t of layout.talkers) {
    entries.push({ kind: 'fixed', character: t.character, offset: offset(), x: t.x, z: t.z, yaw: t.yaw, distance: t.distance })
  }
  for (const g of layout.guides) {
    entries.push({ kind: 'fixed', character: g.character, offset: offset(), x: g.x, z: g.z, yaw: g.yaw, distance: g.distance })
  }
  return entries
}

function createPerson(entry: Entry, template: PersonTemplate, index: number): Person {
  const model = clone(template.root)
  const outer = new THREE.Group()
  outer.name = `${PERSON_NAME_PREFIX}${index}`
  outer.add(model)
  outer.visible = false
  const mixer = new THREE.AnimationMixer(model)
  const actions = {
    walk: mixer.clipAction(template.clips.walk),
    idle: mixer.clipAction(template.clips.idle),
    talk: mixer.clipAction(template.clips.talk),
  }
  const current = entry.kind === 'walker' ? actions.walk : actions.talk
  current.play()
  current.time = entry.offset * current.getClip().duration
  const person: Person = {
    entry, outer, model, mixer, actions, current, skinned: collectSkinnedMeshes(model),
    distance: entry.kind === 'fixed' ? entry.distance : walkerPoseAt(entry.walker, 0, walkPose).distance,
    moving: entry.kind === 'walker',
  }
  if (entry.kind === 'fixed') {
    outer.position.set(entry.x, FEET_Y, entry.z)
    outer.rotation.y = entry.yaw
  }
  return person
}

function desiredClip(person: Person, t: number): ClipName {
  if (person.entry.kind === 'walker') return person.moving ? 'walk' : 'idle'
  const phase = (t + person.entry.offset * TALK_CYCLE_SECONDS) % TALK_CYCLE_SECONDS
  return (phase < 0 ? phase + TALK_CYCLE_SECONDS : phase) < TALK_SECONDS ? 'talk' : 'idle'
}

function switchClip(person: Person, name: ClipName): void {
  const next = person.actions[name]
  if (person.current === next) return
  next.reset().play()
  person.current.crossFadeTo(next, CLIP_FADE_SECONDS, false)
  person.current = next
}

function updatePerson(person: Person, t: number, step: number, cameraDistance: number): void {
  const { entry } = person
  if (entry.kind === 'walker') {
    walkerPoseAt(entry.walker, t, walkPose)
    person.outer.position.set(walkPose.x, FEET_Y, walkPose.z)
    person.outer.rotation.y = walkPose.yaw
    person.distance = walkPose.distance
    person.moving = walkPose.moving
  }
  const gap = Math.abs(person.distance - cameraDistance)
  person.outer.visible = gap <= PEOPLE_VISIBLE_DISTANCE
  if (gap > PEOPLE_ANIMATE_DISTANCE) return
  switchClip(person, desiredClip(person, t))
  person.mixer.update(step)
}

function createEmptyPeople(group: THREE.Group): People {
  return { group, objects: [], stageModels() {}, showModels() {}, discardModels() {}, update() {}, dispose() {} }
}

export function createPeople(layout: PeopleLayout): People {
  const group = new THREE.Group()
  group.name = PEOPLE_GROUP_NAME
  const entries = entriesFor(layout)
  if (entries.length === 0) return createEmptyPeople(group)

  let staged: Staged | null = null
  let shown: Staged | null = null
  let meshes: readonly THREE.SkinnedMesh[] = []
  let offered = false
  let disposed = false
  let lastTime: number | null = null
  let lastKey = -1

  function release(state: Staged) {
    for (const person of state.people) {
      person.mixer.stopAllAction()
      person.mixer.uncacheRoot(person.model)
      for (const mesh of person.skinned) mesh.skeleton.dispose()
      group.remove(person.outer)
    }
    disposePeopleModels(state.models)
  }

  return {
    group,
    get objects() { return meshes },
    stageModels(models) {
      if (disposed || offered) return
      offered = true
      const people = entries.map((entry, i) => {
        const template = models.templates[entry.character % models.templates.length]
        if (!template) throw new Error('There are no person templates to clone')
        return createPerson(entry, template, i)
      })
      group.add(...people.map(person => person.outer))
      staged = { models, people }
    },
    showModels() {
      if (disposed || !staged) return
      shown = staged
      staged = null
      meshes = shown.people.flatMap(person => person.skinned)
    },
    discardModels() {
      if (disposed || !staged) return
      release(staged)
      staged = null
    },
    update(windowLitRatio, t, cameraDistance) {
      if (!shown) return
      const step = lastTime === null ? 0 : Math.min(Math.max(t - lastTime, 0), MAX_FRAME_STEP)
      lastTime = t
      const key = Math.round(windowLitRatio / RATIO_QUANTUM)
      if (key !== lastKey) {
        lastKey = key
        const glow = NIGHT_GLOW * smoothstep(GLOW_START, GLOW_END, windowLitRatio)
        for (const template of shown.models.templates) template.material.emissiveIntensity = glow
      }
      for (const person of shown.people) updatePerson(person, t, step, cameraDistance)
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (staged) release(staged)
      if (shown) release(shown)
      staged = null
      shown = null
      meshes = []
    },
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/journey/people.test.ts`
Expected: PASS.

The "hides people" test relies on `entriesFor` ordering the children walkers first, then talkers, then guides, which is the order its `distances` list builds.

- [ ] **Step 5: Run the whole unit suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/journey/people.ts tests/journey/people.test.ts
git commit -m "feat: add the people runtime with staged clones, mixers, and distance cutoffs"
```

---

### Task 7: Wire people into the scene and the GPU harness

**Files:**
- Modify: `app/journey/scene.ts`
- Modify: `tests/gpu/harness.ts`
- Create: `tests/gpu/people.spec.ts`

**Interfaces:**
- Consumes: `createPeople`, `People` from `./people`; `peopleLayout` from `./people-layout`; `PEOPLE_COUNTS` from `./people-specs`; `attachPeopleModels`, `loadPeopleModels`, `PeopleModels` from `./people-models`; `hallFrameSlots` from `./hall`.
- Produces: new `JourneySceneOptions` fields `loadPeopleModels?: () => Promise<PeopleModels>`, `onPeopleReady?: () => void`, `onPeopleFailed?: (error: unknown) => void`; new harness option `people?: boolean` on `mountJourney` and `cityGpu.waitForPeople(): Promise<void>`.

- [ ] **Step 1: Write the failing GPU spec**

```ts
// tests/gpu/people.spec.ts
import { expect, test } from '@playwright/test'
import { hallFrameSlots } from '../../app/journey/hall'
import { peopleLayout, layoutPeopleCount } from '../../app/journey/people-layout'
import { MAX_PEOPLE, PEOPLE_COUNTS, PEOPLE_GROUP_NAME } from '../../app/journey/people-specs'
import { REFLECT_LAYER } from '../../app/journey/reflect-layer'
import { WET_ROAD_NAME } from '../../app/journey/wet-road'

const GPU_TEST_TIMEOUT_MS = 120_000
// The GPU harness mounts one exhibit, so the hall has one frame and one guide.
const HARNESS_FRAMES = hallFrameSlots(1)

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

for (const [tier, lowPower] of [['full', false], ['lite', true]] as const) {
  test(`${tier}: the real GLBs load, show one skinned mesh per person, stay out of the reflection, and build no new program`, async ({ page }) => {
    test.setTimeout(GPU_TEST_TIMEOUT_MS)
    const expected = layoutPeopleCount(peopleLayout(PEOPLE_COUNTS[tier], HARNESS_FRAMES))
    const result = await page.evaluate(async ({ tier, lowPower, groupName, layer, wetRoadName }) => {
      window.cityGpu.mountJourney({ tier, lowPower, people: true })
      await window.cityGpu.waitForPeople()
      const scene = window.cityGpu.getJourneyContext().scene
      const programsBefore = window.cityGpu.journeyState().programs
      const frames = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter, time: 2 + chapter }))
      const programsAfter = window.cityGpu.journeyState().programs
      type Probe = { isSkinnedMesh?: boolean; layers: { isEnabled(layer: number): boolean }; visible: boolean }
      const meshes: Probe[] = []
      scene.getObjectByName(groupName)?.traverse(object => { if ((object as unknown as Probe).isSkinnedMesh) meshes.push(object as unknown as Probe) })
      const passes = (scene.getObjectByName(wetRoadName)?.userData.wetRoad as { stats: { passes: number } } | undefined)?.stats.passes ?? null
      window.cityGpu.dispose()
      return {
        frames, programsBefore, programsAfter, passes,
        meshCount: meshes.length,
        reflected: meshes.filter(mesh => mesh.layers.isEnabled(layer)).length,
      }
    }, { tier, lowPower, groupName: PEOPLE_GROUP_NAME, layer: REFLECT_LAYER, wetRoadName: WET_ROAD_NAME })
    for (const frame of result.frames) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
    }
    expect(result.meshCount).toBe(expected)
    expect(result.meshCount).toBeLessThanOrEqual(MAX_PEOPLE)
    expect(result.reflected).toBe(0)
    expect(result.programsAfter).toEqual(result.programsBefore)
    if (!lowPower) expect(result.passes).not.toBeNull()
  })
}

test('reduced motion creates no people and starts no model download', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/models/people/')) requests.push(request.url()) })
  await page.evaluate(async () => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: false, people: true })
    await window.cityGpu.waitForPeople()
    window.cityGpu.dispose()
  })
  expect(requests).toEqual([])
})

test('a missing model leaves the street empty and does not break the scene', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  await page.route('**/models/people/hoodie.glb', route => route.fulfill({ status: 404, body: 'missing' }))
  const result = await page.evaluate(async ({ groupName }) => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, people: true })
    await window.cityGpu.waitForPeople()
    const frame = window.cityGpu.renderJourney({ chapter: 1 })
    const children = window.cityGpu.getJourneyContext().scene.getObjectByName(groupName)?.children.length ?? -1
    window.cityGpu.dispose()
    return { frame, children }
  }, { groupName: PEOPLE_GROUP_NAME })
  expect(result.children).toBe(0)
  expect(result.frame.shaderError).toBeNull()
  expect(result.frame.glError).toBe(0)
})
```

If the third test name's route does not match the third character's file, change `hoodie.glb` to the file named by `CHARACTER_SPECS[2]` from Task 1.

- [ ] **Step 2: Add the harness option**

In `tests/gpu/harness.ts`, next to `vehiclesSettled`, add:

```ts
let peopleSettled: Promise<void> = Promise.resolve()
```

Add to the `cityGpu` object, next to `waitForVehicles`:

```ts
  // Settles once the people show (after their shader warmup) or the swap gives up.
  waitForPeople(): Promise<void> {
    return peopleSettled
  },
```

In `mountJourney`: add `people?: boolean` to the options type; after the `vehiclesSettled` lines add

```ts
    let settlePeople: () => void = () => {}
    peopleSettled = new Promise<void>(resolve => { settlePeople = resolve })
    // Reduced motion has no people, so no load starts and nothing would ever settle the promise.
    if (!options.people || options.tier === 'reduced') settlePeople()
```

In the `createJourneyScene` options add

```ts
        // Existing GPU tests pin the street without people, so by default the load never finishes. Pass `people: true` for the real GLBs.
        loadPeopleModels: options.people ? undefined : () => new Promise<never>(() => {}),
        onPeopleReady: settlePeople,
        onPeopleFailed: settlePeople,
```

In the `catch` block next to `settleVehicles()` add `settlePeople()`.

- [ ] **Step 3: Run the GPU spec to verify it fails**

Run: `npx playwright test --config playwright.config.ts tests/gpu/people.spec.ts`
Expected: FAIL (the scene has no people yet; `meshCount` is 0 and the harness option is unused).

- [ ] **Step 4: Wire the scene**

In `app/journey/scene.ts`:

1. Imports: `import { hallFrameSlots } from './hall'` (already added in Task 2, extend it), `import { createPeople, type People } from './people'`, `import { peopleLayout } from './people-layout'`, `import { attachPeopleModels, loadPeopleModels, type PeopleModels } from './people-models'`, `import { PEOPLE_COUNTS } from './people-specs'`.
2. `JourneySceneOptions`: add

```ts
  // Test seam: replaces the people GLB download. The default loads the GLBs from /models/people/.
  loadPeopleModels?: () => Promise<PeopleModels>
  // Called after the people show. Never called if the load fails or the scene is disposed first.
  onPeopleReady?: () => void
  // Called once when the people load or swap fails. The street stays empty.
  onPeopleFailed?: (error: unknown) => void
```

3. Next to `let wetRoad`, add `let people: People | null = null`, and in `dispose()` add `people?.dispose()` right after `post?.dispose()`. People dispose first, so the sweep below finds an empty people group.
4. After the traffic block (after the `reflectInPuddles(...)` call that includes `traffic.group`), add:

```ts
  // People: walkers, talkers, and hall guides. Not reflected: they are small and the reflection pass is capped.
  // Reduced motion has none, so no model is fetched.
  const peopleField = createPeople(peopleLayout(PEOPLE_COUNTS[tier], hallFrameSlots(projectItems.length)))
  people = peopleField
  scene.add(peopleField.group)
  // Same warmup as the vehicles: the person material arrives later, so it compiles here, before the people show.
  async function warmPeopleShaders(): Promise<void> {
    await preservingState(renderer, () => {
      renderer.setRenderTarget(post?.sceneTarget ?? null)
      return renderer.compileAsync(peopleField.group, camera, scene)
    })
  }
  if (tier !== 'reduced') {
    void attachPeopleModels({
      people: peopleField,
      load: options.loadPeopleModels ?? (() => loadPeopleModels()),
      isDisposed: () => disposed,
      warm: warmPeopleShaders,
      onReady: options.onPeopleReady,
      onError(error) {
        console.warn('Journey people: the GLB models could not be used. Leaving the street empty.', error)
        options.onPeopleFailed?.(error)
      },
    })
  }
```

   The `tier !== 'reduced'` check is enough because `PEOPLE_COUNTS.reduced` is empty; if the layout were empty for another reason, `createPeople` returns the inert object and `attachModels` stages and shows nothing harmful.

5. In `apply(state)`, right after `traffic.update(state.windowLitRatio, lastTime)`, add `people?.update(state.windowLitRatio, lastTime, state.cameraDistance)`.

- [ ] **Step 5: Run the unit suite, typecheck, and the GPU spec**

Run: `npm test && npm run typecheck && npx playwright test --config playwright.config.ts tests/gpu/people.spec.ts`
Expected: PASS. If the program-count assertion fails, the warmup did not compile the same variant the frame draws; check that `warmPeopleShaders` runs under the same render target as the vehicles' warmup and that `people` meshes carry the same layers as the scene default.

- [ ] **Step 6: Run the existing street and vehicle GPU specs as the regression check**

Run: `npx playwright test --config playwright.config.ts tests/gpu/street.spec.ts tests/gpu/vehicles.spec.ts tests/gpu/wet-road.spec.ts`
Expected: PASS. The harness default keeps the people load pending, so the street draw-call counts stay at their old values.

- [ ] **Step 7: Commit**

```bash
git add app/journey/scene.ts tests/gpu/harness.ts tests/gpu/people.spec.ts
git commit -m "feat: show people in the journey scene"
```

---

### Task 8: Acceptance

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-journey-people-design.md` (status line only)

- [ ] **Step 1: Run the automated checks**

Automated verification (the agent runs these, and all must pass):

- [ ] `npm test`
- [ ] `npm run test:gpu`
- [ ] `npm run typecheck`
- [ ] `npm run build`

If `npm run test:gpu` shows failures, rerun the failing spec alone once with the machine awake before investigating (earlier journey work saw sleep-induced timeouts). Compare any remaining failure against `master` before blaming this branch.

- [ ] **Step 2: Check the files against the size rule**

Run: `wc -l app/journey/people*.ts app/journey/model-swap.ts app/journey/hall.ts app/journey/scene.ts`
Expected: each new file under 400 lines. `scene.ts` should be about 650 lines (it lost the hall block and gained about 30 lines); if it grew past 700, report it in the handoff instead of splitting it in this plan.

- [ ] **Step 3: Mark the spec**

Change the spec's `Status: Draft, pending review` to `Status: Implemented, pending manual checks`. Commit:

```bash
git add ../../docs/superpowers/specs/2026-10-12-journey-people-design.md
git commit -m "docs: mark the journey people spec implemented"
```

- [ ] **Step 4: Hand off the manual checks**

Do not pause between tasks for these, and do not mark them done until the user confirms them. List them in the final handoff message:

Manual verification (a person checks):

- [ ] People read as people from the journey camera in both themes, and at night (the faint night glow keeps them visible without looking lit from inside).
- [ ] People face the way they walk. If they walk backward, set `MODEL_FACING_Y` to `0` in `app/journey/people-specs.ts`.
- [ ] Walkers stay on the sidewalks and do not clip lamps, the gate pillars, the hall pillars, the courtyard walls, or buildings. The turn at each end of a stretch looks natural.
- [ ] Hall guides stand sensibly beside the frames, face the wall, and the projects panel does not cover them.
- [ ] Talking groups look natural, face each other, and are not in sync. If they look frozen, the pack has no talk clip and they only idle; say so.
- [ ] People are neither too small nor too large against the cars. Tune `PERSON_HEIGHT` (one constant) if needed.
- [ ] Figures read as grounded without a shadow. If they seem to float, add contact shadows as a follow-up.
- [ ] iPhone frame rate does not drop against the current build, with all 6 `lite` people shown. If it does, the spec's fallback is baked vertex-animation instancing.
- [ ] The models download in the background without delaying the first frame (check the network panel on a throttled connection).
