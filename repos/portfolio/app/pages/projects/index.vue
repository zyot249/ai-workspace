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
