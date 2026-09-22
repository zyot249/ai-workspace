<script setup lang="ts">
import { siteConfig } from '~~/site.config'

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
