import { describe, expect, it } from 'vitest'
import { LAYERS, placeBuilding } from '../../app/journey/buildings'
import {
  BUILDING_CLEARANCE, BUILDING_ROAD_MARGIN, clearsSidewalks, PATH_SEGMENTS, pathBandRects, ROAD_HALF_WIDTH,
  roadRects, SIDEWALK_INNER, SIDEWALK_OUTER, type Rect, type Vec2, WAYPOINTS,
} from '../../app/journey/path'
import {
  DASH_JOINT_MARGIN, DASH_LENGTH, DASH_PERIOD, DASH_WIDTH, dashPositions, sidewalkPolygon,
} from '../../app/journey/road-layout'

function inRects(rects: readonly Rect[], x: number, z: number, grow = 0): boolean {
  return rects.some(([minX, minZ, maxX, maxZ]) =>
    x >= minX - grow && x <= maxX + grow && z >= minZ - grow && z <= maxZ + grow)
}

function inPolygon(polygon: readonly Vec2[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

function hasVertex(polygon: readonly Vec2[], x: number, z: number): boolean {
  return polygon.some(p => Math.abs(p.x - x) < 1e-9 && Math.abs(p.z - z) < 1e-9)
}

function crosses(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x)
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

describe('roadRects', () => {
  it('lists the three segment rectangles and the two joint squares', () => {
    expect(roadRects()).toEqual([
      [-3, -26, 3, 8], [-26, -29, 0, -23], [-29, -66, -23, -26],
      [-3, -29, 3, -23], [-29, -29, -23, -23],
    ])
  })

  it('covers the road geometry and nothing farther than 0.01 beyond it', () => {
    const rects = roadRects()
    // Independent description of the geometry: each segment quad is `length` long and 2 * ROAD_HALF_WIDTH wide,
    // centered on the segment middle, and each interior waypoint carries a 6 x 6 square.
    const onGeometry = (x: number, z: number, grow: number) => {
      const onSegment = PATH_SEGMENTS.some(segment => {
        const dx = x - (segment.fromX + segment.dirX * segment.length / 2)
        const dz = z - (segment.fromZ + segment.dirZ * segment.length / 2)
        return Math.abs(dx * segment.dirX + dz * segment.dirZ) <= segment.length / 2 + grow
          && Math.abs(dx * segment.rightX + dz * segment.rightZ) <= ROAD_HALF_WIDTH + grow
      })
      const onJoint = WAYPOINTS.slice(1, -1).some(point =>
        Math.abs(x - point.x) <= ROAD_HALF_WIDTH + grow && Math.abs(z - point.z) <= ROAD_HALF_WIDTH + grow)
      return onSegment || onJoint
    }
    for (let x = -34; x <= 8; x += 0.07) for (let z = -72; z <= 14; z += 0.07) {
      if (onGeometry(x, z, 0)) expect(inRects(rects, x, z)).toBe(true)
      if (inRects(rects, x, z)) expect(onGeometry(x, z, 0.01)).toBe(true)
    }
  })
})

describe('sidewalkPolygon', () => {
  const outer = pathBandRects(SIDEWALK_OUTER)
  const road = roadRects()

  it('matches the complete region between the road and the 3.9 band', () => {
    const polygons = ([-1, 1] as const).map(side => sidewalkPolygon(side))
    const mismatches: string[] = []
    // Offset grid: no sample sits exactly on a boundary at a multiple of 0.1.
    for (let x = -36.05; x <= 10; x += 0.1) for (let z = -76.05; z <= 18; z += 0.1) {
      const expected = inRects(outer, x, z) && !inRects(road, x, z)
      const actual = polygons.some(polygon => inPolygon(polygon, x, z))
      if (expected !== actual) mismatches.push(`${x.toFixed(2)},${z.toFixed(2)}`)
    }
    expect(mismatches).toEqual([])
  })

  it('reaches the square outside corner and keeps a clean inside corner', () => {
    const right = sidewalkPolygon(1), left = sidewalkPolygon(-1)
    expect(hasVertex(right, 3.9, -29.9)).toBe(true)
    expect(hasVertex(right, 3, -29)).toBe(true)
    expect(hasVertex(left, -3, -23)).toBe(true)
    expect(hasVertex(left, -3.9, -22.1)).toBe(true)
  })

  it('has no self-intersection and the two sides never overlap', () => {
    for (const side of [-1, 1] as const) {
      const polygon = sidewalkPolygon(side)
      for (let i = 0; i < polygon.length; i++) for (let j = i + 2; j < polygon.length; j++) {
        if (i === 0 && j === polygon.length - 1) continue
        expect(crosses(polygon[i]!, polygon[(i + 1) % polygon.length]!, polygon[j]!, polygon[(j + 1) % polygon.length]!)).toBe(false)
      }
    }
    const [left, right] = [sidewalkPolygon(-1), sidewalkPolygon(1)]
    for (let x = -36.05; x <= 10; x += 0.1) for (let z = -76.05; z <= 18; z += 0.1)
      expect(inPolygon(left, x, z) && inPolygon(right, x, z)).toBe(false)
  })

  it('honors the inner and outer distances', () => {
    expect(hasVertex(sidewalkPolygon(1, 3, 5), 5, 8)).toBe(true)
    expect(SIDEWALK_INNER).toBe(ROAD_HALF_WIDTH)
  })
})

describe('dashPositions', () => {
  const dashes = dashPositions()

  it('places 29 dashes: 10, 7 and 12 on the three segments', () => {
    expect(dashes).toHaveLength(29)
    const perSegment = PATH_SEGMENTS.map(segment =>
      dashes.filter(d => d.dirX === segment.dirX && d.dirZ === segment.dirZ
        && Math.abs((d.x - segment.fromX) * segment.rightX + (d.z - segment.fromZ) * segment.rightZ) < 1e-9
        && ((d.x - segment.fromX) * segment.dirX + (d.z - segment.fromZ) * segment.dirZ) >= -1e-9
        && ((d.x - segment.fromX) * segment.dirX + (d.z - segment.fromZ) * segment.dirZ) <= segment.length + 1e-9).length)
    expect(perSegment).toEqual([10, 7, 12])
  })

  it('spaces dashes 3.0 apart along each segment', () => {
    for (const segment of PATH_SEGMENTS) {
      const along = dashes
        .filter(d => d.dirX === segment.dirX && d.dirZ === segment.dirZ
          && Math.abs((d.x - segment.fromX) * segment.rightX + (d.z - segment.fromZ) * segment.rightZ) < 1e-9)
        .map(d => (d.x - segment.fromX) * segment.dirX + (d.z - segment.fromZ) * segment.dirZ)
        .filter(a => a >= -1e-9 && a <= segment.length + 1e-9)
        .sort((a, b) => a - b)
      for (let i = 1; i < along.length; i++) expect(along[i]! - along[i - 1]!).toBeCloseTo(DASH_PERIOD, 9)
    }
  })

  it('keeps the whole dash inside its segment and 3.0 from every interior waypoint', () => {
    expect(DASH_JOINT_MARGIN).toBe(ROAD_HALF_WIDTH + DASH_LENGTH / 2)
    const interior = WAYPOINTS.slice(1, -1)
    for (const dash of dashes) {
      // The dash rectangle's four corners in world space.
      const corners = [-1, 1].flatMap(a => [-1, 1].map(b => ({
        x: dash.x + dash.dirX * a * DASH_LENGTH / 2 - dash.dirZ * b * DASH_WIDTH / 2,
        z: dash.z + dash.dirZ * a * DASH_LENGTH / 2 + dash.dirX * b * DASH_WIDTH / 2,
      })))
      for (const corner of corners) {
        expect(inRects(roadRects().slice(0, 3), corner.x, corner.z, 1e-9)).toBe(true)
        for (const point of interior)
          expect(Math.max(Math.abs(corner.x - point.x), Math.abs(corner.z - point.z))).toBeGreaterThanOrEqual(ROAD_HALF_WIDTH - 1e-9)
      }
      for (const point of interior)
        expect(Math.hypot(dash.x - point.x, dash.z - point.z)).toBeGreaterThanOrEqual(DASH_JOINT_MARGIN - 1e-9)
    }
  })

  it('puts every center on the path center line', () => {
    for (const dash of dashes) {
      const onLine = PATH_SEGMENTS.some(segment =>
        Math.abs((dash.x - segment.fromX) * segment.rightX + (dash.z - segment.fromZ) * segment.rightZ) < 1e-9)
      expect(onLine).toBe(true)
    }
  })
})

describe('clearsSidewalks', () => {
  it('rejects the sidewalk, its margin, and the square outside corner', () => {
    expect(clearsSidewalks(3.5, -10)).toBe(false)
    expect(clearsSidewalks(4.1, -10)).toBe(false) // inside the 0.3 gap
    expect(clearsSidewalks(4.3, -10)).toBe(true)
    expect(clearsSidewalks(3.2, -29.2)).toBe(false) // diagonal from the waypoint: Euclidean distance 4.53
    expect(clearsSidewalks(4.3, -10, 0.2)).toBe(false) // halfExtent grows the margin
  })

  it('keeps BUILDING_ROAD_MARGIN consistent with the sidewalk and gap', () => {
    expect(BUILDING_ROAD_MARGIN).toBeCloseTo(SIDEWALK_OUTER + 0.3, 12)
  })

  it('clears the nearest market stall edge from the sidewalk', () => {
    // Stall x = side * (BUILDING_CLEARANCE + 0.5 + up to 3); half width 0.6.
    expect(BUILDING_CLEARANCE + 0.5 - 0.6).toBeGreaterThanOrEqual(SIDEWALK_OUTER)
  })
})

describe('placed buildings and the sidewalk', () => {
  const polygons = ([-1, 1] as const).map(side => sidewalkPolygon(side))

  it.each(LAYERS.map((config, layer) => [layer, config.sideSpread] as const))(
    'layer %i: no building rectangle touches either sidewalk polygon',
    (layer, sideSpread) => {
      const offenders: string[] = []
      for (let i = 0; i < 500; i++) {
        const placed = placeBuilding(layer * 1000 + i, sideSpread)
        if (!placed) continue
        const halfW = placed.width / 2, halfD = placed.depth / 2
        for (let gx = -1; gx <= 1; gx += 0.25) for (let gz = -1; gz <= 1; gz += 0.25) {
          const x = placed.x + gx * halfW, z = placed.z + gz * halfD
          if (polygons.some(polygon => inPolygon(polygon, x, z))) offenders.push(`${layer}:${i}`)
        }
        for (const polygon of polygons) for (const vertex of polygon) {
          if (Math.abs(vertex.x - placed.x) < halfW && Math.abs(vertex.z - placed.z) < halfD) offenders.push(`${layer}:${i} vertex`)
        }
      }
      expect(offenders).toEqual([])
    },
  )
})
