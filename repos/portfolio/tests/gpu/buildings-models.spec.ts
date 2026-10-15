// tests/gpu/buildings-models.spec.ts
import { expect, test } from '@playwright/test'
import { MAX_SET_PIECE_DRAW_CALLS, SCENERY_GROUP_NAME } from '../../app/journey/building-specs'
import { PASS_DRAW_CALL_BUDGET, WET_ROAD_NAME } from '../../app/journey/wet-road'

const GPU_TEST_TIMEOUT_MS = 120_000

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

for (const [tier, lowPower] of [['full', false], ['lite', true], ['reduced', false]] as const) {
  test(`${tier}: the real GLBs load, show four set-piece groups within ${MAX_SET_PIECE_DRAW_CALLS} draw calls and build no new program`, async ({ page }) => {
    test.setTimeout(GPU_TEST_TIMEOUT_MS)
    const result = await page.evaluate(async ({ tier, lowPower, group, wetRoadName }) => {
      window.cityGpu.mountJourney({ tier, lowPower, buildings: true })
      await window.cityGpu.waitForBuildings()
      const scene = window.cityGpu.getJourneyContext().scene
      const programsBefore = window.cityGpu.journeyState().programs
      const frames = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter }))
      const programsAfter = window.cityGpu.journeyState().programs
      type Probe = { isMesh?: boolean; visible: boolean }
      const setPieceGroup = scene.getObjectByName(group + '-set-pieces')
      const meshes: Probe[] = []
      setPieceGroup?.traverse(object => { if ((object as unknown as Probe).isMesh) meshes.push(object as unknown as Probe) })
      const passes = (scene.getObjectByName(wetRoadName)?.userData.wetRoad as { stats: { passes: number; lastDrawCalls: number } } | undefined)?.stats
      const result = {
        frames, programsBefore, programsAfter, passes,
        groupVisible: setPieceGroup?.visible ?? false,
        childCount: setPieceGroup?.children.length ?? 0,
        meshCount: meshes.length,
      }
      window.cityGpu.dispose()
      return result
    }, { tier, lowPower, group: SCENERY_GROUP_NAME, wetRoadName: WET_ROAD_NAME })
    for (const frame of result.frames) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
    }
    expect(result.groupVisible).toBe(true)
    expect(result.childCount).toBe(4)
    expect(result.meshCount).toBeGreaterThan(0)
    expect(result.meshCount).toBeLessThanOrEqual(MAX_SET_PIECE_DRAW_CALLS)
    expect(result.programsAfter).toEqual(result.programsBefore)
    if (!lowPower && tier !== 'reduced') expect(result.passes!.lastDrawCalls).toBeLessThanOrEqual(PASS_DRAW_CALL_BUDGET)
  })
}

test('a missing set-piece model keeps the primitives and does not break the scene', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  await page.route('**/models/buildings/house.glb', route => route.fulfill({ status: 404, body: 'missing' }))
  const result = await page.evaluate(async ({ group }) => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, buildings: true })
    await window.cityGpu.waitForBuildings()
    const frame = window.cityGpu.renderJourney({ chapter: 1 })
    const scene = window.cityGpu.getJourneyContext().scene
    const setPieceGroup = scene.getObjectByName(group + '-set-pieces')
    const result = { frame, childCount: setPieceGroup?.children.length ?? -1 }
    window.cityGpu.dispose()
    return result
  }, { group: SCENERY_GROUP_NAME })
  expect(result.childCount).toBe(0)
  expect(result.frame.shaderError).toBeNull()
  expect(result.frame.glError).toBe(0)
})
