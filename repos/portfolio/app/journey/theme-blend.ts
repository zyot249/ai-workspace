import { clamp01 } from './interpolate'

export const THEME_BLEND_SECONDS = 1.2
export interface ThemeBlend { mix: number; target: 0 | 1 }

export function advanceBlend(blend: ThemeBlend, dt: number): ThemeBlend {
  const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(.1, dt)) : 0
  const next = blend.mix + (blend.target === 1 ? 1 : -1) * elapsed / THEME_BLEND_SECONDS
  const mix = clamp01(next)
  return { mix: Math.abs(mix - blend.target) < 1e-12 ? blend.target : mix, target: blend.target }
}

export function retarget(blend: ThemeBlend, isDark: boolean, snap: boolean): ThemeBlend {
  const target = isDark ? 1 : 0
  return { mix: snap ? target : blend.mix, target }
}

export interface ThemeController {
  readonly mix: number
  readonly target: 0 | 1
  setTheme(isDark: boolean, options?: { animate?: boolean }): { changed: boolean; snapped: boolean }
  advance(t: number): number
}

export function createThemeController(reduced: boolean): ThemeController {
  let blend: ThemeBlend = { mix: 0, target: 0 }
  let initialized = false
  let previousTime: number | null = null
  return {
    get mix() { return blend.mix },
    get target() { return blend.target },
    setTheme(isDark, options) {
      const target = isDark ? 1 : 0
      if (initialized && target === blend.target) return { changed: false, snapped: false }
      const snapped = !initialized || reduced || options?.animate === false
      initialized = true
      blend = retarget(blend, isDark, snapped)
      if (snapped) previousTime = null
      return { changed: true, snapped }
    },
    advance(t) {
      if (!Number.isFinite(t)) return blend.mix
      const dt = previousTime === null ? 0 : Math.max(0, t - previousTime)
      previousTime = previousTime === null ? t : Math.max(previousTime, t)
      blend = advanceBlend(blend, dt)
      return blend.mix
    },
  }
}
