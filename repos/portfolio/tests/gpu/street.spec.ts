import { expect, test } from '@playwright/test'
import * as THREE from 'three'
import { DARK_GLASS_HEX } from '../../app/journey/lamps'
import { linearLuminance } from '../../app/journey/window-look'

const TIERS = [['full', false], ['lite', true], ['reduced', false], ['reduced', true]] as const
const HALO_FOV = 40
const HALO_IMAGE = 400
// Half-intensity width of the falloff texture: smoothstep(0.5) = 0.5, so half the plane width.
const HALO_HALF_INTENSITY_WIDTH = 0.45
const BILLBOARD_DISTANCE = 4

const GPU_TEST_TIMEOUT_MS = 120_000

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

for (const [tier, lowPower] of TIERS) {
  test(`${tier} lowPower=${lowPower}: no shader errors, the pinned object counts and at most 6 street draw calls (4 with no cars)`, async ({ page }) => {
    test.setTimeout(GPU_TEST_TIMEOUT_MS)
    const result = await page.evaluate(({ tier, lowPower }) => {
      window.cityGpu.mountJourney({ tier, lowPower })
      const frames = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter }))
      const state = window.cityGpu.streetState()
      const calls = window.cityGpu.streetDrawCalls()
      window.cityGpu.dispose()
      return { frames, state, calls }
    }, { tier, lowPower })
    for (const frame of result.frames) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
    }
    expect(result.calls.shaderError).toBeNull()
    expect(result.calls.glError).toBe(0)
    const lamps = lowPower ? 8 : 14
    const cars = tier === 'reduced' ? 0 : lowPower ? 6 : 12
    for (const part of [result.state.posts, result.state.heads, result.state.halos, result.state.pools]) {
      expect(part?.count).toBe(lamps)
      expect(part?.frustumCulled).toBe(false)
    }
    expect(result.state.halos?.renderOrder).toBe(3)
    expect(result.state.pools?.renderOrder).toBe(1.5)
    if (cars === 0) {
      expect(result.state.carBodies).toBeNull()
      expect(result.state.carLights).toBeNull()
      expect(result.calls.calls).toBe(4)
    } else {
      expect(result.state.carBodies?.count).toBe(cars)
      expect(result.state.carLights?.count).toBe(cars * 4)
      expect(result.calls.calls).toBe(6)
    }
  })
}

test('at the light-theme intro no halo or pool glows; at the dark-theme about chapter every one does', async ({ page }) => {
  const result = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'reduced', lowPower: false, initialDark: false })
    window.cityGpu.renderJourney({ chapter: 0, frames: 2 })
    const day = window.cityGpu.streetState()
    window.cityGpu.setJourneyTheme(true, { animate: false })
    window.cityGpu.renderJourney({ chapter: 3, frames: 2 })
    const night = window.cityGpu.streetState()
    window.cityGpu.dispose()
    return { day, night }
  })
  expect(Math.max(...result.day.halos!.colors)).toBe(0)
  expect(Math.max(...result.day.pools!.colors)).toBe(0)
  const triples = (colors: number[]) => Array.from({ length: colors.length / 3 }, (_, i) => Math.max(...colors.slice(3 * i, 3 * i + 3)))
  for (const peak of [...triples(result.night.halos!.colors), ...triples(result.night.pools!.colors)]) expect(peak).toBeGreaterThan(0.4)
})

for (const density of [0.045, 0.065]) {
  for (const distance of [5, 20, 40]) {
    test(`fog ${density} at ${distance} units: a switched-off halo and pool add nothing`, async ({ page }) => {
      const result = await page.evaluate(input => window.cityGpu.probeStreetFog(input), { density, distance, ratio: 0 })
      expect(result.shaderError).toBeNull()
      expect(result.glError).toBe(0)
      expect(result.maxDifference).toBeLessThanOrEqual(1)
    })
  }
}

test('a lit halo fades with distance and vanishes once the fog factor passes 0.99', async ({ page }) => {
  const density = 0.065
  const gains = []
  for (const distance of [5, 20, 40]) {
    const result = await page.evaluate(input => window.cityGpu.probeStreetFog(input), { density, distance, ratio: 0.4 })
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
    gains.push(result.centerGain)
  }
  expect(gains[0]).toBeGreaterThan(gains[1]!)
  expect(gains[1]).toBeGreaterThan(gains[2]!)
  expect(1 - Math.exp(-((density * 40) ** 2))).toBeGreaterThan(0.99)
  expect(gains[2]).toBeLessThan(1 / 255)
})

test('the halo faces the camera: its width barely changes as the camera circles the lamp head', async ({ page }) => {
  const widths: number[] = []
  const expected = (HALO_HALF_INTENSITY_WIDTH / (2 * BILLBOARD_DISTANCE * Math.tan((HALO_FOV * Math.PI) / 360))) * HALO_IMAGE
  for (const yaw of [0, 45, 90]) {
    const result = await page.evaluate(input => window.cityGpu.probeStreetHalo(input), { yawDegrees: yaw, distance: BILLBOARD_DISTANCE })
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
    expect(Math.abs(result.centerColumn - HALO_IMAGE / 2)).toBeLessThanOrEqual(2)
    expect(Math.abs(result.widthPx - expected) / expected).toBeLessThan(0.08)
    widths.push(result.widthPx)
  }
  expect((Math.max(...widths) - Math.min(...widths)) / Math.max(...widths)).toBeLessThan(0.05)
})

test('head brightness: at least luminance 2.0 when lit, dark glass by day, a mix at ratio 0.25', async ({ page }) => {
  const lit = await page.evaluate(() => window.cityGpu.probeStreetHeads(0.4))
  const day = await page.evaluate(() => window.cityGpu.probeStreetHeads(0.05))
  const dusk = await page.evaluate(() => window.cityGpu.probeStreetHeads(0.25))
  for (const result of [lit, day, dusk]) {
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
  }
  const glass = new THREE.Color(DARK_GLASS_HEX)
  const glassLuminance = linearLuminance([glass.r, glass.g, glass.b])
  for (const value of lit.luminance) expect(value).toBeGreaterThanOrEqual(2.0)
  for (const value of day.luminance) expect(Math.abs(value - glassLuminance)).toBeLessThan(1e-3)
  expect(dusk.luminance.some(value => value >= 2.0)).toBe(true)
  expect(dusk.luminance.some(value => value < 0.5)).toBe(true)
})

test('pools: a road pixel under a lamp is brighter than one 4 units away when lit, and equal by day', async ({ page }) => {
  const lit = await page.evaluate(() => window.cityGpu.probeStreetPools(0.4))
  const day = await page.evaluate(() => window.cityGpu.probeStreetPools(0.05))
  for (const result of [lit, day]) {
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
  }
  expect(lit.under).toBeGreaterThan(lit.away + 0.2)
  expect(Math.abs(day.under - day.away)).toBeLessThanOrEqual(2 / 255)
})

test('traffic moves between t = 0 and t = 0.75, and no car is visible next to a corner at any of 80 times', async ({ page }) => {
  test.setTimeout(GPU_TEST_TIMEOUT_MS)
  const times = Array.from({ length: 80 }, (_, i) => i * 0.75)
  const result = await page.evaluate(input => window.cityGpu.probeTraffic(input), { cars: 12, times })
  expect(result.shaderError).toBeNull()
  expect(result.glError).toBe(0)
  expect(result.objects).toBe(2)
  expect(result.lit[0]).toBeGreaterThan(0)
  expect(result.changed).toBeGreaterThan(0)
  expect(result.nearCorner).toBe(0)
})

test('with no cars (reduced motion) nothing is drawn and two renders match', async ({ page }) => {
  const result = await page.evaluate(() => window.cityGpu.probeTraffic({ cars: 0, times: [0, 2] }))
  expect(result.objects).toBe(0)
  expect(result.lit).toEqual([0, 0])
  expect(result.changed).toBe(0)
})

for (const [tier, lowPower] of TIERS) {
  test(`${tier} lowPower=${lowPower}: lamps, halos, pools and the falloff texture survive context loss`, async ({ page }) => {
    test.setTimeout(GPU_TEST_TIMEOUT_MS)
    const result = await page.evaluate(async ({ tier, lowPower }) => {
      window.cityGpu.mountJourney({ tier, lowPower })
      window.cityGpu.renderJourney({ chapter: 3 })
      const before = window.cityGpu.readFrame()
      const restore = await window.cityGpu.loseAndRestore()
      const after = window.cityGpu.readFrame()
      const state = window.cityGpu.streetState()
      window.cityGpu.dispose()
      return { before, after, restore, state }
    }, { tier, lowPower })
    expect(result.restore.shaderError).toBeNull()
    expect(result.restore.glError).toBe(0)
    expect(result.state.halos?.count).toBe(lowPower ? 8 : 14)
    const maxDifference = result.before.reduce((max, byte, index) => Math.max(max, Math.abs(byte - result.after[index]!)), 0)
    expect(maxDifference).toBeLessThanOrEqual(1)
  })
}
