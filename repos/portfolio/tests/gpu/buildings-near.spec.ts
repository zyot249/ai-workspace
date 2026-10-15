// tests/gpu/buildings-near.spec.ts
import { expect, test } from '@playwright/test'
import { MAX_NEAR_MESHES, NEAR_MESH_PREFIX } from '../../app/journey/building-specs'
import { REFLECT_LAYER } from '../../app/journey/reflect-layer'
import { PASS_DRAW_CALL_BUDGET, WET_ROAD_NAME } from '../../app/journey/wet-road'

const GPU_TEST_TIMEOUT_MS = 120_000
// Full has 24 near buildings. Lite scales that by 0.6 and rounds: 14.
const NEAR_COUNT = { full: 24, lite: 14, reduced: 24 } as const

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

for (const [tier, lowPower] of [['full', false], ['lite', true], ['reduced', false]] as const) {
  test(`${tier}: the near layer shows at most ${MAX_NEAR_MESHES} instanced meshes covering every building, hides the near boxes, and reflects`, async ({ page }) => {
    test.setTimeout(GPU_TEST_TIMEOUT_MS)
    const result = await page.evaluate(async ({ tier, lowPower, prefix, layer }) => {
      window.cityGpu.mountJourney({ tier, lowPower, buildings: true })
      await window.cityGpu.waitForBuildings()
      const scene = window.cityGpu.getJourneyContext().scene
      const frames = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter }))
      type Probe = { isInstancedMesh?: boolean; count: number; visible: boolean; name: string; layers: { isEnabled(layer: number): boolean } }
      const near: Probe[] = []
      scene.traverse(object => {
        const probe = object as unknown as Probe
        if (probe.isInstancedMesh && probe.name.startsWith(prefix)) near.push(probe)
      })
      const nearBox = scene.getObjectByName('journey-building-near') as unknown as Probe | undefined
      const result = {
        frames, meshes: near.length, total: near.reduce((sum, mesh) => sum + mesh.count, 0),
        reflected: near.filter(mesh => mesh.layers.isEnabled(layer)).length, boxVisible: nearBox?.visible ?? null,
      }
      window.cityGpu.dispose()
      return result
    }, { tier, lowPower, prefix: NEAR_MESH_PREFIX, layer: REFLECT_LAYER })
    for (const frame of result.frames) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
    }
    expect(result.meshes).toBeGreaterThan(0)
    expect(result.meshes).toBeLessThanOrEqual(MAX_NEAR_MESHES)
    expect(result.boxVisible).toBe(false)
    expect(result.reflected).toBe(result.meshes)
    // Every building appears once per material, so the total is a whole multiple of the layer size.
    expect(result.total % NEAR_COUNT[tier]).toBe(0)
  })
}

test('the near boxes stay visible until the models load', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  const result = await page.evaluate(async () => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false })
    const scene = window.cityGpu.getJourneyContext().scene
    const frame = window.cityGpu.renderJourney({ chapter: 1 })
    const nearBox = scene.getObjectByName('journey-building-near')
    const visible = nearBox?.visible ?? null
    window.cityGpu.dispose()
    return { frame, visible }
  })
  expect(result.visible).toBe(true)
  expect(result.frame.shaderError).toBeNull()
})

test('with the near GLBs the wet-road pass stays within its draw-call budget', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  const result = await page.evaluate(async ({ wetRoadName }) => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, buildings: true, vehicles: true, people: true })
    await window.cityGpu.waitForBuildings()
    await window.cityGpu.waitForVehicles()
    window.cityGpu.renderJourney({ chapter: 2 })
    const scene = window.cityGpu.getJourneyContext().scene
    const stats = (scene.getObjectByName(wetRoadName)?.userData.wetRoad as { stats: { lastDrawCalls: number } } | undefined)?.stats
    window.cityGpu.dispose()
    return stats?.lastDrawCalls ?? null
  }, { wetRoadName: WET_ROAD_NAME })
  expect(result).not.toBeNull()
  expect(result!).toBeLessThanOrEqual(PASS_DRAW_CALL_BUDGET)
})
