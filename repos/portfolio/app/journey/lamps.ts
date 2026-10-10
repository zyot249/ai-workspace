import { clearsCornerBlocks, clearsFootprints } from './footprints'
import { clearsPath, PATH_TOTAL_LENGTH, pathPointAt, ROAD_HALF_WIDTH } from './path'
import { seeded } from './random'
import { smoothstep } from './sky-mirror'
import { gainFor } from './window-look'

export const LAMP_SPACING_FULL = 6
export const LAMP_SPACING_LOW_POWER = 8
// Distance from the road center line to a lamp post.
export const LAMP_OFFSET = ROAD_HALF_WIDTH + 0.3
export const LAMP_BASE_Y = -1
export const POST_HEIGHT = 2.4
export const ARM_LENGTH = 0.5
export const LAMP_HEAD_Y = LAMP_BASE_Y + POST_HEIGHT
// Switch-on thresholds fall in [LAMP_ON_MIN, LAMP_ON_MIN + LAMP_ON_SPREAD); a lamp fades in over LAMP_FADE.
export const LAMP_ON_MIN = 0.15
export const LAMP_ON_SPREAD = 0.2
export const LAMP_FADE = 0.05
// Linear luminance every bloom-capable street light reaches (spec 02's brightness contract).
export const STREET_LIGHT_LUMINANCE = 2.3
export const LAMP_LIGHT_HEX = 0xffc983
export const DARK_GLASS_HEX = 0x2a2a30
export const LAMP_LIGHT_GAIN = gainFor(LAMP_LIGHT_HEX, STREET_LIGHT_LUMINANCE)

const FOOTPRINT_PAD = 0.2
const PATH_CLEARANCE = ROAD_HALF_WIDTH + 0.2
const THRESHOLD_SEED = 9100
const STATION_EPSILON = 1e-9

export interface Lamp {
  // Path distance of the station the lamp belongs to.
  distance: number
  x: number
  z: number
  side: 1 | -1
  armAngle: number
}

// The arm points along local +X; a rotation by `theta` about Y maps +X to (cos theta, 0, -sin theta).
// It must point at the road center, which is -side * (rightX, rightZ) from the post.
export function armAngleFor(side: 1 | -1, rightX: number, rightZ: number): number {
  return Math.atan2(side * rightZ, -side * rightX)
}

// One lamp per side at every station, minus positions inside a set-piece footprint, a corner
// block, or within PATH_CLEARANCE of ANY road leg (a lamp near a corner can sit on the next leg).
export function lampPositions(spacing: number): Lamp[] {
  if (!(spacing > 0)) throw new RangeError(`lamp spacing must be positive, got ${spacing}`)
  const lamps: Lamp[] = []
  const first = spacing / 2
  const last = PATH_TOTAL_LENGTH - spacing / 2
  for (let i = 0; first + i * spacing <= last + STATION_EPSILON; i++) {
    const distance = first + i * spacing
    const point = pathPointAt(distance)
    for (const side of [1, -1] as const) {
      const x = point.x + point.rightX * LAMP_OFFSET * side
      const z = point.z + point.rightZ * LAMP_OFFSET * side
      if (!clearsFootprints(x, z, FOOTPRINT_PAD)) continue
      if (!clearsCornerBlocks(x, z, FOOTPRINT_PAD)) continue
      if (!clearsPath(x, z, PATH_CLEARANCE)) continue
      lamps.push({ distance, x, z, side, armAngle: armAngleFor(side, point.rightX, point.rightZ) })
    }
  }
  return lamps
}

// World position of the lamp head: the far end of the arm, at the top of the post.
export function lampHeadPosition(lamp: Pick<Lamp, 'x' | 'z' | 'armAngle'>): { x: number; y: number; z: number } {
  return {
    x: lamp.x + ARM_LENGTH * Math.cos(lamp.armAngle),
    y: LAMP_HEAD_Y,
    z: lamp.z - ARM_LENGTH * Math.sin(lamp.armAngle),
  }
}

export function lampThreshold(index: number): number {
  return LAMP_ON_MIN + LAMP_ON_SPREAD * seeded(THRESHOLD_SEED + index)
}

// smoothstep(threshold, threshold + LAMP_FADE, windowLitRatio): 0 at or below the threshold, 1 above it plus the fade.
export function lampIntensity(threshold: number, windowLitRatio: number): number {
  return smoothstep(threshold, threshold + LAMP_FADE, windowLitRatio)
}
