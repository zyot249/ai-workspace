export default defineNuxtConfig({
  compatibilityDate: '2026-09-22',
  devtools: { enabled: true },
  modules: [
    '@nuxtjs/tailwindcss',
    '@nuxt/content',
  ],
  css: ['~/assets/css/main.css'],
})