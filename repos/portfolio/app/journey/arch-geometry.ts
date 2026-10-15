// app/journey/arch-geometry.ts
import * as THREE from 'three'

export interface ArchSpec {
  // Width between the two inner feet on the ground, along x.
  span: number
  // Height of the underside at the middle.
  rise: number
  // Thickness of the band at the middle. The band is `footWidth` wide at the ground.
  thickness: number
  // Width of each foot on the ground, measured outward from the inner foot.
  footWidth: number
  // Depth along z.
  depth: number
  // Number of straight pieces each curve is cut into. At least 2.
  segments: number
  // Every vertex gets this uv, so the arch samples one flat color of a palette texture.
  uv: readonly [number, number]
}

function requirePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Arch ${name} must be a positive number, got ${value}`)
}

// A band between two nested parabolas that both end on y = 0:
//   underside  y = rise * (1 - (x / innerHalf)^2)
//   top        y = (rise + thickness) * (1 - (x / outerHalf)^2)
// The band is `thickness` thick at the middle and `footWidth` wide at each foot, and the feet are flat on the
// ground. The pivot is the center of the span: x and z centered, y = 0 on the ground.
export function parabolicArchGeometry(spec: ArchSpec): THREE.BufferGeometry {
  const { span, rise, thickness, footWidth, depth, segments, uv } = spec
  requirePositive('span', span)
  requirePositive('rise', rise)
  requirePositive('thickness', thickness)
  requirePositive('footWidth', footWidth)
  requirePositive('depth', depth)
  if (!Number.isInteger(segments) || segments < 2) throw new Error(`Arch segments must be an integer of at least 2, got ${segments}`)

  const innerHalf = span / 2
  const outerHalf = innerHalf + footWidth
  const outerHeight = rise + thickness
  const halfDepth = depth / 2
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []

  function vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    positions.push(x, y, z)
    normals.push(nx, ny, nz)
    return positions.length / 3 - 1
  }

  // Upward unit normal of y = height * (1 - (x / half)^2) at x.
  function curveNormal(x: number, height: number, half: number): [number, number] {
    const slope = (-2 * height * x) / (half * half)
    const length = Math.hypot(slope, 1)
    return [-slope / length, 1 / length]
  }

  const stations = Array.from({ length: segments + 1 }, (_, i) => {
    const u = i / segments
    const xInner = -innerHalf + span * u
    const xOuter = -outerHalf + 2 * outerHalf * u
    const [inx, iny] = curveNormal(xInner, rise, innerHalf)
    const [onx, ony] = curveNormal(xOuter, outerHeight, outerHalf)
    return {
      xInner, yInner: rise * (1 - (xInner / innerHalf) ** 2), inx, iny,
      xOuter, yOuter: outerHeight * (1 - (xOuter / outerHalf) ** 2), onx, ony,
    }
  })

  // Top strip (normals up along the outer curve), underside strip (normals down), then the two faces.
  const top = stations.map(s => [vertex(s.xOuter, s.yOuter, -halfDepth, s.onx, s.ony, 0), vertex(s.xOuter, s.yOuter, halfDepth, s.onx, s.ony, 0)] as const)
  const bottom = stations.map(s => [vertex(s.xInner, s.yInner, -halfDepth, -s.inx, -s.iny, 0), vertex(s.xInner, s.yInner, halfDepth, -s.inx, -s.iny, 0)] as const)
  const front = stations.map(s => [vertex(s.xInner, s.yInner, halfDepth, 0, 0, 1), vertex(s.xOuter, s.yOuter, halfDepth, 0, 0, 1)] as const)
  const back = stations.map(s => [vertex(s.xInner, s.yInner, -halfDepth, 0, 0, -1), vertex(s.xOuter, s.yOuter, -halfDepth, 0, 0, -1)] as const)

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

  // Flat feet: one quad on the ground under each end, facing down.
  for (const side of [-1, 1] as const) {
    const near = side * innerHalf
    const far = side * outerHalf
    const [first, second] = side < 0 ? [far, near] : [near, far]
    const p = [
      vertex(first, 0, -halfDepth, 0, -1, 0), vertex(first, 0, halfDepth, 0, -1, 0),
      vertex(second, 0, halfDepth, 0, -1, 0), vertex(second, 0, -halfDepth, 0, -1, 0),
    ] as const
    indices.push(p[0], p[2], p[1], p[0], p[3], p[2])
  }

  const uvs = Array.from({ length: positions.length / 3 }, () => [uv[0], uv[1]]).flat()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}
