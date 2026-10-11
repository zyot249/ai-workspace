import { PATH_SEGMENTS, ROAD_HALF_WIDTH, SIDEWALK_INNER, SIDEWALK_OUTER, type Vec2, WAYPOINTS } from './path'

export const DASH_LENGTH = 1.2
export const DASH_WIDTH = 0.08
export const DASH_PERIOD = 3
// A dash center stays this far from an exterior segment end.
export const DASH_END_MARGIN = DASH_LENGTH / 2
// And this far from an interior waypoint: the 6 x 6 joint patch half width plus the dash half length.
export const DASH_JOINT_MARGIN = ROAD_HALF_WIDTH + DASH_LENGTH / 2

export interface Dash {
  x: number
  z: number
  dirX: number
  dirZ: number
}

// Dash centers for the whole path: 10, 7, and 12 on the three legs.
export function dashPositions(): Dash[] {
  const dashes: Dash[] = []
  const lastIndex = PATH_SEGMENTS.length - 1
  PATH_SEGMENTS.forEach((segment, index) => {
    const first = index === 0 ? DASH_END_MARGIN : DASH_JOINT_MARGIN
    const last = segment.length - (index === lastIndex ? DASH_END_MARGIN : DASH_JOINT_MARGIN)
    for (let along = first; along <= last + 1e-9; along += DASH_PERIOD) {
      dashes.push({
        x: segment.fromX + segment.dirX * along,
        z: segment.fromZ + segment.dirZ * along,
        dirX: segment.dirX,
        dirZ: segment.dirZ,
      })
    }
  })
  return dashes
}

// The path offset by `distance` on one side, with mitered corners: at each waypoint the offset point is
// pushed along the normalized sum of the adjacent legs' right vectors, scaled so it stays `distance` from both.
function offsetPath(side: -1 | 1, distance: number): Vec2[] {
  return WAYPOINTS.map((waypoint, index) => {
    const before = PATH_SEGMENTS[index - 1]
    const after = PATH_SEGMENTS[index]
    const first = before ?? after
    const second = after ?? before
    if (!first || !second) throw new Error('path has no segments')
    const sumX = first.rightX + second.rightX
    const sumZ = first.rightZ + second.rightZ
    const length = Math.hypot(sumX, sumZ)
    if (length < 1e-9) throw new Error('path doubles back on itself')
    const miterX = sumX / length
    const miterZ = sumZ / length
    const scale = 1 / (miterX * second.rightX + miterZ * second.rightZ)
    return { x: waypoint.x + side * miterX * scale * distance, z: waypoint.z + side * miterZ * scale * distance }
  })
}

// One sidewalk strip as a closed polygon: the inner offset points, then the outer offset points reversed.
export function sidewalkPolygon(side: -1 | 1, inner = SIDEWALK_INNER, outer = SIDEWALK_OUTER): Vec2[] {
  return [...offsetPath(side, inner), ...offsetPath(side, outer).reverse()]
}
