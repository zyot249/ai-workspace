export interface SiteSocials {
  github?: string
  linkedin?: string
  x?: string
  email?: string
}

export interface SkillGroup {
  category: string
  items: string[]
}

export interface Track {
  src: string       // path under /audio/, for example '/audio/morning-walk.mp3'
  title: string
  artist: string
  credit: string    // license and attribution line, shown in the control
}

export interface MusicConfig {
  volume: number                 // 0..1, level at full fade-in
  fadeSeconds: number            // start, stop, hide, and show fades
  themeCrossfadeSeconds: number  // theme toggle crossfade
  light: readonly Track[]
  dark: readonly Track[]
}

export interface SiteConfig {
  name: string
  tagline: string
  resumeUrl: string
  socials: SiteSocials
  skills: SkillGroup[]
  music: MusicConfig
}
