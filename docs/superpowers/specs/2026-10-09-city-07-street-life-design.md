# City polish 07: Street life

Date: 2026-10-09
Status: Draft, pending review and prioritization
Direction: Realistic dusk/dawn skyline
Series: City polish (07 of 08). Read [00 shared conventions](2026-10-09-city-00-shared-conventions.md) first.

## Problem

The road is empty. The only street lights are two lamp posts inside the market set-piece. Nothing moves, so scrolling through the city feels like moving through a model. A real street at dusk has lit lamp posts that switch on in sequence, pools of light on the asphalt, and traffic with headlights and tail lights.

## Goal

Add three things to the street:

1. Lamp posts along both sides of the road, switching on one by one as night falls.
2. Light for each lamp: a glow halo at the lamp head and a pool of light on the road.
3. A small amount of traffic: cars with headlights and tail lights driving in both lanes.

Success criteria:

- Lamps appear on both sides of the road at regular spacing in the stretches between set-pieces. They skip set-piece footprints (the entrance, hall, market, and courtyard cover most of the 100-unit path) and corner blocks, and they never stand on another road segment. The count is pinned by a golden test: 14 lamps on `full` (spacing 6) and 8 on `lowPower` (spacing 8), computed from the real path.
- Lamps switch on individually: the number of lit lamps rises monotonically with `windowLitRatio` between 0.15 and 0.40, and every lamp is on by 0.40.
- At `about` (night) every light pool and halo is visible. At `intro` (day) none is.
- Cars drive in two lanes, in both directions, wrap around the path, and stay in their lane. Cars are hidden near interior waypoints (corners), so none turns through a building.
- Under reduced motion no car is visible. Lamps, halos, and pools still appear.
- Added cost: at most 6 draw calls and +0.4 ms on the named reference desktop and +0.4 ms on a physical iPhone (shared conventions, section 8).

## Non-goals

- Pedestrians, animals, birds, drifting dust, or fireflies.
- Real point lights. Cost is too high on phones, so glow is faked with additive sprites and quads.
- Traffic that turns corners smoothly or obeys signals.
- Replacing the two lamps in the market set-piece. They stay, and generic lamps skip the market footprint.
- Reflections of the lights on the road. Spec 08 covers the wet road.

## Current state

- `createMarket` builds two lamp posts (`CylinderGeometry` plus a glow sphere with a `MeshBasicMaterial` color `#ffdca8`) at `x = +-(ROAD_HALF_WIDTH + 0.3)`.
- `createRoad` builds the road surface, a center line (`MeshBasicMaterial`, transparent, opacity 0.5), and square joint patches at interior waypoints.
- `update(chapter, progress, _t, pointer)` receives the time `_t` and ignores it.
- Path: 100 units long (`PATH_TOTAL_LENGTH`), three segments, two 90-degree turns at the interior waypoints `(0, -26)` and `(-26, -26)`. `pathPointAt(distance)` returns position, direction, and the right vector.

## Design

### New modules

| Module | Contents |
| --- | --- |
| `app/journey/falloff-texture.ts` | `radialFalloffPixels(size)` and `createFalloffTexture(size)`. Shared with spec 04's contact shadows. If spec 04 has landed, move its function here and import it from both. |
| `app/journey/lamps.ts` | Lamp placement, instanced posts, heads, halos, pools, per-lamp intensity. |
| `app/journey/traffic.ts` | Car state, instanced bodies and lights, per-frame writer. |

`scene.ts` only creates these and calls `update`. It gains a few lines.

### Lamp placement

`lampPositions(spacing)` is a pure function. It walks the path from distance `spacing / 2` to `PATH_TOTAL_LENGTH - spacing / 2` in steps of `spacing` (6 units on `full`, 8 on `lowPower`) and places one lamp on each side at `ROAD_HALF_WIDTH + 0.3` (3.3 units) from the center line, along the segment's right vector (`rightX = -dirZ`, `rightZ = dirX`; when walking toward -Z the right side is +X). It returns `{ x, z, side, armAngle }`.

A position is dropped when any of these holds:

- it lies inside a set-piece footprint: `clearsFootprints(x, z, 0.2)` is false (the `halfExtent` parameter comes from spec 03, or an inline check enlarges each rectangle by 0.2 if spec 03 has not landed);
- it lies inside a corner block: `clearsCornerBlocks(x, z, 0.2)` is false (spec 03, or inline);
- it is closer than 3.2 units to **any** path segment: `clearsPath(x, z, ROAD_HALF_WIDTH + 0.2)` is false. A lamp near a corner can fall 0.5 units from the next segment's road (for example, at distance 59.5 on side +1, the position is about `(-25.5, -29.3)`). Checking all segments, not only its own, removes it.

The footprints cover most of the path: the entrance and hall take the first stretch from z = 3.2 down to -22.5, the market the middle of segment 2, and the courtyard the middle of segment 3. Computed from the real path, `full` keeps **14** lamps (7 per side) at spacing 6 and `lowPower` keeps **8** (4 per side) at spacing 8. Counts per side are not required to be equal, because independent exclusions cannot guarantee it; the golden test pins the actual numbers per side.

Arm angle. The arm points along local +X, and a rotation by `theta` about Y maps local +X to `(cos theta, 0, -sin theta)`. The arm must point toward the road center, which is `-side * (rightX, rightZ)` from the post. So `armAngle = atan2(side * rightZ, -side * rightX)`. Check: on segment 1 (`right = (1, 0)`), side +1 gives `atan2(0, -1) = pi`, and local +X maps to `(-1, 0, 0)`, toward the road.

### Lamp geometry

Heights are anchored to the road: the road surface is at world `y = -1` (shared conventions, section 6).

- **Posts.** One `InstancedMesh`. The geometry is built once by merging (`mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js`) a `CylinderGeometry(0.04, 0.05, 2.4, 6)` **translated up by 1.2** (so its bottom is at local `y = 0` and its top at 2.4) and an arm box of size 0.5 x 0.05 x 0.05 centered at local `(0.25, 2.375, 0)`, so it spans local x from 0 to 0.5 and sits at the post top. Color `#2a2a2f`, `MeshStandardMaterial`. Instance position `(x, -1, z)`, rotation `armAngle` about Y, scale 1.
- **Heads.** One `InstancedMesh` of a unit sphere (`SphereGeometry(1, 8, 6)`), scale 0.12, at the world position of the arm tip: `(x + 0.5 cos(armAngle), -1 + 2.4, z - 0.5 sin(armAngle))`. `lampHeadPosition(lamp)` is a pure function. `MeshBasicMaterial`, white material color. Per-instance color carries the brightness (below).
- Test: for each lamp the post base, the arm end, and the head center agree with these formulas, and the head center is within 0.01 of the arm's far end.
- Both meshes have `frustumCulled = false` (shared conventions, section 2).

### Per-lamp switching

Each lamp has a switch-on threshold `th = 0.15 + 0.2 * hash(i)` in [0.15, 0.35]. Its intensity is:

```ts
export function lampIntensity(th: number, windowLitRatio: number): number {
  const x = clamp01((windowLitRatio - th) / 0.05)
  return x * x * (3 - 2 * x)      // smoothstep(th, th + 0.05, ratio)
}
```

Every lamp is fully on at `windowLitRatio >= 0.40`, and all are off at or below 0.15. The sequence is fixed per lamp, so lamps never switch off as the user scrolls forward.

### Light colors and brightness

Lamp light is warm, `#ffc983` (linear luminance 0.647), with `gainFor(color, 2.3)` from spec 06's `window-look.ts` (about 3.56), which meets spec 02's brightness contract (luminance at least 2.0 for sources that should bloom). If spec 06 has not landed, define `gainFor` in this spec's module and have spec 06 import it. The head's per-instance color is `warm * gain * intensity`, blended with a dark glass color (`#2a2a30`) when the intensity is low:

`color = mix(dark, warm * gain, intensity)`

The color array is rewritten only when `windowLitRatio` changed since the last frame (dirty check on a quantized value, 1e-3), so the mesh does not re-upload every frame once the chapter has settled.

### Halos and pools

- **Halos.** One `InstancedMesh` of a `PlaneGeometry(1, 1)` at each lamp head, scaled to 0.9 units, using a `MeshBasicMaterial` with `map` = the radial falloff texture, `blending: THREE.AdditiveBlending`, `transparent: true`, `depthWrite: false`, `fog: true` (so the fog uniforms and defines exist; see "Fog on additive lights" for how fog is applied). The material is patched with `onBeforeCompile` and `replaceOrThrow` (shared conventions, section 2) so each instance faces the camera. In `project_vertex`, replace the standard transform with a view-space billboard: compute `mvPosition = modelViewMatrix * instanceMatrix * vec4(0, 0, 0, 1)` for the instance center, then add `position.xy * instanceScale` (scale extracted from the instance matrix) in view space. `customProgramCacheKey` is `'street-halo'`. A `Points` sprite was rejected: point size is clamped by the GPU (the maximum point size varies, and iOS may clamp below the size needed when the camera passes 3 units from a lamp), which would shrink the halo at the closest, most visible moment.
- **Pools.** One `InstancedMesh` of `PlaneGeometry(1, 1)`, rotated flat once, scaled to 3.2 units, lying under each lamp at `y = -0.992` (above the road at `-1`, below the center line at `-0.99`). Same falloff texture and additive blending. `polygonOffset: true` with factor and units `-1`. The pool center is offset 1.2 units toward the road from the post, so the pool falls on the lane.
- **Fog on additive lights.** r186's `fog_fragment` mixes the output toward `fogColor`. For an alpha-blended object that is correct. For an additive object it is wrong: a switched-off light (black output) is mixed toward the fog color, and additive blending then adds that color to the scene, so a "dark" halo or pool would brighten the image by its fog factor. The falloff texture's alpha is always 255, so even its black edges would add fog color. Both the halo and the pool materials therefore replace `#include <fog_fragment>` (through `replaceOrThrow`) with an attenuation toward black:

  ```glsl
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb *= 1.0 - fogFactor;
  #endif
  ```

  Light that is far away fades to nothing, as it should in thick fog, and zero-intensity lights contribute exactly zero at any distance. The helper `attenuateAdditiveFog(material)` lives in `shader-utils.ts`. `customProgramCacheKey` includes `'additive-fog'`.
- Both use per-instance color for brightness: `warm * intensity * 0.5` for pools and `warm * intensity * 0.9` for halos (additive blending needs no HDR for these; they add on top).
- `renderOrder`: pools `1.5`, which is after spec 04's shadow quads (`1`) and before the road markings (`2`). Halos `3`, after the markings, so they draw over everything near the road. Additive, depth-write-off objects do not occlude each other, so the order matters only against alpha-blended objects.

### Traffic

State per car (fixed at creation from `seeded()`): `lane` (+1 or -1), `speed` (2.5 to 5.5 units per second), `startDistance` (0 to `PATH_TOTAL_LENGTH`), and a body color from a six-color dark palette (grays, a dark blue, a dark red).

Lanes are 1.5 units from the path center, the `+1` lane on the right side of travel. The `+1` lane travels in the direction of increasing path distance (away from the camera's start), and the `-1` lane travels toward the start. Count: 12 cars on `full` (6 per lane), 6 on `lowPower`. Under reduced motion there are no cars (`CAR_COUNT = 0`): the preference asks for no motion, and a frozen traffic jam would look wrong.

Position at time `t`:

```ts
s = mod(startDistance + lane * speed * t, PATH_TOTAL_LENGTH)
p = pathPointAt(s)
x = p.x + p.rightX * lane * LANE_OFFSET
z = p.z + p.rightZ * lane * LANE_OFFSET
yaw = headingFor(lane * p.dirX, lane * p.dirZ)
```

`t` comes from `performance.now() / 1000` and grows large. Compute `startDistance + lane * speed * t` and the modulo in double precision (JavaScript numbers), and only then write float values into the matrices, so large `t` does not lose precision.

**Corner handling.** The lane offset flips sides of the polyline at the interior waypoints, and a 90-degree snap would put a car through the joint patch's inside corner. Cars are therefore hidden near corners: scale ramps from 0 at `CORNER_HIDE = 2.5` units from an interior waypoint to 1 at 3.5 units. This reads as cars turning into side streets. `cornerScale(s)` is a pure function.

**Geometry and axes.** `headingFor` returns the `rotation.y` that turns an object authored facing **-Z** toward a direction, so every car part is authored with its front toward -Z. One `InstancedMesh` of box bodies, `BoxGeometry(0.45, 0.28, 0.9)` (x = width, y = height, z = length), `MeshStandardMaterial` (white material color, per-instance body color). Ride height 0.08: the body center is at world `y = -1 + 0.08 + 0.14 = -0.78`. One `InstancedMesh` of small boxes `BoxGeometry(0.08, 0.06, 0.03)` for lights: 4 per car, `MeshBasicMaterial`, per-instance color. In the car's local frame the front lights are at `(+-0.15, 0, -0.46)` and the rear lights at `(+-0.15, 0, +0.46)`, both at the body center height. The light matrices are `bodyMatrix * translate(local offset)` (or the same rotation applied to the offset), so a front light always lies ahead of the body center along the car's heading. Front lights are white-warm (`#fff1d6`, linear luminance 0.890), rear lights red (`#ff2a1a`, 0.230). Their gains come from `gainFor(color, 2.3)`: about 2.58 for the front lights, 10.0 for the rear lights, and 3.56 for the warm `#ffc983` lamp light. Lights use `lampIntensity`-style switching: front lights follow the dusk ramp (th 0.2), rear lights stay at 20% minimum (brake and running lights).

The writer is allocation-free: it writes into a preallocated `Float32Array` and reuses module-level `Matrix4`, `Vector3`, and `Quaternion` (render-loop exception in `.claude/rules/common/coding-style.md`). Matrices update every frame (cars move), unless the car count is 0.

### Tier behavior

| Situation | Lamps | Halos | Pools | Cars |
| --- | --- | --- | --- | --- |
| full | spacing 6 (14 lamps) | yes | yes | 12 |
| lowPower | spacing 8 (8 lamps) | yes | yes | 6 |
| reduced | follows `lowPower` | yes | yes | none |

Draw calls: posts 1, heads 1, halos 1, pools 1, car bodies 1, car lights 1 = 6 (4 with no cars).

## Files

| File | Change |
| --- | --- |
| `app/journey/falloff-texture.ts` | New (or moved from spec 04). |
| `app/journey/lamps.ts` | New. |
| `app/journey/traffic.ts` | New. |
| `app/journey/scene.ts` | Create the modules, call updates with `windowLitRatio` and `t`, dispose textures. |
| `tests/journey/lamps.test.ts` | New. |
| `tests/journey/traffic.test.ts` | New. |
| `tests/gpu/street.spec.ts` | New. |

## Testing

Unit (Vitest, `tests/journey/`):

1. `lampPositions(6)` returns 14 lamps (7 per side) and `lampPositions(8)` returns 8 (4 per side). The numbers are pinned from the real path and footprints. Every lamp is 3.3 +- 0.01 units from the center line of its own segment and at least 3.2 units from every segment (`clearsPath(x, z, 3.2)` holds); none lies inside a set-piece footprint or a corner block (enlarged by 0.2). A fixture lamp at path distance 59.5, side +1, is rejected.
2. Geometry: `armAngle = atan2(side * rightZ, -side * rightX)` points the arm toward the road center for both sides and all three segments (the dot product of the rotated +X vector with the vector from post to road center is positive). `lampHeadPosition` agrees with the post top and the arm end; the post base is at `y = -1`, the post top at `y = 1.4`, and the head center at `y = 1.4` too.
3. `lampIntensity`: 0 at ratio 0.15 for every threshold (th >= 0.15), 1 at ratio 0.40 for every threshold (th <= 0.35 + 0.05), monotonic non-decreasing in ratio, and the number of lit lamps (intensity above 0.5) rises monotonically with the ratio.
4. `carPosition(car, t)`: wraps at `PATH_TOTAL_LENGTH`, keeps the car at lane offset 1.5 +- 0.01 from the path center, and the `+1` and `-1` lanes move in opposite directions along the path. Heading flips by 180 degrees between lanes. Using a large `t` (`1e6`) gives the same position as the reduced `t % period` value within 1e-3.
5. `cornerScale(s)`: 0 within 2.5 units of each interior waypoint, 1 beyond 3.5, and monotonic between. Cars at those distances are fully hidden and never overlap a joint patch's inside corner.
6. `gainFor`: warm lamp light (3.556), front light (2.584), and rear light (10.004) each reach luminance 2.3 within 1e-3.
6b. Car light offsets: for a car with heading `yaw`, the front light world position minus the body center has a positive dot product with the car's travel direction, and the rear light's is negative. Body center `y` is -0.78.
7. Zero cars when `reducedMotion` is true; the writer does not touch the car matrices.
8. Dirty check: updating lamp colors twice with the same ratio writes once.

GPU (Playwright, `tests/gpu/street.spec.ts`):

9. Shader errors for the halo and pool materials (both patched), the full and `lowPower` configurations. The recorder is empty after warm-up frames (shared conventions, section 2).
9b. Fog on additive lights: with every lamp at intensity 0, render halos and pools at fog densities 0.045 and 0.065 and distances 5, 20, and 40. The pixels equal the same render with the halo and pool meshes hidden (within 1/255). With intensity 1, the added light shrinks with distance and is 0 within 1/255 once `fogFactor` exceeds 0.99.
10. Billboard: place the camera at a fixed distance of 4 units from a lamp head and rotate it around the head to yaw angles 0, 45, and 90 degrees, keeping the distance constant. The halo's projected width differs by less than 5% across poses (it faces the camera), and it is centered on the head. Also compare the width at each pose with the expected projection `0.9 / distance` scaled by the camera's focal length.
11. Brightness: at `about`, the lamp head pixel has linear luminance of at least 2.0 (measured in a half-float target before tone mapping, fog disabled). At `intro`, the same pixel is the dark glass color. At `windowLitRatio = 0.25` some heads are lit and some dark.
12. Pools: at `about`, a road pixel under a lamp is brighter than the road pixel 4 units away along the lane; at `intro` they match within 2/255.
13. Draw calls: on the direct pipeline with `renderer.info.autoReset = false` and `renderer.info.reset()` before one `renderer.render` (as in spec 03, item 8), the street objects add at most 6 calls. With reduced motion, at most 4.
14. Traffic: render at `t = 0` and `t = 2`; at least one car body pixel moved. Under reduced motion the two renders are identical. At a corner, no car is visible within 2.5 units of the waypoint.
15. Context restore: after `loseContext()` and `restoreContext()`, lamps, halos, pools, and the falloff texture render the same pixels as before.

Manual verification (shared conventions, section 9): scrub through the four chapters; check that lamps switch on one by one, not together; that the camera passing a lamp at 3.3 units does not show clipping or a huge halo; and that the road line, pools, and shadows do not z-fight at 50 to 100 units.

Performance: shared conventions, section 8. Budget +0.4 ms on desktop and on iPhone.

## Risks

- **Halo overdraw**: the halo is small (0.9 units), but the camera passes at 3.3 units, so a halo can cover about 200 px across. 26 additive quads at that size is not much; measure on the iPhone. Fallback: shrink to 0.6 units on `lowPower`.
- **Few lamps**: the set-pieces take most of the road, so there are only 14 generic lamps. This matches the places where they are visible. If it feels sparse, reduce spacing to 4 (about 20 lamps) in the same function.
- **Z-fighting of pools**: pools sit 0.008 above the road. `polygonOffset` and `depthWrite: false` should handle it; check at 60 to 100 units.
- **Cars near the camera**: the camera is on the path center, cars are 1.5 units away at eye height 0.2 to 0.8. A car can pass very close to the lens and fill the screen for a moment. If it feels intrusive, widen the lane offset to 1.9 (inside the 3-unit road half width) or hide cars within 1.2 units of the camera.
- **Speed and scroll**: traffic time is wall-clock time, while the camera moves by scroll. Cars move even when the user stops scrolling. This is intended: it makes the city feel alive.
- **Tone mapping with HDR colors on non-bloom pipelines**: `lowPower` has no bloom, so high-gain colors (the red rear lights, gain about 10) clip to saturated red/white. Check the look, and reduce the `lowPower` gains to 1.5 if the lights look blown out without bloom.
- **Lane geometry at joints**: hiding cars at corners removes a visible artifact at the cost of cars vanishing. If it reads badly, replace it with quarter-circle arcs in a later change.

## Dependencies

- Uses `gainFor` from spec 06 (or defines it). Uses `clearsFootprints(halfExtent)` and `clearsCornerBlocks` from spec 03 (or inline checks).
- Shares the falloff texture with spec 04.
- Benefits from spec 02 (bloom on lamp heads and lights).
- Spec 08 adds wet reflections of these lights.

## Open questions

None.
