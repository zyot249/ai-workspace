import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { PATH_TOTAL_LENGTH, pathPointAt } from '../../app/journey/path'
import { seeded } from '../../app/journey/random'
import { CORNER_BLOCKS, LAYERS, layerPlacements } from '../../app/journey/scene'
import { CAMERA_FAR, SKY_RADIUS } from '../../app/journey/sky'
import { toLinear } from '../../app/journey/sky-mirror'
import {
  createFarSkyline, createGround, createHazeMesh, farColor, GROUND_HALF_SIZE, GROUND_NAME, GROUND_Y,
  HAZE_BASE_Y, HAZE_HEIGHT, HAZE_NAME, HAZE_RADIUS, RINGS, SCENE_CENTER, silhouetteLayout,
} from '../../app/journey/skyline-far'
import { LOOKS, type Vec3 } from '../../app/journey/stops'

// Every camera position: the path in 0.5-unit steps, plus the full-tier pointer tilt (±0.3 sideways).
const CAMERAS = Array.from({ length: Math.ceil(PATH_TOTAL_LENGTH * 2) + 1 }, (_, i) => pathPointAt(i / 2))
  .flatMap(p => [-.3, 0, .3].map(tilt => ({ x: p.x + p.rightX * tilt, z: p.z + p.rightZ * tilt })))
const CAMERA_MAX_Y = 1 // highest cameraHeight 0.8 plus the pointer tilt 0.2
const MIN_EDGE_DISTANCE = 80

const halfDiagonal = (width: number, depth: number) => Math.hypot(width, depth) / 2
function cornerDistances(x: number, z: number, halfX: number, halfZ: number): number[] {
  return [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) =>
    Math.hypot(x + sx! * halfX - SCENE_CENTER.x, z + sz! * halfZ - SCENE_CENTER.z))
}

describe('layout', () => {
  it('centres the backdrop on the path bounding box', () => {
    expect(SCENE_CENTER).toEqual({ x: -13, z: -29 })
  })

  it('keeps the legacy seeded sequence', () => {
    for (const i of [0, 5, 1234]) {
      const x = Math.sin(i * 12.9898) * 43758.5453
      expect(seeded(i)).toBe(x - Math.floor(x))
      expect(seeded(i)).toBeGreaterThanOrEqual(0)
      expect(seeded(i)).toBeLessThan(1)
    }
  })

  it('lays a 260 x 260 ground whose edge is always at least 80 units away', () => {
    const ground = createGround()
    expect(ground.name).toBe(GROUND_NAME)
    expect(ground.geometry.parameters).toMatchObject({ width: 260, height: 260 })
    expect(ground.position.toArray()).toEqual([SCENE_CENTER.x, GROUND_Y, SCENE_CENTER.z])
    expect(ground.rotation.x).toBeCloseTo(-Math.PI / 2, 12)
    for (const c of CAMERAS) {
      const edge = Math.min(GROUND_HALF_SIZE - Math.abs(c.x - SCENE_CENTER.x), GROUND_HALF_SIZE - Math.abs(c.z - SCENE_CENTER.z))
      expect(edge).toBeGreaterThanOrEqual(MIN_EDGE_DISTANCE)
    }
  })

  it('keeps every backdrop object inside the camera far plane', () => {
    expect(SKY_RADIUS).toBeLessThan(CAMERA_FAR)
    const ringReach = Math.max(...Object.values(RINGS).map(r => r.maxDistance + halfDiagonal(10, 10)))
    const ringTop = Math.max(...Object.values(RINGS).map(r => r.maxHeight)) - 1
    for (const c of CAMERAS) {
      const fromCenter = Math.hypot(c.x - SCENE_CENTER.x, c.z - SCENE_CENTER.z)
      expect(Math.hypot(fromCenter + HAZE_RADIUS, HAZE_BASE_Y + HAZE_HEIGHT + CAMERA_MAX_Y)).toBeLessThan(CAMERA_FAR)
      expect(Math.hypot(fromCenter + ringReach, ringTop + CAMERA_MAX_Y)).toBeLessThan(CAMERA_FAR)
      const corner = Math.hypot(GROUND_HALF_SIZE + Math.abs(c.x - SCENE_CENTER.x), GROUND_HALF_SIZE + Math.abs(c.z - SCENE_CENTER.z))
      expect(corner).toBeLessThan(CAMERA_FAR)
    }
  })

  it.each(['a', 'b'] as const)('places ring %s inside its band, behind the haze, and repeatably', key => {
    const ring = RINGS[key]
    const boxes = silhouetteLayout(ring, ring.fullCount, ring.seed)
    expect(boxes).toHaveLength(ring.fullCount)
    expect(silhouetteLayout(ring, ring.fullCount, ring.seed)).toEqual(boxes)
    for (const box of boxes) {
      expect(Math.hypot(box.x - SCENE_CENTER.x, box.z - SCENE_CENTER.z)).toBeCloseTo(box.distance, 9)
      expect(box.distance).toBeGreaterThanOrEqual(ring.minDistance)
      expect(box.distance).toBeLessThanOrEqual(ring.maxDistance)
      expect(box.height).toBeGreaterThanOrEqual(ring.minHeight)
      expect(box.height).toBeLessThanOrEqual(ring.maxHeight)
      for (const size of [box.width, box.depth]) {
        expect(size).toBeGreaterThanOrEqual(5)
        expect(size).toBeLessThanOrEqual(10)
      }
      expect(box.distance + halfDiagonal(box.width, box.depth)).toBeLessThan(HAZE_RADIUS)
    }
  })

  it('keeps ring A at least 30 units outside the city', () => {
    const cityOuterRadius = Math.max(
      ...LAYERS.flatMap((config, i) => layerPlacements(config, i, config.count))
        .filter(b => b.width > 0)
        .flatMap(b => cornerDistances(b.x, b.z, b.width / 2, b.width / 2)),
      ...CORNER_BLOCKS.flatMap(b => cornerDistances(b.x, b.z, b.width / 2, b.depth / 2)),
    )
    expect(cityOuterRadius).toBeGreaterThan(30)
    for (const box of silhouetteLayout(RINGS.a, RINGS.a.fullCount, RINGS.a.seed)) {
      expect(box.distance - halfDiagonal(box.width, box.depth)).toBeGreaterThanOrEqual(cityOuterRadius + 30)
    }
  })
})

describe('colours', () => {
  it('mixes far colours toward the ink and stays in range', () => {
    for (const look of [LOOKS.light.intro, LOOKS.dark.about]) {
      expect(farColor(look.fogColor, 0)).toEqual(look.fogColor)
      for (const amount of [.1, .22, 1]) for (const v of farColor(look.fogColor, amount)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it.each([false, true])('paints the rings with a vertex gradient only (lowPower %s)', lowPower => {
    const far = createFarSkyline(lowPower)
    const fog: Vec3 = LOOKS.dark.projects.fogColor
    far.update(fog)
    const rings = far.objects.filter((o): o is THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> =>
      o instanceof THREE.InstancedMesh)
    expect(rings.map(r => [r.name, r.count])).toEqual([
      [RINGS.a.name, lowPower ? RINGS.a.liteCount : RINGS.a.fullCount],
      [RINGS.b.name, lowPower ? RINGS.b.liteCount : RINGS.b.fullCount],
    ])
    expect(lowPower ? [RINGS.a.liteCount, RINGS.b.liteCount] : [RINGS.a.fullCount, RINGS.b.fullCount])
      .toEqual(lowPower ? [36, 20] : [36, 36])
    for (const [i, ring] of rings.entries()) {
      const config = i === 0 ? RINGS.a : RINGS.b
      expect(ring.material.color.toArray()).toEqual([1, 1, 1])
      expect(ring.material.vertexColors).toBe(true)
      expect(ring.material.fog).toBe(false)
      expect(ring.instanceColor).toBeNull()
      const position = ring.geometry.getAttribute('position'), color = ring.geometry.getAttribute('color')
      expect(color.itemSize).toBe(3)
      const bottom = toLinear(fog), top = toLinear(farColor(fog, config.inkMix))
      for (let v = 0; v < position.count; v++) {
        const want = position.getY(v) < 0 ? bottom : top
        ;[color.getX(v), color.getY(v), color.getZ(v)].forEach((c, k) => expect(c).toBeCloseTo(want[k]!, 6))
      }
    }
  })
})

describe('haze', () => {
  it('fades its RGBA vertex alpha from 0.85 at the bottom to 0 at the top', () => {
    const haze = createHazeMesh(64)
    expect(haze.name).toBe(HAZE_NAME)
    expect(haze.geometry.parameters).toMatchObject({ radiusTop: 136, radiusBottom: 136, height: 40,
      radialSegments: 64, heightSegments: 1, openEnded: true })
    const position = haze.geometry.getAttribute('position'), color = haze.geometry.getAttribute('color')
    expect(color.itemSize).toBe(4)
    for (let v = 0; v < position.count; v++) {
      expect([color.getX(v), color.getY(v), color.getZ(v)]).toEqual([1, 1, 1])
      expect(color.getW(v)).toBeCloseTo(position.getY(v) < 0 ? .85 : 0, 6)
    }
    expect(haze.material.vertexColors).toBe(true)
    expect(haze.material.transparent).toBe(true)
    expect(haze.material.depthWrite).toBe(false)
    expect(haze.material.fog).toBe(false)
    expect(haze.material.side).toBe(THREE.BackSide)
    expect(haze.renderOrder).toBe(-900)
    expect(haze.position.toArray()).toEqual([SCENE_CENTER.x, -1 + 20, SCENE_CENTER.z])
  })

  it.each([false, true])('tints the haze with the authored fog colour (lowPower %s)', lowPower => {
    const far = createFarSkyline(lowPower)
    const haze = far.objects.find(o => o.name === HAZE_NAME) as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
    expect(haze.geometry.parameters.radialSegments).toBe(lowPower ? 32 : 64)
    far.update(LOOKS.light.skills.fogColor)
    haze.material.color.toArray().forEach((v, i) => expect(v).toBeCloseTo(toLinear(LOOKS.light.skills.fogColor)[i]!, 6))
    expect(far.objects).toHaveLength(3)
  })
})
