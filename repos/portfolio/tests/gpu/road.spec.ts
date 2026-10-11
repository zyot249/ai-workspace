import { expect, test } from '@playwright/test'
import { REFLECT_LAYER } from '../../app/journey/reflect-layer'
import { STREET_NAMES } from '../../app/journey/lamps'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

test('the shader puddle mask agrees with puddleMaskAt on a 20 x 20 grid over the road', async ({ page }) => {
  const result = await page.evaluate(() => window.cityGpu.road.probeMask())
  expect(result.shaderError).toBeNull()
  expect(result.glError).toBe(0)
  expect(result.samples.length).toBeGreaterThan(40)
  for (const sample of result.samples) expect(Math.abs(sample.gpu - sample.cpu)).toBeLessThan(0.02)
  // The check is only meaningful if the grid sees both puddle and dry asphalt.
  expect(result.samples.some(s => s.cpu > 0.9)).toBe(true)
  expect(result.samples.some(s => s.cpu < 0.1)).toBe(true)
})

test('wet sheen grows toward grazing angles and is absent when dry', async ({ page }) => {
  const grazing = await page.evaluate(() => window.cityGpu.road.probeSheen({ cameraY: 0.5, distance: 8, wetness: 0.7 }))
  const steep = await page.evaluate(() => window.cityGpu.road.probeSheen({ cameraY: 14, distance: 1, wetness: 0.7 }))
  const dry = await page.evaluate(() => window.cityGpu.road.probeSheen({ cameraY: 0.5, distance: 8, wetness: 0 }))
  for (const result of [grazing, steep, dry]) {
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
  }
  expect(grazing.pixel[2]).toBeGreaterThan(15)
  expect(steep.pixel[2]).toBeLessThanOrEqual(2)
  expect(dry.pixel.slice(0, 3)).toEqual([0, 0, 0])
})

const CONFIGS = [
  { tier: 'full', lowPower: false }, { tier: 'full', lowPower: true }, { tier: 'lite', lowPower: true },
  { tier: 'lite', lowPower: false }, { tier: 'reduced', lowPower: false }, { tier: 'reduced', lowPower: true },
] as const

for (const config of CONFIGS) {
  test(`${config.tier} lowPower=${config.lowPower}: the road renders at every chapter in both themes`, async ({ page }) => {
    test.setTimeout(120000)
    const frames = await page.evaluate(({ tier, lowPower }) => {
      window.cityGpu.mountJourney({ tier, lowPower, width: 640, height: 360 })
      const results = [0, 1, 2, 3].map(chapter => window.cityGpu.renderJourney({ chapter, frames: 3 }))
      window.cityGpu.setJourneyTheme(false, { animate: false })
      results.push(window.cityGpu.renderJourney({ chapter: 3, frames: 3 }))
      const road = window.cityGpu.getJourneyContext().scene.getObjectByName('journey-road')
      const meshes = road?.children.map(child => child.name) ?? []
      window.cityGpu.dispose()
      return { results, meshes }
    }, config)
    expect(frames.meshes).toEqual(['journey-road-surface', 'journey-sidewalks', 'journey-road-dashes'])
    for (const frame of frames.results) {
      expect(frame.shaderError).toBeNull()
      expect(frame.glError).toBe(0)
    }
  })
}

type WetHandle = { stats: { passes: number; lastDrawCalls: number }; overlay: { visible: boolean }; enabled: boolean }

test('the reflection pass stays within 16 draw calls, runs when wet, and is off at intro', async ({ page }) => {
  test.setTimeout(120000)
  const r = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, width: 640, height: 360 })
    const wet = window.cityGpu.getJourneyContext().scene.getObjectByName('journey-wet-road')?.userData.wetRoad as WetHandle | undefined
    if (!wet) throw new Error('The journey has no wet road on the composer pipeline')
    const start = wet.stats.passes
    window.cityGpu.renderJourney({ chapter: 0, frames: 3 })
    const intro = { passes: wet.stats.passes - start, visible: wet.overlay.visible }
    const stops = ([[1, 0], [1, 0.5], [2, 0], [2, 0.5], [3, 0]] as const).map(([chapter, progress]) => {
      window.cityGpu.renderJourney({ chapter, progress, frames: 30 })
      return { chapter, progress, calls: wet.stats.lastDrawCalls, visible: wet.overlay.visible, passes: wet.stats.passes }
    })
    window.cityGpu.dispose()
    return { intro, stops }
  })
  expect(r.intro).toEqual({ passes: 0, visible: false })
  let previous = 0
  for (const stop of r.stops) {
    expect(stop.visible).toBe(true)
    expect(stop.calls).toBeGreaterThan(0)
    expect(stop.calls, `draw calls at chapter ${stop.chapter} progress ${stop.progress}`).toBeLessThanOrEqual(16)
    expect(stop.passes).toBeGreaterThan(previous)
    previous = stop.passes
  }
})

test('street posts, heads and cars reflect without duplicating pools or halos', async ({ page }) => {
  const names = STREET_NAMES
  const layers = await page.evaluate(({ layer, names }) => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, width: 640, height: 360 })
    const scene = window.cityGpu.getJourneyContext().scene
    const result = Object.values(names).map(name => {
      const object = scene.getObjectByName(name)
      if (!object) throw new Error(`Missing street object ${name}`)
      return { name, reflects: object.layers.isEnabled(layer) }
    })
    window.cityGpu.dispose()
    return result
  }, { layer: REFLECT_LAYER, names })
  expect(layers).toEqual([
    { name: names.posts, reflects: true },
    { name: names.heads, reflects: true },
    { name: names.halos, reflects: false },
    { name: names.pools, reflects: false },
    { name: names.carBodies, reflects: true },
    { name: names.carLights, reflects: true },
  ])
})

test('the light theme is dry: no pass and no overlay at any chapter', async ({ page }) => {
  const r = await page.evaluate(() => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, width: 640, height: 360, initialDark: false })
    const wet = window.cityGpu.getJourneyContext().scene.getObjectByName('journey-wet-road')?.userData.wetRoad as WetHandle | undefined
    if (!wet) throw new Error('The journey has no wet road on the composer pipeline')
    const start = wet.stats.passes
    const visible = [0, 1, 2, 3].map(chapter => {
      window.cityGpu.renderJourney({ chapter, frames: 30 })
      return wet.overlay.visible
    })
    const passes = wet.stats.passes - start
    window.cityGpu.dispose()
    return { visible, passes }
  })
  expect(r.visible).toEqual([false, false, false, false])
  expect(r.passes).toBe(0)
})

const FALLBACKS = [
  { label: 'lowPower', options: { tier: 'full', lowPower: true }, overlay: false },
  { label: 'the direct pipeline', options: { tier: 'full', lowPower: false, directPipeline: true }, overlay: false },
  { label: 'a target that fails the framebuffer check', options: { tier: 'full', lowPower: false, failWetRoadTarget: true }, overlay: false },
  { label: 'reduced motion', options: { tier: 'reduced', lowPower: false }, overlay: true },
] as const

for (const fallback of FALLBACKS) {
  test(`with ${fallback.label} the scene ${fallback.overlay ? 'keeps' : 'drops'} the reflection and still renders`, async ({ page }) => {
    const r = await page.evaluate(options => {
      window.cityGpu.mountJourney({ ...options, width: 640, height: 360 })
      const frame = window.cityGpu.renderJourney({ chapter: 3, frames: 5 })
      const overlay = window.cityGpu.getJourneyContext().scene.getObjectByName('journey-wet-road')
      const visible = (overlay as { visible?: boolean } | undefined)?.visible ?? null
      window.cityGpu.dispose()
      return { frame, hasOverlay: overlay !== undefined, visible }
    }, fallback.options)
    expect(r.hasOverlay).toBe(fallback.overlay)
    if (fallback.overlay) expect(r.visible).toBe(true)
    expect(r.frame.shaderError).toBeNull()
    expect(r.frame.glError).toBe(0)
  })
}

test('resize and context loss keep the reflection on the first frame', async ({ page }) => {
  test.setTimeout(120000)
  const r = await page.evaluate(async () => {
    window.cityGpu.mountJourney({ tier: 'full', lowPower: false, width: 640, height: 360 })
    window.cityGpu.renderJourney({ chapter: 3 })
    const wet = window.cityGpu.getJourneyContext().scene.getObjectByName('journey-wet-road')?.userData.wetRoad as WetHandle | undefined
    if (!wet) throw new Error('The journey has no wet road on the composer pipeline')
    window.cityGpu.resizeJourney(480, 270)
    const resized = window.cityGpu.renderJourney({ chapter: 3, frames: 1 })
    const firstAfterResize = window.cityGpu.readFrame()
    window.cityGpu.renderJourney({ chapter: 3, frames: 3 })
    const steady = window.cityGpu.readFrame()
    wet.enabled = false
    window.cityGpu.renderJourney({ chapter: 3, frames: 1 })
    const withoutOverlay = window.cityGpu.readFrame()
    wet.enabled = true
    window.cityGpu.renderJourney({ chapter: 3, frames: 1 })
    const beforeRestore = window.cityGpu.readFrame()
    const passesBefore = wet.stats.passes
    const restored = await window.cityGpu.loseAndRestore()
    const firstAfterRestore = window.cityGpu.readFrame()
    const passesAfter = wet.stats.passes
    const reflectedChannels = steady.flatMap((byte, i) =>
      i % 4 < 3 && Math.abs(byte - withoutOverlay[i]!) > 6 ? [i] : [])
    const signalError = (frame: number[]) => reflectedChannels.reduce((sum, i) =>
      sum + Math.abs(frame[i]! - steady[i]!), 0) / reflectedChannels.length
    const dryError = signalError(withoutOverlay)
    const resizeError = signalError(firstAfterResize)
    const beforeRestoreError = signalError(beforeRestore)
    const restoreError = signalError(firstAfterRestore)
    window.cityGpu.dispose()
    return { resized, restored, overlayPixels: reflectedChannels.length,
      dryError, resizeError, beforeRestoreError, restoreError, passesBefore, passesAfter }
  })
  expect(r.resized.shaderError).toBeNull()
  expect(r.resized.glError).toBe(0)
  expect(r.restored.shaderError).toBeNull()
  expect(r.restored.glError).toBe(0)
  expect(r.passesAfter).toBeGreaterThan(r.passesBefore)
  // Select only channels where deliberately disabling the overlay changes this camera's frame.
  expect(r.overlayPixels).toBeGreaterThan(100)
  expect(r.dryError).toBeGreaterThan(6)
  expect(r.beforeRestoreError).toBeLessThan(r.dryError * 0.25)
  expect(r.resizeError).toBeLessThan(r.dryError * 0.25)
  expect(r.restoreError).toBeLessThan(r.dryError * 0.25)
})
