import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createFalloffTexture, FALLOFF_TEXTURE_SIZE, radialFalloffPixels } from '../../app/journey/falloff-texture'

describe('radialFalloffPixels', () => {
  const size = FALLOFF_TEXTURE_SIZE
  const pixels = radialFalloffPixels(size)
  const at = (x: number, y: number) => Array.from(pixels.subarray(4 * (y * size + x), 4 * (y * size + x) + 4))

  it('is opaque grayscale: R = G = B, A = 255', () => {
    expect(pixels).toHaveLength(size * size * 4)
    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(pixels[i + 1])
      expect(pixels[i]).toBe(pixels[i + 2])
      expect(pixels[i + 3]).toBe(255)
    }
  })

  it('is white at the center and black at the corner', () => {
    expect(at(size / 2, size / 2)).toEqual([255, 255, 255, 255])
    expect(at(0, 0)).toEqual([0, 0, 0, 255])
    expect(at(size - 1, size - 1)).toEqual([0, 0, 0, 255])
  })

  it('falls monotonically from the center to the edge and is intermediate halfway', () => {
    let previous = 256
    for (let x = size / 2; x < size; x++) {
      const green = at(x, size / 2)[1]!
      expect(green).toBeLessThanOrEqual(previous)
      previous = green
    }
    const half = at(size / 2 + size / 4, size / 2)[1]!
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(255)
  })
})

describe('createFalloffTexture', () => {
  it('builds a linear, mipmap-free, non-color-managed RGBA texture of the requested size', () => {
    const texture = createFalloffTexture(32)
    expect(texture.colorSpace).toBe(THREE.NoColorSpace)
    expect(texture.minFilter).toBe(THREE.LinearFilter)
    expect(texture.magFilter).toBe(THREE.LinearFilter)
    expect(texture.generateMipmaps).toBe(false)
    expect(texture.image.width).toBe(32)
    expect(texture.image.height).toBe(32)
    texture.dispose()
  })

  it('defaults to FALLOFF_TEXTURE_SIZE', () => {
    const texture = createFalloffTexture()
    expect(texture.image.width).toBe(FALLOFF_TEXTURE_SIZE)
    texture.dispose()
  })
})
