import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { glslFloat } from '../../app/journey/shader-utils'
import { CAMERA_FAR, SKY_NAME, SKY_RADIUS, cloudOffsetAt, createSky, lightFromStop } from '../../app/journey/sky'
import {
  CLOUD_SCALE, CLOUD_TIME_WRAP, CLOUD_WIND, COVER_THRESHOLDS, SKY_MAX_LUMINANCE, sunDirectionFor,
  sunVisibilityFor, toLinear,
} from '../../app/journey/sky-mirror'
import { LOOKS, PATH_STOPS } from '../../app/journey/stops'

const darkAbout = { ...PATH_STOPS.about, ...LOOKS.dark.about }

describe('sun light', () => {
  it('keeps a moonlight floor from above while the sun direction stays unclamped', () => {
    const light = lightFromStop(LOOKS.dark.about)
    expect(light.intensity).toBe(.25)
    expect(light.position[1]).toBeGreaterThanOrEqual(2)
    const direction = sunDirectionFor(-22, 10)
    expect(direction[1]).toBeLessThan(0)
    // Moonlight does not feed the rim or the glow.
    expect(sunVisibilityFor(direction[1])).toBe(0)
  })

  it('gives full light to a high sun and places it along the sun direction', () => {
    const light = lightFromStop(LOOKS.light.skills)
    expect(light.intensity).toBe(1)
    sunDirectionFor(55, -10).forEach((v, i) => expect(light.position[i]).toBeCloseTo(v * 10, 12))
  })

  it('uses the floor and the height clamp just after sunset', () => {
    const light = lightFromStop(LOOKS.dark.projects)
    expect(light.intensity).toBe(.25)
    expect(light.position[1]).toBe(2)
  })
})

describe('cloud drift', () => {
  it('stays still on the reduced tier', () => {
    for (const t of [0, 5, 1e6]) expect(cloudOffsetAt(t, true)).toEqual([0, 0])
  })

  it('moves continuously within an hour and wraps once an hour', () => {
    const a = cloudOffsetAt(100, false), b = cloudOffsetAt(100 + 1 / 60, false)
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThan(1e-3)
    expect(cloudOffsetAt(CLOUD_TIME_WRAP, false)).toEqual([0, 0])
  })

  it('stays finite and bounded in a long session', () => {
    const limit = Math.hypot(CLOUD_WIND[0], CLOUD_WIND[1]) * CLOUD_TIME_WRAP
    for (const t of [0, 1799.5, 3599.9, 1e7, Number.NaN]) {
      const [x, y] = cloudOffsetAt(t, false)
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
      expect(Math.hypot(x, y)).toBeLessThan(limit)
    }
  })
})

describe('dome', () => {
  it.each(['full', 'lite'] as const)('builds the %s program and mesh', variant => {
    const sky = createSky(variant, false)
    const m = sky.mesh.material
    expect(m.customProgramCacheKey()).toBe(`sky-${variant}`)
    expect(m.name).toBe('journey-sky')
    expect(sky.mesh.geometry.parameters).toMatchObject(variant === 'full'
      ? { radius: SKY_RADIUS, widthSegments: 32, heightSegments: 16 }
      : { radius: SKY_RADIUS, widthSegments: 24, heightSegments: 12 })
    expect(SKY_RADIUS).toBeLessThan(CAMERA_FAR)
    expect(m.side).toBe(THREE.BackSide)
    expect(m.depthWrite).toBe(false)
    expect(m.fog).toBe(false)
    expect(m.transparent).toBe(false)
    expect(sky.mesh.name).toBe(SKY_NAME)
    expect(sky.mesh.renderOrder).toBe(-1000)
    expect(sky.mesh.frustumCulled).toBe(false)
    const source = m.fragmentShader
    expect(source.startsWith('precision highp float;')).toBe(true)
    expect(source).toContain(`#define CLOUD_OCTAVES ${variant === 'full' ? 4 : 2}`)
    expect(source).toContain(`#define CLOUD_SELF_SHADOW ${variant === 'full' ? 1 : 0}`)
    expect(source).toContain(`#define SKY_MAX_LUMINANCE ${glslFloat(SKY_MAX_LUMINANCE)}`)
    expect(source).toContain(`#define CLOUD_SCALE ${glslFloat(CLOUD_SCALE)}`)
    for (const threshold of COVER_THRESHOLDS[variant]) expect(source).toContain(glslFloat(threshold))
    // GLSL pow() is undefined for a negative base; the band uses x * x.
    expect(source).not.toMatch(/pow\(\s*\(h/)
    expect(source.indexOf('#include <tonemapping_fragment>')).toBeGreaterThan(source.indexOf('SKY_MAX_LUMINANCE / max('))
    expect(source.indexOf('#include <colorspace_fragment>')).toBeGreaterThan(source.indexOf('#include <tonemapping_fragment>'))
  })

  it('feeds authored linear colours, follows the camera and exposes the sun', () => {
    const sky = createSky('full', false)
    const camera = new THREE.Vector3(3, .5, -20)
    sky.update(darkAbout, camera, 10)
    const u = sky.mesh.material.uniforms
    expect(u.uHorizon!.value.toArray()).toEqual([...toLinear(darkAbout.fogColor)])
    expect(u.uMid!.value.toArray()).toEqual([...toLinear(darkAbout.skyColor)])
    expect(u.uZenith!.value.toArray()).toEqual([...toLinear(darkAbout.skyZenith)])
    expect(u.uSunColor!.value.toArray()).toEqual([...toLinear(darkAbout.sunColor)])
    expect(u.uCloudLit!.value.toArray()).toEqual([...toLinear(darkAbout.cloudLitColor)])
    expect(u.uCloudShade!.value.toArray()).toEqual([...toLinear(darkAbout.cloudShadeColor)])
    expect(u.uSunGlow!.value).toBe(darkAbout.sunGlow)
    expect(u.uCloudCover!.value).toBe(darkAbout.cloudCover)
    expect(u.uCloudOffset!.value.toArray()).toEqual([...cloudOffsetAt(10, false)])
    expect(sky.mesh.position.toArray()).toEqual([3, .5, -20])
    expect(sky.sunDirection.toArray()).toEqual([...sunDirectionFor(-22, 10)])
    expect(sky.sunVisibility).toBe(0)
  })

  it('holds the clouds still on the reduced tier', () => {
    const sky = createSky('lite', true)
    sky.update(darkAbout, new THREE.Vector3(), 500)
    expect(sky.mesh.material.uniforms.uCloudOffset!.value.toArray()).toEqual([0, 0])
  })
})
