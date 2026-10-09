import { expect, test } from '@playwright/test'
import { Color, SRGBColorSpace, MathUtils } from 'three'
import { LOOKS, CHAPTER_IDS } from '../../app/journey/stops'
import { targetFor } from '../../app/journey/target'

const combinations = [
  { tier: 'full', lowPower: false }, { tier: 'lite', lowPower: true },
  { tier: 'reduced', lowPower: false }, { tier: 'reduced', lowPower: true },
] as const
const linear = (rgb: readonly [number, number, number]) => new Color().setRGB(...rgb, SRGBColorSpace).toArray()
test.beforeEach(async ({ page }) => { await page.goto('/tests/gpu/harness.html') })
test.afterEach(async ({ page }) => { await page.evaluate(() => window.cityGpu.dispose()) })

for (const input of combinations) {
  test(`theme endpoints and lights ${input.tier}/${input.lowPower}`, async ({ page }) => {
    await page.evaluate(input => window.cityGpu.mountJourney({ ...input, initialDark: false, width: 320, height: 180 }), input)
    for (const dark of [false, true]) for (let chapter = 0; chapter < 4; chapter++) {
      const result = await page.evaluate(({ dark, chapter }) => {
        window.cityGpu.setJourneyTheme(dark, { animate: false })
        const d = window.cityGpu.renderJourney({ chapter, time: 0, frames: 240 })
        return { d, snapshot: window.cityGpu.journeyState() }
      }, { dark, chapter })
      const look = LOOKS[dark ? 'dark' : 'light'][CHAPTER_IDS[chapter]!]
      const expected = targetFor(chapter, 0, dark ? 1 : 0, input.tier === 'reduced')
      for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
        const actual = result.snapshot.state[key], wanted = expected[key]
        if (Array.isArray(wanted)) wanted.forEach((v, i) => expect((actual as number[])[i]).toBeCloseTo(v, 6))
        else expect(actual).toBeCloseTo(wanted as number, 6)
      }
      expect(result.snapshot.sunIntensity).toBeCloseTo(Math.max(.25, MathUtils.smoothstep(look.sunElevation, -6, 12)), 6)
      expect(result.snapshot.sunPosition[1]).toBeGreaterThanOrEqual(2)
      linear(look.sunColor).forEach((v, i) => expect(result.snapshot.sunColor[i]).toBeCloseTo(v, 6))
      expect(result.snapshot.hemiIntensity).toBeCloseTo(look.hemiIntensity, 6)
      const hemi = new Color().setRGB(...look.skyZenith, SRGBColorSpace)
        .lerp(new Color().setRGB(...look.skyColor, SRGBColorSpace), .5).toArray()
      hemi.forEach((v, i) => expect(result.snapshot.hemiColor[i]).toBeCloseTo(v, 6))
      if (input.lowPower) expect(result.snapshot.starOpacity).toBeNull()
      else expect(result.snapshot.starOpacity).toBeCloseTo(look.starOpacity, 6)
      expect(result.d.shaderError).toBeNull(); expect(result.d.glError).toBe(0)
    }
  })
  test(`no compilation or camera movement during toggles ${input.tier}/${input.lowPower}`, async ({ page }) => {
    await page.evaluate(input => window.cityGpu.mountJourney({ ...input, initialDark: false, width: 320, height: 180 }), input)
    for (let chapter = 0; chapter < 4; chapter++) {
      const result = await page.evaluate(chapter => {
        window.cityGpu.setJourneyTheme(false, { animate: false })
        const baseTime = chapter * 3
        window.cityGpu.renderJourney({ chapter, time: baseTime, frames: 240 })
        const before = window.cityGpu.journeyState()
        const snapshots = []
        const endpoints = []
        for (const dark of [true, false]) {
          window.cityGpu.setJourneyTheme(dark)
          for (let frame = 0; frame <= 72; frame++) {
            const time = baseTime + (dark ? 0 : 1.2) + frame / 60
            const d = window.cityGpu.stepJourney({ chapter, time })
            snapshots.push({ d, s: window.cityGpu.journeyState() })
          }
          window.cityGpu.renderJourney({ chapter, time: baseTime + (dark ? 1.2 : 2.4), frames: 240 })
          endpoints.push(window.cityGpu.journeyState())
        }
        return { before, snapshots, endpoints, after: window.cityGpu.journeyState() }
      }, chapter)
      for (const { d, s } of result.snapshots) {
        expect(s.programs).toEqual(result.before.programs)
        s.camera.forEach((v, i) => expect(v).toBeCloseTo(result.before.camera[i]!, 6))
        expect(d.shaderError).toBeNull(); expect(d.glError).toBe(0)
      }
      expect(result.endpoints[0]!.state.bloomStrength).toBeCloseTo(LOOKS.dark[CHAPTER_IDS[chapter]!].bloomStrength, 6)
      expect(result.after.state.bloomStrength).toBeCloseTo(0, 6)
      expect(result.after.state.starOpacity).toBeCloseTo(0, 6)
    }
  })
}

for (const input of combinations) {
  test(`snap is visible immediately ${input.tier}/${input.lowPower}`, async ({ page }) => {
    const result = await page.evaluate(input => {
      window.cityGpu.mountJourney({ ...input, initialDark: true, width: 320, height: 180 })
      window.cityGpu.renderJourney({ chapter: 3, frames: 240, time: 0 })
      const before = window.cityGpu.journeyState()
      window.cityGpu.setJourneyTheme(false, input.tier === 'reduced' ? undefined : { animate: false })
      return { before, after: window.cityGpu.journeyState(), d: window.cityGpu.diagnostics() }
    }, input)
    expect(result.after.state.starOpacity).toBe(0)
    expect(result.after.state.bloomStrength).toBe(0)
    expect(result.after.state.skyColor).toEqual(LOOKS.light.about.skyColor)
    expect(result.after.camera).toEqual(result.before.camera)
    expect(result.d.shaderError).toBeNull(); expect(result.d.glError).toBe(0)
  })
}
test('bounded background gap and reversal keep the scrolling path', async ({ page }) => {
  const result = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'lite', lowPower: true, initialDark: false, width: 320, height: 180 })
    window.cityGpu.renderJourney({ chapter: 1, progress: .5, time: 0 })
    window.cityGpu.setJourneyTheme(true)
    window.cityGpu.stepJourney({ time: 0 })
    window.cityGpu.renderJourney({ chapter: 1, progress: .5, time: 5, frames: 240 })
    const gap = window.cityGpu.journeyState()
    window.cityGpu.setJourneyTheme(false)
    const atReversal = window.cityGpu.journeyState()
    window.cityGpu.renderJourney({ chapter: 1, progress: .5, time: 5.06, frames: 240 })
    return { gap, atReversal, reversed: window.cityGpu.journeyState(), d: window.cityGpu.diagnostics() }
  })
  const expected = targetFor(1, .5, .1 / 1.2, false)
  expect(result.gap.state.windowLitRatio).toBeCloseTo(expected.windowLitRatio, 6)
  expect(result.atReversal.state).toEqual(result.gap.state)
  expect(result.reversed.state.windowLitRatio).toBeLessThan(result.gap.state.windowLitRatio)
  for (const key of ['cameraDistance', 'cameraHeight', 'lookAheadDistance', 'lookHeight', 'buildingDensity', 'buildingHeight'] as const)
    expect(result.reversed.state[key]).toBeCloseTo(expected[key], 6)
  expect(result.d.shaderError).toBeNull(); expect(result.d.glError).toBe(0)
})
for (const input of [combinations[0], combinations[1]]) {
  test(`restore mid-blend retains the final rendered look ${input.tier}`, async ({ page }) => {
    const result = await page.evaluate(async input => {
      window.cityGpu.mountJourney({ ...input, initialDark: false, width: 320, height: 180 })
      const begin = () => {
        window.cityGpu.setJourneyTheme(false, { animate: false })
        window.cityGpu.renderJourney({ chapter: 3, time: 0, frames: 240 })
        window.cityGpu.setJourneyTheme(true)
        window.cityGpu.stepJourney({ time: 0 })
      }
      begin()
      for (let f = 1; f <= 72; f++) window.cityGpu.stepJourney({ time: f / 60 })
      window.cityGpu.renderJourney({ chapter: 3, time: 1.2, frames: 240 })
      const reference = window.cityGpu.readFrame()
      begin()
      for (let f = 1; f <= 36; f++) window.cityGpu.stepJourney({ time: f / 60 })
      window.cityGpu.renderJourney({ chapter: 3, time: .6, frames: 240 })
      const midpoint = window.cityGpu.journeyState()
      await window.cityGpu.loseAndRestore()
      window.cityGpu.resizeJourney(320, 180)
      window.cityGpu.renderJourney({ chapter: 3, time: .6, frames: 240 })
      const restoredMidpoint = window.cityGpu.journeyState()
      for (let f = 37; f <= 72; f++) window.cityGpu.stepJourney({ time: f / 60 })
      const d = window.cityGpu.renderJourney({ chapter: 3, time: 1.2, frames: 240 })
      const after = window.cityGpu.readFrame()
      let maxDelta = 0
      for (let i = 0; i < reference.length; i++) maxDelta = Math.max(maxDelta, Math.abs(reference[i]! - after[i]!))
      return { midpoint, restoredMidpoint, final: window.cityGpu.journeyState(), maxDelta, d }
    }, input)
    expect(result.restoredMidpoint.state.windowLitRatio).toBeCloseTo(result.midpoint.state.windowLitRatio, 6)
    expect(result.final.state.starOpacity).toBeCloseTo(1, 6)
    expect(result.final.state.exposure).toBeCloseTo(1.25, 6)
    expect(result.maxDelta).toBeLessThanOrEqual(3)
    expect(result.d.shaderError).toBeNull(); expect(result.d.glError).toBe(0)
  })
}
