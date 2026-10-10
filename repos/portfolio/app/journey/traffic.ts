import * as THREE from 'three'
import { DARK_GLASS_HEX, lampIntensity, STREET_LIGHT_LUMINANCE, STREET_NAMES } from './lamps'
import { headingFor, PATH_SEGMENTS, PATH_TOTAL_LENGTH, pathPointAt } from './path'
import { seeded } from './random'
import { smoothstep } from './sky-mirror'
import { gainFor } from './window-look'

export const LANE_OFFSET = 1.5
export const CAR_COUNT_FULL = 12
export const CAR_COUNT_LOW_POWER = 6
export const SPEED_MIN = 2.5
export const SPEED_MAX = 5.5
// Scale is 0 within CORNER_HIDE of an interior waypoint and 1 beyond CORNER_SHOW.
export const CORNER_HIDE = 2.5
export const CORNER_SHOW = 3.5
// Scale is 0 at either path end and 1 from EDGE_SHOW in, so the wrap from 100 to 0 never pops.
export const EDGE_SHOW = 4
export const CAR_SIZE = { width: 0.45, height: 0.28, length: 0.9 } as const
export const CAR_RIDE_HEIGHT = 0.08
// Road surface is at y = -1.
export const CAR_CENTER_Y = -1 + CAR_RIDE_HEIGHT + CAR_SIZE.height / 2
export const FRONT_LIGHT_HEX = 0xfff1d6
export const REAR_LIGHT_HEX = 0xff2a1a
export const FRONT_LIGHT_THRESHOLD = 0.2
export const REAR_MIN_INTENSITY = 0.2

const CAR_SEED = 9300
const LANES = [1, -1] as const
// Jitter is a fraction of the spacing between cars, so same-lane gaps stay at least (1 - JITTER) * spacing.
const START_JITTER = 0.7
const BODY_COLORS = [0x3a3a40, 0x52525a, 0x6a6a72, 0x1f2a44, 0x4a1c1c, 0x2c2c30] as const
const INTERIOR_DISTANCES = PATH_SEGMENTS.slice(1).map(segment => segment.cumStart)

export interface Car {
  lane: 1 | -1
  speed: number
  startDistance: number
  bodyColor: number
}

export interface CarPose {
  x: number
  z: number
  yaw: number
  distance: number
  scale: number
}

export function carCountFor(reducedMotion: boolean, lowPower: boolean): number {
  if (reducedMotion) return 0
  return lowPower ? CAR_COUNT_LOW_POWER : CAR_COUNT_FULL
}

// All cars in a lane share one speed, so they keep their spacing and never drive through each other.
export function createCars(count: number): Car[] {
  const perLane = Math.floor(count / 2)
  const cars: Car[] = []
  for (const [laneIndex, lane] of LANES.entries()) {
    const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * seeded(CAR_SEED + laneIndex)
    for (let i = 0; i < perLane; i++) {
      const seed = CAR_SEED + 10 + laneIndex * 50 + i
      const colorIndex = Math.floor(seeded(seed + 100) * BODY_COLORS.length)
      cars.push({
        lane,
        speed,
        startDistance: ((i + START_JITTER * seeded(seed)) / perLane) * PATH_TOTAL_LENGTH,
        bodyColor: BODY_COLORS[colorIndex] ?? BODY_COLORS[0],
      })
    }
  }
  return cars
}

// Distance from the nearest interior waypoint, in path units: 0 hides the car, CORNER_SHOW shows it.
export function cornerScale(distance: number): number {
  let nearest = Infinity
  for (const corner of INTERIOR_DISTANCES) nearest = Math.min(nearest, Math.abs(distance - corner))
  return smoothstep(CORNER_HIDE, CORNER_SHOW, nearest)
}

export function edgeScale(distance: number): number {
  return smoothstep(0, EDGE_SHOW, Math.min(distance, PATH_TOTAL_LENGTH - distance))
}

export function visibilityScale(distance: number): number {
  return cornerScale(distance) * edgeScale(distance)
}

// The modulo runs in double precision before anything is written to a float matrix, so a large
// `t` (performance.now() / 1000 after hours) does not lose precision.
export function carPoseAt(car: Car, t: number, out: CarPose = { x: 0, z: 0, yaw: 0, distance: 0, scale: 0 }): CarPose {
  const raw = (car.startDistance + car.lane * car.speed * t) % PATH_TOTAL_LENGTH
  const distance = raw < 0 ? raw + PATH_TOTAL_LENGTH : raw
  const point = pathPointAt(distance)
  out.x = point.x + point.rightX * car.lane * LANE_OFFSET
  out.z = point.z + point.rightZ * car.lane * LANE_OFFSET
  out.yaw = headingFor(car.lane * point.dirX, car.lane * point.dirZ)
  out.distance = distance
  out.scale = visibilityScale(distance)
  return out
}

export type CarLightKind = 'front' | 'rear'

// Authored facing -Z: the front is at -Z, the rear at +Z, at body-center height.
export const CAR_LIGHT_OFFSETS: readonly { x: number; z: number; kind: CarLightKind }[] = [
  { x: -0.15, z: -0.46, kind: 'front' },
  { x: 0.15, z: -0.46, kind: 'front' },
  { x: -0.15, z: 0.46, kind: 'rear' },
  { x: 0.15, z: 0.46, kind: 'rear' },
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
  // Car bodies, then car lights: two draw calls. Empty when there are no cars.
  readonly objects: readonly THREE.InstancedMesh[]
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

export function createTraffic(cars: readonly Car[]): Traffic {
  if (cars.length === 0) return { objects: [], update() {}, dispose() {} }

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.3 })
  bodyMaterial.name = 'journey-street-car-body'
  const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  lightMaterial.name = 'journey-street-car-light'
  const bodies = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CAR_SIZE.width, CAR_SIZE.height, CAR_SIZE.length), bodyMaterial, cars.length)
  const lights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(LIGHT_SIZE.width, LIGHT_SIZE.height, LIGHT_SIZE.depth), lightMaterial, cars.length * LIGHTS_PER_CAR)
  bodies.name = STREET_NAMES.carBodies
  lights.name = STREET_NAMES.carLights
  const objects = [bodies, lights] as const
  for (const mesh of objects) mesh.frustumCulled = false

  cars.forEach((car, i) => bodies.setColorAt(i, scratchColor.set(car.bodyColor)))
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true

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

  return {
    objects,
    update(windowLitRatio, t) {
      const key = Math.round(windowLitRatio / RATIO_QUANTUM)
      if (key !== lastKey) {
        lastKey = key
        writeLightColors(windowLitRatio)
      }
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]
        if (!car) continue
        carPoseAt(car, t, pose)
        bodyRotation.setFromAxisAngle(UP, pose.yaw)
        bodyScale.setScalar(pose.scale)
        bodyPosition.set(pose.x, CAR_CENTER_Y, pose.z)
        matrix.compose(bodyPosition, bodyRotation, bodyScale)
        bodies.setMatrixAt(i, matrix)
        for (let k = 0; k < LIGHTS_PER_CAR; k++) {
          const light = CAR_LIGHT_OFFSETS[k]
          if (!light) continue
          lightOffset.set(light.x, 0, light.z).applyQuaternion(bodyRotation).multiplyScalar(pose.scale).add(bodyPosition)
          matrix.compose(lightOffset, bodyRotation, bodyScale)
          lights.setMatrixAt(i * LIGHTS_PER_CAR + k, matrix)
        }
      }
      bodies.instanceMatrix.needsUpdate = true
      lights.instanceMatrix.needsUpdate = true
    },
    dispose() {
      for (const mesh of objects) {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
    },
  }
}
