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
