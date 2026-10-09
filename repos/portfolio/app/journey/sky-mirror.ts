import * as THREE from 'three'
import { clamp01, lerp } from './interpolate'
import type { LookState, Vec3 } from './stops'

// TypeScript mirror of the sky dome fragment shader (sky-shader.ts). Unit
// tests run against this file, so keep every step in the same order as the GLSL.

export type SkyVariant = 'full' | 'lite'
export type CloudOffset = readonly [number, number]

export const SKY_MAX_LUMINANCE = 0.92
export const HORIZON_FLAT = 0.01
export const CLOUD_SCALE = 0.6
export const CLOUD_SOFTNESS = 0.18
export const CLOUD_OPACITY = 0.95
export const CLOUD_WIND: CloudOffset = [0.01, 0.004]
export const CLOUD_TIME_WRAP = 3600
export const CLOUD_OCTAVE_SHIFT: CloudOffset = [17.3, 9.1]
export const CLOUD_OCTAVES: Readonly<Record<SkyVariant, number>> = { full: 4, lite: 2 }
export const COVER_STOPS: readonly number[] = [0, 0.25, 0.5, 0.75, 1]
// Noise value that each cover fraction of the spec 09 test-5 grid exceeds,
// minus half the softness, measured from cloudFbm at offset (0, 0); see
// sky-mirror.test.ts. Cover 0 and 1 are anchors outside the noise range.
export const COVER_THRESHOLDS: Readonly<Record<SkyVariant, readonly number[]>> = {
  full: [1, 0.4916, 0.3589, 0.2156, -0.2],
  lite: [1, 0.5175, 0.3393, 0.1659, -0.2],
}

const LUMA: Vec3 = [0.2126, 0.7152, 0.0722]
const MIN_LUMINANCE = 1e-4
const MIN_HORIZONTAL = 1e-4
const MIN_CLOUD_LIFT = 0.05

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const fract = (x: number): number => x - Math.floor(x)

export function normalize3(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2])
  return [v[0] / length, v[1] / length, v[2] / length]
}

export function luminance(c: Vec3): number {
  return dot3(c, LUMA)
}

export function toLinear(srgb: Vec3): Vec3 {
  const c = new THREE.Color().setRGB(srgb[0], srgb[1], srgb[2], THREE.SRGBColorSpace)
  return [c.r, c.g, c.b]
}

// Same formula as GLSL smoothstep.
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export function skyCurve(x: number): number {
  return smoothstep(0, 1, clamp01(x)) ** 1.2
}

// Azimuth 0 points toward -Z and positive angles turn toward -X.
export function sunDirectionFor(elevationDeg: number, azimuthDeg: number): Vec3 {
  const e = elevationDeg * Math.PI / 180
  const a = azimuthDeg * Math.PI / 180
  return [-Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]
}

export function sunVisibilityFor(sunY: number): number {
  return smoothstep(-0.3, 0, sunY)
}

// Hash without sine (Dave Hoskins), stable in 32-bit floats on the GPU.
export function cloudHash(x: number, y: number): number {
  let a = fract(x * 0.1031)
  let b = fract(y * 0.1031)
  let c = fract(x * 0.1031)
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33)
  a += d
  b += d
  c += d
  return fract((a + b) * c)
}

export function cloudNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  return lerp(
    lerp(cloudHash(ix, iy), cloudHash(ix + 1, iy), ux),
    lerp(cloudHash(ix, iy + 1), cloudHash(ix + 1, iy + 1), ux),
    uy,
  )
}

// Value-noise fbm normalized to 0..1.
export function cloudFbm(x: number, y: number, octaves: number): number {
  let sum = 0, amplitude = 0.5, norm = 0, px = x, py = y
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * cloudNoise(px, py)
    norm += amplitude
    px = px * 2 + CLOUD_OCTAVE_SHIFT[0]
    py = py * 2 + CLOUD_OCTAVE_SHIFT[1]
    amplitude *= 0.5
  }
  return sum / norm
}

// Projects a unit direction onto a cloud ceiling: dividing by height makes
// clouds shrink and bunch toward the horizon.
export function cloudUv(dir: Vec3, offset: CloudOffset): [number, number] {
  const lift = Math.max(dir[1], MIN_CLOUD_LIFT)
  return [dir[0] / lift * CLOUD_SCALE + offset[0], dir[2] / lift * CLOUD_SCALE + offset[1]]
}

export function coverThreshold(cover: number, variant: SkyVariant): number {
  const table = COVER_THRESHOLDS[variant]
  const c = clamp01(cover) * (COVER_STOPS.length - 1)
  const i = Math.min(COVER_STOPS.length - 2, Math.floor(c))
  return lerp(table[i]!, table[i + 1]!, c - i)
}

export function cloudDensity(noise: number, h: number, cover: number, variant: SkyVariant): number {
  const threshold = coverThreshold(cover, variant)
  return smoothstep(threshold, threshold + CLOUD_SOFTNESS, noise) * smoothstep(0.02, 0.15, h)
}

export interface SkyParams {
  horizon: Vec3
  mid: Vec3
  zenith: Vec3
  sunDir: Vec3
  sunColor: Vec3
  sunGlow: number
  cloudCover: number
  cloudLit: Vec3
  cloudShade: Vec3
  cloudOffset: CloudOffset
}

// Linear uniform values for a look. `fogColor` is the authored horizon colour.
export function skyParamsFor(look: LookState, cloudOffset: CloudOffset): SkyParams {
  return {
    horizon: toLinear(look.fogColor),
    mid: toLinear(look.skyColor),
    zenith: toLinear(look.skyZenith),
    sunDir: sunDirectionFor(look.sunElevation, look.sunAzimuth),
    sunColor: toLinear(look.sunColor),
    sunGlow: look.sunGlow,
    cloudCover: look.cloudCover,
    cloudLit: toLinear(look.cloudLitColor),
    cloudShade: toLinear(look.cloudShadeColor),
    cloudOffset,
  }
}

// Shader step 1. Exactly the horizon colour for h <= HORIZON_FLAT.
export function gradientAt(h: number, p: SkyParams): Vec3 {
  const hh = Math.max(h - HORIZON_FLAT, 0) / (1 - HORIZON_FLAT)
  const low = mix3(p.horizon, p.mid, skyCurve(hh / 0.4))
  return mix3(low, p.zenith, skyCurve((hh - 0.25) / 0.75))
}

function horizontalOf(v: Vec3): [number, number] {
  const length = Math.max(Math.hypot(v[0], v[2]), MIN_HORIZONTAL)
  return [v[0] / length, v[2] / length]
}

export interface SkyLayers {
  base: Vec3
  glow: Vec3
  cloud: Vec3
  density: number
}

// Shader steps 1 to 5 and the cloud terms of spec 09 section 6.
export function skyLayers(direction: Vec3, p: SkyParams, variant: SkyVariant): SkyLayers {
  const dir = normalize3(direction)
  const h = dir[1]
  const vis = sunVisibilityFor(p.sunDir[1])
  const env = smoothstep(0.01, 0.05, h)
  const s = Math.max(dot3(dir, p.sunDir), 0)
  const glow = (s ** 8 * 0.5 + s ** 64 * 0.8) * p.sunGlow * vis * env
  const [hx, hz] = horizontalOf(dir)
  const [sx, sz] = horizontalOf(p.sunDir)
  const bandX = (h - 0.07) / 0.07
  const band = 0.25 * p.sunGlow * vis * env * Math.exp(-bandX * bandX) * (0.5 + 0.5 * (hx * sx + hz * sz))
  const [u, v] = cloudUv(dir, p.cloudOffset)
  const noise = cloudFbm(u, v, CLOUD_OCTAVES[variant])
  let cloud = mix3(p.cloudLit, p.cloudShade, smoothstep(0.55, 1, noise))
  if (variant === 'full') {
    const shadowNoise = cloudFbm(u + p.sunDir[0] * 0.08, v + p.sunDir[2] * 0.08, 2)
    cloud = mix3(cloud, p.cloudShade, 0.5 * clamp01((shadowNoise - noise) * 4))
  }
  return {
    base: gradientAt(h, p),
    glow: scale3(p.sunColor, glow + band),
    cloud,
    density: cloudDensity(noise, h, p.cloudCover, variant),
  }
}

// Composite and bloom cap (spec 09 section 6 step 6, spec 05 step 7).
// `density` overrides the cloud density for tests.
export function composeSky(layers: SkyLayers, density = layers.density): Vec3 {
  const col = mix3(add3(layers.base, layers.glow), add3(layers.cloud, scale3(layers.glow, 0.4)), density * CLOUD_OPACITY)
  return scale3(col, Math.min(1, SKY_MAX_LUMINANCE / Math.max(luminance(col), MIN_LUMINANCE)))
}

export function skyGradient(direction: Vec3, p: SkyParams, variant: SkyVariant): Vec3 {
  return composeSky(skyLayers(direction, p, variant))
}
