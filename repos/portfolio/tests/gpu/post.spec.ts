import { expect, test } from '@playwright/test'

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
