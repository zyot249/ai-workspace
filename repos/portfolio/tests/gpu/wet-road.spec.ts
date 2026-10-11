import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

const sum = (pixel: number[]) => pixel[0]! + pixel[1]! + pixel[2]!

test('a puddle shows a warm lit marker that wetness 0 does not', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeReflection())
  expect(r.shaderError).toBeNull()
  expect(r.glError).toBe(0)
  // Brighter and warmer than the dry road, and brighter than the same puddle without the marker.
  expect(sum(r.wet)).toBeGreaterThan(sum(r.dry) + 40)
  // At this shallow angle the measured red-blue gap grows by 8 levels (79 vs 71).
  expect(r.wet[0]! - r.wet[2]!).toBeGreaterThan(r.dry[0]! - r.dry[2]! + 5)
  expect(sum(r.wet)).toBeGreaterThan(sum(r.withoutMarker) + 40)
})

test('only objects on the reflection layer appear in the puddle', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeReflection())
  for (let i = 0; i < 3; i++) expect(Math.abs(r.decoy[i]! - r.withoutMarker[i]!)).toBeLessThanOrEqual(1)
})

test('at wetness 0.02 the pass does not run and the pixel matches the dry road', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeReflection())
  expect(r.passesAfter).toBe(r.passesBefore)
  for (let i = 0; i < 3; i++) expect(Math.abs(r.intro[i]! - r.dry[i]!)).toBeLessThanOrEqual(1)
})

test('a puddle fades into the fog instead of shining at the horizon', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeReflection())
  for (let i = 0; i < 3; i++) expect(Math.abs(r.fogged[i]! - r.dry[i]!)).toBeLessThanOrEqual(3)
})

test('lights on the reflection layer light the reflected surface; lights left on layer 0 do not', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeLights())
  expect(r.shaderError).toBeNull()
  expect(r.glError).toBe(0)
  expect(sum(r.lit)).toBeGreaterThan(sum(r.unlit) + 25)
})

test('the overlay covers the road rectangles, the joint corners, and nothing past them', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeCoverage())
  expect(r.shaderError).toBeNull()
  expect(r.glError).toBe(0)
  expect(r.cases.filter(c => c.insideRoad).length).toBe(9) // 8 joint corners and (2.8, -28.8)
  for (const c of r.cases) {
    if (c.insideRoad) expect(c.pixel[0], `(${c.x}, ${c.z}) should be covered`).toBeGreaterThan(200)
    else expect(c.pixel[0], `(${c.x}, ${c.z}) should be bare`).toBeLessThan(30)
  }
})

for (const index of [0, 1, 2, 3]) {
  test(`reflections line up with the mirror image (case ${index})`, async ({ page }) => {
    const r = await page.evaluate(i => window.cityGpu.wetRoad.probeMirror(i), index)
    expect(r.shaderError).toBeNull()
    expect(r.glError).toBe(0)
    expect(r.hitOnRoad, `${r.name}: the reflection point must lie on the road`).toBe(true)
    expect(r.count, `${r.name}: the reflected marker should be visible`).toBeGreaterThan(10)
    expect(Math.abs(r.centroid![0]! - r.predicted[0]!), `${r.name} x`).toBeLessThanOrEqual(2)
    expect(Math.abs(r.centroid![1]! - r.predicted[1]!), `${r.name} y`).toBeLessThanOrEqual(2)
  })
}

test('the overlay changes road pixels only: ground and sidewalk are identical with it on and off', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeRoadOnly())
  expect(r.shaderError).toBeNull()
  expect(r.glError).toBe(0)
  expect(r.on.ground).toEqual(r.off.ground)
  expect(r.on.sidewalk).toEqual(r.off.sidewalk)
  expect(r.on.road).not.toEqual(r.off.road)
})

test('the pass restores renderer state, even when a render throws, and the next frame is clean', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeHygiene())
  expect(r.afterPass).toEqual(r.before)
  expect(r.message).toBe('forced reflection failure')
  expect(r.afterThrow).toEqual(r.before)
  expect(r.shaderError).toBeNull()
  expect(r.glError).toBe(0)
})

test('a target that fails the framebuffer check gives null, no pending GL error, and a working retry', async ({ page }) => {
  const r = await page.evaluate(() => window.cityGpu.wetRoad.probeForcedFailure())
  expect(r.failure).toEqual({ isNull: true, targetIsNull: true, glError: 0 })
  expect(r.success).toEqual({ isNull: false, glError: 0 })
  expect(r.shaderError).toBeNull()
})
