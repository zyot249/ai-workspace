import * as THREE from 'three'
import { glslFloat } from './shader-utils'
import { smoothstep } from './sky-mirror'

export const ASPHALT_SIZE = 256
export const ASPHALT_SEED = 7
// World units covered by one texture tile (road UVs are world position / this).
export const ASPHALT_TILE_UNITS = 4

const COARSE_CELLS = 8
const MEDIUM_CELLS = 32
const COARSE_WEIGHT = 0.3
const MEDIUM_WEIGHT = 0.2
const SPECKLE_WEIGHT = 0.35
// r186 skips anisotropy when magFilter is NearestFilter (the DataTexture default), so the filters below are explicit.
const MAX_ASPHALT_ANISOTROPY = 4

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

// Value noise on a lattice that wraps after `cells` cells, so the image tiles. (u, v) are tile fractions in [0, 1).
function periodicNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells, y = v * cells
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = smooth(x - ix), fy = smooth(y - iy)
  const at = (i: number, j: number) => hash2(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed)
  const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx
  const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx
  return top * (1 - fy) + bottom * fy
}

// Tileable grayscale asphalt: two octaves of periodic value noise plus per-pixel speckle.
export function asphaltPixels(size: number, seed: number): Uint8Array {
  const pixels = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size
      const value = 0.5
        + COARSE_WEIGHT * (periodicNoise(u, v, COARSE_CELLS, seed) - 0.5)
        + MEDIUM_WEIGHT * (periodicNoise(u, v, MEDIUM_CELLS, seed + 1) - 0.5)
        + SPECKLE_WEIGHT * (hash2(x, y, seed + 2) - 0.5)
      pixels[y * size + x] = Math.round(255 * Math.min(1, Math.max(0, value)))
    }
  }
  return pixels
}

// The grayscale goes in all four channels' RGB so any channel can drive roughness (r186 reads green) or bump.
export function createAsphaltTexture(maxAnisotropy: number): THREE.DataTexture {
  const gray = asphaltPixels(ASPHALT_SIZE, ASPHALT_SEED)
  const rgba = new Uint8Array(ASPHALT_SIZE * ASPHALT_SIZE * 4)
  gray.forEach((value, i) => {
    rgba[i * 4] = value
    rgba[i * 4 + 1] = value
    rgba[i * 4 + 2] = value
    rgba[i * 4 + 3] = 255
  })
  const texture = new THREE.DataTexture(rgba, ASPHALT_SIZE, ASPHALT_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.NoColorSpace
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.anisotropy = Math.min(MAX_ASPHALT_ANISOTROPY, maxAnisotropy)
  texture.needsUpdate = true
  return texture
}

// World offset added before the noise lookup. Chosen so 32% of the road bounding box is above 0.5 (spec: 15% to 45%).
export const PUDDLE_ORIGIN: readonly [number, number] = [31, 17]
const PUDDLE_LARGE_SCALE = 24
const PUDDLE_SMALL_SCALE = 6
const PUDDLE_LARGE_WEIGHT = 0.75
const PUDDLE_SMALL_WEIGHT = 0.25
const PUDDLE_EDGE_LOW = 0.45
const PUDDLE_EDGE_HIGH = 0.65

function fract(value: number): number {
  return value - Math.floor(value)
}

// Dave Hoskins hash, float64 mirror of puddleHash in PUDDLE_GLSL.
function puddleHash(px: number, py: number): number {
  let a = fract(px * 0.1031), b = fract(py * 0.1031), c = fract(px * 0.1031)
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33)
  a += d
  b += d
  c += d
  return fract((a + b) * c)
}

function puddleNoise(px: number, py: number): number {
  const ix = Math.floor(px), iy = Math.floor(py)
  const ux = smooth(px - ix), uy = smooth(py - iy)
  const mix = (p: number, q: number, t: number) => p * (1 - t) + q * t
  return mix(
    mix(puddleHash(ix, iy), puddleHash(ix + 1, iy), ux),
    mix(puddleHash(ix, iy + 1), puddleHash(ix + 1, iy + 1), ux),
    uy,
  )
}

// Float64 mirror of puddleMask in PUDDLE_GLSL; the test oracle (tolerance 0.02 against the shader).
export function puddleMaskAt(x: number, z: number): number {
  const px = x + PUDDLE_ORIGIN[0], pz = z + PUDDLE_ORIGIN[1]
  const n = puddleNoise(px / PUDDLE_LARGE_SCALE, pz / PUDDLE_LARGE_SCALE) * PUDDLE_LARGE_WEIGHT
    + puddleNoise(px / PUDDLE_SMALL_SCALE, pz / PUDDLE_SMALL_SCALE) * PUDDLE_SMALL_WEIGHT
  return smoothstep(PUDDLE_EDGE_LOW, PUDDLE_EDGE_HIGH, n)
}

// Shared by the road material and the reflection overlay, so both agree on where the puddles are.
export const PUDDLE_GLSL = `
float puddleHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float puddleNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(puddleHash(i), puddleHash(i + vec2(1.0, 0.0)), u.x),
             mix(puddleHash(i + vec2(0.0, 1.0)), puddleHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float puddleMask(vec2 worldXZ) {
  vec2 p = worldXZ + vec2(${glslFloat(PUDDLE_ORIGIN[0])}, ${glslFloat(PUDDLE_ORIGIN[1])});
  float n = puddleNoise(p / 24.0) * 0.75 + puddleNoise(p / 6.0) * 0.25;
  return smoothstep(0.45, 0.65, n);
}
`
