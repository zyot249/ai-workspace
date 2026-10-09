import { expect, test } from '@playwright/test'

test('creation shader failure emits unavailable and never activates canvas', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
  await page.evaluate(() => window.cityGpu.mountComponent({ failure: 'creation' }))
  await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().unavailable)).toBe(1)
  expect(await page.evaluate(() => window.cityGpu.componentStatus().visible)).toBe(false)
  await page.evaluate(() => window.cityGpu.unmountComponent())
})

test('restored-context shader failure disposes once and stops RAF', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
  await page.evaluate(() => window.cityGpu.mountComponent({ failure: 'none' }))
  await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().visible)).toBe(true)
  await page.evaluate(() => window.cityGpu.breakRestoredComponent())
  await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().unavailable)).toBe(1)
  const failed = await page.evaluate(() => window.cityGpu.componentStatus())
  await page.waitForTimeout(100)
  const later = await page.evaluate(() => window.cityGpu.componentStatus())
  expect(later.visible).toBe(false)
  expect(later.updatesAfterFailure).toBe(failed.updatesAfterFailure)
  expect(later.disposed).toBe(1)
  await page.evaluate(() => window.cityGpu.unmountComponent())
})

test('missing shader patch marker also falls back during creation', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
  await page.evaluate(() => window.cityGpu.mountComponent({ failure: 'missing-marker' }))
  await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().unavailable)).toBe(1)
  const result = await page.evaluate(() => {
    const status = window.cityGpu.componentStatus()
    window.cityGpu.unmountComponent()
    return { status, counts: window.cityGpu.componentResourceCounts() }
  })
  expect(result.status.visible).toBe(false)
  expect(result.status.disposed).toBe(1)
  expect(result.counts.length).toBeGreaterThan(0)
  expect(result.counts.every(count => count === 1)).toBe(true)
})

test('successful restore and repeated unmount dispose resources once', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.evaluate(() => window.cityGpu.mountComponent({ failure: 'none' }))
    await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().visible)).toBe(true)
    if (cycle === 0) {
      await page.evaluate(() => window.cityGpu.breakRestoredComponent({ beforeRestore: () => {} }))
      await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().visible)).toBe(true)
      expect(await page.evaluate(() => window.cityGpu.componentStatus().unavailable)).toBe(0)
    }
    const result = await page.evaluate(() => {
      window.cityGpu.unmountComponent()
      window.cityGpu.unmountComponent()
      return { status: window.cityGpu.componentStatus(), counts: window.cityGpu.componentResourceCounts(), canvases: document.querySelectorAll('#journey-component canvas').length }
    })
    expect(result.status.disposed).toBe(1)
    expect(result.status.unavailable).toBe(0)
    expect(result.canvases).toBe(0)
    expect(result.counts.length).toBeGreaterThan(0)
    expect(result.counts.every(count => count === 1)).toBe(true)
  }
  await page.evaluate(() => { window.cityGpu.dispose(); window.cityGpu.dispose() })
})
