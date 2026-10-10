import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DARK_GLASS_HEX, STREET_LIGHT_LUMINANCE, STREET_NAMES } from '../../app/journey/lamps'
import { headingFor, PATH_SEGMENTS, PATH_TOTAL_LENGTH, pathPointAt } from '../../app/journey/path'
import {
  CAR_CENTER_Y, CAR_COUNT_FULL, CAR_COUNT_LOW_POWER, CAR_LIGHT_OFFSETS, CAR_RIDE_HEIGHT, CAR_SIZE, type Car,
  carCountFor, carLightColor, carLightIntensity, carPoseAt, CORNER_HIDE, CORNER_SHOW, cornerScale, createCars,
  createTraffic,
  EDGE_SHOW, edgeScale, FRONT_LIGHT_HEX, LANE_OFFSET, REAR_LIGHT_HEX, REAR_MIN_INTENSITY, SPEED_MAX, SPEED_MIN,
  type Traffic, visibilityScale,
} from '../../app/journey/traffic'
import { gainFor, linearLuminance } from '../../app/journey/window-look'

const INTERIOR_WAYPOINTS = PATH_SEGMENTS.slice(1).map(segment => segment.cumStart)

function car(lane: 1 | -1, startDistance: number, speed = 3): Car {
  return { lane, speed, startDistance, bodyColor: 0x3a3a40 }
}

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
  it('splits the cars evenly between the two lanes and keeps speeds in range', () => {
    for (const count of [CAR_COUNT_FULL, CAR_COUNT_LOW_POWER]) {
      const cars = createCars(count)
      expect(cars).toHaveLength(count)
      expect(cars.filter(c => c.lane === 1)).toHaveLength(count / 2)
      expect(cars.filter(c => c.lane === -1)).toHaveLength(count / 2)
      for (const c of cars) {
        expect(c.speed).toBeGreaterThanOrEqual(SPEED_MIN)
        expect(c.speed).toBeLessThanOrEqual(SPEED_MAX)
        expect(c.startDistance).toBeGreaterThanOrEqual(0)
        expect(c.startDistance).toBeLessThan(PATH_TOTAL_LENGTH)
      }
    }
  })

  it('returns no cars for a count of 0', () => {
    expect(createCars(0)).toEqual([])
  })

  it('is deterministic', () => {
    expect(createCars(CAR_COUNT_FULL)).toEqual(createCars(CAR_COUNT_FULL))
  })

  it('gives every car in a lane the same speed, so cars in one lane never overtake each other', () => {
    for (const lane of [1, -1] as const) {
      const speeds = new Set(createCars(CAR_COUNT_FULL).filter(c => c.lane === lane).map(c => c.speed))
      expect(speeds.size).toBe(1)
    }
  })

  it('keeps same-lane cars at least 4 units apart at every sampled time, wrapping included', () => {
    for (const count of [CAR_COUNT_FULL, CAR_COUNT_LOW_POWER]) {
      const cars = createCars(count)
      for (const lane of [1, -1] as const) {
        const inLane = cars.filter(c => c.lane === lane)
        for (const t of [0, 1.7, 13, 60, 1e4, 1e6]) {
          const distances = inLane.map(c => carPoseAt(c, t).distance).sort((a, b) => a - b)
          for (let i = 0; i < distances.length; i++) {
            const next = distances[(i + 1) % distances.length]!
            const gap = (next - distances[i]! + PATH_TOTAL_LENGTH) % PATH_TOTAL_LENGTH
            expect(gap, `count ${count} lane ${lane} t ${t}`).toBeGreaterThanOrEqual(4)
          }
        }
      }
    }
  })
})

describe('carPoseAt', () => {
  it('wraps past the end of the path in both directions', () => {
    expect(carPoseAt(car(1, 99, 3), 1).distance).toBeCloseTo(2, 9)
    expect(carPoseAt(car(-1, 1, 3), 1).distance).toBeCloseTo(98, 9)
    expect(carPoseAt(car(1, 10, 3), 0).distance).toBe(10)
  })

  it('keeps the car LANE_OFFSET from the center line, on its own side of travel', () => {
    for (const lane of [1, -1] as const) {
      for (let d = 5; d < PATH_TOTAL_LENGTH; d += 7.3) {
        const pose = carPoseAt(car(lane, d, 3), 0)
        const point = pathPointAt(pose.distance)
        expect(Math.hypot(pose.x - point.x, pose.z - point.z)).toBeCloseTo(LANE_OFFSET, 2)
        // Signed offset along the path's right vector: +1 lane on the right, -1 lane on the left.
        expect((pose.x - point.x) * point.rightX + (pose.z - point.z) * point.rightZ).toBeCloseTo(lane * LANE_OFFSET, 6)
      }
    }
  })

  it('moves the +1 lane toward increasing distance and the -1 lane toward decreasing distance', () => {
    const forward = carPoseAt(car(1, 50, 4), 0.5).distance
    const backward = carPoseAt(car(-1, 50, 4), 0.5).distance
    expect(forward).toBeCloseTo(52, 9)
    expect(backward).toBeCloseTo(48, 9)
  })

  it('faces the direction of travel and flips by 180 degrees between lanes', () => {
    for (const d of [10, 45, 80]) {
      const point = pathPointAt(d)
      const a = carPoseAt(car(1, d, 3), 0).yaw
      const b = carPoseAt(car(-1, d, 3), 0).yaw
      expect(a).toBeCloseTo(headingFor(point.dirX, point.dirZ), 9)
      expect(b).toBeCloseTo(headingFor(-point.dirX, -point.dirZ), 9)
      expect(Math.cos(a - b)).toBeCloseTo(-1, 9)
    }
  })

  it('gives the same position at t = 1e6 as at the reduced time modulo the lap period', () => {
    for (const c of createCars(CAR_COUNT_FULL)) {
      const period = PATH_TOTAL_LENGTH / c.speed
      const big = carPoseAt(c, 1e6)
      const small = carPoseAt(c, 1e6 % period)
      expect(big.x).toBeCloseTo(small.x, 3)
      expect(big.z).toBeCloseTo(small.z, 3)
    }
  })

  it('writes into the provided pose and returns it', () => {
    const out = { x: 0, z: 0, yaw: 0, distance: 0, scale: 0 }
    expect(carPoseAt(car(1, 50, 3), 0, out)).toBe(out)
    expect(out.distance).toBe(50)
    expect(out.scale).toBe(1)
  })
})

describe('cornerScale, edgeScale and visibilityScale', () => {
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

  it('hides cars at both path ends and shows them from 4 units in, so a wrap never pops beside the lens', () => {
    expect(edgeScale(0)).toBe(0)
    expect(edgeScale(PATH_TOTAL_LENGTH)).toBe(0)
    expect(edgeScale(EDGE_SHOW)).toBe(1)
    expect(edgeScale(PATH_TOTAL_LENGTH - EDGE_SHOW)).toBe(1)
    expect(edgeScale(PATH_TOTAL_LENGTH / 2)).toBe(1)
    expect(edgeScale(2)).toBeGreaterThan(0)
    expect(edgeScale(2)).toBeLessThan(1)
    expect(carPoseAt(car(1, 0, 3), 0).scale).toBe(0)
  })

  it('combines both: a car is visible only away from corners and ends', () => {
    expect(visibilityScale(50)).toBe(1)
    expect(visibilityScale(34)).toBe(0)
    expect(visibilityScale(0)).toBe(0)
    expect(visibilityScale(PATH_TOTAL_LENGTH)).toBe(0)
    expect(visibilityScale(PATH_TOTAL_LENGTH - 0.5)).toBeLessThan(0.05)
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
    const fixture = car(1, 50, 3)
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
    for (const lane of [1, -1] as const) {
      const fixture = car(lane, 50, 3)
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

  it('hides a car on an interior waypoint and at both path ends, lights included', () => {
    for (const distance of [34, 60, 0]) {
      const traffic = createTraffic([car(1, distance, 3)])
      traffic.update(1, 0)
      expect(scaleOf(meshNamed(traffic, STREET_NAMES.carBodies), 0)).toBe(0)
      for (let k = 0; k < 4; k++) expect(scaleOf(meshNamed(traffic, STREET_NAMES.carLights), k)).toBe(0)
      traffic.dispose()
    }
  })

  it('moves the cars every update but rewrites colors only when the quantised ratio changes', () => {
    const traffic = createTraffic([car(1, 50, 3)])
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
    const traffic = createTraffic([car(1, 50, 3)])
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
