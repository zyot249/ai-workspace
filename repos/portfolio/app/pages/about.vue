<script setup lang="ts">
const { data: about } = await useAsyncData('about-page', () =>
  queryCollection('about').first()
)

useSeoMeta({
  title: 'About',
  description: about.value?.description ?? 'About Kai Nguyen, backend software engineer.',
})
</script>

<template>
  <article class="px-4 py-10 sm:px-6 sm:py-16 max-w-3xl mx-auto prose dark:prose-invert">
    <ContentRenderer v-if="about" :value="about" />
  </article>
</template>
