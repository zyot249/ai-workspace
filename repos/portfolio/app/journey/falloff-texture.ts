import * as THREE from 'three'
import { smoothstep } from './sky-mirror'

export const FALLOFF_TEXTURE_SIZE = 64

// Opaque grayscale: r186 alphamap_fragment reads the GREEN channel only, and a `map` multiplies
// the material color by RGB, so one texture serves contact shadows (alphaMap) and glow (map).
export function radialFalloffPixels(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1
      const dy = ((y + 0.5) / size) * 2 - 1
      const value = Math.round(255 * (1 - smoothstep(0, 1, Math.hypot(dx, dy))))
      const offset = 4 * (y * size + x)
      pixels[offset] = value
      pixels[offset + 1] = value
      pixels[offset + 2] = value
      pixels[offset + 3] = 255
    }
  }
  return pixels
}

export function createFalloffTexture(size = FALLOFF_TEXTURE_SIZE): THREE.DataTexture {
  const texture = new THREE.DataTexture(radialFalloffPixels(size), size, size, THREE.RGBAFormat)
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}
