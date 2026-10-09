import { expect, test } from '@playwright/test'
import type * as THREE from 'three'
import { STARS_NAME } from '../../app/journey/scene'
import { SKY_NAME } from '../../app/journey/sky'
import { GROUND_NAME, HAZE_NAME, RINGS } from '../../app/journey/skyline-far'

const NAMES = { dome: SKY_NAME, haze: HAZE_NAME, ground: GROUND_NAME, ringA: RINGS.a.name, ringB: RINGS.b.name, stars: STARS_NAME }
const COMBINATIONS = [
  { tier: 'full', lowPower: false }, { tier: 'lite', lowPower: true },
  { tier: 'reduced', lowPower: false }, { tier: 'reduced', lowPower: true },
] as const

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})
test.afterEach(async ({ page }) => { await page.evaluate(() => window.cityGpu.dispose()) })

for (const input of COMBINATIONS) {
  test(`backdrop is wired ${input.tier}/${input.lowPower}`, async ({ page }) => {
    const r = await page.evaluate(({ input, names }) => {
      window.cityGpu.mountJourney({ ...input, width: 320, height: 180 })
      const d = window.cityGpu.renderJourney({ chapter: 1, frames: 2 })
      const { scene, camera } = window.cityGpu.getJourneyContext()
      const dome = scene.getObjectByName(names.dome) as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | undefined
      const haze = scene.getObjectByName(names.haze)
      const rings = [names.ringA, names.ringB].map(name => scene.getObjectByName(name) as THREE.InstancedMesh | undefined)
      const ground = scene.getObjectByName(names.ground) as THREE.Mesh<THREE.PlaneGeometry> | undefined
      const stars = scene.getObjectByName(names.stars)
      return {
        d, far: camera.far, camera: camera.position.toArray(),
        dome: dome ? {
          order: dome.renderOrder, culled: dome.frustumCulled, depthWrite: dome.material.depthWrite,
          side: dome.material.side, key: dome.material.customProgramCacheKey(),
          segments: dome.geometry.parameters.widthSegments, position: dome.position.toArray(),
        } : null,
        hazeOrder: haze?.renderOrder ?? null,
        rings: rings.map(ring => ring?.count ?? null),
        groundSize: ground?.geometry.parameters.width ?? null,
        starsOrder: stars?.renderOrder ?? null,
        background: (scene.background as THREE.Color).toArray(),
        fog: (scene.fog as THREE.FogExp2).color.toArray(),
      }
    }, { input, names: NAMES })
    expect(r.far).toBe(260)
    expect(r.dome).toEqual({ order: -1000, culled: false, depthWrite: false, side: 1,
      key: input.lowPower ? 'sky-lite' : 'sky-full', segments: input.lowPower ? 24 : 32, position: r.camera })
    expect(r.hazeOrder).toBe(-900)
    expect(r.rings).toEqual(input.lowPower ? [36, 20] : [36, 36])
    expect(r.groundSize).toBe(260)
    expect(r.starsOrder).toBe(input.lowPower ? null : -999)
    expect(r.background).toEqual(r.fog)
    expect(r.d.shaderError).toBeNull()
    expect(r.d.glError).toBe(0)
  })
}
