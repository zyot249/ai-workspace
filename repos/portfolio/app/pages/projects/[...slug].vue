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
