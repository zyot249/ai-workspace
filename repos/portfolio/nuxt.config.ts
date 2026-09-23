import { siteConfig } from './site.config'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-22',
  devtools: { enabled: true },
  modules: [
    '@nuxtjs/tailwindcss',
    '@nuxt/content',
  ],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: {
        lang: 'en',
      },
      titleTemplate: `%s · ${siteConfig.name}`,
    },
  },
  nitro: {
    preset: 'static',
  },
})
