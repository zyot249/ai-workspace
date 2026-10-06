<script setup lang="ts">
import { siteConfig } from '~~/site.config'

const { toggle } = useDarkMode()
</script>

<template>
  <header class="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 backdrop-blur">
    <NuxtLink to="/" class="font-bold text-lg whitespace-nowrap text-indigo-600 dark:text-indigo-400">
      {{ siteConfig.name }}
    </NuxtLink>
    <nav class="flex items-center gap-3 sm:gap-6 text-sm">
      <NuxtLink to="/projects" class="hover:text-indigo-600 dark:hover:text-indigo-400">Projects</NuxtLink>
      <NuxtLink to="/about" class="hover:text-indigo-600 dark:hover:text-indigo-400">About</NuxtLink>
      <!-- Label comes from the `dark` class, not state, so it is right on first paint and matches the server HTML. -->
      <button
        type="button"
        class="rounded px-2 py-1 border border-neutral-300 dark:border-neutral-700"
        @click="toggle"
      >
        <span class="dark:hidden">Dark</span>
        <span class="hidden dark:inline">Light</span>
      </button>
    </nav>
  </header>
</template>
