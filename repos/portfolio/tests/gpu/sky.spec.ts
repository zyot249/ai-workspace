import { expect, test } from '@playwright/test'
import type * as THREE from 'three'
import { STARS_NAME } from '../../app/journey/scene'
import { SKY_NAME } from '../../app/journey/sky'
import { GROUND_NAME, HAZE_NAME, RINGS } from '../../app/journey/skyline-far'
import { WAYPOINTS } from '../../app/journey/path'
import { cloudOffsetAt } from '../../app/journey/sky'
import { composeSky, skyGradient, skyLayers, skyParamsFor, sunDirectionFor, toLinear } from '../../app/journey/sky-mirror'
import { GROUND_HALF_SIZE, GROUND_Y, SCENE_CENTER } from '../../app/journey/skyline-far'
import { CHAPTER_IDS, LOOKS, type Vec3 } from '../../app/journey/stops'
import type { SkySamples, SkyViewResult } from './sky-probe'
import { byteLuminance, colorDistance, displayBytes, maxChannelDelta } from './sky-expect'

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

const NIGHT_VIEW: [number, number, number] = [0, .8, -1] // ahead along the last leg (-Z), pitched up

// Spec 05 test 8.
for (const pipeline of PIPELINES) {
  test(`sun glow centres on the sun and vanishes at night: ${pipeline.name}`, async ({ page }) => {
    test.setTimeout(180_000)
    const cases = [
      { theme: 'light', chapter: 1 }, { theme: 'dark', chapter: 1 }, { theme: 'dark', chapter: 3 },
    ] as const
    const results = await page.evaluate(({ mount, names, cases }) => {
      window.cityGpu.sky.mount({ ...mount, width: 320, height: 180 })
      return cases.map(c => {
        window.cityGpu.sky.settle({ theme: c.theme, chapter: c.chapter })
        const sampling = { xStride: 2, yStride: 2, minH: -1, maxH: 1 }
        return {
          glow: window.cityGpu.sky.view({ view: { direction: c.direction }, only: [names.dome], sampling }),
          none: window.cityGpu.sky.view({ view: { direction: c.direction }, only: [names.dome], sampling, domeUniforms: { uSunGlow: 0 } }),
        }
      })
    }, { mount: pipeline.mount, names: NAMES, cases: cases.map(c => ({ ...c, direction: sunView(c.theme, c.chapter) })) })
    for (const [i, { glow, none }] of results.entries()) {
      const night = cases[i]!.chapter === 3
      if (night) {
        expect(worstAgainst(glow.samples, k => rgbAt(none.samples, k)), `case ${i}`).toBeLessThanOrEqual(2)
      } else {
        let best = -1, bestDiff = 0
        for (let k = 0; k < glow.samples.x.length; k++) {
          const diff = byteLuminance(rgbAt(glow.samples, k)) - byteLuminance(rgbAt(none.samples, k))
          if (diff > bestDiff) { bestDiff = diff; best = k }
        }
        expect(bestDiff, `case ${i} glow visible`).toBeGreaterThan(2)
        const d = dirAt(glow.samples, best), s = glow.sunDirection
        const angle = Math.acos(Math.min(1, d[0] * s[0]! + d[1] * s[1]! + d[2] * s[2]!)) * 180 / Math.PI
        expect(angle, `case ${i}`).toBeLessThanOrEqual(25)
      }
      expectClean(glow)
      expectClean(none)
    }
  })
}

// Spec 05 test 9: sorting, haze alpha and stars.
test('buildings occlude the far rings and the haze leaves the city untinted', async ({ page }) => {
  test.setTimeout(240_000)
  const results = await page.evaluate(({ names }) => {
    window.cityGpu.sky.mount({ tier: 'full', lowPower: false, width: 320, height: 180 })
    const out = []
    for (const theme of ['light', 'dark'] as const) for (const chapter of [1, 3]) {
      window.cityGpu.sky.settle({ theme, chapter })
      const sampling = { xStride: 4, yStride: 4, minH: -1, maxH: 1 }
      out.push({
        all: window.cityGpu.sky.view({ sampling, cityMask: true }),
        bare: window.cityGpu.sky.view({ sampling, hide: [names.ringA, names.ringB, names.haze] }),
      })
    }
    return out
  }, { names: NAMES })
  for (const [i, { all, bare }] of results.entries()) {
    let cityPixels = 0, worst = 0
    for (let k = 0; k < all.samples.x.length; k++) {
      if (!all.samples.city[k]) continue
      cityPixels++
      worst = Math.max(worst, maxChannelDelta(rgbAt(all.samples, k), rgbAt(bare.samples, k)))
    }
    expect(cityPixels, `case ${i}`).toBeGreaterThan(50)
    expect(worst, `case ${i}`).toBeLessThanOrEqual(1)
    expectClean(all)
    expectClean(bare)
  }
})

test('haze alpha ramps from 0.85 at the bottom to 0 at the top', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.sky.hazeAlpha())
  expect(Math.abs(r.bottom - .85)).toBeLessThanOrEqual(.03)
  expect(Math.abs(r.middle - .43)).toBeLessThanOrEqual(.03)
  expect(Math.abs(r.top)).toBeLessThanOrEqual(.03)
  expectClean(r)
})

test('stars show above the dome at dark about', async ({ page }) => {
  const r = await page.evaluate(({ names, direction }) => {
    window.cityGpu.sky.mount({ tier: 'full', lowPower: false, width: 320, height: 180 })
    window.cityGpu.sky.settle({ theme: 'dark', chapter: 3 })
    const sampling = { xStride: 1, yStride: 1, minH: .05, maxH: 1 }
    return {
      stars: window.cityGpu.sky.view({ view: { direction }, sampling }),
      none: window.cityGpu.sky.view({ view: { direction }, sampling, hide: [names.stars] }),
    }
  }, { names: NAMES, direction: NIGHT_VIEW })
  let visible = 0
  for (let k = 0; k < r.stars.samples.x.length; k++) {
    if (maxChannelDelta(rgbAt(r.stars.samples, k), rgbAt(r.none.samples, k)) > 8) visible++
  }
  expect(visible).toBeGreaterThan(0)
  expectClean(r.stars)
})

test('both far rings show behind the city at projects and skills', async ({ page }) => {
  test.setTimeout(180_000)
  const results = await page.evaluate(({ names }) => {
    window.cityGpu.sky.mount({ tier: 'full', lowPower: false, width: 320, height: 180 })
    const out = []
    for (const theme of ['light', 'dark'] as const) for (const chapter of [1, 2]) {
      window.cityGpu.sky.settle({ theme, chapter })
      const sampling = { xStride: 2, yStride: 2, minH: -.05, maxH: .6 }
      out.push({
        all: window.cityGpu.sky.view({ sampling }),
        noA: window.cityGpu.sky.view({ sampling, hide: [names.ringA] }),
        noB: window.cityGpu.sky.view({ sampling, hide: [names.ringB] }),
      })
    }
    return out
  }, { names: NAMES })
  for (const [i, { all, noA, noB }] of results.entries()) {
    const changed = (other: SkyViewResult) => all.samples.x.filter((_, k) =>
      maxChannelDelta(rgbAt(all.samples, k), rgbAt(other.samples, k)) > 2).length
    expect(changed(noA), `case ${i} ring A`).toBeGreaterThan(20)
    expect(changed(noB), `case ${i} ring B`).toBeGreaterThan(20)
    expectClean(all)
  }
})

// Spec 05 test 10: shader errors and context restore, both variants.
for (const input of [{ tier: 'full', lowPower: false }, { tier: 'lite', lowPower: true }] as const) {
  test(`sky survives a context restore: ${input.tier}`, async ({ page }) => {
    const r = await page.evaluate(async ({ input, names }) => {
      window.cityGpu.sky.mount({ ...input, width: 320, height: 180 })
      window.cityGpu.sky.settle({ theme: 'dark', chapter: 1 })
      const sampling = { xStride: 4, yStride: 4, minH: -1, maxH: 1 }
      const before = window.cityGpu.sky.view({ only: [names.dome, names.haze], sampling })
      await window.cityGpu.loseAndRestore()
      window.cityGpu.resizeJourney(320, 180)
      window.cityGpu.sky.settle({ theme: 'dark', chapter: 1 })
      const after = window.cityGpu.sky.view({ only: [names.dome, names.haze], sampling })
      return { before, after }
    }, { input, names: NAMES })
    expect(r.after.samples.x.length).toBe(r.before.samples.x.length)
    expect(worstAgainst(r.after.samples, k => rgbAt(r.before.samples, k))).toBeLessThanOrEqual(2)
    expectClean(r.before)
    expectClean(r.after)
  })
}

// Spec 09 test 12, as decided on 2026-10-09: the GPU must match the mirror's
// cloud pixels. The gap from cloudCover is recorded, not asserted.
for (const pipeline of PIPELINES) {
  test(`cloud pixels match the mirror in every light chapter: ${pipeline.name}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000)
    const results = await page.evaluate(({ mount, names }) => {
      window.cityGpu.sky.mount({ ...mount, width: 320, height: 180 })
      return [0, 1, 2, 3].map(chapter => {
        window.cityGpu.sky.settle({ theme: 'light', chapter })
        const sampling = { xStride: 2, yStride: 2, minH: .15, maxH: 1 }
        return {
          sky: window.cityGpu.sky.view({ only: [names.dome], sampling }),
          clear: window.cityGpu.sky.view({ only: [names.dome], sampling, domeUniforms: { uCloudCover: 0 } }),
        }
      })
    }, { mount: pipeline.mount, names: NAMES })
    for (const [chapter, { sky, clear }] of results.entries()) {
      const params = paramsOf(sky)
      const n = sky.samples.x.length
      expect(n, `chapter ${chapter}`).toBeGreaterThan(500)
      let gpuClouds = 0, mirrorClouds = 0, worstClear = 0
      for (let k = 0; k < n; k++) {
        const layers = skyLayers(dirAt(sky.samples, k), params, sky.variant)
        const cloudy = displayBytes(composeSky(layers, 1), sky.exposure)
        const mirrorClear = displayBytes(composeSky(layers, 0), sky.exposure)
        const mirror = displayBytes(composeSky(layers), sky.exposure)
        const gpu = rgbAt(sky.samples, k), gpuClear = rgbAt(clear.samples, k)
        worstClear = Math.max(worstClear, maxChannelDelta(gpuClear, mirrorClear))
        if (colorDistance(gpu, cloudy) < colorDistance(gpu, gpuClear)) gpuClouds++
        if (colorDistance(mirror, cloudy) < colorDistance(mirror, mirrorClear)) mirrorClouds++
      }
      testInfo.annotations.push({ type: 'cloud-cover',
        description: `${pipeline.name} ${CHAPTER_IDS[chapter]}: on screen ${(gpuClouds / n).toFixed(3)}, cloudCover ${sky.state.cloudCover}` })
      expect(worstClear, `chapter ${chapter} clear sky`).toBeLessThanOrEqual(3)
      expect(Math.abs(gpuClouds - mirrorClouds) / n, `chapter ${chapter} clouds`).toBeLessThanOrEqual(.03)
      expectClean(sky)
      expectClean(clear)
    }
  })
}

// Spec 09 test 16: night clouds stay faint over the clear sky.
for (const pipeline of PIPELINES) {
  test(`night clouds stay within 8/255 at dark about: ${pipeline.name}`, async ({ page }) => {
    const r = await page.evaluate(({ mount, names, direction }) => {
      window.cityGpu.sky.mount({ ...mount, width: 320, height: 180 })
      window.cityGpu.sky.settle({ theme: 'dark', chapter: 3 })
      const sampling = { xStride: 2, yStride: 2, minH: .02, maxH: 1 }
      return {
        sky: window.cityGpu.sky.view({ view: { direction }, only: [names.dome], sampling }),
        clear: window.cityGpu.sky.view({ view: { direction }, only: [names.dome], sampling, domeUniforms: { uCloudCover: 0 } }),
      }
    }, { mount: pipeline.mount, names: NAMES, direction: NIGHT_VIEW })
    expect(r.sky.samples.x.length).toBeGreaterThan(1000)
    expect(worstAgainst(r.sky.samples, k => rgbAt(r.clear.samples, k))).toBeLessThanOrEqual(8)
    expectClean(r.sky)
  })
}
