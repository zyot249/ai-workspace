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
      // Apply the saved or system theme before first paint, so dark-mode
      // visitors never see a flash of the light theme. See useDarkMode.
      script: [{
        tagPosition: 'head',
        innerHTML: `try{var t=localStorage.getItem('theme');document.documentElement.classList.toggle('dark',t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches)}catch(e){}`,
      }],
    },
  },
  nitro: {
    preset: 'static',
  },
})
