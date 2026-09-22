<script setup lang="ts">
import { siteConfig } from '~~/site.config'

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
