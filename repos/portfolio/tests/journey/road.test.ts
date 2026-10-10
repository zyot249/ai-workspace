import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ASPHALT_TILE_UNITS } from '../../app/journey/asphalt'
import { ROAD_MARKING_RENDER_ORDER } from '../../app/journey/contact-shadows'
import { headingFor, roadRects, SIDEWALK_HEIGHT } from '../../app/journey/path'
import { DASH_Y, flatQuadGeometry, createRoad, ROAD_Y, sidewalkGeometry } from '../../app/journey/road'
import { dashPositions } from '../../app/journey/road-layout'

type Shader = Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0]

function fakeShader(): Shader {
  return {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>\n',
    fragmentShader: '#include <common>\n#include <roughnessmap_fragment>\n#include <opaque_fragment>\n#include <dithering_fragment>\n',
  } as unknown as Shader
}

describe('flatQuadGeometry', () => {
  it('lies flat at y, faces up, and bakes world-unit UVs', () => {
    for (const rect of roadRects()) {
      const [minX, minZ, maxX, maxZ] = rect
      const geometry = flatQuadGeometry(rect, ROAD_Y)
      const position = geometry.getAttribute('position')
      const uv = geometry.getAttribute('uv')
      const normal = geometry.getAttribute('normal')
      const us: number[] = [], vs: number[] = []
      for (let i = 0; i < position.count; i++) {
        expect(position.getY(i)).toBe(ROAD_Y)
        expect([normal.getX(i), normal.getY(i), normal.getZ(i)]).toEqual([0, 1, 0])
        expect(uv.getX(i)).toBeCloseTo(position.getX(i) / ASPHALT_TILE_UNITS, 6)
        expect(uv.getY(i)).toBeCloseTo(position.getZ(i) / ASPHALT_TILE_UNITS, 6)
        us.push(uv.getX(i)); vs.push(uv.getY(i))
      }
      expect(Math.max(...us) - Math.min(...us)).toBeCloseTo((maxX - minX) / ASPHALT_TILE_UNITS, 6)
      expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo((maxZ - minZ) / ASPHALT_TILE_UNITS, 6)
    }
  })

  it('winds its triangles counter-clockwise seen from above', () => {
    const geometry = flatQuadGeometry([0, 0, 2, 2], 0)
    const index = geometry.getIndex()!, position = geometry.getAttribute('position')
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(position, index.getX(t + k)))
      expect(new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!)).y).toBeGreaterThan(0)
    }
  })
})

describe('sidewalkGeometry', () => {
  it('spans the curb height and the sidewalk bands, with world-unit UVs', () => {
    const geometry = sidewalkGeometry()
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    expect(box.min.y).toBeCloseTo(ROAD_Y, 6)
    expect(box.max.y).toBeCloseTo(ROAD_Y + SIDEWALK_HEIGHT, 6)
    expect(box.min.x).toBeCloseTo(-29.9, 6)
    expect(box.max.x).toBeCloseTo(3.9, 6)
    expect(box.min.z).toBeCloseTo(-66, 6)
    expect(box.max.z).toBeCloseTo(8, 6)
    const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
    for (let i = 0; i < position.count; i += 7) {
      expect(uv.getX(i)).toBeCloseTo(position.getX(i) / ASPHALT_TILE_UNITS, 6)
      expect(uv.getY(i)).toBeCloseTo(position.getZ(i) / ASPHALT_TILE_UNITS, 6)
    }
  })
})

describe('createRoad', () => {
  const road = createRoad(8)

  it('is three draw calls: one surface, one sidewalk mesh, one dash batch', () => {
    expect(road.group.children).toHaveLength(3)
    expect(road.surface.geometry.getIndex()!.count).toBe(roadRects().length * 6)
    expect(road.dashes.count).toBe(29)
  })

  it('keeps the shared texture at repeat (1, 1) on every map', () => {
    const material = road.surface.material
    expect(material.roughnessMap).toBe(material.bumpMap)
    expect(material.roughnessMap!.repeat.toArray()).toEqual([1, 1])
    expect(road.sidewalks.material.bumpMap).toBe(material.bumpMap)
  })

  it('uses the center-line transparency rules: transparent, after the shadow quads', () => {
    expect(road.dashes.material.transparent).toBe(true)
    expect(road.dashes.material.opacity).toBe(0.55)
    expect(road.dashes.renderOrder).toBe(ROAD_MARKING_RENDER_ORDER)
    expect(road.dashes.frustumCulled).toBe(false)
  })

  it('places each dash at its center, flat at DASH_Y, turned to its leg', () => {
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3()
    dashPositions().forEach((dash, i) => {
      road.dashes.getMatrixAt(i, matrix)
      matrix.decompose(position, quaternion, scale)
      expect(position.x).toBeCloseTo(dash.x, 4)
      expect(position.y).toBeCloseTo(DASH_Y, 4)
      expect(position.z).toBeCloseTo(dash.z, 4)
      const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingFor(dash.dirX, dash.dirZ))
      expect(quaternion.angleTo(expected)).toBeLessThan(1e-5)
    })
  })

  it('converts the sky color from sRGB to linear in update()', () => {
    road.update(0.4, [0.5, 0.5, 0.5])
    expect(road.uniforms.uWetness.value).toBe(0.4)
    expect(road.uniforms.uSkyTint.value.r).toBeCloseTo(0.214, 3)
  })

  it('patches the road shader at its anchors and throws when an anchor is missing', () => {
    const shader = fakeShader()
    road.surface.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
    expect(shader.vertexShader).toContain('varying vec2 vWorldPos;')
    expect(shader.vertexShader).toContain('vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xz;')
    expect(shader.fragmentShader).toContain('float puddleMask(vec2 worldXZ)')
    expect(shader.fragmentShader).toContain('roughnessFactor = mix(roughnessFactor, 0.35, wetAmt);')
    expect(shader.fragmentShader).toMatch(/outgoingLight \+= uSkyTint \* wetFresnel \* wetAmt \* 0\.5;\s*#include <opaque_fragment>/)
    expect(shader.fragmentShader).toContain('ROAD_DEBUG_PUDDLE')
    expect(shader.uniforms).toHaveProperty('uWetness')
    const broken = { uniforms: {}, vertexShader: '#include <common>', fragmentShader: '' } as unknown as Shader
    expect(() => road.surface.material.onBeforeCompile(broken, {} as THREE.WebGLRenderer)).toThrow(/Missing shader marker/)
  })

  it('keys the program cache on the debug define', () => {
    const material = createRoad(1).surface.material
    const plain = material.customProgramCacheKey()
    material.defines = { ROAD_DEBUG_PUDDLE: 1 }
    expect(material.customProgramCacheKey()).not.toBe(plain)
  })
})
