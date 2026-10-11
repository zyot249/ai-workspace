import { PATH_SEGMENTS, ROAD_HALF_WIDTH } from './path'

// Turn radius of the road center line at an interior waypoint. A lane `offset` to the right of the path
// turns on a concentric arc of radius CORNER_RADIUS - offset on a right turn and CORNER_RADIUS + offset on
// a left turn. The arc stays inside the square joint patch of the road.
export const CORNER_RADIUS = ROAD_HALF_WIDTH

// A point on a lane and its unit travel direction, in world x and z.
export interface LaneSample {
  x: number
  z: number
  dirX: number
  dirZ: number
}

export interface Lane {
  // Arc length from the start of the path to the route end.
  readonly length: number
  // Writes the point `w` along the lane, clamped to [0, length], and returns `out`.
  sample(w: number, out?: LaneSample): LaneSample
}

interface StraightPiece {
  kind: 'straight'
  start: number
  x: number
  z: number
  dirX: number
  dirZ: number
}

// Quarter circle around (centerX, centerZ). The radial vector turns from -d2 to d1, so the heading
// turns from d1 to d2.
interface ArcPiece {
  kind: 'arc'
  start: number
  centerX: number
  centerZ: number
  radius: number
  d1X: number
  d1Z: number
  d2X: number
  d2Z: number
}

type Piece = StraightPiece | ArcPiece

const NEW_SAMPLE = (): LaneSample => ({ x: 0, z: 0, dirX: 0, dirZ: 0 })

// The path offset by `offset` to the right of travel, with each interior corner rounded to a quarter
// circle, from the path start to `routeEnd` (a distance along the path on the last leg).
export function createLane(offset: number, routeEnd: number): Lane {
  const lastIndex = PATH_SEGMENTS.length - 1
  const last = PATH_SEGMENTS[lastIndex]
  if (!last || routeEnd < last.cumStart + CORNER_RADIUS) throw new Error('route end must be on the last leg, past its corner arc')

  const pieces: Piece[] = []
  let cursor = 0
  PATH_SEGMENTS.forEach((segment, index) => {
    const next = PATH_SEGMENTS[index + 1]
    const from = index === 0 ? 0 : CORNER_RADIUS
    const to = next ? segment.length - CORNER_RADIUS : routeEnd - segment.cumStart
    pieces.push({
      kind: 'straight',
      start: cursor,
      x: segment.fromX + segment.dirX * from + segment.rightX * offset,
      z: segment.fromZ + segment.dirZ * from + segment.rightZ * offset,
      dirX: segment.dirX,
      dirZ: segment.dirZ,
    })
    cursor += to - from
    if (!next) return
    const waypointX = next.fromX
    const waypointZ = next.fromZ
    const turn = next.dirX * segment.rightX + next.dirZ * segment.rightZ
    const radius = CORNER_RADIUS - offset * turn
    pieces.push({
      kind: 'arc',
      start: cursor,
      centerX: waypointX + (next.dirX - segment.dirX) * CORNER_RADIUS,
      centerZ: waypointZ + (next.dirZ - segment.dirZ) * CORNER_RADIUS,
      radius,
      d1X: segment.dirX,
      d1Z: segment.dirZ,
      d2X: next.dirX,
      d2Z: next.dirZ,
    })
    cursor += (Math.PI / 2) * radius
  })

  return {
    length: cursor,
    sample(w, out = NEW_SAMPLE()) {
      const clamped = Math.min(Math.max(w, 0), cursor)
      let index = 0
      pieces.forEach((piece, i) => {
        if (clamped >= piece.start) index = i
      })
      const piece = pieces[index]
      if (!piece) throw new Error('lane has no pieces')
      const into = clamped - piece.start
      if (piece.kind === 'straight') {
        out.x = piece.x + piece.dirX * into
        out.z = piece.z + piece.dirZ * into
        out.dirX = piece.dirX
        out.dirZ = piece.dirZ
        return out
      }
      const phi = into / piece.radius
      const cos = Math.cos(phi)
      const sin = Math.sin(phi)
      out.x = piece.centerX + piece.radius * (-piece.d2X * cos + piece.d1X * sin)
      out.z = piece.centerZ + piece.radius * (-piece.d2Z * cos + piece.d1Z * sin)
      out.dirX = piece.d1X * cos + piece.d2X * sin
      out.dirZ = piece.d1Z * cos + piece.d2Z * sin
      return out
    },
  }
}
