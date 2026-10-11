import * as THREE from 'three'
import { DARK_GLASS_HEX, lampIntensity, STREET_LIGHT_LUMINANCE, STREET_NAME_PREFIX, STREET_NAMES } from './lamps'
import { COURTYARD_DEPTH, headingFor, PATH_SEGMENTS, pathPointAt, PLACES } from './path'
import { seeded } from './random'
import { smoothstep } from './sky-mirror'
import { disposeVehicleModels, type VehicleModels } from './vehicle-models'
import { VEHICLE_TYPES, type VehicleLightOffset, type VehicleType, vehicleLightOffsets } from './vehicle-specs'
import { gainFor } from './window-look'

export const LANE_OFFSET = 1.5
export const CAR_COUNT_FULL = 12
export const CAR_COUNT_LOW_POWER = 6
export const SPEED_MIN = 2.5
export const SPEED_MAX = 5.5
// Scale is 0 within CORNER_HIDE of an interior waypoint and 1 beyond CORNER_SHOW.
export const CORNER_HIDE = 2.5
export const CORNER_SHOW = 3.5
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
// One lap: forward leg, end arc, back leg, start arc.
export const LOOP_LENGTH = 2 * CAR_ROUTE_END + 2 * TURN_ARC_LENGTH
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
const INTERIOR_DISTANCES = PATH_SEGMENTS.slice(1).map(segment => segment.cumStart)

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
  // Distance along the path center line to the nearest point on it.
  distance: number
  scale: number
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

// Distance from the nearest interior waypoint, in path units: 0 hides the car, CORNER_SHOW shows it.
export function cornerScale(distance: number): number {
  let nearest = Infinity
  for (const corner of INTERIOR_DISTANCES) nearest = Math.min(nearest, Math.abs(distance - corner))
  return smoothstep(CORNER_HIDE, CORNER_SHOW, nearest)
}

// A point on the loop in the path frame: `forward` along the path direction and `right` along its right
// vector, both from the path point at `distance`. `heading` is the unit travel direction in the same frame.
interface LoopFrame {
  distance: number
  forward: number
  right: number
  headingForward: number
  headingRight: number
}

const frame: LoopFrame = { distance: 0, forward: 0, right: 0, headingForward: 0, headingRight: 0 }

function loopFrameAt(u: number, out: LoopFrame): LoopFrame {
  if (u < CAR_ROUTE_END) {
    out.distance = u
    out.forward = 0
    out.right = LANE_OFFSET
    out.headingForward = 1
    out.headingRight = 0
    return out
  }
  if (u < CAR_ROUTE_END + TURN_ARC_LENGTH) {
    const theta = (u - CAR_ROUTE_END) / LANE_OFFSET
    out.distance = CAR_ROUTE_END
    out.forward = LANE_OFFSET * Math.sin(theta)
    out.right = LANE_OFFSET * Math.cos(theta)
    out.headingForward = Math.cos(theta)
    out.headingRight = -Math.sin(theta)
    return out
  }
  const backStart = CAR_ROUTE_END + TURN_ARC_LENGTH
  if (u < backStart + CAR_ROUTE_END) {
    out.distance = CAR_ROUTE_END - (u - backStart)
    out.forward = 0
    out.right = -LANE_OFFSET
    out.headingForward = -1
    out.headingRight = 0
    return out
  }
  const theta = (u - backStart - CAR_ROUTE_END) / LANE_OFFSET
  out.distance = 0
  out.forward = -LANE_OFFSET * Math.sin(theta)
  out.right = -LANE_OFFSET * Math.cos(theta)
  out.headingForward = -Math.cos(theta)
  out.headingRight = Math.sin(theta)
  return out
}

// The modulo runs in double precision before anything is written to a float matrix, so a large
// `t` (performance.now() / 1000 after hours) does not lose precision.
export function carPoseAt(car: Car, t: number, out: CarPose = { x: 0, z: 0, yaw: 0, distance: 0, scale: 0 }): CarPose {
  const raw = (car.startDistance + car.speed * t) % LOOP_LENGTH
  const loop = loopFrameAt(raw < 0 ? raw + LOOP_LENGTH : raw, frame)
  const point = pathPointAt(loop.distance)
  out.x = point.x + point.dirX * loop.forward + point.rightX * loop.right
  out.z = point.z + point.dirZ * loop.forward + point.rightZ * loop.right
  out.yaw = headingFor(
    point.dirX * loop.headingForward + point.rightX * loop.headingRight,
    point.dirZ * loop.headingForward + point.rightZ * loop.headingRight,
  )
  out.distance = loop.distance
  out.scale = cornerScale(loop.distance)
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
  // Stable parent of the meshes below. The scene adds it once; `useModels` swaps its children.
  readonly group: THREE.Group
  // Car bodies, then car lights. Box bodies and lights at first (two meshes), then one body mesh per
  // vehicle type that has cars plus the lights (up to four). Empty when there are no cars.
  readonly objects: readonly THREE.InstancedMesh[]
  // Replaces the box bodies with the vehicle models. Ignored when there are no cars, after dispose, or
  // after the first call. Traffic owns the models from then on and disposes them in `dispose`.
  useModels(models: VehicleModels): void
  update(windowLitRatio: number, t: number): void
  dispose(): void
}

// Module-level scratch objects: the per-frame writer reuses them. `pathPointAt` still returns one
// small object per car per frame, which is negligible next to the matrix work.
const matrix = new THREE.Matrix4()
const bodyPosition = new THREE.Vector3()
const lightOffset = new THREE.Vector3()
const bodyScale = new THREE.Vector3()
const bodyRotation = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)
const pose: CarPose = { x: 0, z: 0, yaw: 0, distance: 0, scale: 0 }
const scratchColor = new THREE.Color()

// One body mesh. Instance j draws cars[carIndices[j]], with its wheels on `baseY`.
interface BodySet {
  mesh: THREE.InstancedMesh
  carIndices: readonly number[]
  baseY: number
}

function createEmptyTraffic(group: THREE.Group): Traffic {
  return { group, objects: [], useModels() {}, update() {}, dispose() {} }
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
  let models: VehicleModels | null = null
  let modelMaterial: THREE.MeshStandardMaterial | null = null
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
    useModels(next) {
      if (disposed || models) return
      const material = new THREE.MeshStandardMaterial({ map: next.map, roughness: 0.55, metalness: 0.3 })
      material.name = 'journey-street-car-body'
      sets = createModelSets(next, material)
      models = next
      modelMaterial = material
      offsetsFor = car => vehicleLightOffsets(car.type)
      releaseBoxBodies()
      fillGroup()
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
          bodyScale.setScalar(pose.scale)
          bodyPosition.set(pose.x, set.baseY, pose.z)
          matrix.compose(bodyPosition, bodyRotation, bodyScale)
          set.mesh.setMatrixAt(j, matrix)
          const offsets = offsetsFor(car)
          for (let k = 0; k < LIGHTS_PER_CAR; k++) {
            const light = offsets[k]
            if (!light) continue
            lightOffset.set(light.x, light.y, light.z).applyQuaternion(bodyRotation).multiplyScalar(pose.scale).add(bodyPosition)
            matrix.compose(lightOffset, bodyRotation, bodyScale)
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
      if (models) {
        disposeVehicleModels(models)
        modelMaterial?.dispose()
      } else {
        releaseBoxBodies()
      }
      lights.geometry.dispose()
      ;(lights.material as THREE.Material).dispose()
    },
  }
}
