import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { fovForAspect } from '../../app/journey/camera'
import { ROAD_MARKING_RENDER_ORDER, SHADOW_RENDER_ORDER } from '../../app/journey/contact-shadows'
import { clearsCornerBlocks, clearsFootprints } from '../../app/journey/footprints'
import {
  ARM_LENGTH, armAngleFor, createLamps, DARK_GLASS_HEX, glowColor, HALO_RENDER_ORDER, headColor, LAMP_BASE_Y,
  LAMP_HEAD_Y, LAMP_LIGHT_GAIN, LAMP_LIGHT_HEX, LAMP_OFFSET, LAMP_SPACING_FULL, LAMP_SPACING_LOW_POWER,
  lampHeadPosition, lampIntensity, lampPositions, lampThreshold, POOL_RENDER_ORDER, POST_HEIGHT,
  STREET_LIGHT_LUMINANCE, STREET_NAME_PREFIX, STREET_NAMES,
} from '../../app/journey/lamps'
import { clearsPath, PATH_SEGMENTS, pathPointAt, ROAD_HALF_WIDTH } from '../../app/journey/path'
import { gainFor, linearLuminance } from '../../app/journey/window-look'

// [path distance of the station, side, x, z], computed from the real path, footprints and corner blocks.
const FULL_GOLDEN = [
  [3, 1, 3.3, 5], [3, -1, -3.3, 5], [9, 1, 3.3, -1], [9, -1, -3.3, -1], [33, 1, 3.3, -25],
  [39, 1, -5, -29.3], [57, -1, -23, -22.7], [63, -1, -29.3, -29], [69, 1, -22.7, -35], [69, -1, -29.3, -35],
  [87, 1, -22.7, -53], [87, -1, -29.3, -53], [93, 1, -22.7, -59], [93, -1, -29.3, -59],
] as const
const LOW_POWER_GOLDEN = [
  [4, 1, 3.3, 4], [4, -1, -3.3, 4], [36, 1, -2, -29.3], [60, -1, -29.3, -26],
  [68, 1, -22.7, -34], [68, -1, -29.3, -34], [92, 1, -22.7, -58], [92, -1, -29.3, -58],
] as const

function expectGolden(lamps: ReturnType<typeof lampPositions>, golden: ReadonlyArray<readonly [number, number, number, number]>) {
  expect(lamps).toHaveLength(golden.length)
  golden.forEach(([distance, side, x, z], i) => {
    expect(lamps[i]).toMatchObject({ distance, side })
    expect(lamps[i]!.x).toBeCloseTo(x, 6)
    expect(lamps[i]!.z).toBeCloseTo(z, 6)
  })
}

describe('lampPositions', () => {
  it('keeps 14 lamps (7 per side) at spacing 6, at the pinned positions', () => {
    const lamps = lampPositions(LAMP_SPACING_FULL)
    expectGolden(lamps, FULL_GOLDEN)
    expect(lamps.filter(l => l.side === 1)).toHaveLength(7)
    expect(lamps.filter(l => l.side === -1)).toHaveLength(7)
  })

  it('keeps 8 lamps (4 per side) at spacing 8, at the pinned positions', () => {
    const lamps = lampPositions(LAMP_SPACING_LOW_POWER)
    expectGolden(lamps, LOW_POWER_GOLDEN)
    expect(lamps.filter(l => l.side === 1)).toHaveLength(4)
    expect(lamps.filter(l => l.side === -1)).toHaveLength(4)
  })

  it('stands every lamp 3.3 from the center line at its station and clear of footprints, corner blocks and every road leg', () => {
    for (const spacing of [1, LAMP_SPACING_FULL, LAMP_SPACING_LOW_POWER]) {
      for (const lamp of lampPositions(spacing)) {
        const station = pathPointAt(lamp.distance)
        expect(Math.hypot(lamp.x - station.x, lamp.z - station.z)).toBeCloseTo(LAMP_OFFSET, 2)
        expect(clearsPath(lamp.x, lamp.z, 3.2)).toBe(true)
        expect(clearsFootprints(lamp.x, lamp.z, 0.2)).toBe(true)
        expect(clearsCornerBlocks(lamp.x, lamp.z, 0.2)).toBe(true)
      }
    }
  })

  it('rejects the fixture lamp at path distance 59.5 on side +1, which sits 0.5 units from the next road leg', () => {
    const station = pathPointAt(59.5)
    const x = station.x + station.rightX * LAMP_OFFSET
    const z = station.z + station.rightZ * LAMP_OFFSET
    expect(x).toBeCloseTo(-25.5, 6)
    expect(z).toBeCloseTo(-29.3, 6)
    expect(clearsPath(x, z, ROAD_HALF_WIDTH + 0.2)).toBe(false)
    const near = lampPositions(1).filter(l => Math.hypot(l.x - x, l.z - z) < 0.01)
    expect(near).toHaveLength(0)
  })

  it('rejects a spacing that is not positive', () => {
    expect(() => lampPositions(0)).toThrow(RangeError)
    expect(() => lampPositions(-6)).toThrow(RangeError)
  })
})

describe('armAngleFor and lampHeadPosition', () => {
  it('turns the arm toward the road center for both sides and all three segments', () => {
    for (const segment of PATH_SEGMENTS) {
      for (const side of [1, -1] as const) {
        const angle = armAngleFor(side, segment.rightX, segment.rightZ)
        // Rotation by theta about Y maps local +X to (cos theta, 0, -sin theta).
        const arm = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle)
        const toRoad = new THREE.Vector3(-side * segment.rightX, 0, -side * segment.rightZ)
        expect(arm.dot(toRoad)).toBeGreaterThan(0.99)
      }
    }
  })

  it('matches the worked example: segment 1, side +1, angle pi', () => {
    const [first] = PATH_SEGMENTS
    expect(armAngleFor(1, first!.rightX, first!.rightZ)).toBeCloseTo(Math.PI, 12)
  })

  it('puts the post base at y -1 and the head at the arm tip, y 1.4', () => {
    expect(LAMP_BASE_Y).toBe(-1)
    expect(LAMP_HEAD_Y).toBeCloseTo(LAMP_BASE_Y + POST_HEIGHT, 12)
    expect(LAMP_HEAD_Y).toBeCloseTo(1.4, 12)
    for (const lamp of lampPositions(LAMP_SPACING_FULL)) {
      const head = lampHeadPosition(lamp)
      expect(head.y).toBeCloseTo(1.4, 12)
      expect(head.x).toBeCloseTo(lamp.x + ARM_LENGTH * Math.cos(lamp.armAngle), 12)
      expect(head.z).toBeCloseTo(lamp.z - ARM_LENGTH * Math.sin(lamp.armAngle), 12)
      // The arm box spans local x 0..0.5 at height 2.375, so its far end is the head, horizontally.
      const tip = new THREE.Vector3(ARM_LENGTH, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), lamp.armAngle)
      expect(Math.hypot(head.x - (lamp.x + tip.x), head.z - (lamp.z + tip.z))).toBeLessThan(0.01)
      expect(Math.abs(head.y - (LAMP_BASE_Y + 2.375))).toBeLessThanOrEqual(0.025 + 1e-9)
    }
  })

  it('points every head toward the road: closer to the center line than its post', () => {
    for (const lamp of lampPositions(LAMP_SPACING_FULL)) {
      const station = pathPointAt(lamp.distance)
      const head = lampHeadPosition(lamp)
      expect(Math.hypot(head.x - station.x, head.z - station.z)).toBeCloseTo(LAMP_OFFSET - ARM_LENGTH, 6)
    }
  })
})

describe('lampThreshold and lampIntensity', () => {
  const thresholds = Array.from({ length: 64 }, (_, i) => lampThreshold(i))

  it('draws every threshold from [0.15, 0.35)', () => {
    for (const th of thresholds) {
      expect(th).toBeGreaterThanOrEqual(0.15)
      expect(th).toBeLessThan(0.35)
    }
  })

  it('is 0 at ratio 0.15 and 1 at ratio 0.40 for every threshold', () => {
    for (const th of thresholds) {
      expect(lampIntensity(th, 0.15)).toBe(0)
      expect(lampIntensity(th, 0.4)).toBe(1)
      expect(lampIntensity(th, 0)).toBe(0)
      expect(lampIntensity(th, 1)).toBe(1)
    }
  })

  it('is monotonic non-decreasing in the ratio', () => {
    for (const th of thresholds) {
      let previous = 0
      for (let ratio = 0; ratio <= 0.5; ratio += 0.005) {
        const value = lampIntensity(th, ratio)
        expect(value).toBeGreaterThanOrEqual(previous - 1e-12)
        previous = value
      }
    }
  })

  it('lights lamps one by one: the lit count rises monotonically from none to all', () => {
    const lit = (ratio: number) => thresholds.filter(th => lampIntensity(th, ratio) > 0.5).length
    let previous = 0
    for (let ratio = 0; ratio <= 0.5; ratio += 0.005) {
      const count = lit(ratio)
      expect(count).toBeGreaterThanOrEqual(previous)
      previous = count
    }
    expect(lit(0.15)).toBe(0)
    expect(lit(0.4)).toBe(thresholds.length)
    // Lamps switch at different ratios, not all together.
    expect(lit(0.25)).toBeGreaterThan(0)
    expect(lit(0.25)).toBeLessThan(thresholds.length)
  })

  it('depends only on the ratio, so scrolling back turns a lamp off again', () => {
    const th = lampThreshold(0)
    const up = lampIntensity(th, 0.3)
    lampIntensity(th, 0.1)
    expect(lampIntensity(th, 0.3)).toBe(up)
    expect(lampIntensity(th, 0.1)).toBe(0)
  })
})

describe('light gains', () => {
  it('brings warm lamp light to luminance 2.3 (about 3.56)', () => {
    expect(STREET_LIGHT_LUMINANCE).toBe(2.3)
    const color = new THREE.Color(LAMP_LIGHT_HEX)
    expect(LAMP_LIGHT_GAIN).toBeCloseTo(3.556, 1)
    expect(LAMP_LIGHT_GAIN).toBeCloseTo(gainFor(LAMP_LIGHT_HEX, 2.3), 12)
    expect(linearLuminance([color.r * LAMP_LIGHT_GAIN, color.g * LAMP_LIGHT_GAIN, color.b * LAMP_LIGHT_GAIN])).toBeCloseTo(2.3, 3)
  })

  it('brings the front (about 2.58) and rear (about 10.0) car light colors to luminance 2.3', () => {
    for (const [hex, expected] of [[0xfff1d6, 2.584], [0xff2a1a, 10.004]] as const) {
      const gain = gainFor(hex, STREET_LIGHT_LUMINANCE)
      const color = new THREE.Color(hex)
      expect(gain).toBeCloseTo(expected, 1)
      expect(linearLuminance([color.r * gain, color.g * gain, color.b * gain])).toBeCloseTo(2.3, 3)
    }
  })

  it('keeps the dark glass color dim', () => {
    const glass = new THREE.Color(DARK_GLASS_HEX)
    expect(linearLuminance([glass.r, glass.g, glass.b])).toBeLessThan(0.05)
  })
})

function meshNamed(field: ReturnType<typeof createLamps>, name: string): THREE.InstancedMesh {
  const mesh = field.objects.find(object => object.name === name)
  if (!mesh) throw new Error(`missing mesh ${name}`)
  return mesh
}

// Instance colors are stored as float32, so compare through Math.fround or with a tolerance.
function colorAt(mesh: THREE.InstancedMesh, index: number): THREE.Color {
  const color = new THREE.Color()
  mesh.getColorAt(index, color)
  return color
}

describe('createLamps', () => {
  it('creates four named instanced meshes, one instance per lamp, culling off', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    expect(field.objects).toHaveLength(4)
    expect(field.lamps).toHaveLength(14)
    for (const name of [STREET_NAMES.posts, STREET_NAMES.heads, STREET_NAMES.halos, STREET_NAMES.pools]) {
      const mesh = meshNamed(field, name)
      expect(name.startsWith(STREET_NAME_PREFIX)).toBe(true)
      expect(mesh.count).toBe(14)
      expect(mesh.frustumCulled).toBe(false)
    }
    expect(createLamps(LAMP_SPACING_LOW_POWER).lamps).toHaveLength(8)
    field.dispose()
  })

  it('draws pools after shadows and before road markings, and halos after markings', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    expect(SHADOW_RENDER_ORDER).toBeLessThan(POOL_RENDER_ORDER)
    expect(POOL_RENDER_ORDER).toBeLessThan(ROAD_MARKING_RENDER_ORDER)
    expect(ROAD_MARKING_RENDER_ORDER).toBeLessThan(HALO_RENDER_ORDER)
    expect(meshNamed(field, STREET_NAMES.pools).renderOrder).toBe(1.5)
    expect(meshNamed(field, STREET_NAMES.halos).renderOrder).toBe(3)
    field.dispose()
  })

  it('merges the post and arm into one geometry that stands on y -1 and reaches the head height', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    const posts = meshNamed(field, STREET_NAMES.posts)
    posts.geometry.computeBoundingBox()
    const box = posts.geometry.boundingBox!
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.max.y).toBeCloseTo(POST_HEIGHT, 6)
    // A 6-sided cylinder of radius 0.05 has vertices at sin(k * 60 deg), so its widest x extent is 0.05 * sin(60 deg).
    expect(box.min.x).toBeCloseTo(-0.05 * Math.sin(Math.PI / 3), 6)
    expect(box.max.x).toBeCloseTo(ARM_LENGTH, 6)
    field.dispose()
  })

  it('places posts at y -1, heads and halos at the head position, and pools on the road toward the lane', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const posts = meshNamed(field, STREET_NAMES.posts)
    const heads = meshNamed(field, STREET_NAMES.heads)
    const halos = meshNamed(field, STREET_NAMES.halos)
    const pools = meshNamed(field, STREET_NAMES.pools)
    field.lamps.forEach((lamp, i) => {
      const head = lampHeadPosition(lamp)
      posts.getMatrixAt(i, matrix)
      // Instance matrices are float32, so positions match to float32 precision, not exactly.
      position.setFromMatrixPosition(matrix)
      expect(position.x).toBeCloseTo(lamp.x, 5)
      expect(position.y).toBeCloseTo(LAMP_BASE_Y, 5)
      expect(position.z).toBeCloseTo(lamp.z, 5)
      heads.getMatrixAt(i, matrix)
      position.setFromMatrixPosition(matrix)
      expect(position.x).toBeCloseTo(head.x, 5)
      expect(position.y).toBeCloseTo(head.y, 5)
      expect(position.z).toBeCloseTo(head.z, 5)
      expect(new THREE.Vector3().setFromMatrixScale(matrix).x).toBeCloseTo(0.12, 5)
      halos.getMatrixAt(i, matrix)
      position.setFromMatrixPosition(matrix)
      expect(position.x).toBeCloseTo(head.x, 5)
      expect(position.y).toBeCloseTo(head.y, 5)
      expect(position.z).toBeCloseTo(head.z, 5)
      expect(new THREE.Vector3().setFromMatrixScale(matrix).x).toBeCloseTo(0.9, 5)
      pools.getMatrixAt(i, matrix)
      position.setFromMatrixPosition(matrix)
      expect(position.y).toBeCloseTo(-0.992, 5)
      expect(position.x).toBeCloseTo(lamp.x + 1.2 * Math.cos(lamp.armAngle), 5)
      expect(position.z).toBeCloseTo(lamp.z - 1.2 * Math.sin(lamp.armAngle), 5)
      expect(new THREE.Vector3().setFromMatrixScale(matrix).x).toBeCloseTo(3.2, 5)
      // The pool lies flat: its normal points up.
      expect(pools.geometry.getAttribute('normal').getY(0)).toBeCloseTo(1, 6)
    })
    field.dispose()
  })

  it('gives halos and pools additive, depth-write-off materials with the falloff map and distinct cache keys', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    const halo = meshNamed(field, STREET_NAMES.halos).material as THREE.MeshBasicMaterial
    const pool = meshNamed(field, STREET_NAMES.pools).material as THREE.MeshBasicMaterial
    for (const material of [halo, pool]) {
      expect(material.blending).toBe(THREE.AdditiveBlending)
      expect(material.transparent).toBe(true)
      expect(material.depthWrite).toBe(false)
      expect(material.fog).toBe(true)
      expect(material.map).not.toBeNull()
      expect(material.map!.colorSpace).toBe(THREE.NoColorSpace)
    }
    expect(pool.polygonOffset).toBe(true)
    expect(pool.polygonOffsetFactor).toBe(-1)
    expect(pool.polygonOffsetUnits).toBe(-1)
    expect(halo.customProgramCacheKey()).toBe('street-halo|additive-fog')
    expect(pool.customProgramCacheKey()).toBe('street-pool|additive-fog')
    field.dispose()
  })

  it('patches the halo vertex shader into a view-space billboard and both fog fragments to attenuate', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    const halo = meshNamed(field, STREET_NAMES.halos).material as THREE.MeshBasicMaterial
    const pool = meshNamed(field, STREET_NAMES.pools).material as THREE.MeshBasicMaterial
    const shader = () => ({ vertexShader: '#include <project_vertex>', fragmentShader: '#include <fog_fragment>', uniforms: {} }) as unknown as THREE.WebGLProgramParametersWithUniforms
    const haloShader = shader()
    halo.onBeforeCompile(haloShader, {} as THREE.WebGLRenderer)
    expect(haloShader.vertexShader).not.toContain('#include <project_vertex>')
    expect(haloShader.vertexShader).toContain('instanceMatrix')
    expect(haloShader.vertexShader).toContain('mvPosition.xy +=')
    expect(haloShader.fragmentShader).toContain('1.0 - fogFactor')
    const poolShader = shader()
    pool.onBeforeCompile(poolShader, {} as THREE.WebGLRenderer)
    expect(poolShader.vertexShader).toBe('#include <project_vertex>')
    expect(poolShader.fragmentShader).toContain('1.0 - fogFactor')
    field.dispose()
  })

  it('shows dark glass on a head and exactly black halos and pools when every lamp is off', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    field.update(0.05)
    const dark = new THREE.Color(DARK_GLASS_HEX)
    for (let i = 0; i < field.lamps.length; i++) {
      expect(colorAt(meshNamed(field, STREET_NAMES.heads), i).toArray()).toEqual(dark.toArray().map(Math.fround))
      expect(colorAt(meshNamed(field, STREET_NAMES.halos), i).toArray()).toEqual([0, 0, 0])
      expect(colorAt(meshNamed(field, STREET_NAMES.pools), i).toArray()).toEqual([0, 0, 0])
    }
    field.dispose()
  })

  it('lights every head to warm * gain, every halo to warm * 0.9 and every pool to warm * 0.5 at ratio 0.40', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    field.update(0.4)
    const warm = new THREE.Color(LAMP_LIGHT_HEX)
    const lit = warm.clone().multiplyScalar(LAMP_LIGHT_GAIN)
    const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    for (let i = 0; i < field.lamps.length; i++) {
      const head = colorAt(meshNamed(field, STREET_NAMES.heads), i)
      expect(head.r).toBeCloseTo(lit.r, 5)
      expect(head.g).toBeCloseTo(lit.g, 5)
      expect(head.b).toBeCloseTo(lit.b, 5)
      expect(luminance(colorAt(meshNamed(field, STREET_NAMES.heads), i))).toBeGreaterThanOrEqual(STREET_LIGHT_LUMINANCE - 0.01)
      expect(colorAt(meshNamed(field, STREET_NAMES.halos), i).r).toBeCloseTo(warm.r * 0.9, 6)
      expect(colorAt(meshNamed(field, STREET_NAMES.pools), i).r).toBeCloseTo(warm.r * 0.5, 6)
    }
    field.dispose()
  })

  it('rewrites colors only when the quantised ratio changes, in both directions', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    const heads = meshNamed(field, STREET_NAMES.heads)
    const version = () => heads.instanceColor!.version
    field.update(0.3)
    const afterFirst = version()
    field.update(0.3)
    expect(version()).toBe(afterFirst)
    field.update(0.3004)
    expect(version()).toBe(afterFirst)
    field.update(0.25)
    const afterDown = version()
    expect(afterDown).toBeGreaterThan(afterFirst)
    field.update(0.25)
    expect(version()).toBe(afterDown)
    field.update(0.3)
    expect(version()).toBeGreaterThan(afterDown)
    field.dispose()
  })

  it('turns lamps off again when the ratio falls back to the day value', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    const halos = meshNamed(field, STREET_NAMES.halos)
    field.update(0.9)
    expect(colorAt(halos, 0).r).toBeGreaterThan(0.5)
    field.update(0.05)
    for (let i = 0; i < field.lamps.length; i++) expect(colorAt(halos, i).toArray()).toEqual([0, 0, 0])
    field.dispose()
  })

  it('keeps a lit halo under half the viewport at the 3.3 units a lamp passes the camera, on a portrait phone', () => {
    const aspect = 390 / 844
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, 0.1, 200)
    const corner = new THREE.Vector3(0.45, 0.45, -(LAMP_OFFSET)).applyMatrix4(camera.projectionMatrix)
    // NDC spans 2 units across the viewport, so the half-extent in NDC is the full fraction of the viewport.
    expect(Math.abs(corner.x)).toBeLessThan(0.5)
    expect(Math.abs(corner.y)).toBeLessThan(0.5)
  })

  it('dispose releases geometry, material and texture without throwing twice', () => {
    const field = createLamps(LAMP_SPACING_FULL)
    field.dispose()
    expect(() => field.dispose()).not.toThrow()
  })
})

describe('light color helpers', () => {
  it('mixes dark glass to warm * gain with the intensity', () => {
    const out = new THREE.Color()
    expect(headColor(0, out).toArray()).toEqual(new THREE.Color(DARK_GLASS_HEX).toArray())
    const lit = new THREE.Color(LAMP_LIGHT_HEX).multiplyScalar(LAMP_LIGHT_GAIN)
    expect(headColor(1, out).r).toBeCloseTo(lit.r, 12)
    const half = headColor(0.5, out)
    expect(half.r).toBeCloseTo((new THREE.Color(DARK_GLASS_HEX).r + lit.r) / 2, 12)
  })

  it('scales warm light by intensity * brightness', () => {
    const out = new THREE.Color()
    expect(glowColor(0, 0.9, out).toArray()).toEqual([0, 0, 0])
    expect(glowColor(1, 0.9, out).r).toBeCloseTo(new THREE.Color(LAMP_LIGHT_HEX).r * 0.9, 12)
  })
})
