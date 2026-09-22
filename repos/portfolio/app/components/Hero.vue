<script setup lang="ts">
import { siteConfig } from '~~/site.config'

const props = withDefaults(defineProps<{
  transparent?: boolean
}>(), {
  transparent: false,
})

const isExternalResume = siteConfig.resumeUrl.startsWith('http')

// Transparent mode sits over the 3D scene on the page background, so it uses theme colors.
const theme = computed(() => props.transparent
  ? {
      section: 'text-neutral-900 dark:text-white',
      tagline: 'text-neutral-600 dark:text-white/80',
      primary: 'bg-indigo-600 text-white hover:bg-indigo-500',
      secondary: 'border-neutral-400 hover:bg-neutral-900/5 dark:border-white/70 dark:hover:bg-white/10',
      panel: 'inline-block rounded-2xl px-8 py-10 bg-white/75 dark:bg-neutral-950/60 backdrop-blur border border-neutral-200/70 dark:border-white/10 shadow-sm',
    }
  : {
      section: 'bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white',
      tagline: 'text-white/90',
      primary: 'bg-white text-indigo-700 hover:bg-white/90',
      secondary: 'border-white/70 hover:bg-white/10',
      panel: '',
    })
</script>

<template>
  <section class="px-6 py-24 text-center" :class="theme.section">
    <div :class="theme.panel">
      <h1 class="text-5xl font-extrabold tracking-tight">{{ siteConfig.name }}</h1>
      <p class="mt-4 text-xl" :class="theme.tagline">{{ siteConfig.tagline }}</p>
      <div class="mt-8 flex justify-center gap-4">
        <NuxtLink
          to="/projects"
          class="rounded-lg font-semibold px-6 py-3"
          :class="theme.primary"
        >
          View Projects
        </NuxtLink>
        <a
          :href="siteConfig.resumeUrl"
          :target="isExternalResume ? '_blank' : undefined"
          :rel="isExternalResume ? 'noopener' : undefined"
          class="rounded-lg border px-6 py-3 font-semibold"
          :class="theme.secondary"
        >
          Resume
        </a>
      </div>
    </div>
  </section>
</template>
