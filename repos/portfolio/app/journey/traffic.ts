import * as THREE from 'three'
import { DARK_GLASS_HEX, lampIntensity, STREET_LIGHT_LUMINANCE, STREET_NAME_PREFIX, STREET_NAMES } from './lamps'
import { createLane, type LaneSample } from './lane'
import { COURTYARD_DEPTH, headingFor, PATH_SEGMENTS, pathPointAt, PLACES } from './path'
import { seeded } from './random'
import { disposeVehicleModels, type VehicleModels } from './vehicle-models'
import { VEHICLE_TYPES, type VehicleLightOffset, type VehicleType, vehicleLightOffsets } from './vehicle-specs'
import { gainFor } from './window-look'

export const LANE_OFFSET = 1.5
export const CAR_COUNT_FULL = 12
export const CAR_COUNT_LOW_POWER = 6
export const SPEED_MIN = 2.5
export const SPEED_MAX = 5.5
// Free road kept between a turnaround arc and the courtyard entrance.
export const CAR_TURN_MARGIN = 1
// The road runs on past the courtyard, but its house stands on the road. Cars drive from the start
// of the path to this distance, turn around, and come back. The turnaround arc bulges LANE_OFFSET
// past it, so it ends CAR_TURN_MARGIN short of the courtyard entrance.
const COURTYARD_SEGMENT = PATH_SEGMENTS[2]
export const CAR_ROUTE_END = COURTYARD_SEGMENT
  ? COURTYARD_SEGMENT.cumStart
    + Math.hypot(PLACES.courtyard.x - COURTYARD_SEGMENT.fromX, PLACES.courtyard.z - COURTYARD_SEGMENT.fromZ)
    - COURTYARD_DEPTH / 2
    - LANE_OFFSET
    - CAR_TURN_MARGIN
  : 0
// Half circle of radius LANE_OFFSET that carries a car from one lane to the other.
export const TURN_ARC_LENGTH = Math.PI * LANE_OFFSET
// Each lane follows the road with rounded corners, so it is a little shorter or longer than the path. The
// two lanes take one outside and one inside arc each, so they have the same length.
const FORWARD_LANE = createLane(LANE_OFFSET, CAR_ROUTE_END)
const BACK_LANE = createLane(-LANE_OFFSET, CAR_ROUTE_END)
export const LANE_LENGTH = FORWARD_LANE.length
// One lap: forward leg, end arc, back leg, start arc.
export const LOOP_LENGTH = 2 * LANE_LENGTH + 2 * TURN_ARC_LENGTH
export const CAR_SIZE = { width: 0.45, height: 0.28, length: 0.9 } as const
export const CAR_RIDE_HEIGHT = 0.08
// Road surface is at y = -1.
export const CAR_CENTER_Y = -1 + CAR_RIDE_HEIGHT + CAR_SIZE.height / 2
export const FRONT_LIGHT_HEX = 0xfff1d6
export const REAR_LIGHT_HEX = 0xff2a1a
export const FRONT_LIGHT_THRESHOLD = 0.2
export const REAR_MIN_INTENSITY = 0.2

// Road surface is at y = -1. Model geometry has its wheel bottoms at y = 0.
export const ROAD_Y = -1
// The Kenney body paint is a dark charcoal swatch, so a plain tint barely shows. This brings it up
// to roughly the color in BODY_COLORS. Tuned by eye in the browser.
export const PAINT_COMPENSATION = 2.5
export const TRAFFIC_GROUP_NAME = `${STREET_NAME_PREFIX}traffic`

export function vehicleBodyName(type: VehicleType): string {
  return `${STREET_NAMES.carBodies}-${type}`
}

const CAR_SEED = 9300
// Jitter is a fraction of the spacing between cars, so gaps along the loop stay at least (1 - JITTER) * spacing.
const START_JITTER = 0.6
const BODY_COLORS = [0x3a3a40, 0x52525a, 0x6a6a72, 0x1f2a44, 0x4a1c1c, 0x2c2c30] as const

export interface Car {
  speed: number
  // Position along the loop, 0 to LOOP_LENGTH.
  startDistance: number
  bodyColor: number
  type: VehicleType
}

export interface CarPose {
  x: number
  z: number
  yaw: number
}

export function carCountFor(reducedMotion: boolean, lowPower: boolean): number {
  if (reducedMotion) return 0
  return lowPower ? CAR_COUNT_LOW_POWER : CAR_COUNT_FULL
}

// All cars share one speed, so they keep their spacing along the loop and never drive through each other.
export function createCars(count: number): Car[] {
  const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * seeded(CAR_SEED)
  const cars: Car[] = []
  for (let i = 0; i < count; i++) {
    const seed = CAR_SEED + 10 + i
    const colorIndex = Math.floor(seeded(seed + 100) * BODY_COLORS.length)
    cars.push({
      speed,
      startDistance: ((i + START_JITTER * seeded(seed)) / count) * LOOP_LENGTH,
      bodyColor: BODY_COLORS[colorIndex] ?? BODY_COLORS[0],
      type: VEHICLE_TYPES[i % VEHICLE_TYPES.length] ?? 'sedan',
    })
  }
  return cars
}

const laneSample: LaneSample = { x: 0, z: 0, dirX: 0, dirZ: 0 }

// A point on the loop with its unit travel direction. The straight legs follow the rounded lanes. The
// turnarounds are half circles about the path ends, in the path frame: `forward` along the path
// direction and `right` along its right vector.
function loopSampleAt(u: number, out: LaneSample): LaneSample {
  if (u < LANE_LENGTH) return FORWARD_LANE.sample(u, out)
  if (u < LANE_LENGTH + TURN_ARC_LENGTH) {
    const theta = (u - LANE_LENGTH) / LANE_OFFSET
    return turnaroundSample(pathPointAt(CAR_ROUTE_END), 1, theta, out)
  }
  const backStart = LANE_LENGTH + TURN_ARC_LENGTH
  if (u < backStart + LANE_LENGTH) {
    BACK_LANE.sample(LANE_LENGTH - (u - backStart), out)
    out.dirX = -out.dirX
    out.dirZ = -out.dirZ
    return out
  }
  const theta = (u - backStart - LANE_LENGTH) / LANE_OFFSET
  return turnaroundSample(pathPointAt(0), -1, theta, out)
}

// Half circle of radius LANE_OFFSET about `point`. `side` is 1 at the route end, where the car leaves the
// right lane, and -1 at the path start, where it leaves the left lane.
function turnaroundSample(point: ReturnType<typeof pathPointAt>, side: 1 | -1, theta: number, out: LaneSample): LaneSample {
  const forward = side * LANE_OFFSET * Math.sin(theta)
  const right = side * LANE_OFFSET * Math.cos(theta)
  const headingForward = side * Math.cos(theta)
  const headingRight = -side * Math.sin(theta)
  out.x = point.x + point.dirX * forward + point.rightX * right
  out.z = point.z + point.dirZ * forward + point.rightZ * right
  out.dirX = point.dirX * headingForward + point.rightX * headingRight
  out.dirZ = point.dirZ * headingForward + point.rightZ * headingRight
  return out
}

// The modulo runs in double precision before anything is written to a float matrix, so a large
// `t` (performance.now() / 1000 after hours) does not lose precision.
export function carPoseAt(car: Car, t: number, out: CarPose = { x: 0, z: 0, yaw: 0 }): CarPose {
  const raw = (car.startDistance + car.speed * t) % LOOP_LENGTH
  const sample = loopSampleAt(raw < 0 ? raw + LOOP_LENGTH : raw, laneSample)
  out.x = sample.x
  out.z = sample.z
  out.yaw = headingFor(sample.dirX, sample.dirZ)
  return out
}

export type CarLightKind = 'front' | 'rear'

// Box-car fallback. Authored facing -Z: the front is at -Z, the rear at +Z, at body-center height.
export const CAR_LIGHT_OFFSETS: readonly VehicleLightOffset[] = [
  { x: -0.15, y: 0, z: -0.46, kind: 'front' },
  { x: 0.15, y: 0, z: -0.46, kind: 'front' },
  { x: -0.15, y: 0, z: 0.46, kind: 'rear' },
  { x: 0.15, y: 0, z: 0.46, kind: 'rear' },
]

const litFront = new THREE.Color(FRONT_LIGHT_HEX).multiplyScalar(gainFor(FRONT_LIGHT_HEX, STREET_LIGHT_LUMINANCE))
const litRear = new THREE.Color(REAR_LIGHT_HEX).multiplyScalar(gainFor(REAR_LIGHT_HEX, STREET_LIGHT_LUMINANCE))
const darkGlass = new THREE.Color(DARK_GLASS_HEX)

// Front lights follow the dusk ramp. Rear lights are running and brake lights: never below 20%.
export function carLightIntensity(kind: CarLightKind, windowLitRatio: number): number {
  const ramp = lampIntensity(FRONT_LIGHT_THRESHOLD, windowLitRatio)
  return kind === 'rear' ? Math.max(REAR_MIN_INTENSITY, ramp) : ramp
}

// mix(dark glass, color * gain, intensity)
export function carLightColor(kind: CarLightKind, windowLitRatio: number, out: THREE.Color): THREE.Color {
  return out.copy(darkGlass).lerp(kind === 'rear' ? litRear : litFront, carLightIntensity(kind, windowLitRatio))
}

const LIGHT_SIZE = { width: 0.08, height: 0.06, depth: 0.03 } as const
const RATIO_QUANTUM = 1e-3
const LIGHTS_PER_CAR = CAR_LIGHT_OFFSETS.length

export interface Traffic {
  // Stable parent of the meshes below. The scene adds it once; the model swap changes its children.
  readonly group: THREE.Group
  // The meshes that draw: car bodies, then car lights. Box bodies and lights at first (two meshes), then
  // one body mesh per vehicle type that has cars plus the lights (up to four). Empty when there are no
  // cars. Staged model meshes are not listed until `showModels`.
  readonly objects: readonly THREE.InstancedMesh[]
  // Builds the model body meshes and adds them to the group hidden, so their shaders can compile while
  // the box cars keep drawing. Ignored when there are no cars, after dispose, or after the first call.
  // Traffic owns the models from then on and disposes them in `discardModels` or `dispose`.
  stageModels(models: VehicleModels): void
  // Shows the staged meshes and drops the box bodies. Does nothing unless models are staged.
  showModels(): void
  // Removes the staged meshes and disposes the models. The box cars stay. Does nothing unless models are staged.
  discardModels(): void
  update(windowLitRatio: number, t: number): void
  dispose(): void
}

// Module-level scratch objects: the per-frame writer reuses them. `pathPointAt` still returns one
// small object per car per frame, which is negligible next to the matrix work.
const matrix = new THREE.Matrix4()
const bodyPosition = new THREE.Vector3()
const lightOffset = new THREE.Vector3()
const UNIT_SCALE = new THREE.Vector3(1, 1, 1)
const bodyRotation = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)
const pose: CarPose = { x: 0, z: 0, yaw: 0 }
const scratchColor = new THREE.Color()

// One body mesh. Instance j draws cars[carIndices[j]], with its wheels on `baseY`.
interface BodySet {
  mesh: THREE.InstancedMesh
  carIndices: readonly number[]
  baseY: number
}

function createEmptyTraffic(group: THREE.Group): Traffic {
  return { group, objects: [], stageModels() {}, showModels() {}, discardModels() {}, update() {}, dispose() {} }
}

export function createTraffic(cars: readonly Car[]): Traffic {
  const group = new THREE.Group()
  group.name = TRAFFIC_GROUP_NAME
  if (cars.length === 0) return createEmptyTraffic(group)

  const boxMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.3 })
  boxMaterial.name = 'journey-street-car-body'
  const boxBodies = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CAR_SIZE.width, CAR_SIZE.height, CAR_SIZE.length), boxMaterial, cars.length)
  boxBodies.name = STREET_NAMES.carBodies
  boxBodies.frustumCulled = false
  cars.forEach((car, i) => boxBodies.setColorAt(i, scratchColor.set(car.bodyColor)))
  if (boxBodies.instanceColor) boxBodies.instanceColor.needsUpdate = true

  const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  lightMaterial.name = 'journey-street-car-light'
  const lights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(LIGHT_SIZE.width, LIGHT_SIZE.height, LIGHT_SIZE.depth), lightMaterial, cars.length * LIGHTS_PER_CAR)
  lights.name = STREET_NAMES.carLights
  lights.frustumCulled = false

  let sets: BodySet[] = [{ mesh: boxBodies, carIndices: cars.map((_, i) => i), baseY: CAR_CENTER_Y }]
  let offsetsFor: (car: Car) => readonly VehicleLightOffset[] = () => CAR_LIGHT_OFFSETS
  // Models move from staged to shown, or from staged to discarded. Only the first stageModels call counts.
  interface ModelState { models: VehicleModels; material: THREE.MeshStandardMaterial; sets: BodySet[] }
  let staged: ModelState | null = null
  let shown: ModelState | null = null
  let modelsOffered = false
  let disposed = false

  // Stable array, rebuilt on swap. It stays valid when a caller moves the meshes to another parent.
  let meshes: readonly THREE.InstancedMesh[] = []
  function fillGroup() {
    meshes = [...sets.map(set => set.mesh), lights]
    group.clear()
    group.add(...meshes)
  }
  fillGroup()

  // Light kinds follow the same front, front, rear, rear order in every offset table.
  function writeLightColors(windowLitRatio: number) {
    for (let i = 0; i < cars.length; i++) {
      for (let k = 0; k < LIGHTS_PER_CAR; k++) {
        const light = CAR_LIGHT_OFFSETS[k]
        if (!light) continue
        lights.setColorAt(i * LIGHTS_PER_CAR + k, carLightColor(light.kind, windowLitRatio, scratchColor))
      }
    }
    if (lights.instanceColor) lights.instanceColor.needsUpdate = true
  }
  // Create the color attribute before the first render: three decides USE_INSTANCING_COLOR from it.
  writeLightColors(0)
  let lastKey = 0

  function releaseBoxBodies() {
    boxBodies.geometry.dispose()
    boxMaterial.dispose()
  }

  function releaseModels(state: ModelState) {
    disposeVehicleModels(state.models)
    state.material.dispose()
  }

  function createModelSets(next: VehicleModels, material: THREE.MeshStandardMaterial): BodySet[] {
    const indicesByType = new Map<VehicleType, number[]>()
    cars.forEach((car, i) => indicesByType.set(car.type, [...(indicesByType.get(car.type) ?? []), i]))
    const modelSets: BodySet[] = []
    for (const type of VEHICLE_TYPES) {
      const carIndices = indicesByType.get(type)
      if (!carIndices) continue
      const mesh = new THREE.InstancedMesh(next.geometries[type], material, carIndices.length)
      mesh.name = vehicleBodyName(type)
      mesh.frustumCulled = false
      mesh.layers.mask = group.layers.mask
      carIndices.forEach((carIndex, j) => {
        const car = cars[carIndex]
        if (car) mesh.setColorAt(j, scratchColor.set(car.bodyColor).multiplyScalar(PAINT_COMPENSATION))
      })
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      modelSets.push({ mesh, carIndices, baseY: ROAD_Y })
    }
    return modelSets
  }

  return {
    group,
    get objects() { return meshes },
    stageModels(next) {
      if (disposed || modelsOffered) return
      modelsOffered = true
      const material = new THREE.MeshStandardMaterial({ map: next.map, roughness: 0.55, metalness: 0.3 })
      material.name = 'journey-street-car-body'
      const modelSets = createModelSets(next, material)
      for (const set of modelSets) set.mesh.visible = false
      group.add(...modelSets.map(set => set.mesh))
      staged = { models: next, material, sets: modelSets }
    },
    showModels() {
      if (disposed || !staged) return
      shown = staged
      staged = null
      for (const set of shown.sets) set.mesh.visible = true
      sets = shown.sets
      offsetsFor = car => vehicleLightOffsets(car.type)
      releaseBoxBodies()
      fillGroup()
    },
    discardModels() {
      if (disposed || !staged) return
      group.remove(...staged.sets.map(set => set.mesh))
      releaseModels(staged)
      staged = null
    },
    update(windowLitRatio, t) {
      const key = Math.round(windowLitRatio / RATIO_QUANTUM)
      if (key !== lastKey) {
        lastKey = key
        writeLightColors(windowLitRatio)
      }
      for (const set of sets) {
        set.carIndices.forEach((carIndex, j) => {
          const car = cars[carIndex]
          if (!car) return
          carPoseAt(car, t, pose)
          bodyRotation.setFromAxisAngle(UP, pose.yaw)
          bodyPosition.set(pose.x, set.baseY, pose.z)
          matrix.compose(bodyPosition, bodyRotation, UNIT_SCALE)
          set.mesh.setMatrixAt(j, matrix)
          const offsets = offsetsFor(car)
          for (let k = 0; k < LIGHTS_PER_CAR; k++) {
            const light = offsets[k]
            if (!light) continue
            lightOffset.set(light.x, light.y, light.z).applyQuaternion(bodyRotation).add(bodyPosition)
            matrix.compose(lightOffset, bodyRotation, UNIT_SCALE)
            lights.setMatrixAt(carIndex * LIGHTS_PER_CAR + k, matrix)
          }
        })
        set.mesh.instanceMatrix.needsUpdate = true
      }
      lights.instanceMatrix.needsUpdate = true
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (staged) releaseModels(staged)
      if (shown) releaseModels(shown)
      else releaseBoxBodies()
      lights.geometry.dispose()
      ;(lights.material as THREE.Material).dispose()
    },
  }
}
