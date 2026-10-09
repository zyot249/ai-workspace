import * as THREE from 'three'
import type { Vec3 } from './stops'

export const TONE_MAPPING = THREE.NeutralToneMapping

export const POST_EMISSIVES = {
  lamp: { hex: 0xffdca8, gain: 2.8 },
  courtyard: { hex: 0xffe1a8, gain: 2.7 },
} as const

const BLOOM_MIN_STRENGTH = 0.01
const NEUTRAL_COMPRESSION_START = 0.8 - 0.04
const NEUTRAL_DESATURATION = 0.15

export function bloomEnabled(strength: number): boolean {
  return strength >= BLOOM_MIN_STRENGTH
}

// CPU mirror of three's NeutralToneMapping (see tonemapping_pars_fragment).
export function neutralToneMap(rgbLinear: Vec3, exposure: number): [number, number, number] {
  let c = rgbLinear.map(v => v * exposure) as [number, number, number]
  const x = Math.min(...c)
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04
  c = c.map(v => v - offset) as [number, number, number]
  const peak = Math.max(...c)
  if (peak < NEUTRAL_COMPRESSION_START) return c
  const d = 1 - NEUTRAL_COMPRESSION_START
  const newPeak = 1 - d * d / (peak + d - NEUTRAL_COMPRESSION_START)
  const g = 1 - 1 / (NEUTRAL_DESATURATION * (peak - newPeak) + 1)
  return c.map(v => (v * newPeak / peak) * (1 - g) + newPeak * g) as [number, number, number]
}

// Authored sRGB -> linear -> tone map -> sRGB, for sky and fog on the direct pipeline.
export function skyForDirectPipeline(authoredSrgb: Vec3, exposure: number): [number, number, number] {
  const linear = new THREE.Color().setRGB(...authoredSrgb, THREE.SRGBColorSpace)
  const mapped = neutralToneMap([linear.r, linear.g, linear.b], exposure)
  const color = new THREE.Color().setRGB(...mapped)
  const output = color.getRGB(new THREE.Color(), THREE.SRGBColorSpace)
  return [output.r, output.g, output.b]
}
