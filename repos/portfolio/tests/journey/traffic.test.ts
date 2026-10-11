import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { DARK_GLASS_HEX, STREET_LIGHT_LUMINANCE, STREET_NAMES } from '../../app/journey/lamps'
import { COURTYARD_DEPTH, headingFor, PATH_SEGMENTS, PATH_TOTAL_LENGTH, pathPointAt, PLACES } from '../../app/journey/path'
import {
  CAR_CENTER_Y, CAR_COUNT_FULL, CAR_COUNT_LOW_POWER, CAR_LIGHT_OFFSETS, CAR_RIDE_HEIGHT, CAR_ROUTE_END, CAR_SIZE,
  CAR_TURN_MARGIN, type Car, carCountFor, carLightColor, carLightIntensity, carPoseAt, CORNER_HIDE, CORNER_SHOW,
  cornerScale, createCars, createTraffic, FRONT_LIGHT_HEX, LANE_OFFSET, LOOP_LENGTH, REAR_LIGHT_HEX,
  PAINT_COMPENSATION, REAR_MIN_INTENSITY, ROAD_Y, SPEED_MAX, SPEED_MIN, TRAFFIC_GROUP_NAME, TURN_ARC_LENGTH, type Traffic,
  vehicleBodyName,
} from '../../app/journey/traffic'
import type { VehicleModels } from '../../app/journey/vehicle-models'
import { VEHICLE_TYPES, type VehicleType, vehicleBounds, vehicleLightOffsets } from '../../app/journey/vehicle-specs'
import { gainFor, linearLuminance } from '../../app/journey/window-look'

const INTERIOR_WAYPOINTS = PATH_SEGMENTS.slice(1).map(segment => segment.cumStart)
const BACK_LEG_START = CAR_ROUTE_END + TURN_ARC_LENGTH

function car(startDistance: number, speed = 3, type: VehicleType = 'sedan'): Car {
  return { speed, startDistance, bodyColor: 0x3a3a40, type }
}

// A car on the forward leg (right lane) at path distance `d`, and one on the back leg (left lane).
const forwardAt = (d: number, speed = 3) => car(d, speed)
const backAt = (d: number, speed = 3) => car(BACK_LEG_START + (CAR_ROUTE_END - d), speed)

describe('carCountFor', () => {
  it('gives 12 cars on full, 6 on lowPower and none under reduced motion', () => {
    expect(carCountFor(false, false)).toBe(CAR_COUNT_FULL)
    expect(carCountFor(false, true)).toBe(CAR_COUNT_LOW_POWER)
    expect(carCountFor(true, false)).toBe(0)
    expect(carCountFor(true, true)).toBe(0)
    expect(CAR_COUNT_FULL).toBe(12)
    expect(CAR_COUNT_LOW_POWER).toBe(6)
  })
})

describe('createCars', () => {
  it('creates the requested count with speeds in range and a start inside the loop', () => {
    for (const count of [CAR_COUNT_FULL, CAR_COUNT_LOW_POWER]) {
      const cars = createCars(count)
      expect(cars).toHaveLength(count)
      for (const c of cars) {
        expect(c.speed).toBeGreaterThanOrEqual(SPEED_MIN)
        expect(c.speed).toBeLessThanOrEqual(SPEED_MAX)
        expect(c.startDistance).toBeGreaterThanOrEqual(0)
        expect(c.startDistance).toBeLessThan(LOOP_LENGTH)
      }
    }
  })

  it('returns no cars for a count of 0', () => {
    expect(createCars(0)).toEqual([])
  })

  it('is deterministic', () => {
    expect(createCars(CAR_COUNT_FULL)).toEqual(createCars(CAR_COUNT_FULL))
  })

  it('gives every car the same speed, so cars on the loop never overtake each other', () => {
    expect(new Set(createCars(CAR_COUNT_FULL).map(c => c.speed)).size).toBe(1)
  })

  it('keeps cars at least 4 units apart along the loop at every sampled time', () => {
    for (const count of [CAR_COUNT_FULL, CAR_COUNT_LOW_POWER]) {
      const cars = createCars(count)
      for (const t of [0, 1.7, 13, 60, 1e4, 1e6]) {
        const positions = cars.map(c => ((c.startDistance + c.speed * t) % LOOP_LENGTH + LOOP_LENGTH) % LOOP_LENGTH).sort((a, b) => a - b)
        for (let i = 0; i < positions.length; i++) {
          const next = positions[(i + 1) % positions.length]!
          const gap = (next - positions[i]! + LOOP_LENGTH) % LOOP_LENGTH
          expect(gap, `count ${count} t ${t}`).toBeGreaterThanOrEqual(4)
        }
      }
    }
  })
})

describe('CAR_ROUTE_END', () => {
  it('leaves room for the turnaround arc and a margin before the courtyard entrance', () => {
    const seg = PATH_SEGMENTS[2]!
    const entrance = seg.cumStart + Math.hypot(PLACES.courtyard.x - seg.fromX, PLACES.courtyard.z - seg.fromZ) - COURTYARD_DEPTH / 2
    expect(CAR_ROUTE_END + LANE_OFFSET + CAR_TURN_MARGIN).toBeCloseTo(entrance, 9)
    expect(CAR_ROUTE_END).toBeLessThan(PATH_TOTAL_LENGTH)
  })

  it('has a loop of two legs and two half circles', () => {
    expect(LOOP_LENGTH).toBeCloseTo(2 * CAR_ROUTE_END + 2 * Math.PI * LANE_OFFSET, 9)
  })

  it('keeps every car, at every sampled time, out of the courtyard and off the road past it', () => {
    const seg = PATH_SEGMENTS[2]!
    const entranceAlong = CAR_ROUTE_END + LANE_OFFSET + CAR_TURN_MARGIN - seg.cumStart
    for (const c of createCars(CAR_COUNT_FULL)) {
      for (let t = 0; t < 400; t += 0.37) {
        const pose = carPoseAt(c, t)
        const along = (pose.x - seg.fromX) * seg.dirX + (pose.z - seg.fromZ) * seg.dirZ
        expect(along).toBeLessThanOrEqual(entranceAlong - CAR_TURN_MARGIN + 1e-9)
      }
    }
  })
})

describe('carPoseAt', () => {
  it('makes a full lap and returns to where it began', () => {
    const c = car(10, 3)
    const start = carPoseAt(c, 0)
    const lap = carPoseAt(c, LOOP_LENGTH / 3)
    expect(lap.x).toBeCloseTo(start.x, 6)
    expect(lap.z).toBeCloseTo(start.z, 6)
    expect(lap.distance).toBeCloseTo(start.distance, 6)
  })

  it('drives the forward leg toward increasing distance and the back leg toward decreasing distance', () => {
    expect(carPoseAt(forwardAt(50, 4), 0.5).distance).toBeCloseTo(52, 9)
    expect(carPoseAt(backAt(50, 4), 0.5).distance).toBeCloseTo(48, 9)
  })

  it('keeps the car LANE_OFFSET from the center line on each leg, on the right when driving forward', () => {
    for (let d = 5; d < CAR_ROUTE_END; d += 7.3) {
      for (const [fixture, side] of [[forwardAt(d), 1], [backAt(d), -1]] as const) {
        const pose = carPoseAt(fixture, 0)
        const point = pathPointAt(pose.distance)
        expect((pose.x - point.x) * point.rightX + (pose.z - point.z) * point.rightZ).toBeCloseTo(side * LANE_OFFSET, 6)
        expect((pose.x - point.x) * point.dirX + (pose.z - point.z) * point.dirZ).toBeCloseTo(0, 6)
      }
    }
  })

  it('faces the direction of travel on each leg and flips by 180 degrees between legs', () => {
    for (const d of [10, 45, 70]) {
      const point = pathPointAt(d)
      const a = carPoseAt(forwardAt(d), 0).yaw
      const b = carPoseAt(backAt(d), 0).yaw
      expect(Math.cos(a - headingFor(point.dirX, point.dirZ))).toBeCloseTo(1, 9)
      expect(Math.cos(b - headingFor(-point.dirX, -point.dirZ))).toBeCloseTo(1, 9)
      expect(Math.cos(a - b)).toBeCloseTo(-1, 9)
    }
  })

  it('moves continuously through both turnarounds: no jump in position or heading', () => {
    const speed = 3
    const dt = 0.02
    const maxStep = speed * dt * 1.001
    const c = car(0, speed)
    let previous = { ...carPoseAt(c, 0) }
    for (let t = dt; t < (LOOP_LENGTH / speed) * 2; t += dt) {
      const pose = carPoseAt(c, t)
      // The lane offset flips direction at a corner, where the car is scaled to 0 and so is not drawn.
      if (pose.scale === 0 || previous.scale === 0) {
        previous = { ...pose }
        continue
      }
      expect(Math.hypot(pose.x - previous.x, pose.z - previous.z), `t ${t}`).toBeLessThanOrEqual(maxStep)
      const turn = Math.abs(Math.atan2(Math.sin(pose.yaw - previous.yaw), Math.cos(pose.yaw - previous.yaw)))
      expect(turn, `t ${t}`).toBeLessThan(speed * dt / LANE_OFFSET * 1.01)
      previous = { ...pose }
    }
  })

  it('swings across the road in the end arc: right lane in, left lane out, bulging past the route end', () => {
    const seg = PATH_SEGMENTS[2]!
    const mid = carPoseAt(car(CAR_ROUTE_END + TURN_ARC_LENGTH / 2, 3), 0)
    const point = pathPointAt(CAR_ROUTE_END)
    expect((mid.x - point.x) * point.rightX + (mid.z - point.z) * point.rightZ).toBeCloseTo(0, 6)
    expect((mid.x - point.x) * seg.dirX + (mid.z - point.z) * seg.dirZ).toBeCloseTo(LANE_OFFSET, 6)
  })

  it('gives the same position at t = 1e6 as at the reduced time modulo the lap period', () => {
    for (const c of createCars(CAR_COUNT_FULL)) {
      const period = LOOP_LENGTH / c.speed
      const big = carPoseAt(c, 1e6)
      const small = carPoseAt(c, 1e6 % period)
      expect(big.x).toBeCloseTo(small.x, 3)
      expect(big.z).toBeCloseTo(small.z, 3)
    }
  })

  it('writes into the provided pose and returns it', () => {
    const out = { x: 0, z: 0, yaw: 0, distance: 0, scale: 0 }
    expect(carPoseAt(forwardAt(50), 0, out)).toBe(out)
    expect(out.distance).toBe(50)
    expect(out.scale).toBe(1)
  })

  it('stays fully visible through both turnarounds, with no fade at the path ends', () => {
    expect(carPoseAt(forwardAt(0), 0).scale).toBe(1)
    expect(carPoseAt(car(CAR_ROUTE_END + TURN_ARC_LENGTH / 2), 0).scale).toBe(1)
    expect(carPoseAt(car(LOOP_LENGTH - TURN_ARC_LENGTH / 2), 0).scale).toBe(1)
  })
})

describe('cornerScale', () => {
  it('hides cars within 2.5 units of each interior waypoint and shows them beyond 3.5', () => {
    expect(INTERIOR_WAYPOINTS).toEqual([34, 60])
    for (const corner of INTERIOR_WAYPOINTS) {
      for (const offset of [0, 1, CORNER_HIDE]) {
        expect(cornerScale(corner + offset)).toBe(0)
        expect(cornerScale(corner - offset)).toBe(0)
      }
      for (const offset of [CORNER_SHOW, CORNER_SHOW + 0.1, 8]) {
        expect(cornerScale(corner + offset)).toBe(1)
        expect(cornerScale(corner - offset)).toBe(1)
      }
    }
  })

  it('grows monotonically between 2.5 and 3.5 units from a corner', () => {
    let previous = 0
    for (let offset = CORNER_HIDE; offset <= CORNER_SHOW; offset += 0.05) {
      const value = cornerScale(34 + offset)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
    expect(cornerScale(34 + 3)).toBeGreaterThan(0)
    expect(cornerScale(34 + 3)).toBeLessThan(1)
  })

  it('hides a car at a corner on either leg', () => {
    expect(carPoseAt(forwardAt(34), 0).scale).toBe(0)
    expect(carPoseAt(backAt(60), 0).scale).toBe(0)
  })
})

describe('car geometry constants', () => {
  it('rests the body on a ride height of 0.08, so its center is at y -0.78', () => {
    expect(CAR_SIZE).toEqual({ width: 0.45, height: 0.28, length: 0.9 })
    expect(CAR_RIDE_HEIGHT).toBe(0.08)
    expect(CAR_CENTER_Y).toBeCloseTo(-0.78, 12)
  })

  it('puts two front lights ahead (-Z) and two rear lights behind (+Z) the body center', () => {
    expect(CAR_LIGHT_OFFSETS).toHaveLength(4)
    expect(CAR_LIGHT_OFFSETS.filter(l => l.kind === 'front').map(l => [l.x, l.z])).toEqual([[-0.15, -0.46], [0.15, -0.46]])
    expect(CAR_LIGHT_OFFSETS.filter(l => l.kind === 'rear').map(l => [l.x, l.z])).toEqual([[-0.15, 0.46], [0.15, 0.46]])
  })
})

describe('car light intensity and color', () => {
  it('ramps the front lights with the dusk ramp: off at 0.2, fully on at 0.25', () => {
    expect(carLightIntensity('front', 0)).toBe(0)
    expect(carLightIntensity('front', 0.2)).toBe(0)
    expect(carLightIntensity('front', 0.25)).toBe(1)
    expect(carLightIntensity('front', 0.9)).toBe(1)
  })

  it('keeps the rear lights at 20% minimum and follows the same ramp above it', () => {
    expect(REAR_MIN_INTENSITY).toBe(0.2)
    expect(carLightIntensity('rear', 0)).toBe(0.2)
    expect(carLightIntensity('rear', 0.2)).toBe(0.2)
    expect(carLightIntensity('rear', 0.25)).toBe(1)
  })

  it('reaches luminance 2.3 for a fully lit light and dark glass for an unlit front light', () => {
    const out = new THREE.Color()
    for (const [kind, hex] of [['front', FRONT_LIGHT_HEX], ['rear', REAR_LIGHT_HEX]] as const) {
      const lit = carLightColor(kind, 1, out)
      expect(linearLuminance([lit.r, lit.g, lit.b])).toBeCloseTo(STREET_LIGHT_LUMINANCE, 3)
      expect(gainFor(hex, STREET_LIGHT_LUMINANCE)).toBeGreaterThan(1)
    }
    expect(carLightColor('front', 0, out).toArray()).toEqual(new THREE.Color(DARK_GLASS_HEX).toArray())
    const rearDay = carLightColor('rear', 0, out)
    const rearLit = carLightColor('rear', 1, new THREE.Color())
    expect(rearDay.r).toBeGreaterThan(new THREE.Color(DARK_GLASS_HEX).r)
    expect(rearDay.r).toBeLessThan(rearLit.r)
  })
})

function meshNamed(traffic: Traffic, name: string): THREE.InstancedMesh {
  const mesh = traffic.objects.find(object => object.name === name)
  if (!mesh) throw new Error(`missing mesh ${name}`)
  return mesh
}

const matrix = new THREE.Matrix4()
function positionOf(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixPosition(matrix)
}
function scaleOf(mesh: THREE.InstancedMesh, index: number): number {
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixScale(matrix).x
}

describe('createTraffic', () => {
  it('creates no objects for an empty car list, and update does nothing', () => {
    const traffic = createTraffic([])
    expect(traffic.objects).toEqual([])
    expect(() => traffic.update(0.5, 12)).not.toThrow()
    expect(() => traffic.dispose()).not.toThrow()
  })

  it('creates no objects under reduced motion, where the car count is 0', () => {
    expect(createTraffic(createCars(carCountFor(true, false))).objects).toEqual([])
    expect(createTraffic(createCars(carCountFor(true, true))).objects).toEqual([])
  })

  it('creates one body per car and four lights per car, culling off, two draw calls', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    expect(traffic.objects).toHaveLength(2)
    const bodies = meshNamed(traffic, STREET_NAMES.carBodies)
    const lights = meshNamed(traffic, STREET_NAMES.carLights)
    expect(bodies.count).toBe(12)
    expect(lights.count).toBe(48)
    expect(bodies.frustumCulled).toBe(false)
    expect(lights.frustumCulled).toBe(false)
    expect(createTraffic(createCars(CAR_COUNT_LOW_POWER)).objects[0]!.count).toBe(6)
    traffic.dispose()
  })

  it('puts a visible car body center at y -0.78 on its lane position', () => {
    const fixture = forwardAt(50)
    const traffic = createTraffic([fixture])
    traffic.update(1, 0)
    const bodies = meshNamed(traffic, STREET_NAMES.carBodies)
    const pose = carPoseAt(fixture, 0)
    const body = positionOf(bodies, 0)
    expect(body.y).toBeCloseTo(CAR_CENTER_Y, 6)
    expect(body.x).toBeCloseTo(pose.x, 6)
    expect(body.z).toBeCloseTo(pose.z, 6)
    expect(scaleOf(bodies, 0)).toBeCloseTo(1, 6)
    traffic.dispose()
  })

  it('places front lights ahead of the body center along travel and rear lights behind, in both lanes', () => {
    for (const [lane, fixture] of [[1, forwardAt(50)], [-1, backAt(50)]] as const) {
      const traffic = createTraffic([fixture])
      traffic.update(1, 0)
      const bodies = meshNamed(traffic, STREET_NAMES.carBodies)
      const lights = meshNamed(traffic, STREET_NAMES.carLights)
      const body = positionOf(bodies, 0)
      const point = pathPointAt(50)
      const travel = new THREE.Vector3(lane * point.dirX, 0, lane * point.dirZ)
      CAR_LIGHT_OFFSETS.forEach((offset, k) => {
        const light = positionOf(lights, k)
        expect(light.y).toBeCloseTo(CAR_CENTER_Y, 6)
        const ahead = light.clone().sub(body).dot(travel)
        if (offset.kind === 'front') expect(ahead, `lane ${lane} light ${k}`).toBeGreaterThan(0.4)
        else expect(ahead, `lane ${lane} light ${k}`).toBeLessThan(-0.4)
      })
      traffic.dispose()
    }
  })

  it('hides a car on an interior waypoint, lights included', () => {
    for (const distance of [34, 60]) {
      const traffic = createTraffic([forwardAt(distance)])
      traffic.update(1, 0)
      expect(scaleOf(meshNamed(traffic, STREET_NAMES.carBodies), 0)).toBe(0)
      for (let k = 0; k < 4; k++) expect(scaleOf(meshNamed(traffic, STREET_NAMES.carLights), k)).toBe(0)
      traffic.dispose()
    }
  })

  it('moves the cars every update but rewrites colors only when the quantised ratio changes', () => {
    const traffic = createTraffic([forwardAt(50)])
    const bodies = meshNamed(traffic, STREET_NAMES.carBodies)
    const lights = meshNamed(traffic, STREET_NAMES.carLights)
    traffic.update(0.3, 0)
    const matrixVersion = bodies.instanceMatrix.version
    const colorVersion = lights.instanceColor!.version
    traffic.update(0.3, 1)
    expect(bodies.instanceMatrix.version).toBeGreaterThan(matrixVersion)
    expect(positionOf(bodies, 0).x).not.toBe(Number.NaN)
    expect(lights.instanceColor!.version).toBe(colorVersion)
    traffic.update(0.1, 2)
    expect(lights.instanceColor!.version).toBeGreaterThan(colorVersion)
    traffic.dispose()
  })

  it('colors lights by kind: unlit front lights show dark glass, rear lights keep their 20% glow', () => {
    const traffic = createTraffic([forwardAt(50)])
    traffic.update(0.05, 0)
    const lights = meshNamed(traffic, STREET_NAMES.carLights)
    const out = new THREE.Color()
    CAR_LIGHT_OFFSETS.forEach((offset, k) => {
      lights.getColorAt(k, out)
      const expected = carLightColor(offset.kind, 0.05, new THREE.Color())
      expect(out.r).toBeCloseTo(expected.r, 6)
      expect(out.g).toBeCloseTo(expected.g, 6)
      expect(out.b).toBeCloseTo(expected.b, 6)
    })
    traffic.dispose()
  })

  it('keeps each car body color from the palette entry it was created with', () => {
    const cars = createCars(CAR_COUNT_LOW_POWER)
    const traffic = createTraffic(cars)
    const bodies = meshNamed(traffic, STREET_NAMES.carBodies)
    const out = new THREE.Color()
    cars.forEach((c, i) => {
      bodies.getColorAt(i, out)
      expect(out.getHex()).toBe(new THREE.Color(c.bodyColor).getHex())
    })
    traffic.dispose()
  })

  it('does not touch matrices when there are no cars to move', () => {
    const traffic = createTraffic([])
    expect(() => { for (let t = 0; t < 5; t++) traffic.update(0.9, t) }).not.toThrow()
  })
})

function fakeModels(): VehicleModels {
  const geometries = {
    sedan: new THREE.BoxGeometry(0.5, 0.4, 0.9),
    suv: new THREE.BoxGeometry(0.5, 0.45, 0.95),
    truck: new THREE.BoxGeometry(0.5, 0.5, 1.05),
  }
  return { geometries, map: new THREE.Texture() }
}

const bodyMeshes = (traffic: Traffic) =>
  traffic.objects.filter(mesh => mesh.name.startsWith(`${STREET_NAMES.carBodies}-`))

// The full swap the scene performs once the shader warmup is done.
function swapIn(traffic: Traffic, models: VehicleModels): void {
  traffic.stageModels(models)
  traffic.showModels()
}

const stagedBodies = (traffic: Traffic) => traffic.group.children
  .filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh
    && child.name.startsWith(`${STREET_NAMES.carBodies}-`))

describe('createCars vehicle types', () => {
  it('assigns the three types in rotation, so low power still has all three', () => {
    for (const count of [CAR_COUNT_FULL, CAR_COUNT_LOW_POWER]) {
      const types = createCars(count).map(c => c.type)
      expect(new Set(types)).toEqual(new Set(VEHICLE_TYPES))
    }
    expect(createCars(CAR_COUNT_FULL).map(c => c.type)).toEqual(createCars(CAR_COUNT_FULL).map(c => c.type))
  })
})

describe('createTraffic with vehicle models', () => {
  it('exposes a named group that holds the box meshes until models arrive', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    expect(traffic.group.name).toBe(TRAFFIC_GROUP_NAME)
    expect(traffic.group.name.startsWith('journey-street-')).toBe(true)
    expect(traffic.group.children).toHaveLength(2)
    traffic.dispose()
  })

  it('swaps the box bodies for one body mesh per type: three bodies plus the lights, four draw calls', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    swapIn(traffic, fakeModels())
    expect(traffic.objects).toHaveLength(4)
    expect(bodyMeshes(traffic).map(mesh => mesh.name).sort()).toEqual(VEHICLE_TYPES.map(vehicleBodyName).sort())
    expect(bodyMeshes(traffic).map(mesh => mesh.count)).toEqual([4, 4, 4])
    expect(meshNamed(traffic, STREET_NAMES.carLights).count).toBe(48)
    expect(traffic.objects.some(mesh => mesh.name === STREET_NAMES.carBodies)).toBe(false)
    for (const mesh of traffic.objects) expect(mesh.frustumCulled).toBe(false)
    traffic.dispose()
  })

  it('creates no empty mesh for a type with no cars', () => {
    const traffic = createTraffic([car(10, 3, 'sedan'), car(40, 3, 'sedan'), car(70, 3, 'truck')])
    swapIn(traffic, fakeModels())
    expect(bodyMeshes(traffic).map(mesh => [mesh.name, mesh.count])).toEqual([
      [vehicleBodyName('sedan'), 2],
      [vehicleBodyName('truck'), 1],
    ])
    traffic.dispose()
  })

  it('copies the reflection layers of the group onto the new meshes', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_LOW_POWER))
    traffic.group.layers.enable(1)
    swapIn(traffic, fakeModels())
    for (const mesh of bodyMeshes(traffic)) expect(mesh.layers.isEnabled(1)).toBe(true)
    traffic.dispose()
  })

  it('ignores a second stageModels call and keeps the first meshes', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    swapIn(traffic, fakeModels())
    const first = bodyMeshes(traffic)
    swapIn(traffic, fakeModels())
    expect(bodyMeshes(traffic)).toEqual(first)
    expect(traffic.group.children).toHaveLength(4)
    traffic.dispose()
  })

  it('does nothing after dispose, and with no cars', () => {
    const none = createTraffic([])
    swapIn(none, fakeModels())
    expect(none.group.children).toHaveLength(0)
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    traffic.dispose()
    const before = [...traffic.group.children]
    expect(() => swapIn(traffic, fakeModels())).not.toThrow()
    expect(traffic.group.children).toEqual(before)
  })

  it('puts the vehicles on the road and each on its lane position', () => {
    const fixture = car(50, 3, 'suv')
    const traffic = createTraffic([fixture])
    swapIn(traffic, fakeModels())
    traffic.update(1, 0)
    const bodies = meshNamed(traffic, vehicleBodyName('suv'))
    const pose = carPoseAt(fixture, 0)
    const position = positionOf(bodies, 0)
    expect(position.y).toBeCloseTo(ROAD_Y, 6)
    expect(position.x).toBeCloseTo(pose.x, 6)
    expect(position.z).toBeCloseTo(pose.z, 6)
    expect(scaleOf(bodies, 0)).toBeCloseTo(1, 6)
    traffic.dispose()
  })

  it('writes every matrix on the first update after a swap that happens mid-run, and keeps the light mesh', () => {
    const traffic = createTraffic([car(50, 3, 'sedan'), car(80, 3, 'truck')])
    traffic.update(0.3, 0)
    const lights = meshNamed(traffic, STREET_NAMES.carLights)
    const colorVersion = lights.instanceColor!.version
    swapIn(traffic, fakeModels())
    expect(meshNamed(traffic, STREET_NAMES.carLights)).toBe(lights)
    traffic.update(0.3, 1)
    for (const mesh of bodyMeshes(traffic)) {
      expect(scaleOf(mesh, 0)).toBeGreaterThan(0)
      expect(Number.isNaN(positionOf(mesh, 0).x)).toBe(false)
    }
    expect(lights.instanceColor!.version).toBe(colorVersion)
    traffic.dispose()
  })

  it('places each type\'s lights at its own bumpers, ahead of or behind the body in both lanes', () => {
    for (const type of VEHICLE_TYPES) {
      for (const [lane, fixture] of [[1, forwardAt(50)], [-1, backAt(50)]] as const) {
        const typed = { ...fixture, type }
        const traffic = createTraffic([typed])
        swapIn(traffic, fakeModels())
        traffic.update(1, 0)
        const body = positionOf(meshNamed(traffic, vehicleBodyName(type)), 0)
        const lights = meshNamed(traffic, STREET_NAMES.carLights)
        const point = pathPointAt(50)
        const travel = new THREE.Vector3(lane * point.dirX, 0, lane * point.dirZ)
        const bounds = vehicleBounds(type)
        vehicleLightOffsets(type).forEach((offset, k) => {
          const light = positionOf(lights, k)
          expect(light.y).toBeCloseTo(ROAD_Y + offset.y, 6)
          const ahead = light.clone().sub(body).dot(travel)
          const halfLength = (bounds.maxZ - bounds.minZ) / 2
          if (offset.kind === 'front') expect(ahead, `${type} lane ${lane} light ${k}`).toBeGreaterThan(halfLength * 0.8)
          else expect(ahead, `${type} lane ${lane} light ${k}`).toBeLessThan(-halfLength * 0.8)
        })
        traffic.dispose()
      }
    }
  })

  it('hides a car at a corner in every mesh, lights included', () => {
    for (const distance of [34, 60]) {
      const traffic = createTraffic([car(distance, 3, 'truck')])
      swapIn(traffic, fakeModels())
      traffic.update(1, 0)
      expect(scaleOf(meshNamed(traffic, vehicleBodyName('truck')), 0)).toBe(0)
      for (let k = 0; k < 4; k++) expect(scaleOf(meshNamed(traffic, STREET_NAMES.carLights), k)).toBe(0)
      traffic.dispose()
    }
  })

  it('tints each body by its palette color times the paint compensation', () => {
    const cars = createCars(CAR_COUNT_LOW_POWER)
    const traffic = createTraffic(cars)
    swapIn(traffic, fakeModels())
    const out = new THREE.Color()
    const expected = new THREE.Color()
    for (const type of VEHICLE_TYPES) {
      const mesh = meshNamed(traffic, vehicleBodyName(type))
      cars.filter(c => c.type === type).forEach((c, j) => {
        mesh.getColorAt(j, out)
        expected.set(c.bodyColor).multiplyScalar(PAINT_COMPENSATION)
        expect(out.r).toBeCloseTo(expected.r, 5)
        expect(out.g).toBeCloseTo(expected.g, 5)
        expect(out.b).toBeCloseTo(expected.b, 5)
      })
    }
    traffic.dispose()
  })

  it('disposes the model geometries, texture and shared material, and the lights', () => {
    const models = fakeModels()
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    const box = meshNamed(traffic, STREET_NAMES.carBodies)
    const boxGeometrySpy = vi.spyOn(box.geometry, 'dispose')
    const boxMaterialSpy = vi.spyOn(box.material as THREE.Material, 'dispose')
    swapIn(traffic, models)
    const geometrySpies = VEHICLE_TYPES.map(type => vi.spyOn(models.geometries[type], 'dispose'))
    const mapSpy = vi.spyOn(models.map, 'dispose')
    const material = bodyMeshes(traffic)[0]!.material as THREE.Material
    const materialSpy = vi.spyOn(material, 'dispose')
    const lights = meshNamed(traffic, STREET_NAMES.carLights)
    const lightGeometrySpy = vi.spyOn(lights.geometry, 'dispose')
    traffic.dispose()
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalledTimes(1)
    expect(mapSpy).toHaveBeenCalledTimes(1)
    expect(materialSpy).toHaveBeenCalledTimes(1)
    expect(lightGeometrySpy).toHaveBeenCalledTimes(1)
    expect(boxGeometrySpy).toHaveBeenCalledTimes(1)
    expect(boxMaterialSpy).toHaveBeenCalledTimes(1)
  })
})

describe('staging the vehicle models before they show', () => {
  it('adds hidden body meshes to the group and keeps drawing the box cars', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    const before = traffic.objects
    traffic.stageModels(fakeModels())
    expect(stagedBodies(traffic).map(mesh => mesh.name).sort()).toEqual(VEHICLE_TYPES.map(vehicleBodyName).sort())
    for (const mesh of stagedBodies(traffic)) expect(mesh.visible).toBe(false)
    expect(traffic.objects).toBe(before)
    expect(meshNamed(traffic, STREET_NAMES.carBodies).visible).toBe(true)
    expect(traffic.group.getObjectByName(STREET_NAMES.carBodies)).toBeDefined()
    traffic.dispose()
  })

  it('gives the staged meshes the reflection layers of the group', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_LOW_POWER))
    traffic.group.layers.enable(1)
    traffic.stageModels(fakeModels())
    for (const mesh of stagedBodies(traffic)) expect(mesh.layers.isEnabled(1)).toBe(true)
    traffic.dispose()
  })

  it('shows the staged meshes, drops the box bodies and releases their geometry and material', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    const box = meshNamed(traffic, STREET_NAMES.carBodies)
    const boxGeometrySpy = vi.spyOn(box.geometry, 'dispose')
    const boxMaterialSpy = vi.spyOn(box.material as THREE.Material, 'dispose')
    traffic.stageModels(fakeModels())
    const staged = stagedBodies(traffic)
    traffic.showModels()
    expect(bodyMeshes(traffic)).toEqual(staged)
    for (const mesh of staged) expect(mesh.visible).toBe(true)
    expect(traffic.group.getObjectByName(STREET_NAMES.carBodies)).toBeUndefined()
    expect(traffic.group.children).toHaveLength(4)
    expect(boxGeometrySpy).toHaveBeenCalledTimes(1)
    expect(boxMaterialSpy).toHaveBeenCalledTimes(1)
    traffic.dispose()
  })

  it('keeps the box lights offsets until the models show', () => {
    const fixture = car(50, 3, 'truck')
    const traffic = createTraffic([fixture])
    traffic.stageModels(fakeModels())
    traffic.update(1, 0)
    const lights = meshNamed(traffic, STREET_NAMES.carLights)
    const body = positionOf(meshNamed(traffic, STREET_NAMES.carBodies), 0)
    expect(positionOf(lights, 0).y).toBeCloseTo(body.y + CAR_LIGHT_OFFSETS[0]!.y, 6)
    traffic.dispose()
  })

  it('does nothing on showModels when nothing is staged', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    const before = traffic.objects
    traffic.showModels()
    expect(traffic.objects).toBe(before)
    expect(traffic.group.children).toHaveLength(2)
    traffic.dispose()
  })

  it('discards staged models: removes their meshes, disposes them once and keeps the box cars', () => {
    const models = fakeModels()
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    const before = traffic.objects
    traffic.stageModels(models)
    const material = stagedBodies(traffic)[0]!.material as THREE.Material
    const materialSpy = vi.spyOn(material, 'dispose')
    const geometrySpies = VEHICLE_TYPES.map(type => vi.spyOn(models.geometries[type], 'dispose'))
    const mapSpy = vi.spyOn(models.map, 'dispose')
    traffic.discardModels()
    expect(stagedBodies(traffic)).toEqual([])
    expect(traffic.objects).toBe(before)
    expect(traffic.group.children).toHaveLength(2)
    traffic.showModels()
    expect(traffic.group.children).toHaveLength(2)
    traffic.dispose()
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalledTimes(1)
    expect(mapSpy).toHaveBeenCalledTimes(1)
    expect(materialSpy).toHaveBeenCalledTimes(1)
  })

  it('does not discard models that already show', () => {
    const models = fakeModels()
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    swapIn(traffic, models)
    const mapSpy = vi.spyOn(models.map, 'dispose')
    traffic.discardModels()
    expect(bodyMeshes(traffic)).toHaveLength(3)
    expect(mapSpy).not.toHaveBeenCalled()
    traffic.dispose()
  })

  it('disposes staged models, the box cars and the lights when traffic is disposed before the models show', () => {
    const models = fakeModels()
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    const box = meshNamed(traffic, STREET_NAMES.carBodies)
    const boxGeometrySpy = vi.spyOn(box.geometry, 'dispose')
    traffic.stageModels(models)
    const material = stagedBodies(traffic)[0]!.material as THREE.Material
    const materialSpy = vi.spyOn(material, 'dispose')
    const geometrySpies = VEHICLE_TYPES.map(type => vi.spyOn(models.geometries[type], 'dispose'))
    const mapSpy = vi.spyOn(models.map, 'dispose')
    const lightGeometrySpy = vi.spyOn(meshNamed(traffic, STREET_NAMES.carLights).geometry, 'dispose')
    traffic.dispose()
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalledTimes(1)
    expect(mapSpy).toHaveBeenCalledTimes(1)
    expect(materialSpy).toHaveBeenCalledTimes(1)
    expect(boxGeometrySpy).toHaveBeenCalledTimes(1)
    expect(lightGeometrySpy).toHaveBeenCalledTimes(1)
  })
})

describe('traffic.objects and car-to-slot mapping', () => {
  it('returns a snapshot, so adding the meshes to another parent neither drops them nor empties objects', () => {
    const traffic = createTraffic(createCars(CAR_COUNT_FULL))
    for (const expected of [2, 4]) {
      const meshes = traffic.objects
      expect(meshes).toHaveLength(expected)
      const scene = new THREE.Scene()
      const visited: THREE.Object3D[] = []
      for (const mesh of meshes) {
        visited.push(mesh)
        scene.add(mesh)
      }
      expect(visited).toHaveLength(expected)
      expect(scene.children).toHaveLength(expected)
      expect(traffic.objects).toHaveLength(expected)
      expect(traffic.objects.filter(mesh => mesh.name.startsWith(`${STREET_NAMES.carBodies}`))).toHaveLength(expected - 1)
      if (expected === 2) {
        swapIn(traffic, fakeModels())
      }
    }
    traffic.dispose()
  })

  it('writes each car\'s body and lights to its own slots', () => {
    const cars = createCars(CAR_COUNT_FULL)
    const traffic = createTraffic(cars)
    swapIn(traffic, fakeModels())
    const time = 5
    traffic.update(0.3, time)
    const lights = meshNamed(traffic, STREET_NAMES.carLights)
    const seen: Record<string, number> = {}
    let checked = 0
    cars.forEach((c, i) => {
      const slot = seen[c.type] ?? 0
      seen[c.type] = slot + 1
      const pose = carPoseAt(c, time)
      if (pose.scale <= 0) return
      checked++
      const body = positionOf(meshNamed(traffic, vehicleBodyName(c.type)), slot)
      expect(body.x, `car ${i} body x`).toBeCloseTo(pose.x, 5)
      expect(body.z, `car ${i} body z`).toBeCloseTo(pose.z, 5)
      for (let k = 0; k < 4; k++) {
        const light = positionOf(lights, i * 4 + k)
        expect(Math.hypot(light.x - pose.x, light.z - pose.z), `car ${i} light ${k}`).toBeLessThan(0.6)
      }
    })
    expect(checked).toBeGreaterThan(CAR_COUNT_FULL / 2)
    traffic.dispose()
  })
})
