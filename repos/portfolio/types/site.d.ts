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

export interface SiteConfig {
  name: string
  tagline: string
  resumeUrl: string
  socials: SiteSocials
  skills: SkillGroup[]
}
