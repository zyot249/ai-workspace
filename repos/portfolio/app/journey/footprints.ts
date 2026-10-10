import { headingFor, PATH_SEGMENTS, type PathSegment, PLACES } from './path'

// Axis-aligned-in-its-own-frame footprint for a set-piece: keeps generic
// background buildings (and corner-blocking props) from landing inside it.
// `heading` must match the rotation the piece was placed with.
export interface Footprint {
  x: number
  z: number
  heading: number
  halfX: number
  halfZ: number
}

function segmentAt(index: number): PathSegment {
  const segment = PATH_SEGMENTS[index]
  if (!segment) throw new Error(`expected path segment ${index}`)
  return segment
}

const seg1 = segmentAt(0)
const seg2 = segmentAt(1)
const seg3 = segmentAt(2)

export const FOOTPRINTS: readonly Footprint[] = [
  { x: PLACES.entrance.x, z: PLACES.entrance.z, heading: headingFor(seg1.dirX, seg1.dirZ), halfX: 4, halfZ: 1.2 },
  // halfZ covers HALL_MAX_LENGTH / 2 + margin, not just the base length, so
  // background scenery stays clear even when the hall grows for more projects.
  { x: PLACES.hall.x, z: PLACES.hall.z, heading: headingFor(seg1.dirX, seg1.dirZ), halfX: 4.5, halfZ: 10.5 },
  // Market halfX covers the stalls at BUILDING_CLEARANCE + 0.5 + 3 + 0.6 = 8.6 off the center line.
  { x: PLACES.market.x, z: PLACES.market.z, heading: headingFor(seg2.dirX, seg2.dirZ), halfX: 8.7, halfZ: 6.5 },
  { x: PLACES.courtyard.x, z: PLACES.courtyard.z, heading: headingFor(seg3.dirX, seg3.dirZ), halfX: 4.5, halfZ: 5 },
]

// `halfExtent` grows each footprint on both local axes, so a building whose
// center passes also keeps its whole axis-aligned rectangle clear. Footprint
// headings are multiples of 90 degrees, so this is exact, not just conservative.
export function clearsFootprints(x: number, z: number, halfExtent = 0): boolean {
  for (const fp of FOOTPRINTS) {
    const dx = x - fp.x
    const dz = z - fp.z
    const cos = Math.cos(fp.heading)
    const sin = Math.sin(fp.heading)
    const lx = dx * cos - dz * sin
    const lz = dx * sin + dz * cos
    if (Math.abs(lx) <= fp.halfX + halfExtent && Math.abs(lz) <= fp.halfZ + halfExtent) return false
  }
  return true
}

// Two tall solid blocks, one tucked into each turn's inside corner, so the
// wide-open sightline from the entrance can't see straight through both
// turns to the market and courtyard. Always present, not tied to density.
export const CORNER_BLOCKS = [
  { x: -4.2, z: -22, width: 3, depth: 3, height: 5 },
  { x: -22, z: -30, width: 3, depth: 3, height: 5 },
] as const

export function clearsCornerBlocks(x: number, z: number, halfExtent = 0): boolean {
  return CORNER_BLOCKS.every(block =>
    Math.abs(x - block.x) > block.width / 2 + halfExtent || Math.abs(z - block.z) > block.depth / 2 + halfExtent)
}
