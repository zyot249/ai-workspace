export interface Vec2 {
  x: number
  z: number
}

export interface PathPoint {
  x: number
  z: number
  dirX: number
  dirZ: number
  rightX: number
  rightZ: number
}

export interface PathSegment {
  fromX: number
  fromZ: number
  dirX: number
  dirZ: number
  rightX: number
  rightZ: number
  length: number
  cumStart: number
}

// Places the journey passes, in order: entrance gate, exhibition hall, market
// square, home courtyard. Each sits mid-leg, not on a turn, so its own
// geometry (and the road beside it) has room clear of the corner.
export const PLACES = {
  entrance: { x: 0, z: 2 },
  hall: { x: 0, z: -12 },
  market: { x: -13, z: -26 },
  courtyard: { x: -26, z: -46 },
} as const

// The path is a polyline, not a straight line: it turns 90 degrees twice,
// between places rather than at them.
export const WAYPOINTS: readonly Vec2[] = [
  { x: 0, z: 8 },
  { x: 0, z: -26 },
  { x: -26, z: -26 },
  { x: -26, z: -66 },
]

export const PATH_SEGMENTS: readonly PathSegment[] = (() => {
  const segments: PathSegment[] = []
  let cumStart = 0
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const from = WAYPOINTS[i]
    const to = WAYPOINTS[i + 1]
    if (!from || !to) continue
    const dx = to.x - from.x
    const dz = to.z - from.z
    const length = Math.hypot(dx, dz)
    const dirX = dx / length
    const dirZ = dz / length
    segments.push({ fromX: from.x, fromZ: from.z, dirX, dirZ, rightX: -dirZ, rightZ: dirX, length, cumStart })
    cumStart += length
  }
  return segments
})()

export const PATH_TOTAL_LENGTH = PATH_SEGMENTS.reduce((sum, s) => sum + s.length, 0)

// Walks the polyline to the point at `distance` from the start, with the
// heading and perpendicular ("right") direction of the segment it falls on.
export function pathPointAt(distance: number): PathPoint {
  const clamped = Math.min(Math.max(distance, 0), PATH_TOTAL_LENGTH)
  let segment = PATH_SEGMENTS[0]
  for (const s of PATH_SEGMENTS) {
    if (clamped >= s.cumStart) segment = s
  }
  if (!segment) throw new Error('PATH_SEGMENTS is empty')
  const into = clamped - segment.cumStart
  return {
    x: segment.fromX + segment.dirX * into,
    z: segment.fromZ + segment.dirZ * into,
    dirX: segment.dirX,
    dirZ: segment.dirZ,
    rightX: segment.rightX,
    rightZ: segment.rightZ,
  }
}

// The rotation.y that turns an object authored facing world -Z to face
// (dirX, dirZ) instead.
export function headingFor(dirX: number, dirZ: number): number {
  return Math.atan2(-dirX, -dirZ)
}

// Shortest distance from (x, z) to the finite segment at `segment` (clamped
// to its endpoints, not the infinite line through it).
function distanceToSegment(x: number, z: number, segment: PathSegment): number {
  const dx = x - segment.fromX
  const dz = z - segment.fromZ
  const along = Math.min(Math.max(dx * segment.dirX + dz * segment.dirZ, 0), segment.length)
  const px = segment.fromX + segment.dirX * along
  const pz = segment.fromZ + segment.dirZ * along
  return Math.hypot(x - px, z - pz)
}

// True if (x, z) is at least `minClearance` from every leg of the path,
// including the two corners. Used to keep background scenery off the road.
export function clearsPath(x: number, z: number, minClearance: number): boolean {
  return PATH_SEGMENTS.every(segment => distanceToSegment(x, z, segment) >= minClearance)
}
