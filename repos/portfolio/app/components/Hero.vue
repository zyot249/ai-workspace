<script setup lang="ts">
import { siteConfig } from '~~/site.config'
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
