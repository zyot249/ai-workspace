import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

test('a ground pixel beside an active building is darker; beside an inactive one it matches the far pixel', async ({ page }) => {
  const result = await page.evaluate(() => window.cityGpu.probeContactShadow())
  expect(result.shaderError).toBeNull()
  expect(result.glError).toBe(0)
  expect(result.nearActive).toBeLessThan(result.far - 0.03)
  expect(Math.abs(result.nearInactive - result.far)).toBeLessThan(0.005)
})

for (const [tier, lowPower] of [
  ['full', false], ['reduced', false], ['lite', true], ['reduced', true],
] as const) {
  test(`${tier} lowPower=${lowPower}: one shadow draw call, culling off, restore keeps the alpha map`, async ({ page }) => {
    const result = await page.evaluate(async ({ tier, lowPower }) => {
      window.cityGpu.mountJourney({ tier, lowPower })
      window.cityGpu.renderJourney({ chapter: 3 })
      const measured = window.cityGpu.contactShadowDrawCalls()
      window.cityGpu.renderJourney({ chapter: 3 })
      const before = window.cityGpu.readFrame()
      const restore = await window.cityGpu.loseAndRestore()
      const after = window.cityGpu.readFrame()
      window.cityGpu.dispose()
      return { measured, before, after, restore }
    }, { tier, lowPower })
    const total = lowPower ? 14 + 19 + 24 : 24 + 32 + 40
    expect(result.measured.shaderError).toBeNull()
    expect(result.measured.glError).toBe(0)
    expect(result.measured.calls).toBe(1)
    expect(result.measured.count).toBe(total)
    expect(result.measured.frustumCulled).toBe(false)
    expect(result.measured.renderOrder).toBe(1)
    expect(result.restore.shaderError).toBeNull()
    expect(result.restore.glError).toBe(0)
    const maxDifference = result.before.reduce((max, byte, index) => Math.max(max, Math.abs(byte - result.after[index]!)), 0)
    expect(maxDifference).toBeLessThanOrEqual(1)
  })
}

test('the shadow quads change the rendered frame in at least one light-theme chapter', async ({ page }) => {
  const deltas = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: true, initialDark: false })
    const result = window.cityGpu.contactShadowFrameDelta([0, 1, 2, 3])
    window.cityGpu.dispose()
    return result
  })
  // The ground is nearly black and fog covers the far field, so the change is small. It must still exist.
  expect(Math.max(...deltas)).toBeGreaterThanOrEqual(1)
})

test('the shadow material keeps its transparent, no-depth-write, offset settings in the scene', async ({ page }) => {
  const result = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: true })
    window.cityGpu.renderJourney({ chapter: 1, frames: 2 })
    const { scene } = window.cityGpu.getJourneyContext()
    const mesh = scene.getObjectByName('journey-contact-shadows') as import('three').InstancedMesh
    const material = mesh.material as import('three').MeshBasicMaterial
    const out = { depthWrite: material.depthWrite, transparent: material.transparent, polygonOffset: material.polygonOffset,
      alphaMapColorSpace: material.alphaMap?.colorSpace }
    window.cityGpu.dispose()
    return out
  })
  expect(result.depthWrite).toBe(false)
  expect(result.transparent).toBe(true)
  expect(result.polygonOffset).toBe(true)
  expect(result.alphaMapColorSpace).toBe('')
})
