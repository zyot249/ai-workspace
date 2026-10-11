import { Color, SRGBColorSpace } from 'three'
import { expect, it } from 'vitest'
import { CHAPTER_IDS, hexToRgb, LOOKS, PATH_STOPS } from '../../app/journey/stops'

it('retains all authored path values and exactly four chapters', () => {
  expect(Object.keys(PATH_STOPS)).toEqual([...CHAPTER_IDS])
  expect(Object.values(PATH_STOPS)).toEqual([
    { cameraDistance: 0, cameraHeight: .2, lookAheadDistance: 8, lookHeight: 0, buildingDensity: .35, buildingHeight: .6 },
    { cameraDistance: 8, cameraHeight: .6, lookAheadDistance: 8, lookHeight: .3, buildingDensity: .6, buildingHeight: .85 },
    { cameraDistance: 40, cameraHeight: .8, lookAheadDistance: 9, lookHeight: .4, buildingDensity: .85, buildingHeight: 1.15 },
    { cameraDistance: 72, cameraHeight: .3, lookAheadDistance: 9, lookHeight: .2, buildingDensity: 1, buildingHeight: 1 },
  ])
})
it('enforces both palettes and light-only constraints', () => {
  for (const theme of ['light', 'dark'] as const) {
    expect(Object.keys(LOOKS[theme])).toEqual([...CHAPTER_IDS])
    const angles = CHAPTER_IDS.map(id => LOOKS[theme][id].sunAzimuth)
    expect(Math.max(...angles) - Math.min(...angles)).toBeLessThanOrEqual(120)
    for (const id of CHAPTER_IDS) {
      const look = LOOKS[theme][id]
      expect(look.fogDensity).toBeGreaterThanOrEqual(.035)
      for (const value of Object.values(look)) {
        for (const n of Array.isArray(value) ? value : [value]) expect(Number.isFinite(n)).toBe(true)
        if (Array.isArray(value)) value.forEach(n => {
          expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1)
        })
      }
      for (const key of ['windowLitRatio', 'starOpacity', 'sunGlow', 'cloudCover'] as const) {
        expect(look[key]).toBeGreaterThanOrEqual(0); expect(look[key]).toBeLessThanOrEqual(1)
      }
      if (theme === 'light') {
        expect(look.bloomStrength).toBe(0); expect(look.starOpacity).toBe(0)
        const hsl = { h: 0, s: 0, l: 0 }
        new Color().setRGB(...look.skyZenith, SRGBColorSpace).getHSL(hsl, SRGBColorSpace)
        expect(hsl.h * 360).toBeGreaterThanOrEqual(200)
        expect(hsl.h * 360).toBeLessThanOrEqual(230)
      }
    }
  }
  expect(CHAPTER_IDS.map(id => LOOKS.dark[id].windowLitRatio)).toEqual([.3, .55, .75, .9])
  expect(CHAPTER_IDS.map(id => LOOKS.dark[id].bloomStrength)).toEqual([.12, .25, .35, .42])
  expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0])
})

it('keeps night clouds faint (spec 09 test 16, retuned 2026-10-09)', () => {
  expect(LOOKS.dark.about.cloudCover).toBe(.1)
  expect(LOOKS.dark.about.cloudLitColor).toEqual(hexToRgb('#2c3353'))
  expect(LOOKS.dark.about.cloudShadeColor).toEqual(hexToRgb('#181c35'))
})

it('authors wetness per theme: dry day, rain-wet dusk to night', () => {
  expect(CHAPTER_IDS.map(id => LOOKS.light[id].wetness)).toEqual([0, 0, 0, 0])
  expect(CHAPTER_IDS.map(id => LOOKS.dark[id].wetness)).toEqual([0, .15, .4, .7])
})
