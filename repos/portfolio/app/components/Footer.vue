<script setup lang="ts">
import { siteConfig } from '~~/site.config'

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
