// app/journey/arch-geometry.ts
import * as THREE from 'three'

export interface ArchSpec {
  // Width between the two ends, along x.
  span: number
  // How far the underside at the middle rises above the underside at the ends.
  rise: number
  // Vertical thickness of the arch band.
  thickness: number
  // Depth along z.
  depth: number
  // Number of straight pieces the curve is cut into. At least 2.
  segments: number
  // Every vertex gets this uv, so the arch samples one flat color of a palette texture.
  uv: readonly [number, number]
}

function requirePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Arch ${name} must be a positive number, got ${value}`)
}

// A band that follows the parabola y = rise * (1 - (x / half)^2). The underside meets y = 0 at both ends, so the
// ends stand flat on a base. The pivot is the center of the base: x and z centered, y = 0 at the ends.
export function parabolicArchGeometry(spec: ArchSpec): THREE.BufferGeometry {
  const { span, rise, thickness, depth, segments, uv } = spec
  requirePositive('span', span)
  requirePositive('rise', rise)
  requirePositive('thickness', thickness)
  requirePositive('depth', depth)
  if (!Number.isInteger(segments) || segments < 2) throw new Error(`Arch segments must be an integer of at least 2, got ${segments}`)

  const half = span / 2
  const halfDepth = depth / 2
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []

  function vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    positions.push(x, y, z)
    normals.push(nx, ny, nz)
    return positions.length / 3 - 1
  }

  const stations = Array.from({ length: segments + 1 }, (_, i) => {
    const x = -half + (span * i) / segments
    const under = rise * (1 - (x / half) ** 2)
    const slope = (-2 * rise * x) / (half * half)
    const length = Math.hypot(slope, 1)
    return { x, under, over: under + thickness, nx: -slope / length, ny: 1 / length }
  })

  // Top strip (normals up along the curve), then the underside strip (normals down), then the two faces.
  const top = stations.map(s => [vertex(s.x, s.over, -halfDepth, s.nx, s.ny, 0), vertex(s.x, s.over, halfDepth, s.nx, s.ny, 0)] as const)
  const bottom = stations.map(s => [vertex(s.x, s.under, -halfDepth, -s.nx, -s.ny, 0), vertex(s.x, s.under, halfDepth, -s.nx, -s.ny, 0)] as const)
  const front = stations.map(s => [vertex(s.x, s.under, halfDepth, 0, 0, 1), vertex(s.x, s.over, halfDepth, 0, 0, 1)] as const)
  const back = stations.map(s => [vertex(s.x, s.under, -halfDepth, 0, 0, -1), vertex(s.x, s.over, -halfDepth, 0, 0, -1)] as const)

  for (let i = 0; i < segments; i++) {
    const [a, b] = top[i]!
    const [c, d] = top[i + 1]!
    indices.push(a, b, c, b, d, c)
    const [ba, bb] = bottom[i]!
    const [bc, bd] = bottom[i + 1]!
    indices.push(ba, bc, bb, bb, bc, bd)
    const [fl, fh] = front[i]!
    const [fnl, fnh] = front[i + 1]!
    indices.push(fl, fnl, fh, fnl, fnh, fh)
    const [kl, kh] = back[i]!
    const [knl, knh] = back[i + 1]!
    indices.push(kl, kh, knl, knl, kh, knh)
  }

  for (const side of [-1, 1] as const) {
    const x = side * half
    const p = [
      vertex(x, 0, -halfDepth, side, 0, 0), vertex(x, 0, halfDepth, side, 0, 0),
      vertex(x, thickness, halfDepth, side, 0, 0), vertex(x, thickness, -halfDepth, side, 0, 0),
    ] as const
    if (side < 0) indices.push(p[0], p[1], p[2], p[0], p[2], p[3])
    else indices.push(p[0], p[2], p[1], p[0], p[3], p[2])
  }

  const uvs = Array.from({ length: positions.length / 3 }, () => [uv[0], uv[1]]).flat()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}
