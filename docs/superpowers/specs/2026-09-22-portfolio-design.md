# Portfolio site — design spec

Date: 2026-09-22

## Goal

Personal dev portfolio: showcase projects, skills, about, contact. Static-ish site, no backend/DB.

## Location

`repos/portfolio/` — new self-contained project per workspace convention (own toolchain, own README).

## Stack

- Nuxt 4 + TypeScript
- Tailwind CSS
- `@nuxt/content` (v3) — markdown-driven content
- Deploy: Vercel

## Content model

Markdown files under `content/`:
- `content/projects/*.md` — frontmatter: `title`, `description`, `stack` (string[]), `links` (repo/demo), `cover` (image path), `featured` (bool), `date`
- `content/about.md` — bio body markdown

Config-driven (not markdown) in `site.config.ts`:
- name, tagline, socials (github/linkedin/email/x), resume link
- skills list: `{ category: string, items: string[] }[]`

## Routes / pages

- `/` — Hero, featured projects (subset where `featured: true`), skills strip, brief about teaser, contact links
- `/projects` — full project list (cards)
- `/projects/[slug]` — project detail, renders markdown body + frontmatter meta
- `/about` — full bio (renders `about.md`)

## Components

- `Hero.vue` — name, tagline, CTA buttons (view projects, resume)
- `ProjectCard.vue` — cover, title, short desc, stack badges, links
- `SkillBadge.vue` — single skill pill, grouped by category on skills section
- `Nav.vue` — top nav, links to sections/pages, dark mode toggle
- `Footer.vue` — socials, copyright

## Design language

Bold/colorful: vivid accent/gradient primary color, punchy type scale for headings, generous spacing. Tailwind dark mode support (`dark:` variants), default to system preference.

## Data flow

`@nuxt/content` queries markdown collections at build time → `nuxt generate` static output → deploy to Vercel. No backend, no database, no contact-form submission handler (contact = mailto/social links only).

## Out of scope (this iteration)

- Blog
- Analytics
- Backend contact form
- CMS integration
- E2E test suite (flag later if wanted; manual dev-server check only for now)

## Testing plan

Manual: run dev server, visually check each route (`/`, `/projects`, `/projects/[slug]`, `/about`) in browser, verify dark mode toggle, verify responsive at mobile width.
