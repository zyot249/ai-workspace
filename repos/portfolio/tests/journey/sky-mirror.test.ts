import { describe, expect, it } from 'vitest'
import { LOOKS, type LookState, type Vec3 } from '../../app/journey/stops'
import { targetFor } from '../../app/journey/target'
import {
  CLOUD_OCTAVES, CLOUD_SOFTNESS, COVER_THRESHOLDS, SKY_MAX_LUMINANCE, cloudDensity, cloudFbm, cloudUv,
  composeSky, gradientAt, luminance, skyCurve, skyGradient, skyLayers, skyParamsFor, sunDirectionFor,
  sunVisibilityFor, toLinear, type SkyVariant,
} from '../../app/journey/sky-mirror'
import { displayBytes, maxChannelDelta } from '../gpu/sky-expect'

const VARIANTS: readonly SkyVariant[] = ['full', 'lite']
const MIXES = [0, .25, .5, .75, 1]

function dirAt(h: number, azimuthDeg: number): Vec3 {
  const a = azimuthDeg * Math.PI / 180, r = Math.sqrt(Math.max(0, 1 - h * h))
  return [r * Math.cos(a), h, r * Math.sin(a)]
}

// Every chapter of both arcs and three blends between them.
function allLooks(): LookState[] {
  const looks: LookState[] = []
  for (let chapter = 0; chapter < 4; chapter++) for (const mix of MIXES) looks.push(targetFor(chapter, 0, mix, false))
  return looks
}

// Spec 09 test 5 grid: h in [0.15, 1] in 0.01 steps, 64 azimuths.
const COVERAGE_GRID: Vec3[] = Array.from({ length: 86 }, (_, i) => .15 + i * .01)
  .flatMap(h => Array.from({ length: 64 }, (_, a) => dirAt(h, a / 64 * 360)))
const noiseAt = (dir: Vec3, variant: SkyVariant) => cloudFbm(...cloudUv(dir, [0, 0]), CLOUD_OCTAVES[variant])

describe('sun', () => {
  it('builds unit directions from elevation and azimuth', () => {
    for (const [e, a] of [[0, 0], [38, -60], [-22, 10], [90, 45]] as const) {
      const d = sunDirectionFor(e, a)
      expect(Math.hypot(...d)).toBeCloseTo(1, 12)
    }
    sunDirectionFor(90, 0).forEach((v, i) => expect(v).toBeCloseTo([0, 1, 0][i]!, 12))
    sunDirectionFor(0, 0).forEach((v, i) => expect(v).toBeCloseTo([0, 0, -1][i]!, 12))
    sunDirectionFor(0, 90).forEach((v, i) => expect(v).toBeCloseTo([-1, 0, 0][i]!, 12))
    expect(sunDirectionFor(-22, 10)[1]).toBeLessThan(0)
  })

  it('fades sun visibility below the horizon', () => {
    expect(sunVisibilityFor(sunDirectionFor(7, 0)[1])).toBe(1)
    expect(sunVisibilityFor(sunDirectionFor(-3, 0)[1])).toBeCloseTo(.92, 2)
    expect(sunVisibilityFor(sunDirectionFor(-22, 0)[1])).toBe(0)
  })
})

describe('gradient', () => {
  it('pins the curve', () => {
    expect(skyCurve(.05)).toBeLessThan(.005)
    expect(skyCurve(0)).toBe(0)
    expect(skyCurve(1)).toBe(1)
  })

  it('reaches the zenith colour exactly at h = 1', () => {
    for (const look of allLooks()) {
      const p = skyParamsFor(look, [0, 0])
      expect(gradientAt(1, p)).toEqual(p.zenith)
    }
  })

  it('equals the authored fog colour at and below the horizon in every look and blend', () => {
    let worst = 0
    for (const look of allLooks()) for (const offset of [[0, 0], [12.3, -4.5]] as const) for (const variant of VARIANTS) {
      const p = skyParamsFor(look, offset), fog = toLinear(look.fogColor)
      for (let i = 0; i <= 8; i++) for (let a = 0; a < 360; a += 22.5) {
        const c = skyGradient(dirAt(Math.min(-.03 + i * .005, .01), a), p, variant)
        worst = Math.max(worst, ...c.map((v, k) => Math.abs(v - fog[k]!)))
      }
    }
    expect(worst).toBeLessThan(1e-6)
  })

  it('never exceeds SKY_MAX_LUMINANCE, including looking into the sun', () => {
    let worst = 0
    for (const look of allLooks()) for (const variant of VARIANTS) {
      const p = skyParamsFor(look, [0, 0])
      const dirs: Vec3[] = [p.sunDir]
      for (let h = -.1; h <= 1; h += .02) for (let a = 0; a < 360; a += 11.25) dirs.push(dirAt(Math.min(h, 1), a))
      for (const d of dirs) worst = Math.max(worst, luminance(skyGradient(d, p, variant)))
    }
    expect(worst).toBeLessThanOrEqual(SKY_MAX_LUMINANCE + 1e-9)
  })

  it('is continuous: the gradient in 0.01 steps, the cloudless sky in 0.0005 steps', () => {
    let gradientStep = 0, skyStep = 0
    for (const look of allLooks()) {
      const p = { ...skyParamsFor(look, [0, 0]), cloudCover: 0 }
      for (let i = 0; i < 104; i++) {
        const a = gradientAt(-.05 + i * .01, p), b = gradientAt(-.05 + (i + 1) * .01, p)
        gradientStep = Math.max(gradientStep, ...a.map((v, k) => Math.abs(v - b[k]!)))
      }
      for (let az = 0; az < 360; az += 30) for (let i = 0; i < 2100; i++) {
        const a = skyGradient(dirAt(-.05 + i * .0005, az), p, 'lite')
        const b = skyGradient(dirAt(-.05 + (i + 1) * .0005, az), p, 'lite')
        skyStep = Math.max(skyStep, ...a.map((v, k) => Math.abs(v - b[k]!)))
      }
    }
    expect(gradientStep).toBeLessThan(.05)
    expect(skyStep).toBeLessThan(.05)
  })

  it('adds no sun terms at dark about', () => {
    const p = skyParamsFor(LOOKS.dark.about, [0, 0])
    let worst = 0
    for (let h = -.1; h <= 1; h += .02) for (let a = 0; a < 360; a += 15) {
      worst = Math.max(worst, ...skyLayers(dirAt(Math.min(h, 1), a), p, 'full').glow)
    }
    expect(worst).toBeLessThan(1 / 255)
  })
})

describe('clouds', () => {
  it.each(VARIANTS)('cover thresholds are measured from the %s mirror', variant => {
    const sorted = COVERAGE_GRID.map(d => noiseAt(d, variant)).sort((a, b) => a - b)
    const table = COVER_THRESHOLDS[variant]
    expect(table[0]).toBe(1)
    expect(table[4]).toBe(-.2)
    expect(sorted.at(-1)!).toBeLessThan(table[0]!)
    expect(sorted[0]!).toBeGreaterThan(table[4]! + CLOUD_SOFTNESS)
    ;[.25, .5, .75].forEach((cover, k) => {
      const measured = sorted[Math.floor((1 - cover) * sorted.length)]! - CLOUD_SOFTNESS / 2
      expect(Math.abs(table[k + 1]! - measured)).toBeLessThan(1e-3)
    })
  })

  it.each(VARIANTS)('covers the upper sky to within 0.1 of cloudCover: %s', variant => {
    for (const cover of [.25, .45, .55, .65]) {
      const covered = COVERAGE_GRID.filter(d => cloudDensity(noiseAt(d, variant), d[1], cover, variant) > .5).length
      expect(Math.abs(covered / COVERAGE_GRID.length - cover)).toBeLessThanOrEqual(.1)
    }
    expect(COVERAGE_GRID.every(d => cloudDensity(noiseAt(d, variant), d[1], 0, variant) === 0)).toBe(true)
  })

  it.each(VARIANTS)('keeps clouds off the horizon: %s', variant => {
    for (const h of [-.2, 0, .01, .02]) for (const noise of [0, .5, 1]) {
      expect(cloudDensity(noise, h, 1, variant)).toBe(0)
    }
  })

  it('keeps night clouds within 8/255 of the clear sky at dark about', () => {
    const look = LOOKS.dark.about
    let worst = 0
    for (const variant of VARIANTS) for (const offset of [[0, 0], [7.3, 2.1], [19.7, -4.4], [-11, 14]] as const) {
      const p = skyParamsFor(look, offset)
      for (let i = 0; i <= 98; i++) for (let a = 0; a < 64; a++) {
        const layers = skyLayers(dirAt(.02 + i * .01, a / 64 * 360), p, variant)
        worst = Math.max(worst, maxChannelDelta(displayBytes(composeSky(layers), look.exposure),
          displayBytes(composeSky(layers, 0), look.exposure)))
      }
    }
    expect(worst).toBeLessThanOrEqual(8)
  })
})
