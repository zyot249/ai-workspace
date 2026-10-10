import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

test('the shader puddle mask agrees with puddleMaskAt on a 20 x 20 grid over the road', async ({ page }) => {
  const result = await page.evaluate(() => window.cityGpu.road.probeMask())
  expect(result.shaderError).toBeNull()
  expect(result.glError).toBe(0)
  expect(result.samples.length).toBeGreaterThan(40)
  for (const sample of result.samples) expect(Math.abs(sample.gpu - sample.cpu)).toBeLessThan(0.02)
  // The check is only meaningful if the grid sees both puddle and dry asphalt.
  expect(result.samples.some(s => s.cpu > 0.9)).toBe(true)
  expect(result.samples.some(s => s.cpu < 0.1)).toBe(true)
})

test('wet sheen grows toward grazing angles and is absent when dry', async ({ page }) => {
  const grazing = await page.evaluate(() => window.cityGpu.road.probeSheen({ cameraY: 0.5, distance: 8, wetness: 0.7 }))
  const steep = await page.evaluate(() => window.cityGpu.road.probeSheen({ cameraY: 14, distance: 1, wetness: 0.7 }))
  const dry = await page.evaluate(() => window.cityGpu.road.probeSheen({ cameraY: 0.5, distance: 8, wetness: 0 }))
  for (const result of [grazing, steep, dry]) {
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
  }
  expect(grazing.pixel[2]).toBeGreaterThan(15)
  expect(steep.pixel[2]).toBeLessThanOrEqual(2)
  expect(dry.pixel.slice(0, 3)).toEqual([0, 0, 0])
})

const CONFIGS = [
  { tier: 'full', lowPower: false }, { tier: 'full', lowPower: true }, { tier: 'lite', lowPower: true },
  { tier: 'lite', lowPower: false }, { tier: 'reduced', lowPower: false }, { tier: 'reduced', lowPower: true },
] as const

for (const config of CONFIGS) {
  test(`${config.tier} lowPower=${config.lowPower}: the road renders at every chapter in both themes`, async ({ page }) => {
    test.setTimeout(120000)
    const frames = await page.evaluate(({ tier, lowPower }) => {
      window.cityGpu.mountJourney({ tier, lowPower, width: 640, height: 360 })
      const results = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter, frames: 3 }))
      window.cityGpu.setJourneyTheme(false, { animate: false })
      results.push(window.cityGpu.renderJourney({ chapter: 3, frames: 3 }))
      const road = window.cityGpu.getJourneyContext().scene.getObjectByName('journey-road')
      const meshes = road?.children.map(child => child.name) ?? []
      window.cityGpu.dispose()
      return { results, meshes }
    }, config)
    expect(frames.meshes).toEqual(['journey-road-surface', 'journey-sidewalks', 'journey-road-dashes'])
    for (const frame of frames.results) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
    }
  })
}
