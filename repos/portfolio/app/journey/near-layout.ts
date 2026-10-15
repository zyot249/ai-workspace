// app/journey/near-layout.ts
import { NEAR_VARIANT_SEED, NEAR_Y_MAX, NEAR_Y_MIN } from './building-specs'
import { closestPathPoint } from './path'
import { seeded } from './random'
import type { Vec3 } from './stops'

const QUARTER_TURN = Math.PI / 2

export function nearVariantFor(index: number, variantCount: number): number {
  return Math.min(variantCount - 1, Math.floor(seeded(NEAR_VARIANT_SEED + index) * variantCount))
}

// The yaw about Y that turns a model facing -Z so its front faces the closest road point, snapped to a quarter
// turn so the footprint stays axis aligned. A model turned by `yaw` faces (-sin yaw, -cos yaw).
export function nearYaw(x: number, z: number): number {
  const road = closestPathPoint(x, z)
  const yaw = Math.atan2(-(road.x - x), -(road.z - z))
  return Math.round(yaw / QUARTER_TURN) * QUARTER_TURN
}

// Uniform scale that fits the model inside the placed width x depth rectangle after turning by `yaw`.
export function nearFootprintScale(size: Vec3, yaw: number, width: number, depth: number): number {
  const turned = Math.abs(Math.sin(yaw)) > 0.5
  const footX = turned ? size[2] : size[0]
  const footZ = turned ? size[0] : size[2]
  return Math.min(width / footX, depth / footZ)
}

export function nearYScale(heightScale: number): number {
  return Math.min(Math.max(heightScale, NEAR_Y_MIN), NEAR_Y_MAX)
}
