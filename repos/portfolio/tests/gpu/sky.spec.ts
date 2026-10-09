import { expect, test } from '@playwright/test'
import type * as THREE from 'three'
import { STARS_NAME } from '../../app/journey/scene'
import { SKY_NAME } from '../../app/journey/sky'
import { GROUND_NAME, HAZE_NAME, RINGS } from '../../app/journey/skyline-far'
import { WAYPOINTS } from '../../app/journey/path'
import { cloudOffsetAt } from '../../app/journey/sky'
import { skyGradient, skyParamsFor, sunDirectionFor, toLinear } from '../../app/journey/sky-mirror'
import { GROUND_HALF_SIZE, GROUND_Y, SCENE_CENTER } from '../../app/journey/skyline-far'
import { CHAPTER_IDS, LOOKS, type Vec3 } from '../../app/journey/stops'
import type { SkySamples, SkyViewResult } from './sky-probe'
import { byteLuminance, displayBytes, maxChannelDelta } from './sky-expect'

const NAMES = { dome: SKY_NAME, haze: HAZE_NAME, ground: GROUND_NAME, ringA: RINGS.a.name, ringB: RINGS.b.name, stars: STARS_NAME }
const COMBINATIONS = [
  { tier: 'full', lowPower: false }, { tier: 'lite', lowPower: true },
  { tier: 'reduced', lowPower: false }, { tier: 'reduced', lowPower: true },
] as const

const PIPELINES = [
  { name: 'composer', mount: { tier: 'full', lowPower: false } },
  { name: 'direct', mount: { tier: 'lite', lowPower: true } },
] as const
const rgbAt = (s: SkySamples, k: number) => s.rgb.slice(k * 3, k * 3 + 3)
const dirAt = (s: SkySamples, k: number): Vec3 => [s.dir[k * 3]!, s.dir[k * 3 + 1]!, s.dir[k * 3 + 2]!]
const fogBytes = (r: SkyViewResult) => displayBytes(toLinear(r.state.fogColor), r.exposure)
const paramsOf = (r: SkyViewResult) => skyParamsFor(r.state, cloudOffsetAt(r.time, r.reduced))
const expectedSky = (r: SkyViewResult, dir: Vec3) => displayBytes(skyGradient(dir, paramsOf(r), r.variant), r.exposure)
function expectClean(r: { shaderError: string | null; glError: number }) {
  expect(r.shaderError).toBeNull()
  expect(r.glError).toBe(0)
}
function worstAgainst(s: SkySamples, expected: (k: number) => readonly number[]): number {
  let worst = 0
  for (let k = 0; k < s.x.length; k++) worst = Math.max(worst, maxChannelDelta(rgbAt(s, k), expected(k)))
  return worst
}
function sunView(theme: 'light' | 'dark', chapter: number): [number, number, number] {
  const look = LOOKS[theme][CHAPTER_IDS[chapter]!]
  // Keep the camera above the horizon for a set sun; the glow sits just above it.
  const d = sunDirectionFor(Math.max(look.sunElevation, 5), look.sunAzimuth)
  return [d[0], d[1], d[2]]
}

const TURN_PROGRESS = [.3, .4, .5, .6, .7]
const HORIZON_VIEWS = [
  ...CHAPTER_IDS.map((_, chapter) => ({ chapter, progress: 0 })),
  ...[1, 2].flatMap(chapter => TURN_PROGRESS.map(progress => ({ chapter, progress }))),
]
const HORIZON_SAMPLING = { xStride: 16, yStride: 1, minH: -0.03, maxH: 0.01 }
const FULL_FOG_DISTANCE = 80

// Samples whose ray lands on the ground plane at least 80 units deep in view space.
// Three.js FogExp2 uses -mvPosition.z, not radial camera-to-surface distance.
function farGround(r: SkyViewResult): number[][] {
  const out: number[][] = []
  const [cx, cy, cz] = r.cameraPosition as [number, number, number]
  for (let k = 0; k < r.samples.x.length; k++) {
    const d = dirAt(r.samples, k)
    if (d[1] >= 0) continue
    const t = (GROUND_Y - cy) / d[1]
    const x = cx + d[0] * t, z = cz + d[2] * t
    const onGround = Math.abs(x - SCENE_CENTER.x) <= GROUND_HALF_SIZE && Math.abs(z - SCENE_CENTER.z) <= GROUND_HALF_SIZE
    const [fx, fy, fz] = r.cameraForward as [number, number, number]
    const viewDepth = t * (d[0] * fx + d[1] * fy + d[2] * fz)
    if (onGround && viewDepth >= FULL_FOG_DISTANCE) out.push(rgbAt(r.samples, k))
  }
  return out
}
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

// Spec 05 test 6 and spec 09 test 13.
for (const pipeline of PIPELINES) for (const theme of ['light', 'dark', 'mid'] as const) {
  test(`horizon row equals fully fogged ground: ${pipeline.name} ${theme}`, async ({ page }) => {
    test.setTimeout(300_000)
    const views = await page.evaluate(({ mount, theme, views, names, sampling }) => {
      window.cityGpu.sky.mount({ ...mount, width: 640, height: 360 })
      return views.map(v => {
        window.cityGpu.sky.settle({ theme, ...v })
        return {
          sky: window.cityGpu.sky.view({ only: [names.dome, names.haze], sampling }),
          ground: window.cityGpu.sky.view({ only: [names.dome, names.haze, names.ground], sampling }),
        }
      })
    }, { mount: pipeline.mount, theme, views: HORIZON_VIEWS, names: NAMES, sampling: HORIZON_SAMPLING })
    let groundHits = 0
    for (const [i, { sky, ground }] of views.entries()) {
      const fog = fogBytes(sky)
      expect(sky.samples.x.length, `view ${i}`).toBeGreaterThan(0)
      expect(worstAgainst(sky.samples, () => fog), `view ${i} sky`).toBeLessThanOrEqual(2)
      const far = farGround(ground)
      groundHits += far.length
      for (const rgb of far) expect(maxChannelDelta(rgb, fog), `view ${i} ground`).toBeLessThanOrEqual(2)
      expectClean(sky)
      expectClean(ground)
    }
    expect(groundHits).toBeGreaterThan(0)
  })
}

// Spec 05 test 6a. The haze and rings are hidden: the haze tints the sky at a
// wall top's height on purpose, and ring B stands behind it.
for (const pipeline of PIPELINES) {
  test(`fogged building tops silhouette against the expected sky: ${pipeline.name}`, async ({ page }) => {
    test.setTimeout(300_000)
    const results = await page.evaluate(({ mount, names }) => {
      window.cityGpu.sky.mount({ ...mount, width: 640, height: 360 })
      const out = []
      for (const theme of ['light', 'dark'] as const) for (let chapter = 0; chapter < 4; chapter++) {
        window.cityGpu.sky.settle({ theme, chapter })
        out.push(window.cityGpu.sky.view({ only: [names.dome, names.ground], wall: { distance: 60, height: 7 } }))
      }
      return out
    }, { mount: pipeline.mount, names: NAMES })
    for (const [i, r] of results.entries()) {
      expect(r.wall, `case ${i}`).not.toBeNull()
      expect(maxChannelDelta(r.wall!.sky, expectedSky(r, r.wall!.skyDir as unknown as Vec3)), `case ${i} sky`).toBeLessThanOrEqual(3)
      expect(maxChannelDelta(r.wall!.top, fogBytes(r)), `case ${i} top`).toBeLessThanOrEqual(3)
      expectClean(r)
    }
  })
}

// Spec 05 test 6b and spec 09 test 15.
for (const theme of ['light', 'dark'] as const) {
  test(`sky never blooms looking at the sun: ${theme} projects`, async ({ page }) => {
    const r = await page.evaluate(({ names, direction, theme }) => {
      window.cityGpu.sky.mount({ tier: 'full', lowPower: false, width: 320, height: 180 })
      window.cityGpu.sky.settle({ theme, chapter: 1 })
      const sampling = { xStride: 2, yStride: 2, minH: 0, maxH: 1 }
      const only = [names.dome, names.haze, names.ground]
      return {
        on: window.cityGpu.sky.view({ view: { direction }, only, bloom: .5, sampling }),
        off: window.cityGpu.sky.view({ view: { direction }, only, bloom: 0, sampling }),
      }
    }, { names: NAMES, direction: sunView(theme, 1), theme })
    expect(r.on.pipeline).toBe('composer')
    expect(r.on.samples.x.length).toBeGreaterThan(1000)
    expect(worstAgainst(r.on.samples, k => rgbAt(r.off.samples, k))).toBeLessThanOrEqual(2)
    expectClean(r.on)
    expectClean(r.off)
  })
}

// Spec 05 test 7, landscape and portrait. The camera stands at its lowest
// height at every waypoint and looks at each ground edge.
const EDGE_DIRECTIONS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
const EDGE_CAMERA_Y = 0.2
for (const pipeline of PIPELINES) for (const theme of ['light', 'dark'] as const) {
  test(`ground edge never shows a step: ${pipeline.name} ${theme}`, async ({ page }) => {
    test.setTimeout(240_000)
    const results = await page.evaluate(({ mount, theme, names, positions, directions }) => {
      const out = []
      for (const [width, height] of [[640, 360], [360, 640]] as const) {
        window.cityGpu.sky.mount({ ...mount, width, height })
        window.cityGpu.sky.settle({ theme, chapter: 0 })
        for (const position of positions) for (const direction of directions) {
          out.push(window.cityGpu.sky.view({ view: { position, direction }, only: [names.dome, names.haze, names.ground],
            sampling: { xStride: 1, yStride: 1, minH: -0.015, maxH: 0.01, column: Math.floor(width / 2) } }))
        }
      }
      return out
    }, { mount: pipeline.mount, theme, names: NAMES, directions: EDGE_DIRECTIONS,
      positions: WAYPOINTS.map(w => [w.x, EDGE_CAMERA_Y, w.z] as [number, number, number]) })
    let worstStep = 0
    for (const r of results) {
      expect(r.samples.x.length).toBeGreaterThan(1)
      for (let k = 1; k < r.samples.x.length; k++) {
        worstStep = Math.max(worstStep, Math.abs(byteLuminance(rgbAt(r.samples, k)) - byteLuminance(rgbAt(r.samples, k - 1))))
      }
      expectClean(r)
    }
    expect(worstStep).toBeLessThanOrEqual(3)
  })
}
