import * as THREE from 'three'
import { neutralToneMap } from '../../app/journey/post'
import type { Vec3 } from '../../app/journey/stops'

// Displayed 8-bit sRGB for a linear scene colour, as both pipelines show it:
// Neutral tone mapping at `exposure`, then sRGB encoding.
export function displayBytes(linear: Vec3, exposure: number): number[] {
  const mapped = neutralToneMap(linear, exposure)
  const encoded = new THREE.Color().setRGB(mapped[0], mapped[1], mapped[2])
    .getRGB(new THREE.Color(), THREE.SRGBColorSpace)
  return [encoded.r, encoded.g, encoded.b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255))
}

export function maxChannelDelta(a: readonly number[], b: readonly number[]): number {
  return Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!), Math.abs(a[2]! - b[2]!))
}

export function byteLuminance(p: readonly number[]): number {
  return 0.2126 * p[0]! + 0.7152 * p[1]! + 0.0722 * p[2]!
}

export function colorDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
}
