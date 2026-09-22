import type { SiteConfig } from './types/site'

export const siteConfig: SiteConfig = {
  name: 'Your Name',
  tagline: 'Building things for the web.',
  resumeUrl: '/resume.pdf',
  socials: {
    github: 'https://github.com/yourhandle',
    linkedin: 'https://linkedin.com/in/yourhandle',
    email: 'mailto:you@example.com',
  },
  skills: [
    { category: 'Languages', items: ['TypeScript', 'Python', 'Rust'] },
    { category: 'Frontend', items: ['Vue', 'Nuxt', 'Tailwind CSS'] },
    { category: 'Backend', items: ['Node.js', 'PostgreSQL'] },
  ],
}
