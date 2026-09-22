# Portfolio

Personal dev portfolio. Nuxt 4 + TypeScript + Tailwind + `@nuxt/content`.

## Develop

```bash
npm install
npm run dev
```

## Build (static)

```bash
npm run generate
```

## Content

Edit markdown in `content/projects/*.md` and `content/about.md`.
Site-wide config (name, socials, skills) is in `site.config.ts`.

## Deploy

Connect this repo folder to Vercel (root directory: `repos/portfolio`). Build command and output directory are set in `vercel.json`.

## Before launch

`public/resume.pdf` does not exist yet. Add the actual resume file at that path, or update `site.config.ts`'s `resumeUrl` to point elsewhere, before the site goes live — otherwise the Hero's "Resume" link 404s.
