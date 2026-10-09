import { expect, it } from 'vitest'
import { advanceBlend, createThemeController, retarget, THEME_BLEND_SECONDS } from '../../app/journey/theme-blend'

it('takes 1.2 seconds, caps dt, preserves input, and reverses continuously', () => {
  expect(THEME_BLEND_SECONDS).toBe(1.2)
  const start = Object.freeze({ mix: 0, target: 1 as const })
  let value = start as { mix: number; target: 0 | 1 }
  for (let i = 0; i < 36; i++) value = advanceBlend(value, 1 / 60)
  expect(value.mix).toBeCloseTo(.5, 12)
  for (let i = 0; i < 36; i++) value = advanceBlend(value, 1 / 60)
  expect(value.mix).toBe(1)
  expect(start.mix).toBe(0)
  expect(advanceBlend(start, 5).mix).toBeCloseTo(.1 / 1.2, 12)
  expect(advanceBlend(start, -1).mix).toBe(0)
  expect(advanceBlend(start, NaN).mix).toBe(0)
  const mid = Object.freeze({ mix: .4, target: 1 as const })
  const reversed = retarget(mid, false, false)
  expect(reversed).toEqual({ mix: .4, target: 0 })
  expect(advanceBlend(reversed, .06).mix).toBeCloseTo(.35, 12)
  expect(retarget(mid, false, true)).toEqual({ mix: 0, target: 0 })
  expect(retarget(mid, true, true)).toEqual({ mix: 1, target: 1 })
  expect(mid).toEqual({ mix: .4, target: 1 })
})
it('first call snaps even when animate is true; repeated targets do nothing', () => {
  const c = createThemeController(false)
  expect(c.setTheme(true, { animate: true })).toEqual({ changed: true, snapped: true })
  expect(c.mix).toBe(1)
  expect(c.setTheme(false)).toEqual({ changed: true, snapped: false })
  c.advance(0); c.advance(.06)
  const before = c.mix
  expect(c.setTheme(false, { animate: false })).toEqual({ changed: false, snapped: false })
  expect(c.mix).toBe(before)
  expect(c.setTheme(true)).toEqual({ changed: true, snapped: false })
  expect(c.mix).toBe(before)
  expect(c.advance(.12)).toBe(1)
})
it('uses absolute time, clamps gaps, and treats repeated/backward timestamps as zero elapsed', () => {
  const c = createThemeController(false)
  c.setTheme(false); c.setTheme(true)
  expect(c.advance(100)).toBe(0)
  expect(c.advance(100)).toBe(0)
  expect(c.advance(99)).toBe(0)
  expect(c.advance(105)).toBeCloseTo(.1 / 1.2, 12)
  for (let i = 1; i <= 11; i++) c.advance(105 + i / 10)
  expect(c.mix).toBe(1)
})
it('snaps later calls on reduced and when animation is disabled', () => {
  for (const reduced of [false, true]) {
    const c = createThemeController(reduced)
    c.setTheme(true)
    expect(c.setTheme(false, reduced ? undefined : { animate: false }).snapped).toBe(true)
    expect(c.mix).toBe(0)
    expect(c.advance(5)).toBe(0)
  }
})
