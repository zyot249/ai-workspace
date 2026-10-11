import { expect, test } from '@playwright/test'
import { STREET_NAMES } from '../../app/journey/lamps'
import { REFLECT_LAYER } from '../../app/journey/reflect-layer'
import { WET_ROAD_NAME } from '../../app/journey/wet-road'

const GPU_TEST_TIMEOUT_MS = 120_000
const TYPES = ['sedan', 'suv', 'truck'] as const
// Four lamp meshes, three vehicle bodies, one light mesh.
const STREET_DRAW_CALLS_WITH_VEHICLES = 8

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

for (const [tier, lowPower, perType] of [['full', false, 4], ['lite', true, 2]] as const) {
  test(`${tier}: the real GLBs load, replace the box cars, reflect and cost eight street draw calls`, async ({ page }) => {
    test.setTimeout(GPU_TEST_TIMEOUT_MS)
    const result = await page.evaluate(async ({ tier, lowPower, names, layer, types, wetRoadName }) => {
      window.cityGpu.mountJourney({ tier, lowPower, vehicles: true })
      await window.cityGpu.waitForVehicles()
      const scene = window.cityGpu.getJourneyContext().scene
      type Reflection = { stats: { passes: number } } | undefined
      const reflectionPasses = () =>
        (scene.getObjectByName(wetRoadName)?.userData.wetRoad as Reflection)?.stats.passes ?? null
      // The models show only after their shaders compiled, so drawing them must build no new program.
      const programsBefore = window.cityGpu.journeyState().programs
      const passesBefore = reflectionPasses()
      const frames = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter }))
      const programsAfter = window.cityGpu.journeyState().programs
      const passesAfter = reflectionPasses()
      type Probe = { count: number; layers: { isEnabled(layer: number): boolean } } | undefined
      const bodies = types.map(type => {
        const mesh = scene.getObjectByName(`${names.carBodies}-${type}`) as unknown as Probe
        return mesh ? { type, count: mesh.count, reflects: mesh.layers.isEnabled(layer) } : null
      })
      const box = scene.getObjectByName(names.carBodies)
      const calls = window.cityGpu.streetDrawCalls()
      window.cityGpu.dispose()
      return { frames, bodies, hasBox: Boolean(box), calls, programsBefore, programsAfter, passesBefore, passesAfter }
    }, { tier, lowPower, names: STREET_NAMES, layer: REFLECT_LAYER, types: TYPES, wetRoadName: WET_ROAD_NAME })
    for (const frame of result.frames) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
    }
    expect(result.hasBox).toBe(false)
    expect(result.bodies).toEqual(TYPES.map(type => ({ type, count: perType, reflects: true })))
    expect(result.calls.shaderError).toBeNull()
    expect(result.calls.glError).toBe(0)
    expect(result.calls.calls).toBe(STREET_DRAW_CALLS_WITH_VEHICLES)
    expect(result.programsAfter).toEqual(result.programsBefore)
    if (lowPower) {
      // The direct pipeline has no reflection pass.
      expect(result.passesBefore).toBeNull()
    } else {
      // The reflection pass ran on these frames, so its program variant is covered by the check above too.
      expect(result.passesAfter!).toBeGreaterThan(result.passesBefore!)
    }
  })
}

test('reduced motion creates no cars and starts no model download', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/models/vehicles/')) requests.push(request.url()) })
  await page.evaluate(async () => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: false, vehicles: true })
    await window.cityGpu.waitForVehicles()
    window.cityGpu.dispose()
  })
  expect(requests).toEqual([])
})

test('a missing model keeps the box cars and does not break the scene', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  await page.route('**/models/vehicles/truck.glb', route => route.fulfill({ status: 404, body: 'missing' }))
  const result = await page.evaluate(async ({ names }) => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, vehicles: true })
    await window.cityGpu.waitForVehicles()
    const frame = window.cityGpu.renderJourney({ chapter: 1 })
    const scene = window.cityGpu.getJourneyContext().scene
    const hasBox = Boolean(scene.getObjectByName(names.carBodies))
    window.cityGpu.dispose()
    return { frame, hasBox }
  }, { names: STREET_NAMES })
  expect(result.hasBox).toBe(true)
  expect(result.frame.shaderError).toBeNull()
  expect(result.frame.glError).toBe(0)
})
