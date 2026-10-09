import { smoothstep } from './sky-mirror'
import type { LookState } from './stops'

// World Y of the ground the walls stand on (shared conventions, section 6). Equals BASE_Y in buildings.ts;
// a test pins the two together so this file does not import buildings.ts.
export const GRADIENT_GROUND_Y = -1
export const AO_MIN = 0.55
export const AO_HEIGHT = 0.9
export const RIM_DEPTH = 0.25
export const BOUNCE_HEIGHT = 0.6

const RIM_STRENGTH = 0.35
const AO_NIGHT_RELIEF = 0.25
const BOUNCE_STRENGTH = 0.06

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

// CPU mirror of the base-occlusion factor in the fragment shader.
export function aoFactor(height: number): number {
  return AO_MIN + (1 - AO_MIN) * smoothstep(0, AO_HEIGHT, height)
}

// The exact multiplier applied to the wall color: mix(1.0, ao, strength).
export function aoEffective(height: number, strength: number): number {
  return 1 + (aoFactor(height) - 1) * strength
}

export function rimAmount(worldY: number, topY: number, normalDotSun: number): number {
  return smoothstep(topY - RIM_DEPTH, topY, worldY) * Math.max(normalDotSun, 0)
}

export function bounceAmount(height: number): number {
  return 1 - smoothstep(0, BOUNCE_HEIGHT, height)
}

export interface FacadeGradientLook {
  uAoStrength: number
  uRimStrength: number
  uBounce: number
}

// `sunVisibility` is `sky.sunVisibility`: a smoothstep on the unclamped sun elevation.
export function facadeLookFor(look: Pick<LookState, 'windowLitRatio'>, sunVisibility: number): FacadeGradientLook {
  const lit = clamp01(look.windowLitRatio)
  return {
    uAoStrength: 1 - AO_NIGHT_RELIEF * lit,
    uRimStrength: RIM_STRENGTH * clamp01(sunVisibility),
    uBounce: BOUNCE_STRENGTH * lit,
  }
}
