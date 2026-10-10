import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  ASPHALT_SEED, ASPHALT_SIZE, asphaltPixels, createAsphaltTexture, PUDDLE_GLSL, PUDDLE_ORIGIN, puddleMaskAt,
} from '../../app/journey/asphalt'
import { seeded } from '../../app/journey/random'

describe('asphaltPixels', () => {
  const pixels = asphaltPixels(ASPHALT_SIZE, ASPHALT_SEED)
  const values = Array.from(pixels, v => v / 255)
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const deviation = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length)

  it('is deterministic and depends on the seed', () => {
    expect(asphaltPixels(ASPHALT_SIZE, ASPHALT_SEED)).toEqual(pixels)
    expect(asphaltPixels(ASPHALT_SIZE, ASPHALT_SEED + 1)).not.toEqual(pixels)
    expect(pixels).toHaveLength(ASPHALT_SIZE * ASPHALT_SIZE)
  })

  it('has a mean near 0.5 and visible grain', () => {
    expect(mean).toBeGreaterThan(0.35)
    expect(mean).toBeLessThan(0.65)
    expect(deviation).toBeGreaterThan(0.05)
  })

  it('tiles: the wrap seam is no rougher than the interior', () => {
    // Per-pixel speckle makes neighbors differ, so the 2/255 bound of the spec cannot hold. A visible seam would
    // show as a seam difference well above the average neighbor difference inside the tile.
    const at = (x: number, y: number) => pixels[y * ASPHALT_SIZE + x]!
    let seamX = 0, interiorX = 0, seamY = 0, interiorY = 0
    for (let a = 0; a < ASPHALT_SIZE; a++) {
      seamX += Math.abs(at(0, a) - at(ASPHALT_SIZE - 1, a))
      seamY += Math.abs(at(a, 0) - at(a, ASPHALT_SIZE - 1))
      for (let b = 0; b < ASPHALT_SIZE - 1; b++) {
        interiorX += Math.abs(at(b, a) - at(b + 1, a))
        interiorY += Math.abs(at(a, b) - at(a, b + 1))
      }
    }
    expect(seamX / ASPHALT_SIZE).toBeLessThanOrEqual(1.2 * interiorX / (ASPHALT_SIZE * (ASPHALT_SIZE - 1)))
    expect(seamY / ASPHALT_SIZE).toBeLessThanOrEqual(1.2 * interiorY / (ASPHALT_SIZE * (ASPHALT_SIZE - 1)))
  })
})

describe('createAsphaltTexture', () => {
  it('sets the filtering r186 needs for anisotropy to apply', () => {
    const texture = createAsphaltTexture(16)
    expect(texture.wrapS).toBe(THREE.RepeatWrapping)
    expect(texture.wrapT).toBe(THREE.RepeatWrapping)
    expect(texture.colorSpace).toBe(THREE.NoColorSpace)
    expect(texture.generateMipmaps).toBe(true)
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter)
    expect(texture.magFilter).toBe(THREE.LinearFilter)
    expect(texture.anisotropy).toBe(4)
    expect(texture.repeat.toArray()).toEqual([1, 1])
    expect(createAsphaltTexture(2).anisotropy).toBe(2)
  })

  it('stores the grayscale in all three color channels', () => {
    const texture = createAsphaltTexture(1)
    const data = texture.image.data as Uint8Array
    const gray = asphaltPixels(ASPHALT_SIZE, ASPHALT_SEED)
    expect(data).toHaveLength(ASPHALT_SIZE * ASPHALT_SIZE * 4)
    for (const i of [0, 1, 777, 65535]) {
      expect([data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]]).toEqual([gray[i], gray[i], gray[i], 255])
    }
  })
})

describe('puddleMaskAt', () => {
  it('stays in [0, 1] and is deterministic', () => {
    for (let i = 0; i < 500; i++) {
      const x = -40 + 60 * seeded(i), z = -80 + 100 * seeded(i + 1000)
      const value = puddleMaskAt(x, z)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
      expect(puddleMaskAt(x, z)).toBe(value)
    }
  })

  it('is continuous: points 0.01 apart differ by less than 0.05', () => {
    for (let i = 0; i < 2000; i++) {
      const x = -40 + 60 * seeded(i), z = -80 + 100 * seeded(i + 5000)
      expect(Math.abs(puddleMaskAt(x, z) - puddleMaskAt(x + 0.01, z))).toBeLessThan(0.05)
      expect(Math.abs(puddleMaskAt(x, z) - puddleMaskAt(x, z + 0.01))).toBeLessThan(0.05)
    }
  })

  it('puts between 15% and 45% of the road bounding box above 0.5', () => {
    let above = 0, total = 0
    for (let x = -30; x <= 4; x += 0.5) for (let z = -70; z <= 12; z += 0.5) {
      total++
      if (puddleMaskAt(x, z) > 0.5) above++
    }
    expect(above / total).toBeGreaterThanOrEqual(0.15)
    expect(above / total).toBeLessThanOrEqual(0.45)
  })
})

describe('PUDDLE_GLSL', () => {
  it('mirrors the TypeScript mask: same octaves, thresholds, and origin', () => {
    for (const token of ['float puddleHash(vec2 p)', 'float puddleNoise(vec2 p)', 'float puddleMask(vec2 worldXZ)',
      'p / 24.0', 'p / 6.0', '0.75', '0.25', 'smoothstep(0.45, 0.65', '0.1031', '33.33']) expect(PUDDLE_GLSL).toContain(token)
    expect(PUDDLE_GLSL).toContain(`vec2(${PUDDLE_ORIGIN[0]}.0, ${PUDDLE_ORIGIN[1]}.0)`)
  })
})
