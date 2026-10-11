# Journey vehicles: three realistic car types

Date: 2026-10-11
Status: Draft, pending review
Builds on: [city-07 street life](2026-10-09-city-07-street-life-design.md), [city-08 wet road](2026-10-10-city-08-wet-road-design.md)

## Problem

Every car in the journey traffic is one `BoxGeometry` (0.45 x 0.28 x 0.9) with four small box lights (`app/journey/traffic.ts`). Only the body color varies. The cars do not read as vehicles, and all of them look the same.

## Goal

Replace the box cars with three recognizable vehicle types: sedan, SUV, and truck. Use CC0 low-poly GLB models.

Success criteria:

- The three silhouettes are distinguishable from the street camera.
- Added download weight is about 170 to 210 KB per model (about 550 KB for three), loaded in the background after the scene starts.
- Traffic stays within the wet-road reflection cap of 16 draw calls.
- The U-turn loop, constant-speed spacing, dusk-ramped lights, and per-tier car counts keep working.

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Realism approach | GLB models, not procedural geometry | Chosen by the user after a side-by-side preview. |
| Model source | Kenney Car Kit (CC0) | No attribution, small files. The page at kenney.nl/assets/car-kit states CC0. |
| Types | Sedan, SUV, truck | Three silhouettes that differ in height and length. |
| Rendering | One `InstancedMesh` per type, one merged geometry per model | Every Kenney model uses a single palette material, so body, wheels, and glass merge into one geometry. That gives 3 body draw calls plus 1 for lights. Cloning scene graphs would cost about 60. |
| Realism bar | Kenney stylized low-poly | Photoreal models are large and need per-model licence review. |

## Design

### Model loading: `vehicle-models.ts` (new)

- Loads three GLBs from `public/models/vehicles/` with `GLTFLoader`.
- For each model: merge all meshes into one geometry (one shared material), then normalize orientation (front at -Z), scale (real length in scene units), and ground contact (wheels at y = 0).
- Returns plain data per type: geometry groups, materials, `length`, and light offsets.
- Pure normalization and merging logic is separate from the loader call, so unit tests run without WebGL or network.

### Traffic: `traffic.ts` (changed)

- `Car` gains `type: 'sedan' | 'suv' | 'truck'`. Assignment is deterministic from `CAR_SEED`.
- `createTraffic` builds instanced meshes per type and per material group. Each mesh is named with the prefix `journey-street-car-` so the wet-road pass can find it by prefix.
- Loop spacing uses each type's length plus a fixed gap, so a truck never overlaps the car ahead. Cars still share one speed.
- Pose logic (`carPoseAt`, `loopFrameAt`, corner scale) is unchanged.

### Color

Kenney models share one palette texture, and the glass lives inside the body mesh. A per-car tint therefore multiplies the whole model. The body paint is a dark charcoal swatch, so the tint is the existing `BODY_COLORS` value times a compensation factor (`PAINT_COMPENSATION`, 2.5, tuned in the browser). Glass and trim take a faint tint too. If that looks wrong in the manual check, set the factor to give every car a neutral tint and rely on the three silhouettes for variety.

### Lights

- Head and tail lights stay as separate emissive instances and keep `carLightIntensity` and the dusk ramp.
- Offsets become per-type constants measured from each model, replacing the single `CAR_LIGHT_OFFSETS` table.

### Reflections and tiers

- The wet-road pass currently collects `STREET_NAMES.carBodies` and `STREET_NAMES.carLights` (`scene.ts:443-445`). It switches to a name-prefix match.
- Total reflected draw calls from traffic must stay at or below 16.
- Low power halves the car count and splits it across types by the same ratio. Reduced motion creates no cars and fetches no models.

### Loading and failure

- Traffic starts with no cars. The scene does not wait for the models.
- When all three GLBs load, traffic builds the instanced meshes and adds them to the scene before the next render.
- If any load fails, traffic falls back to the current box cars. The scene never breaks, and the error is logged once.
- `dispose()` releases geometries and materials for every type.

## Testing

Write each test first and watch it fail.

Unit (`tests/journey/`):

- Type assignment is deterministic and uses all three types at full count.
- Spacing: no two cars on the loop overlap, given per-type lengths.
- Light offsets sit inside each model's bounding box.
- Draw-call count of traffic objects is at most 16 at full and low power.
- Fallback: a rejected load yields box cars and no thrown error.
- Normalization: front faces -Z, wheels sit at y = 0, length matches the target.

GPU (existing suites): street and wet-road tests must pass, with traffic present.

## Verification

Automated: `npm test`, `npm run test:gpu`, `npm run typecheck`, `npm run build`.

Manual (a person checks):

- The three types look distinct from the journey camera.
- Both themes, and dusk lights, look right.
- Cars at the U-turn show no clipping or popping.
- iPhone frame rate does not drop against the current build.

## Out of scope

- Wheel spin, brake-light changes, steering animation.
- More than three types.
- Photoreal or CC-BY models.

## Risks

- **Body isolation:** the shared palette texture may block per-car tint. Mitigation is the check above and the baked-color fallback.
- **Orientation and scale:** Kenney models may face +Z or use different units. Normalization tests cover this.
- **Size:** if a GLB is much larger than expected, decimate or pick another model.
