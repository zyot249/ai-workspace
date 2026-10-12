// tests/gpu/people.spec.ts
import { expect, test } from '@playwright/test'
import { hallFrameSlots } from '../../app/journey/hall'
import { peopleLayout, layoutPeopleCount } from '../../app/journey/people-layout'
import { MAX_PEOPLE, PEOPLE_COUNTS, PEOPLE_GROUP_NAME } from '../../app/journey/people-specs'
import { REFLECT_LAYER } from '../../app/journey/reflect-layer'
import { WET_ROAD_NAME } from '../../app/journey/wet-road'

const GPU_TEST_TIMEOUT_MS = 120_000
// The GPU harness mounts one exhibit, so the hall has one frame and one guide.
const HARNESS_FRAMES = hallFrameSlots(1)

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

for (const [tier, lowPower] of [['full', false], ['lite', true]] as const) {
  test(`${tier}: the real GLBs load, show one skinned mesh per person, stay out of the reflection, and build no new program`, async ({ page }) => {
    test.setTimeout(GPU_TEST_TIMEOUT_MS)
    const expected = layoutPeopleCount(peopleLayout(PEOPLE_COUNTS[tier], HARNESS_FRAMES))
    const result = await page.evaluate(async ({ tier, lowPower, groupName, layer, wetRoadName }) => {
      window.cityGpu.mountJourney({ tier, lowPower, people: true })
      await window.cityGpu.waitForPeople()
      const scene = window.cityGpu.getJourneyContext().scene
      const programsBefore = window.cityGpu.journeyState().programs
      const frames = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter, time: 2 + chapter }))
      const programsAfter = window.cityGpu.journeyState().programs
      type Probe = { isSkinnedMesh?: boolean; layers: { isEnabled(layer: number): boolean }; visible: boolean }
      const meshes: Probe[] = []
      scene.getObjectByName(groupName)?.traverse(object => { if ((object as unknown as Probe).isSkinnedMesh) meshes.push(object as unknown as Probe) })
      const passes = (scene.getObjectByName(wetRoadName)?.userData.wetRoad as { stats: { passes: number } } | undefined)?.stats.passes ?? null
      window.cityGpu.dispose()
      return {
        frames, programsBefore, programsAfter, passes,
        meshCount: meshes.length,
        reflected: meshes.filter(mesh => mesh.layers.isEnabled(layer)).length,
      }
    }, { tier, lowPower, groupName: PEOPLE_GROUP_NAME, layer: REFLECT_LAYER, wetRoadName: WET_ROAD_NAME })
    for (const frame of result.frames) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
    }
    expect(result.meshCount).toBe(expected)
    expect(result.meshCount).toBeLessThanOrEqual(MAX_PEOPLE)
    expect(result.reflected).toBe(0)
    expect(result.programsAfter).toEqual(result.programsBefore)
    if (!lowPower) expect(result.passes).not.toBeNull()
  })
}

test('reduced motion creates no people and starts no model download', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/models/people/')) requests.push(request.url()) })
  await page.evaluate(async () => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: false, people: true })
    await window.cityGpu.waitForPeople()
    window.cityGpu.dispose()
  })
  expect(requests).toEqual([])
})

test('a missing model leaves the street empty and does not break the scene', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  await page.route('**/models/people/hoodie.glb', route => route.fulfill({ status: 404, body: 'missing' }))
  const result = await page.evaluate(async ({ groupName }) => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, people: true })
    await window.cityGpu.waitForPeople()
    const frame = window.cityGpu.renderJourney({ chapter: 1 })
    const children = window.cityGpu.getJourneyContext().scene.getObjectByName(groupName)?.children.length ?? -1
    window.cityGpu.dispose()
    return { frame, children }
  }, { groupName: PEOPLE_GROUP_NAME })
  expect(result.children).toBe(0)
  expect(result.frame.shaderError).toBeNull()
  expect(result.frame.glError).toBe(0)
})
