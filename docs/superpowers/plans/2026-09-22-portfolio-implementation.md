# Portfolio Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, markdown-driven dev portfolio (Nuxt 4 + Tailwind + `@nuxt/content`) with Hero, Projects, About, Contact, deployed via Vercel.

**Architecture:** Nuxt 4 app under `repos/portfolio/`. Content (`projects/*.md`, `about.md`) authored as markdown and queried via `@nuxt/content` v3 collections. Site-wide config (name, socials, skills) lives in a single typed `site.config.ts`. No backend — `nuxt generate` produces a static site.

**Tech Stack:** Nuxt 4, TypeScript, Tailwind CSS (`@nuxtjs/tailwindcss`), `@nuxt/content` v3, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-22-portfolio-design.md`

## Global Constraints

- Project lives at `repos/portfolio/`, self-contained with its own `package.json` (workspace convention — no shared root tooling).
- No backend, no database, no contact-form submission handler — contact is mailto/social links only.
- No blog, no analytics, no CMS, no e2e suite this iteration.
- Dark mode via Tailwind `dark:` variants, default to system preference.
- Testing this iteration is manual (dev-server visual check per route + responsive + dark mode) — matches spec's testing plan. No unit/e2e test framework is introduced.

---

### Task 1: Scaffold Nuxt 4 project with Tailwind

**Files:**
- Create: `repos/portfolio/` (full Nuxt scaffold via `nuxi init`)
- Modify: `repos/portfolio/nuxt.config.ts`
- Create: `repos/portfolio/assets/css/main.css`
- Create: `repos/portfolio/README.md`

**Interfaces:**
- Produces: a running Nuxt dev server at `localhost:3000` serving the default `app.vue`, with Tailwind classes functional.

- [ ] **Step 1: Scaffold the Nuxt project**

```bash
cd /Users/nguyenducdung/Desktop/Zyot/ai-workspace/repos
npx nuxi@latest init portfolio --package-manager npm --git-init false
```

- [ ] **Step 2: Install Tailwind module**

```bash
cd portfolio
npx nuxi@latest module add tailwindcss
```

This installs `@nuxtjs/tailwindcss` and registers it in `nuxt.config.ts` `modules` array automatically.

- [ ] **Step 3: Create the Tailwind entry CSS**

Create `repos/portfolio/assets/css/main.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 4: Wire the CSS into nuxt.config.ts**

Edit `repos/portfolio/nuxt.config.ts` so it includes:

```ts
export default defineNuxtConfig({
  compatibilityDate: '2026-09-22',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss'],
  css: ['~/assets/css/main.css'],
})
```

- [ ] **Step 5: Verify dev server runs with Tailwind working**

Replace the generated `app.vue` body temporarily with a Tailwind-styled element to confirm the pipeline works:

```vue
<template>
  <div class="p-8 text-3xl font-bold text-indigo-600">Portfolio scaffold OK</div>
</template>
```

Run: `npm run dev` (in `repos/portfolio/`), open `http://localhost:3000`.
Expected: page shows large bold indigo text "Portfolio scaffold OK". Stop the dev server after confirming.

- [ ] **Step 6: Write the project README**

Create `repos/portfolio/README.md`:

```markdown
# Portfolio

Personal dev portfolio. Nuxt 4 + TypeScript + Tailwind + `@nuxt/content`.

## Develop

\`\`\`bash
npm install
npm run dev
\`\`\`

## Build (static)

\`\`\`bash
npm run generate
\`\`\`

## Content

Edit markdown in `content/projects/*.md` and `content/about.md`.
Site-wide config (name, socials, skills) is in `site.config.ts`.
```

- [ ] **Step 7: Commit**

```bash
cd /Users/nguyenducdung/Desktop/Zyot/ai-workspace
git add repos/portfolio
git commit -m "Scaffold Nuxt 4 portfolio with Tailwind"
```

---

### Task 2: Add `@nuxt/content`, define collections, site config, types

**Files:**
- Modify: `repos/portfolio/nuxt.config.ts`
- Create: `repos/portfolio/content.config.ts`
- Create: `repos/portfolio/site.config.ts`
- Create: `repos/portfolio/types/site.d.ts`
- Create: `repos/portfolio/content/projects/example-project.md`
- Create: `repos/portfolio/content/about.md`

**Interfaces:**
- Produces: `projects` and `about` collections queryable via `queryCollection('projects')` / `queryCollection('about')`; `siteConfig` object exported from `site.config.ts` with shape `{ name: string, tagline: string, resumeUrl: string, socials: { github?: string, linkedin?: string, x?: string, email?: string }, skills: { category: string, items: string[] }[] }`.

- [ ] **Step 1: Install and register `@nuxt/content`**

```bash
cd /Users/nguyenducdung/Desktop/Zyot/ai-workspace/repos/portfolio
npx nuxi@latest module add content
```

Confirms `@nuxt/content` is added to `nuxt.config.ts` `modules` array (alongside `@nuxtjs/tailwindcss`).

- [ ] **Step 2: Define content collections**

Create `repos/portfolio/content.config.ts`:

```ts
import { defineCollection, defineContentConfig, z } from '@nuxt/content'

export default defineContentConfig({
  collections: {
    projects: defineCollection({
      type: 'page',
      source: 'projects/*.md',
      schema: z.object({
        title: z.string(),
        description: z.string(),
        stack: z.array(z.string()),
        repoUrl: z.string().optional(),
        demoUrl: z.string().optional(),
        cover: z.string().optional(),
        featured: z.boolean().default(false),
        date: z.string(),
      }),
    }),
    about: defineCollection({
      type: 'page',
      source: 'about.md',
      schema: z.object({}),
    }),
  },
})
```

- [ ] **Step 3: Create the site config with typed shape**

Create `repos/portfolio/types/site.d.ts`:

```ts
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
```

Create `repos/portfolio/site.config.ts`:

```ts
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
```

- [ ] **Step 4: Add example content files**

Create `repos/portfolio/content/projects/example-project.md`:

```markdown
---
title: Example Project
description: A short one-line description of what this project does.
stack: [Nuxt, TypeScript, Tailwind CSS]
repoUrl: https://github.com/yourhandle/example-project
demoUrl: https://example.com
featured: true
date: '2026-01-01'
---

## Overview

Longer description of the project goes here. What problem it solves, what you built, what you learned.

## Highlights

- Key feature one
- Key feature two
```

Create `repos/portfolio/content/about.md`:

```markdown
---
title: About
---

I'm a developer who builds things. Replace this with your real bio.

## Background

A paragraph or two about your background, interests, and what you're looking for.
```

- [ ] **Step 5: Verify collections are queryable**

Temporarily add to `app.vue`:

```vue
<script setup lang="ts">
const { data: projects } = await useAsyncData('debug-projects', () => queryCollection('projects').all())
</script>

<template>
  <div class="p-8">
    <pre>{{ projects }}</pre>
  </div>
</template>
```

Run: `npm run dev`, open `http://localhost:3000`.
Expected: page prints a JSON array containing the `example-project` entry with `title: "Example Project"`. Revert `app.vue` to the Task 1 placeholder content afterward (it will be replaced fully in Task 4 anyway).

- [ ] **Step 6: Commit**

```bash
cd /Users/nguyenducdung/Desktop/Zyot/ai-workspace
git add repos/portfolio
git commit -m "Add nuxt/content collections, site config, example content"
```

---

### Task 3: Layout shell — Nav, Footer, dark mode toggle, app.vue

**Files:**
- Create: `repos/portfolio/components/Nav.vue`
- Create: `repos/portfolio/components/Footer.vue`
- Create: `repos/portfolio/composables/useDarkMode.ts`
- Modify: `repos/portfolio/app.vue`
- Modify: `repos/portfolio/nuxt.config.ts`

**Interfaces:**
- Consumes: `siteConfig` from `site.config.ts` (Task 2).
- Produces: `useDarkMode()` composable returning `{ isDark: Ref<boolean>, toggle: () => void }`, used by `Nav.vue` and available to later pages. `Nav.vue` and `Footer.vue` render with no props (read `siteConfig` directly).

- [ ] **Step 1: Enable Nuxt pages routing**

Edit `repos/portfolio/nuxt.config.ts` to confirm pages are enabled (Nuxt 4 auto-detects `pages/` once it exists — created in Task 4). No change needed yet if `app.vue` already contains `<NuxtPage />`; verify this is the case after Step 5 below.

- [ ] **Step 2: Write the dark mode composable**

Create `repos/portfolio/composables/useDarkMode.ts`:

```ts
export function useDarkMode() {
  const isDark = useState('isDark', () => false)

  function apply() {
    if (import.meta.client) {
      document.documentElement.classList.toggle('dark', isDark.value)
      localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
    }
  }

  function toggle() {
    isDark.value = !isDark.value
    apply()
  }

  if (import.meta.client) {
    const stored = localStorage.getItem('theme')
    isDark.value = stored
      ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches
    apply()
  }

  return { isDark, toggle }
}
```

- [ ] **Step 3: Enable Tailwind class-based dark mode**

Edit `repos/portfolio/assets/css/main.css`:

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));
```

- [ ] **Step 4: Write Nav.vue**

Create `repos/portfolio/components/Nav.vue`:

```vue
<script setup lang="ts">
import { siteConfig } from '~/site.config'

const { isDark, toggle } = useDarkMode()
</script>

<template>
  <header class="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-800">
    <NuxtLink to="/" class="font-bold text-lg text-indigo-600 dark:text-indigo-400">
      {{ siteConfig.name }}
    </NuxtLink>
    <nav class="flex items-center gap-6 text-sm">
      <NuxtLink to="/projects" class="hover:text-indigo-600 dark:hover:text-indigo-400">Projects</NuxtLink>
      <NuxtLink to="/about" class="hover:text-indigo-600 dark:hover:text-indigo-400">About</NuxtLink>
      <button
        type="button"
        class="rounded px-2 py-1 border border-neutral-300 dark:border-neutral-700"
        @click="toggle"
      >
        {{ isDark ? 'Light' : 'Dark' }}
      </button>
    </nav>
  </header>
</template>
```

- [ ] **Step 5: Write Footer.vue**

Create `repos/portfolio/components/Footer.vue`:

```vue
<script setup lang="ts">
import { siteConfig } from '~/site.config'

const year = new Date().getFullYear()
</script>

<template>
  <footer class="flex flex-col items-center gap-2 px-6 py-8 text-sm text-neutral-500 dark:text-neutral-400">
    <div class="flex gap-4">
      <a v-if="siteConfig.socials.github" :href="siteConfig.socials.github" target="_blank" rel="noopener">GitHub</a>
      <a v-if="siteConfig.socials.linkedin" :href="siteConfig.socials.linkedin" target="_blank" rel="noopener">LinkedIn</a>
      <a v-if="siteConfig.socials.x" :href="siteConfig.socials.x" target="_blank" rel="noopener">X</a>
      <a v-if="siteConfig.socials.email" :href="siteConfig.socials.email">Email</a>
    </div>
    <p>&copy; {{ year }} {{ siteConfig.name }}</p>
  </footer>
</template>
```

- [ ] **Step 6: Wire layout into app.vue**

Replace `repos/portfolio/app.vue` with:

```vue
<template>
  <div class="min-h-screen flex flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
    <Nav />
    <main class="flex-1">
      <NuxtPage />
    </main>
    <Footer />
  </div>
</template>
```

- [ ] **Step 7: Verify layout renders (will 404 on routes until Task 4, that's expected)**

Run: `npm run dev`, open `http://localhost:3000`.
Expected: Nav bar with site name, "Projects"/"About" links, dark-mode toggle button visible; Footer with social links at bottom. Clicking the toggle switches background/text colors and persists across reload (check `localStorage.theme` in devtools). The main content area shows a 404 — expected, pages don't exist yet.

- [ ] **Step 8: Commit**

```bash
cd /Users/nguyenducdung/Desktop/Zyot/ai-workspace
git add repos/portfolio
git commit -m "Add layout shell: Nav, Footer, dark mode toggle"
```

---

### Task 4: Hero, ProjectCard, SkillBadge components + home page

**Files:**
- Create: `repos/portfolio/components/Hero.vue`
- Create: `repos/portfolio/components/ProjectCard.vue`
- Create: `repos/portfolio/components/SkillBadge.vue`
- Create: `repos/portfolio/pages/index.vue`

**Interfaces:**
- Consumes: `siteConfig` (Task 2), `queryCollection('projects')` (Task 2), `Nav`/`Footer` already wired via `app.vue` (Task 3).
- Produces: `ProjectCard` props `{ project: { title: string, description: string, stack: string[], path: string, cover?: string } }`; `SkillBadge` props `{ label: string }`. Both reused by Task 5 (`/projects`) and Task 6 (`/projects/[slug]`).

- [ ] **Step 1: Write Hero.vue**

Create `repos/portfolio/components/Hero.vue`:

```vue
<script setup lang="ts">
import { siteConfig } from '~/site.config'
</script>

<template>
  <section class="px-6 py-24 text-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white">
    <h1 class="text-5xl font-extrabold tracking-tight">{{ siteConfig.name }}</h1>
    <p class="mt-4 text-xl text-white/90">{{ siteConfig.tagline }}</p>
    <div class="mt-8 flex justify-center gap-4">
      <NuxtLink
        to="/projects"
        class="rounded-lg bg-white text-indigo-700 font-semibold px-6 py-3 hover:bg-white/90"
      >
        View Projects
      </NuxtLink>
      <a
        :href="siteConfig.resumeUrl"
        class="rounded-lg border border-white/70 px-6 py-3 font-semibold hover:bg-white/10"
      >
        Resume
      </a>
    </div>
  </section>
</template>
```

- [ ] **Step 2: Write SkillBadge.vue**

Create `repos/portfolio/components/SkillBadge.vue`:

```vue
<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <span class="inline-block rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200 px-3 py-1 text-sm font-medium">
    {{ label }}
  </span>
</template>
```

- [ ] **Step 3: Write ProjectCard.vue**

Create `repos/portfolio/components/ProjectCard.vue`:

```vue
<script setup lang="ts">
defineProps<{
  project: {
    title: string
    description: string
    stack: string[]
    path: string
    cover?: string
  }
}>()
</script>

<template>
  <NuxtLink
    :to="project.path"
    class="block rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden hover:shadow-lg transition-shadow"
  >
    <img v-if="project.cover" :src="project.cover" :alt="project.title" class="w-full h-40 object-cover" />
    <div class="p-5">
      <h3 class="text-lg font-bold">{{ project.title }}</h3>
      <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{{ project.description }}</p>
      <div class="mt-4 flex flex-wrap gap-2">
        <SkillBadge v-for="tech in project.stack" :key="tech" :label="tech" />
      </div>
    </div>
  </NuxtLink>
</template>
```

- [ ] **Step 4: Write the home page**

Create `repos/portfolio/pages/index.vue`:

```vue
<script setup lang="ts">
import { siteConfig } from '~/site.config'

const { data: featured } = await useAsyncData('home-featured-projects', () =>
  queryCollection('projects').where('featured', '=', true).all()
)
</script>

<template>
  <div>
    <Hero />

    <section class="px-6 py-16 max-w-5xl mx-auto">
      <h2 class="text-2xl font-bold mb-6">Featured Projects</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <ProjectCard
          v-for="project in featured"
          :key="project.path"
          :project="{
            title: project.title,
            description: project.description,
            stack: project.stack,
            path: project.path,
            cover: project.cover,
          }"
        />
      </div>
      <NuxtLink to="/projects" class="inline-block mt-6 text-indigo-600 dark:text-indigo-400 font-medium">
        See all projects &rarr;
      </NuxtLink>
    </section>

    <section class="px-6 py-16 max-w-5xl mx-auto">
      <h2 class="text-2xl font-bold mb-6">Skills</h2>
      <div v-for="group in siteConfig.skills" :key="group.category" class="mb-6">
        <h3 class="text-sm font-semibold uppercase text-neutral-500 mb-2">{{ group.category }}</h3>
        <div class="flex flex-wrap gap-2">
          <SkillBadge v-for="item in group.items" :key="item" :label="item" />
        </div>
      </div>
    </section>
  </div>
</template>
```

- [ ] **Step 5: Verify home page**

Run: `npm run dev`, open `http://localhost:3000`.
Expected: gradient Hero with name/tagline/CTA buttons, "Featured Projects" section showing the `example-project` card (since it has `featured: true`), "Skills" section showing grouped badges from `site.config.ts`. No console errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/nguyenducdung/Desktop/Zyot/ai-workspace
git add repos/portfolio
git commit -m "Add Hero, ProjectCard, SkillBadge components and home page"
```

---

### Task 5: Projects list page

**Files:**
- Create: `repos/portfolio/pages/projects/index.vue`

**Interfaces:**
- Consumes: `ProjectCard` (Task 4), `queryCollection('projects')` (Task 2).

- [ ] **Step 1: Write the projects list page**

Create `repos/portfolio/pages/projects/index.vue`:

```vue
<script setup lang="ts">
const { data: projects } = await useAsyncData('all-projects', () =>
  queryCollection('projects').order('date', 'DESC').all()
)
</script>

<template>
  <section class="px-6 py-16 max-w-5xl mx-auto">
    <h1 class="text-3xl font-bold mb-8">Projects</h1>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <ProjectCard
        v-for="project in projects"
        :key="project.path"
        :project="{
          title: project.title,
          description: project.description,
          stack: project.stack,
          path: project.path,
          cover: project.cover,
        }"
      />
    </div>
  </section>
</template>
```

- [ ] **Step 2: Verify**

Run: `npm run dev`, open `http://localhost:3000/projects`.
Expected: page title "Projects", grid showing the `example-project` card. Clicking Nav "Projects" link from any page lands here.

- [ ] **Step 3: Commit**

```bash
cd /Users/nguyenducdung/Desktop/Zyot/ai-workspace
git add repos/portfolio
git commit -m "Add projects list page"
```

---

### Task 6: Project detail page

**Files:**
- Create: `repos/portfolio/pages/projects/[...slug].vue`

**Interfaces:**
- Consumes: `queryCollection('projects')` (Task 2).

- [ ] **Step 1: Write the project detail page**

Create `repos/portfolio/pages/projects/[...slug].vue`:

```vue
<script setup lang="ts">
const route = useRoute()

const { data: project } = await useAsyncData(`project-${route.path}`, () =>
  queryCollection('projects').path(route.path).first()
)

if (!project.value) {
  throw createError({ statusCode: 404, statusMessage: 'Project not found' })
}
</script>

<template>
  <article class="px-6 py-16 max-w-3xl mx-auto">
    <img v-if="project?.cover" :src="project.cover" :alt="project.title" class="w-full h-64 object-cover rounded-xl mb-8" />
    <h1 class="text-3xl font-bold">{{ project?.title }}</h1>
    <p class="mt-2 text-neutral-600 dark:text-neutral-400">{{ project?.description }}</p>
    <div class="mt-4 flex flex-wrap gap-2">
      <SkillBadge v-for="tech in project?.stack" :key="tech" :label="tech" />
    </div>
    <div class="mt-4 flex gap-4 text-sm">
      <a v-if="project?.repoUrl" :href="project.repoUrl" target="_blank" rel="noopener" class="text-indigo-600 dark:text-indigo-400 font-medium">
        Repo &rarr;
      </a>
      <a v-if="project?.demoUrl" :href="project.demoUrl" target="_blank" rel="noopener" class="text-indigo-600 dark:text-indigo-400 font-medium">
        Live demo &rarr;
      </a>
    </div>
    <div class="prose dark:prose-invert mt-8 max-w-none">
      <ContentRenderer v-if="project" :value="project" />
    </div>
  </article>
</template>
```

- [ ] **Step 2: Verify**

Run: `npm run dev`, open `http://localhost:3000/projects/example-project`.
Expected: page shows title, description, stack badges, repo/demo links, and rendered markdown body ("Overview", "Highlights" sections). Navigating to a nonexistent slug (e.g. `/projects/does-not-exist`) shows Nuxt's 404 page.

- [ ] **Step 3: Commit**

```bash
cd /Users/nguyenducdung/Desktop/Zyot/ai-workspace
git add repos/portfolio
git commit -m "Add project detail page"
```

---

### Task 7: About page

**Files:**
- Create: `repos/portfolio/pages/about.vue`

**Interfaces:**
- Consumes: `queryCollection('about')` (Task 2).

- [ ] **Step 1: Write the about page**

Create `repos/portfolio/pages/about.vue`:

```vue
<script setup lang="ts">
const { data: about } = await useAsyncData('about-page', () =>
  queryCollection('about').first()
)
</script>

<template>
  <article class="px-6 py-16 max-w-3xl mx-auto prose dark:prose-invert">
    <ContentRenderer v-if="about" :value="about" />
  </article>
</template>
```

- [ ] **Step 2: Add the Tailwind Typography plugin for `prose` classes**

```bash
cd /Users/nguyenducdung/Desktop/Zyot/ai-workspace/repos/portfolio
npm install -D @tailwindcss/typography
```

Edit `repos/portfolio/assets/css/main.css`:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";

@custom-variant dark (&:where(.dark, .dark *));
```

- [ ] **Step 3: Verify**

Run: `npm run dev`, open `http://localhost:3000/about`.
Expected: rendered bio markdown with typography styling (proper heading sizes, paragraph spacing), readable in both light and dark mode.

- [ ] **Step 4: Commit**

```bash
cd /Users/nguyenducdung/Desktop/Zyot/ai-workspace
git add repos/portfolio
git commit -m "Add about page with typography styling"
```

---

### Task 8: Static generation + Vercel deploy config + full manual pass

**Files:**
- Modify: `repos/portfolio/nuxt.config.ts`
- Create: `repos/portfolio/vercel.json`
- Modify: `repos/portfolio/README.md`

**Interfaces:**
- Produces: `npm run generate` producing a deployable static build in `.output/public`.

- [ ] **Step 1: Confirm static generation preset**

Edit `repos/portfolio/nuxt.config.ts` to add the static preset (Vercel auto-detects Nuxt, but pin the output mode explicitly):

```ts
export default defineNuxtConfig({
  compatibilityDate: '2026-09-22',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss', '@nuxt/content'],
  css: ['~/assets/css/main.css'],
  nitro: {
    preset: 'vercel-static',
  },
})
```

- [ ] **Step 2: Run the static build**

```bash
cd /Users/nguyenducdung/Desktop/Zyot/ai-workspace/repos/portfolio
npm run generate
```

Expected: build completes with no errors, `.output/public` contains `index.html`, `projects/index.html`, `projects/example-project/index.html`, `about/index.html`.

- [ ] **Step 3: Smoke-test the static output**

```bash
npx serve .output/public
```

Open `http://localhost:3000` (or the port `serve` prints). Click through Home → Projects → project detail → About → back to Home via Nav. Toggle dark mode. Resize browser to a mobile width (~375px) and confirm Nav/Hero/cards reflow without horizontal scroll.

- [ ] **Step 4: Add `vercel.json`**

Create `repos/portfolio/vercel.json`:

```json
{
  "buildCommand": "npm run generate",
  "outputDirectory": ".output/public"
}
```

- [ ] **Step 5: Update README with deploy note**

Add to `repos/portfolio/README.md`:

```markdown

## Deploy

Connect this repo folder to Vercel (root directory: `repos/portfolio`). Build command and output directory are set in `vercel.json`.
```

- [ ] **Step 6: Commit**

```bash
cd /Users/nguyenducdung/Desktop/Zyot/ai-workspace
git add repos/portfolio
git commit -m "Add static generation preset and Vercel deploy config"
```

---

## Post-plan notes

- Placeholder content (`site.config.ts` name/socials, `example-project.md`, `about.md`) is meant to be replaced with real content before going live — not part of this plan's scope.
- `resume.pdf` referenced by `siteConfig.resumeUrl` is not created by this plan; add the actual file to `public/resume.pdf` when available, or update the URL.
