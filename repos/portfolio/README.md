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

## Résumé and profile

Profile and project content are based on Kai Nguyen's résumé. The downloadable copy is `public/resume.pdf`; replace it when updating the résumé. Project dates use the employer start month for ordering because individual project start dates were not provided. The Atherlabs role is listed as ongoing in the source résumé.
