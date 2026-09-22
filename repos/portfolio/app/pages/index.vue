<script setup lang="ts">
import { siteConfig } from '~~/site.config'

const { data: featured } = await useAsyncData('home-featured-projects', () =>
  queryCollection('projects').where('featured', '=', true).all()
)

const { data: about } = await useAsyncData('home-about-teaser', () =>
  queryCollection('about').first()
)

useSeoMeta({
  title: siteConfig.tagline,
  description: siteConfig.tagline,
})
</script>

<template>
  <div>
    <Hero />

    <section class="px-6 py-16 max-w-5xl mx-auto">
      <h2 class="text-2xl font-bold mb-6">Featured Projects</h2>
      <div v-if="featured?.length" class="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
      <p v-else class="text-neutral-500 dark:text-neutral-400">No projects yet.</p>
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

    <section v-if="about" class="px-6 py-16 max-w-5xl mx-auto">
      <h2 class="text-2xl font-bold mb-4">About</h2>
      <p class="text-neutral-600 dark:text-neutral-400">{{ about.title }}</p>
      <NuxtLink to="/about" class="inline-block mt-4 text-indigo-600 dark:text-indigo-400 font-medium">
        Read more about me &rarr;
      </NuxtLink>
    </section>
  </div>
</template>
