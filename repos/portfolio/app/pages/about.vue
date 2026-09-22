<script setup lang="ts">
const { data: about } = await useAsyncData('about-page', () =>
  queryCollection('about').first()
)
</script>

<template>
  <article class="px-6 py-16 max-w-3xl mx-auto prose dark:prose-invert">
    <ContentRenderer v-if="about" :value="about" />
  </article>
</template>
