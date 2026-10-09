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

for (const [tier, lowPower] of [
  ['full', false], ['lite', true], ['reduced', false], ['reduced', true],
  ['full', true], ['lite', false],
] as const) {
  test(`${tier} lowPower=${lowPower}: chapters, mid-transition and restore`, async ({ page }) => {
    await page.goto('/tests/gpu/harness.html')
    await page.waitForFunction(() => Boolean(window.cityGpu))
    const result = await page.evaluate(async ({ tier, lowPower }) => {
      window.cityGpu.mountJourney({ tier, lowPower })
      const layers = window.cityGpu.journeyLayers()
      const planeBatchCount = window.cityGpu.getJourneyContext().scene.children.filter(object =>
        'isInstancedMesh' in object && object.isInstancedMesh && 'geometry' in object
          && object.geometry instanceof Object && 'type' in object.geometry && object.geometry.type === 'PlaneGeometry').length
      const frames = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter }))
      frames.push(window.cityGpu.renderJourney({ chapter: 0, progress: 0.5 }))
      window.cityGpu.renderJourney({ chapter: 3 })
      const before = window.cityGpu.readFrame()
      const restore = await window.cityGpu.loseAndRestore()
      const after = window.cityGpu.readFrame()
      window.cityGpu.dispose()
      return { layers, planeBatchCount, frames, restore, before, after }
    }, { tier, lowPower })
    expect(result.layers.map(layer => layer.count)).toEqual(lowPower ? [14, 19, 24] : [24, 32, 40])
    expect(result.layers).toHaveLength(3)
    expect(result.planeBatchCount).toBe(0)
    // Parent be4b857 at 640x360, one exhibit: full 58/26/15 and lite 57/25/14 calls.
    // Reduced desktop adds one static star draw while the old reduced path omitted it.
    const expectedCalls = lowPower ? [56, 24, 13] : [57, 25, 14]
    expect([result.frames[0]!.calls, result.frames[2]!.calls, result.frames[3]!.calls]).toEqual(expectedCalls)
    for (const layer of result.layers) {
      expect(layer.seedCount).toBe(layer.count)
      expect(layer.frustumCulled).toBe(false)
      expect(layer.variant).toBe(lowPower ? 'journey-facade-lite' : 'journey-facade-full')
    }
    for (const frame of [...result.frames, result.restore]) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
      expect(frame.calls).toBeGreaterThan(0)
    }
    const difference = result.before.reduce((sum, byte, index) => sum + Math.abs(byte - result.after[index]!), 0) / result.before.length
    expect(difference).toBeLessThan(1)
  })
}

test('reduced stays static across time and progress for both costs', async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
  for (const lowPower of [false, true]) {
    const same = await page.evaluate(lowPower => {
      window.cityGpu.mountJourney({ tier: 'reduced', lowPower })
      window.cityGpu.renderJourney({ chapter: 2, progress: 0, time: 0 })
      const a = window.cityGpu.readFrame()
      window.cityGpu.renderJourney({ chapter: 2, progress: 0.9, time: 1000 })
      const b = window.cityGpu.readFrame()
      window.cityGpu.dispose()
      return a.every((value, index) => value === b[index])
    }, lowPower)
    expect(same).toBe(true)
  }
})

for (const variant of ['full', 'lite'] as const) {
  test(`${variant}: fixed rows, four side grids and unwindowed roof`, async ({ page }) => {
    await page.goto('/tests/gpu/harness.html')
    await page.waitForFunction(() => Boolean(window.cityGpu))
    const results = await page.evaluate(variant => {
      const sample = (pixels: number[], x: number, y: number) => pixels.slice((y * 512 + x) * 4, (y * 512 + x) * 4 + 3)
      const x = Math.floor((0.064 + 0.8) / 1.6 * 512)
      const rows = [0, 1].map(row => Math.floor((row * 0.22 + 0.11) / 1.6 * 512))
      const small = window.cityGpu.probeFacade({ variant, height: 0.6, face: 'front', lit: 1 })
      const tall = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 1 })
      const sides = (['front', 'back', 'left', 'right'] as const).map(face => {
        const on = window.cityGpu.probeFacade({ variant, height: 1, face, lit: 1 })
        const off = window.cityGpu.probeFacade({ variant, height: 1, face, lit: 0 })
        return { on: sample(on.pixels, x, rows[0]!), off: sample(off.pixels, x, rows[0]!), errors: [on.diagnostics, off.diagnostics] }
      })
      const roofOn = window.cityGpu.probeFacade({ variant, height: 1, face: 'top', lit: 1 })
      const roofOff = window.cityGpu.probeFacade({ variant, height: 1, face: 'top', lit: 0 })
      return { rows: rows.map(y => [sample(small.pixels, x, y), sample(tall.pixels, x, y)]), sides,
        roofSame: roofOn.pixels.every((byte, index) => byte === roofOff.pixels[index]),
        calls: small.calls, errors: [small.diagnostics, tall.diagnostics, roofOn.diagnostics, roofOff.diagnostics] }
    }, variant)
    for (const [small, tall] of results.rows) small!.forEach((byte, index) => expect(Math.abs(byte - tall![index]!)).toBeLessThanOrEqual(2))
    for (const side of results.sides) {
      expect(side.on.reduce((sum, byte) => sum + byte, 0)).toBeGreaterThan(side.off.reduce((sum, byte) => sum + byte, 0) + 100)
      for (const frame of side.errors) { expect(frame.shaderError).toBeNull(); expect(frame.glError).toBe(0) }
    }
    expect(results.roofSame).toBe(true)
    expect(results.calls).toBe(1)
    for (const frame of results.errors) { expect(frame.shaderError).toBeNull(); expect(frame.glError).toBe(0) }
  })

  test(`${variant}: retained column and chapter occupancy`, async ({ page }) => {
    await page.goto('/tests/gpu/harness.html')
    await page.waitForFunction(() => Boolean(window.cityGpu))
    const result = await page.evaluate(variant => {
      const small = window.cityGpu.probeFacade({ variant, height: 0.6, face: 'front', lit: 1 })
      const tall = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 1 })
      const x = Math.floor((0.064 + 0.8) / 1.6 * 512)
      let retainedError = 0
      for (let y = 3; y < 185; y++) for (let channel = 0; channel < 3; channel++) {
        const index = (y * 512 + x) * 4 + channel
        retainedError = Math.max(retainedError, Math.abs(small.pixels[index]! - tall.pixels[index]!))
      }
      const nonBlack = (pixels: number[]) => {
        let count = 0
        for (let y = 220; y < 300; y++) if (pixels[(y * 512 + x) * 4]! > 0) count++
        return count
      }
      const bright = (pixels: number[]) => {
        let count = 0
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 650) count++
        return count
      }
      const intro = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 0.05 })
      const about = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 0.9 })
      const far = window.cityGpu.probeFacade({ variant, height: 1, face: 'front', lit: 1,
        depth: variant === 'lite' ? 20 : 3, span: variant === 'full' ? 64 : 1.6 })
      return { retainedError, smallRevealed: nonBlack(small.pixels), tallRevealed: nonBlack(tall.pixels),
        introBright: bright(intro.pixels), aboutBright: bright(about.pixels), farBright: bright(far.pixels),
        nearBright: bright(tall.pixels), errors: [small, tall, intro, about, far].map(value => value.diagnostics) }
    }, variant)
    expect(result.retainedError).toBeLessThanOrEqual(2)
    expect(result.tallRevealed).toBeGreaterThan(result.smallRevealed)
    expect(result.introBright).toBeGreaterThan(0)
    expect(result.aboutBright).toBeGreaterThan(result.introBright * 4)
    expect(result.farBright).toBeLessThan(result.nearBright)
    if (variant === 'full') expect(result.farBright).toBe(0)
    for (const frame of result.errors) { expect(frame.shaderError).toBeNull(); expect(frame.glError).toBe(0) }
  })
}
