import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { MusicConfig, Track } from '../../../types/site'

export const MAX_TRACK_BYTES = 6 * 1024 * 1024
export const MAX_FADE_SECONDS = 5

function validateTrack(track: Track, label: string, publicDir: string): string[] {
  const errors: string[] = []
  if (!track.src.startsWith('/audio/') || !track.src.endsWith('.mp3')) {
    errors.push(`${label}.src must start with /audio/ and end with .mp3`)
  } else {
    try {
      if (statSync(join(publicDir, track.src)).size > MAX_TRACK_BYTES) errors.push(`${label}.src is larger than 6 MB`)
    } catch {
      errors.push(`${label}.src names a file that does not exist in public/`)
    }
  }
  for (const field of ['title', 'artist', 'credit'] as const) {
    if (track[field].trim() === '') errors.push(`${label}.${field} must not be empty`)
  }
  return errors
}

export function validateMusicConfig(config: MusicConfig, publicDir: string): string[] {
  const errors: string[] = []
  if (!(config.volume >= 0 && config.volume <= 1)) errors.push('volume must be in [0, 1]')
  for (const key of ['fadeSeconds', 'themeCrossfadeSeconds'] as const) {
    if (!(config[key] > 0 && config[key] <= MAX_FADE_SECONDS)) errors.push(`${key} must be in (0, 5]`)
  }
  for (const theme of ['light', 'dark'] as const) {
    config[theme].forEach((track, index) => errors.push(...validateTrack(track, `${theme}[${index}]`, publicDir)))
  }
  return errors
}
