import { expect, test } from '@playwright/test'
import * as THREE from 'three'
import { aoEffective, facadeLookFor, GRADIENT_GROUND_Y, RIM_DEPTH, rimAmount } from '../../app/journey/facade-gradient'
import { sunDirectionFor, sunVisibilityFor } from '../../app/journey/sky-mirror'
import { CHAPTER_IDS, type ChapterId, LOOKS, type Theme } from '../../app/journey/stops'

const THEMES: readonly Theme[] = ['light', 'dark']
const AO_HEIGHTS = [0.02, 0.2, 0.45, 0.9, 1.5, 2.4]
const FACES = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] } as const
type Face = keyof typeof FACES

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gpu/harness.html')
  await page.waitForFunction(() => Boolean(window.cityGpu))
})

for (const variant of ['full', 'lite'] as const) {
  test(`${variant}: the AO term matches the CPU mirror at every stop strength`, async ({ page }) => {
    for (const theme of THEMES) {
      for (const chapter of CHAPTER_IDS) {
        const strength = facadeLookFor(LOOKS[theme][chapter], 1).uAoStrength
        const result = await page.evaluate(input => window.cityGpu.probeGradient(input), {
          variant, buildingHeight: 3, face: 'front' as Face, output: 'ao' as const,
          sampleHeights: AO_HEIGHTS, aoStrength: strength,
        })
        expect(result.shaderError).toBeNull()
        expect(result.glError).toBe(0)
        result.heights.forEach((height, i) => {
          for (const channel of [0, 1, 2]) {
            expect(result.samples[i]![channel], `${theme} ${chapter} h=${height}`).toBeCloseTo(aoEffective(height, strength), 3)
          }
        })
        // Spec criterion: luminance 0.2 above the base is at most 70% of luminance 1.5 above it.
        const low = result.samples[1]![0]!
        const high = result.samples[4]![0]!
        expect(low / high, `${theme} ${chapter}`).toBeLessThanOrEqual(0.7)
      }
    }
  })

  test(`${variant}: the AO term depends on world height, not on building height`, async ({ page }) => {
    const heights = [0.4, 1.2]
    const probe = (buildingHeight: number) => page.evaluate(input => window.cityGpu.probeGradient(input), {
      variant, buildingHeight, face: 'front' as Face, output: 'ao' as const, sampleHeights: heights, aoStrength: 1,
    })
    const short = await probe(3)
    const tall = await probe(5)
    for (const result of [short, tall]) {
      expect(result.shaderError).toBeNull()
      expect(result.glError).toBe(0)
    }
    heights.forEach((_, i) => {
      const a = short.samples[i]![0]!
      const b = tall.samples[i]![0]!
      expect(Math.abs(a - b) / a).toBeLessThan(0.03)
    })
  })
}

test('full: the rim moves with the roof', async ({ page }) => {
  const sunDir = [0, 0.2, 0.98] as const
  const dot = sunDir[2] / Math.hypot(...sunDir)
  for (const buildingHeight of [3, 5]) {
    const sampleHeights = Array.from({ length: 80 }, (_, i) => buildingHeight - 0.8 + i * 0.01)
    const result = await page.evaluate(input => window.cityGpu.probeGradient(input), {
      variant: 'full' as const, buildingHeight, face: 'front' as Face, output: 'emission' as const,
      sampleHeights, rimStrength: 0.35, sunDir, sunColor: [1, 1, 1] as const,
    })
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
    const topY = buildingHeight + GRADIENT_GROUND_Y
    let peak = 0
    result.heights.forEach((height, i) => {
      const expected = 0.35 * rimAmount(height + GRADIENT_GROUND_Y, topY, dot)
      expect(result.samples[i]![0]).toBeCloseTo(expected, 3)
      if (result.samples[i]![0]! > result.samples[peak]![0]!) peak = i
    })
    expect(topY - (result.heights[peak]! + GRADIENT_GROUND_Y)).toBeLessThanOrEqual(RIM_DEPTH)
    expect(result.samples[peak]![0]).toBeGreaterThan(0.1)
    expect(result.samples[0]![0]).toBeCloseTo(0, 6)
  }
})

function sunFor(theme: Theme, chapter: ChapterId) {
  const look = LOOKS[theme][chapter]
  const dir = sunDirectionFor(look.sunElevation, look.sunAzimuth)
  const color = new THREE.Color().setRGB(look.sunColor[0], look.sunColor[1], look.sunColor[2], THREE.SRGBColorSpace)
  const face = (Object.keys(FACES) as Face[]).reduce((best, name) => {
    const score = (key: Face) => FACES[key][0] * dir[0] + FACES[key][2] * dir[2]
    return score(name) > score(best) ? name : best
  })
  return { dir, face, color: [color.r, color.g, color.b] as const,
    rimStrength: facadeLookFor(look, sunVisibilityFor(dir[1])).uRimStrength }
}

for (const [theme, chapter, label] of [
  ['light', 'intro', 'day'], ['dark', 'projects', 'sunset'], ['dark', 'about', 'night'],
] as const) {
  test(`full: rim at ${label} (${theme} ${chapter})`, async ({ page }) => {
    const sun = sunFor(theme, chapter)
    const buildingHeight = 3
    const result = await page.evaluate(input => window.cityGpu.probeGradient(input), {
      variant: 'full' as const, buildingHeight, face: sun.face, output: 'emission' as const,
      sampleHeights: [buildingHeight - 0.01, buildingHeight - 0.6], rimStrength: sun.rimStrength,
      sunDir: sun.dir, sunColor: sun.color,
    })
    expect(result.shaderError).toBeNull()
    expect(result.glError).toBe(0)
    const [top, below] = result.samples.map(sample => sample[0]!)
    if (label === 'night') {
      expect(sun.rimStrength).toBe(0)
      expect(top!).toBeLessThan(2 / 255)
    } else {
      expect(top!).toBeGreaterThan(0.1)
      expect(top! - below!).toBeGreaterThan(0.1)
    }
  })
}
