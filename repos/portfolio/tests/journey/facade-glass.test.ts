import { describe, expect, it } from 'vitest'
import {
  GLASS, fresnelAmount, glassColorFor, glassFragmentDeclarations, glassStatements,
  glassVertexDeclarations, glassVertexPatch, glintAmount, reflectedSunDot, type Rgb,
} from '../../app/journey/facade-glass'
import { glslFloat } from '../../app/journey/shader-utils'

const DEG = Math.PI / 180

describe('fresnelAmount', () => {
  it('is 0 head-on, 1 edge-on, and treats a back-facing view as edge-on', () => {
    expect(fresnelAmount(1)).toBe(0)
    expect(fresnelAmount(0)).toBe(1)
    expect(fresnelAmount(-0.5)).toBe(1)
  })
  it('matches (1 - cos)^3 at 76 degrees', () => {
    expect(fresnelAmount(Math.cos(76 * DEG))).toBeCloseTo((1 - Math.cos(76 * DEG)) ** 3, 10)
  })
})

describe('glintAmount', () => {
  it('peaks at a perfect mirror and scales by sun visibility', () => {
    expect(glintAmount(1, 1)).toBe(1)
    expect(glintAmount(1, 0)).toBe(0)
    expect(glintAmount(1, 0.5)).toBeCloseTo(0.5, 10)
  })
  it('is 0 when the reflection points away from the sun', () => {
    expect(glintAmount(0, 1)).toBe(0)
    expect(glintAmount(-0.9, 1)).toBe(0)
  })
  it('falls off as cos^24', () => {
    expect(glintAmount(Math.cos(10 * DEG), 1)).toBeCloseTo(Math.cos(10 * DEG) ** 24, 10)
  })
})

describe('reflectedSunDot', () => {
  const normal = [0, 0, 1] as const
  it('reflects straight back head-on', () => {
    expect(reflectedSunDot(normal, [0, 0, 1], [0, 0, 1])).toBeCloseTo(1, 10)
    expect(reflectedSunDot(normal, [0, 0, 1], [1, 0, 0])).toBeCloseTo(0, 10)
  })
  it('mirrors the view direction about the normal', () => {
    const s = Math.sin(45 * DEG), c = Math.cos(45 * DEG)
    expect(reflectedSunDot(normal, [s, 0, c], [-s, 0, c])).toBeCloseTo(1, 10)
    expect(reflectedSunDot(normal, [s, 0, c], [s, 0, c])).toBeCloseTo(0, 10)
  })
})

describe('glassColorFor', () => {
  const wall: Rgb = [0.04, 0.05, 0.1]
  const skyTint: Rgb = [0.5, 0.7, 1]
  const sunColor: Rgb = [1, 0.75, 0.4]
  const base = { wall, skyTint, sunColor, normal: [0, 0, 1] as const, sunDir: [1, 0, 0] as const, sunVisibility: 1 }
  const expectedMix = (t: number): Rgb => [0, 1, 2].map(i => wall[i]! * GLASS.darkFactor * (1 - t) + skyTint[i]! * t) as unknown as Rgb

  it('is 65% dark wall and 35% sky head-on with no glint', () => {
    const out = glassColorFor({ ...base, view: [0, 0, 1] })
    const want = expectedMix(GLASS.tintBase)
    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(want[i]!, 10)
  })
  it('moves toward the sky at a grazing view', () => {
    const view = [Math.sin(76 * DEG), 0, Math.cos(76 * DEG)] as const
    const out = glassColorFor({ ...base, view })
    const want = expectedMix(GLASS.tintBase + GLASS.tintFresnel * fresnelAmount(Math.cos(76 * DEG)))
    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(want[i]!, 10)
  })
  it('adds sunColor * 0.8 on a perfect mirror and nothing when sunVisibility is 0', () => {
    const lit = glassColorFor({ ...base, sunDir: [0, 0, 1], view: [0, 0, 1] })
    const dark = glassColorFor({ ...base, sunDir: [0, 0, 1], view: [0, 0, 1], sunVisibility: 0 })
    for (let i = 0; i < 3; i++) expect(lit[i]! - dark[i]!).toBeCloseTo(sunColor[i]! * GLASS.glintGain, 10)
    const away = glassColorFor({ ...base, view: [0, 0, 1] })
    expect(dark).toEqual(away)
  })
})

describe('GLSL fragments', () => {
  it('full glass uses the spec 06 constants and the spec 04 inputs', () => {
    const source = glassStatements('full')
    expect(source).toContain(`wallColor * ${glslFloat(GLASS.darkFactor)}`)
    expect(source).toContain('normalize(vWorldNormal)')
    expect(source).toContain('normalize(cameraPosition - vWorldPos)')
    expect(source).toContain(`pow(1.0 - max(dot(glassN, glassV), 0.0), ${glslFloat(GLASS.fresnelPower)})`)
    expect(source).toContain('reflect(-glassV, glassN)')
    expect(source).toContain(`pow(max(dot(glassR, uSunDir), 0.0), ${glslFloat(GLASS.glintPower)}) * uSunVisibility`)
    expect(source).toContain(`mix(glassDark, uSkyTint, ${glslFloat(GLASS.tintBase)} + ${glslFloat(GLASS.tintFresnel)} * glassFresnel)`)
    expect(source).toContain(`uSunColor * glassGlint * ${glslFloat(GLASS.glintGain)}`)
  })
  it('lite keeps the flat spec 01 tint and emits no other glass code', () => {
    expect(glassStatements('lite')).toBe('vec3 glass = mix(wallColor, uSkyTint * 0.35, 0.6);')
    expect(glassVertexDeclarations('lite')).toBe('')
    expect(glassVertexPatch('lite')).toBe('')
    expect(glassFragmentDeclarations('lite')).toBe('')
  })
  it('full declares vWorldPos and uSunVisibility, and derives vWorldPos from facadeModel', () => {
    expect(glassVertexDeclarations('full')).toContain('varying vec3 vWorldPos;')
    expect(glassFragmentDeclarations('full')).toContain('varying vec3 vWorldPos;')
    expect(glassFragmentDeclarations('full')).toContain('uniform float uSunVisibility;')
    expect(glassVertexPatch('full')).toContain('vWorldPos = (facadeModel * vec4(position, 1.0)).xyz;')
  })
})
