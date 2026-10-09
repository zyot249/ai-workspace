import { describe, expect, it } from 'vitest'
import { Color, ShaderChunk, SRGBColorSpace } from 'three'
import { STOPS, hexToRgb } from '../../app/journey/stops'
import { bloomEnabled, neutralToneMap, POST_EMISSIVES, probePostSupport, skyForDirectPipeline } from '../../app/journey/post'

describe('post color contract', () => {
  it('disables bloom strictly below the boundary', () => {
    expect(bloomEnabled(0)).toBe(false)
    expect(bloomEnabled(0.009999)).toBe(false)
    expect(bloomEnabled(0.01)).toBe(true)
    expect(bloomEnabled(0.42)).toBe(true)
  })
  it.each([
    ['#bfdbfe', 1, '#b2cdef'], ['#fbbf9f', 1, '#eeb393'], ['#1e2340', 1.25, '#05133f'],
  ] as const)('maps %s at exposure %s', (input, exposure, output) => {
    const got = skyForDirectPipeline(hexToRgb(input), exposure)
    const expected = hexToRgb(output)
    got.forEach((v, i) => expect(Math.abs(v - expected[i]!)).toBeLessThanOrEqual(1 / 255))
  })
  it('pins the mirror to the installed shader curve', () => {
    const shader = ShaderChunk.tonemapping_pars_fragment
    for (const text of ['vec3 NeutralToneMapping', '0.8 - 0.04', 'Desaturation = 0.15',
      'x < 0.08 ? x - 6.25 * x * x : 0.04', 'color *= toneMappingExposure']) {
      expect(shader).toContain(text)
    }
  })
  it('uses linear input, forward mapping, and sRGB output at every exposure', () => {
    for (const stop of STOPS) for (const rgb of [stop.skyColor, stop.fogColor]) {
      for (const exposure of [...STOPS.map(s => s.exposure), 1.05, 1.15, 1.2]) {
        const linear = new Color().setRGB(...rgb, SRGBColorSpace).toArray() as [number, number, number]
        const output = new Color()
        new Color().setRGB(...neutralToneMap(linear, exposure)).getRGB(output, SRGBColorSpace)
        const expected = output.toArray()
        skyForDirectPipeline(rgb, exposure).forEach((v, i) => {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(1)
          expect(Math.abs(v - expected[i]!)).toBeLessThanOrEqual(1 / 255)
        })
      }
    }
    expect(neutralToneMap([0, 0, 0], 1.25)).toEqual([0, 0, 0])
    expect(neutralToneMap([0.08, 0.08, 0.08], 1)).toEqual([0.04, 0.04, 0.04])
    neutralToneMap([10, 5, 2], 1.25).forEach(v => expect(Number.isFinite(v)).toBe(true))
  })
  it('owned source gains satisfy pre-fog linear luminance, and facade contract remains compatible', () => {
    for (const source of [...Object.values(POST_EMISSIVES), { hex: 0xffe1a8, gain: 2.7 }]) {
      const c = new Color(source.hex).multiplyScalar(source.gain)
      expect(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b).toBeGreaterThanOrEqual(2)
    }
  })

  it('chooses only supported RGBA16F sample counts <= 4 and accepts none', () => {
    function renderer(counts: number[]) {
      return {
        extensions: { has: () => true },
        getContext: () => ({ RENDERBUFFER: 0x8d41, RGBA16F: 0x881a, SAMPLES: 0x80a9,
          getInternalformatParameter: () => new Int32Array(counts) }),
      } as unknown as import('three').WebGLRenderer
    }
    expect(probePostSupport(renderer([8, 4, 2]))).toEqual({ samples: 4 })
    expect(probePostSupport(renderer([8, 2]))).toEqual({ samples: 2 })
    expect(probePostSupport(renderer([]))).toEqual({ samples: 0 })
  })
  it('rejects missing half-float extension and a failed sample query', () => {
    expect(probePostSupport({ extensions: { has: () => false } } as unknown as import('three').WebGLRenderer)).toBeNull()
    expect(probePostSupport({ extensions: { has: () => true }, getContext: () => ({
      getInternalformatParameter: () => { throw new Error('query unavailable') },
    }) } as unknown as import('three').WebGLRenderer)).toBeNull()
  })
})
