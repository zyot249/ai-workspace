import { expect, test } from '@playwright/test'

const ABOUT = 3

for (const [tier, lowPower] of [
  ['full', false], ['reduced', false], ['lite', true], ['reduced', true],
] as const) {
  test(`${tier} lowPower=${lowPower}: building draw calls, landmarks, and restore`, async ({ page }) => {
    await page.goto('/tests/gpu/harness.html')
    await page.waitForFunction(() => Boolean(window.cityGpu))
    const result = await page.evaluate(async ({ tier, lowPower, chapter }) => {
      window.cityGpu.mountJourney({ tier, lowPower })
      window.cityGpu.renderJourney({ chapter })
      const measured = window.cityGpu.buildingDrawCalls()
      window.cityGpu.renderJourney({ chapter })
      const before = window.cityGpu.readFrame()
      const restore = await window.cityGpu.loseAndRestore()
      const after = window.cityGpu.readFrame()
      window.cityGpu.dispose()
      return { measured, before, after, restore }
    }, { tier, lowPower, chapter: ABOUT })
    expect(result.measured.shaderError).toBeNull()
    expect(result.measured.glError).toBe(0)
    expect(result.measured.calls).toBeLessThanOrEqual(7)
    expect(result.measured.calls).toBe(lowPower ? 3 : 7)
    expect(result.measured.meshNames.some(name => name.endsWith('-spire'))).toBe(!lowPower)
    expect(result.measured.meshNames.some(name => name.endsWith('-beacon'))).toBe(!lowPower)
    expect(result.restore.shaderError).toBeNull()
    expect(result.restore.glError).toBe(0)
    // Max per-channel difference, not the mean: a missing spire or beacon is a few pixels of ~a million.
    const maxDifference = result.before.reduce((max, byte, index) => Math.max(max, Math.abs(byte - result.after[index]!)), 0)
    expect(maxDifference).toBeLessThanOrEqual(1)
  })
}

for (const variant of ['full', 'lite'] as const) {
  test(`${variant}: an unwindowed part shows no windows even when fully lit`, async ({ page }) => {
    await page.goto('/tests/gpu/harness.html')
    await page.waitForFunction(() => Boolean(window.cityGpu))
    const result = await page.evaluate(variant => {
      const lit = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 1.4, windowed: false })
      const dark = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 0, windowed: false })
      const windowedLit = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 1.4 })
      const windowedDark = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 0 })
      return {
        same: lit.pixels.every((byte, index) => byte === dark.pixels[index]),
        windowedDiffers: windowedLit.pixels.some((byte, index) => byte !== windowedDark.pixels[index]),
        errors: [lit, dark, windowedLit, windowedDark].map(value => value.diagnostics),
      }
    }, variant)
    expect(result.same).toBe(true)
    expect(result.windowedDiffers).toBe(true)
    for (const frame of result.errors) { expect(frame.shaderError).toBeNull(); expect(frame.glError).toBe(0) }
  })
}

test('reduced keeps the building frame identical across time', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
  const same = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: false })
    window.cityGpu.renderJourney({ chapter: 3, time: 0 })
    const a = window.cityGpu.readFrame()
    window.cityGpu.renderJourney({ chapter: 3, time: 0.9 })
    const b = window.cityGpu.readFrame()
    window.cityGpu.dispose()
    return a.every((value, index) => value === b[index])
  })
  expect(same).toBe(true)
})

test('the restore check can see a beacon: hiding beacons changes the frame by more than one level', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
  const result = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: false })
    const beacons = window.cityGpu.getJourneyContext().scene.children.filter(child => child.name.endsWith('-beacon'))
    const chapters = [0, 1, 2, 3].map(chapter => {
      window.cityGpu.renderJourney({ chapter, time: 0 })
      const withBeacons = window.cityGpu.readFrame()
      beacons.forEach(beacon => { beacon.visible = false })
      window.cityGpu.renderJourney({ chapter, time: 0 })
      const without = window.cityGpu.readFrame()
      beacons.forEach(beacon => { beacon.visible = true })
      let max = 0
      let sum = 0
      withBeacons.forEach((byte, index) => { const d = Math.abs(byte - without[index]!); max = Math.max(max, d); sum += d })
      return { chapter, max, mean: sum / withBeacons.length }
    })
    window.cityGpu.dispose()
    return { beacons: beacons.length, chapters }
  })
  expect(result.beacons).toBe(2)
  expect(result.chapters.some(chapter => chapter.max > 1), JSON.stringify(result.chapters)).toBe(true)
  // The old mean < 1 assertion would have passed with no beacon at all.
  expect(result.chapters.every(chapter => chapter.mean < 1)).toBe(true)
})
