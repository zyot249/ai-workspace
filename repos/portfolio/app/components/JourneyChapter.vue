<script setup lang="ts">
defineProps<{
  chapter: string
}>()
</script>

<template>
  <section :id="chapter" data-chapter class="min-h-screen flex flex-col justify-center">
    <slot />
  </section>
</template>
