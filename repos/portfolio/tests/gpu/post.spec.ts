import { expect, test } from '@playwright/test'
import { STOPS } from '../../app/journey/stops'

test.beforeEach(async ({ page }) => { await page.goto('/tests/gpu/harness.html') })

test('HDR threshold, zero-strength halo, exact half sizes, and handled fallback', async ({ page }) => {
  const run = (luminance: number, strength: number, fault?: 'half-float' | 'samples' | 'framebuffer') =>
    page.evaluate(async ({ luminance, strength, fault }) => window.cityPost.synthetic({
      width: 321, height: 181, pixelRatio: 2, luminance, strength, fault,
    }), { luminance, strength, fault })
  const on = await run(2, 0.4)
  expect(on.pipeline).toBe('composer')
  expect(on.sizes!.full).toEqual([642, 362])
  expect(on.sizes!.bright).toEqual([321, 181])
  expect(Math.max(...on.adjacent.slice(0, 3))).toBeGreaterThan(0)
  const off = await run(2, 0)
  expect(off.adjacent.slice(0, 3)).toEqual([0, 0, 0])
  const dim = await run(0.8, 0.4)
  expect(dim.adjacent.slice(0, 3)).toEqual([0, 0, 0])
  for (const fault of ['half-float', 'samples', 'framebuffer'] as const) {
    const failed = await run(2, 0.4, fault)
    expect(failed.pipeline).toBe('direct')
    expect(failed.center.slice(0, 3).some(v => v > 0)).toBe(true)
    expect(failed.adjacent.slice(0, 3)).toEqual([0, 0, 0])
    expect(failed.glError).toBe(0)
    expect(failed.shaderError).toBeNull()
  }
  for (const result of [on, off, dim]) {
    expect(result.glError).toBe(0)
    expect(result.shaderError).toBeNull()
  }
})

test('owns each HDR resource once and restores renderer state on success and exception', async ({ page }) => {
  const r = await page.evaluate(() => window.cityPost.lifetime())
  expect(r.counts.length).toBeGreaterThan(10)
  expect(r.counts.every(n => n === 1)).toBe(true)
  expect(r.created).toEqual(r.expected); expect(r.rendered).toEqual(r.expected); expect(r.thrown).toEqual(r.expected)
  expect(r.remainingTextures).toBe(r.baselineTextures)
  expect(r.glError).toBe(0); expect(r.shaderError).toBeNull()
})

for (const input of [
  { tier: 'full', lowPower: false, composer: true }, { tier: 'lite', lowPower: true, composer: false },
  { tier: 'reduced', lowPower: false, composer: true }, { tier: 'reduced', lowPower: true, composer: false },
] as const) {
  test(`actual scene tone mapping and warm-up: ${input.tier}/${input.lowPower}`, async ({ page }) => {
    const result = await page.evaluate(input => {
      window.cityPost.mountActual({ ...input, width: 640, height: 360 })
      const states = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter, frames: 180 }))
      const actual = window.cityPost.actualDiagnostics()
      window.cityPost.disposeActual()
      return { states, actual }
    }, input)
    result.states.forEach(d => { expect(d.shaderError).toBeNull(); expect(d.glError).toBe(0) })
    expect(result.actual.toneMapping).toBe(result.actual.expectedToneMapping)
    expect(result.actual.exposure).toBeCloseTo(1.25, 4)
    expect(result.actual.composer).toBe(input.composer)
    expect(result.actual.ownedLuminance).toHaveLength(2)
    result.actual.ownedLuminance.forEach(l => expect(l).toBeGreaterThanOrEqual(2))
  })
}

test('actual scene capability fallback remains renderable', async ({ page }) => {
  const d = await page.evaluate(() => {
    window.cityPost.mountActual({ tier: 'full', lowPower: false, forceNoHalfFloat: true, width: 640, height: 360 })
    window.cityGpu.renderJourney({ chapter: 3, frames: 180 })
    return window.cityPost.actualDiagnostics()
  })
  expect(d.composer).toBe(false); expect(d.glError).toBe(0); expect(d.shaderError).toBeNull()
})

for (const stage of ['output', 'bloom'] as const) {
  test(`post warm-up shader failure surfaces and cleans up: ${stage}`, async ({ page }) => {
    const message = await page.evaluate(stage => {
      try {
        window.cityPost.installPostFault(stage)
        window.cityPost.mountActual({ tier: 'full', lowPower: false, width: 320, height: 180 })
        return null
      } catch (error) {
        return String(error)
      } finally {
        window.cityPost.restorePostFault()
        window.cityPost.disposeActual()
      }
    }, stage)
    expect(message).toMatch(/shader|program|invalid_post_fullscreen_token/i)
  })
}

test('sky and fully fogged pixels agree at authored and intermediate exposures', async ({ page }) => {
  const inputs = STOPS.flatMap(stop => [stop.exposure, 1.05, 1.15, 1.2].map(exposure =>
    ({ sky: stop.skyColor, fog: stop.fogColor, exposure })))
  const deltas = await page.evaluate(inputs => inputs.map(input => window.cityPost.parity(input)), inputs)
  for (const p of deltas) for (const delta of [...p.skyDelta, ...p.fogDelta]) expect(delta).toBeLessThanOrEqual(3)
})

for (const chapter of [0, 1, 2, 3]) {
  test(`actual scene sky and fully fogged pixels agree in chapter ${chapter}`, async ({ page }) => {
    const r = await page.evaluate(chapter => window.cityPost.actualParity({ chapter }), chapter)
    for (const delta of [...r.skyDelta, ...r.fogDelta]) expect(delta).toBeLessThanOrEqual(3)
    expect(r.shaderError).toBeNull(); expect(r.glError).toBe(0)
  })
}

test('initial, odd resize, and DPR change retain half-sized bright pass', async ({ page }) => {
  const r = await page.evaluate(() => window.cityPost.resizeSynthetic())
  expect(r.sizes).toEqual(r.expected)
})

test('night halo and center survive real context loss after resize', async ({ page }) => {
  const r = await page.evaluate(() => window.cityPost.restoreSynthetic())
  for (let p = 0; p < r.before.length; p++) for (let c = 0; c < 3; c++) {
    expect(Math.abs(r.before[p]![c]! - r.after[p]![c]!)).toBeLessThanOrEqual(3)
  }
  expect(Math.max(...r.before[1]!.slice(0, 3))).toBeGreaterThan(0)
  expect(Math.max(...r.after[1]!.slice(0, 3))).toBeGreaterThan(0)
  expect(r.shaderError).toBeNull(); expect(r.glError).toBe(0)
})

for (const chapter of [2, 3] as const) {
  test(`real near facade halo in chapter ${chapter}`, async ({ page }) => {
    const r = await page.evaluate(chapter => window.cityPost.actualChapter({ chapter }), chapter)
    expect(r.windowDistance).toBeLessThanOrEqual(10)
    expect(r.on[1]!.slice(0, 3).reduce((a, b) => a + b, 0)).toBeGreaterThan(r.off[1]!.slice(0, 3).reduce((a, b) => a + b, 0))
    expect(r.shaderError).toBeNull(); expect(r.glError).toBe(0)
  })
}

test('actual component emits unavailable for a post warm-up shader failure', async ({ page }) => {
  try {
    await page.evaluate(() => window.cityGpu.mountComponent({ failure: 'none', beforeMount: () => window.cityPost.installPostFault('bloom') }))
    await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().unavailable)).toBe(1)
    const r = await page.evaluate(() => window.cityGpu.componentStatus())
    expect(r.visible).toBe(false); expect(r.disposed).toBe(1); expect(r.updatesAfterFailure).toBe(0)
  } finally {
    await page.evaluate(() => { window.cityPost.restorePostFault(); window.cityGpu.unmountComponent() })
  }
})

test('actual component stops on post-program failure after restore', async ({ page }) => {
  try {
    await page.evaluate(() => window.cityGpu.mountComponent({ failure: 'none' }))
    await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().visible)).toBe(true)
    await page.evaluate(() => window.cityGpu.breakRestoredComponent({ beforeRestore: () => window.cityPost.installPostFault('output') }))
    await expect.poll(() => page.evaluate(() => window.cityGpu.componentStatus().unavailable)).toBe(1)
    const first = await page.evaluate(() => window.cityGpu.componentStatus())
    await page.waitForTimeout(100)
    const later = await page.evaluate(() => window.cityGpu.componentStatus())
    expect(first.visible).toBe(false); expect(first.disposed).toBe(1)
    expect(later.updatesAfterFailure).toBe(first.updatesAfterFailure)
  } finally {
    await page.evaluate(() => { window.cityPost.restorePostFault(); window.cityGpu.unmountComponent() })
  }
})
