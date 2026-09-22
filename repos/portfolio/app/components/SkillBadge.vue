<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <span class="inline-block rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200 px-3 py-1 text-sm font-medium">
    {{ label }}
  </span>
</template>
