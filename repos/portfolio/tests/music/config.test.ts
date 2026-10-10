import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { siteConfig } from '../../site.config'
import type { MusicConfig, Track } from '../../types/site'
import { MAX_TRACK_BYTES, validateMusicConfig } from './support/validate-music-config'

const track: Track = { src: '/audio/ok.mp3', title: 'Morning walk', artist: 'A. Artist', credit: 'CC BY 4.0' }

function configWith(overrides: Partial<MusicConfig>): MusicConfig {
  return { volume: 0.4, fadeSeconds: 1.5, themeCrossfadeSeconds: 1.2, light: [track], dark: [], ...overrides }
}

function makePublicDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'music-public-'))
  mkdirSync(join(root, 'audio'))
  writeFileSync(join(root, 'audio', 'ok.mp3'), Buffer.alloc(10))
  writeFileSync(join(root, 'audio', 'big.mp3'), Buffer.alloc(MAX_TRACK_BYTES + 1))
  return root
}

describe('shipped music config', () => {
  it('passes every rule', () => {
    const publicDir = fileURLToPath(new URL('../../public', import.meta.url))
    expect(validateMusicConfig(siteConfig.music, publicDir)).toEqual([])
  })
})

describe('validateMusicConfig', () => {
  const publicDir = makePublicDir()

  it('accepts a valid config', () => {
    expect(validateMusicConfig(configWith({}), publicDir)).toEqual([])
  })

  it('rejects a volume outside 0..1', () => {
    expect(validateMusicConfig(configWith({ volume: 1.5 }), publicDir)).toEqual(['volume must be in [0, 1]'])
    expect(validateMusicConfig(configWith({ volume: -0.1 }), publicDir)).toEqual(['volume must be in [0, 1]'])
  })

  it('rejects fade lengths outside (0, 5]', () => {
    expect(validateMusicConfig(configWith({ fadeSeconds: 0 }), publicDir)).toEqual(['fadeSeconds must be in (0, 5]'])
    expect(validateMusicConfig(configWith({ themeCrossfadeSeconds: 5.1 }), publicDir)).toEqual([
      'themeCrossfadeSeconds must be in (0, 5]',
    ])
  })

  it('rejects a src with the wrong prefix or extension', () => {
    const bad = configWith({ light: [{ ...track, src: '/media/ok.mp3' }], dark: [{ ...track, src: '/audio/ok.wav' }] })
    expect(validateMusicConfig(bad, publicDir)).toEqual([
      'light[0].src must start with /audio/ and end with .mp3',
      'dark[0].src must start with /audio/ and end with .mp3',
    ])
  })

  it('rejects a file that does not exist', () => {
    const bad = configWith({ light: [{ ...track, src: '/audio/missing.mp3' }] })
    expect(validateMusicConfig(bad, publicDir)).toEqual(['light[0].src names a file that does not exist in public/'])
  })

  it('rejects a file over 6 MB', () => {
    const bad = configWith({ light: [{ ...track, src: '/audio/big.mp3' }] })
    expect(validateMusicConfig(bad, publicDir)).toEqual(['light[0].src is larger than 6 MB'])
  })

  it('rejects empty title, artist, and credit', () => {
    const bad = configWith({ light: [{ ...track, title: '', artist: ' ', credit: '' }] })
    expect(validateMusicConfig(bad, publicDir)).toEqual([
      'light[0].title must not be empty',
      'light[0].artist must not be empty',
      'light[0].credit must not be empty',
    ])
  })

  it('accepts empty lists', () => {
    expect(validateMusicConfig(configWith({ light: [], dark: [] }), publicDir)).toEqual([])
  })
})
