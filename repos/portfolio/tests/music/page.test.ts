import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { musicEnabled } from '../../app/music/playlist'
import type { MusicConfig } from '../../types/site'

const source = readFileSync(new URL('../../app/pages/index.vue', import.meta.url), 'utf8')

const empty: MusicConfig = { volume: 0.4, fadeSeconds: 1.5, themeCrossfadeSeconds: 1.2, light: [], dark: [] }

describe('journey page', () => {
  it('renders MusicControl only when music is enabled, and passes isDark', () => {
    expect(source).toMatch(/<MusicControl\s+v-if="musicEnabled\(siteConfig\.music\)"\s+:is-dark="isDark"\s*\/>/)
  })

  it('imports musicEnabled from the playlist module', () => {
    expect(source).toMatch(/import \{ musicEnabled \} from '~\/music\/playlist'/)
  })

  it('treats empty lists as disabled, so nothing renders and no audio code runs', () => {
    expect(musicEnabled(empty)).toBe(false)
  })
})
