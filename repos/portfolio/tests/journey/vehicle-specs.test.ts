import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  VEHICLE_HALF_WIDTH, VEHICLE_HEIGHT, VEHICLE_SCALE, VEHICLE_SPECS, VEHICLE_TYPES, vehicleBounds, vehicleLightOffsets,
} from '../../app/journey/vehicle-specs'

const MODEL_DIR = new URL('../../public/models/vehicles/', import.meta.url)
const MAX_MODEL_BYTES = 250_000
const LIGHT_DEPTH = 0.03

describe('vehicle files', () => {
  it('ships one non-empty GLB per type under 250 KB, and the CC0 licence note', () => {
    for (const type of VEHICLE_TYPES) {
      const size = fs.statSync(new URL(VEHICLE_SPECS[type].file, MODEL_DIR)).size
      expect(size, type).toBeGreaterThan(0)
      expect(size, type).toBeLessThan(MAX_MODEL_BYTES)
    }
    expect(fs.readFileSync(new URL('LICENSE.txt', MODEL_DIR), 'utf8')).toContain('Creative Commons Zero')
  })
})

describe('vehicleBounds', () => {
  it('is front at -Z, wheels on the ground and scaled from the model units', () => {
    for (const type of VEHICLE_TYPES) {
      const spec = VEHICLE_SPECS[type]
      const bounds = vehicleBounds(type)
      expect(bounds.minZ).toBeCloseTo(-spec.frontZ * VEHICLE_SCALE, 9)
      expect(bounds.maxZ).toBeCloseTo(-spec.rearZ * VEHICLE_SCALE, 9)
      expect(bounds.minY).toBe(0)
      expect(bounds.maxY).toBeCloseTo(VEHICLE_HEIGHT * VEHICLE_SCALE, 9)
      expect(bounds.maxX).toBeCloseTo(VEHICLE_HALF_WIDTH * VEHICLE_SCALE, 9)
      expect(bounds.minX).toBeCloseTo(-bounds.maxX, 9)
    }
  })

  it('makes the truck the longest vehicle and keeps all lengths near 1 unit', () => {
    const length = (type: (typeof VEHICLE_TYPES)[number]) => vehicleBounds(type).maxZ - vehicleBounds(type).minZ
    expect(length('truck')).toBeGreaterThan(length('sedan'))
    expect(length('truck')).toBeGreaterThan(length('suv'))
    for (const type of VEHICLE_TYPES) {
      expect(length(type)).toBeGreaterThan(0.8)
      expect(length(type)).toBeLessThan(1.2)
    }
  })
})

describe('vehicleLightOffsets', () => {
  it('lists two front lights then two rear lights, matching the dusk ramp order', () => {
    for (const type of VEHICLE_TYPES) {
      expect(vehicleLightOffsets(type).map(light => light.kind)).toEqual(['front', 'front', 'rear', 'rear'])
    }
  })

  it('puts front lights at the -Z end, rear lights at the +Z end, and every light inside the body bounds', () => {
    for (const type of VEHICLE_TYPES) {
      const bounds = vehicleBounds(type)
      for (const light of vehicleLightOffsets(type)) {
        expect(light.kind === 'front' ? light.z < 0 : light.z > 0, `${type} ${light.kind}`).toBe(true)
        expect(light.x).toBeGreaterThanOrEqual(bounds.minX)
        expect(light.x).toBeLessThanOrEqual(bounds.maxX)
        expect(light.y).toBeGreaterThan(bounds.minY)
        expect(light.y).toBeLessThan(bounds.maxY)
        expect(light.z).toBeGreaterThanOrEqual(bounds.minZ - LIGHT_DEPTH / 2)
        expect(light.z).toBeLessThanOrEqual(bounds.maxZ + LIGHT_DEPTH / 2)
      }
    }
  })

  it('mirrors the lights left and right', () => {
    for (const type of VEHICLE_TYPES) {
      const [frontLeft, frontRight, rearLeft, rearRight] = vehicleLightOffsets(type)
      expect(frontLeft!.x).toBeCloseTo(-frontRight!.x, 9)
      expect(rearLeft!.x).toBeCloseTo(-rearRight!.x, 9)
    }
  })
})
