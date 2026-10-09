import { expect, test } from '@playwright/test'

test('harness runs the real scene and checks a real render', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
  const result = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, width: 640, height: 360 })
    return window.cityGpu.renderJourney({ chapter: 0, frames: 1 })
  })
  expect(result.shaderError).toBeNull()
  expect(result.glError).toBe(0)
  expect(result.calls).toBeGreaterThan(0)
  expect(result.width).toBe(640)
})
