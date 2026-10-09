import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  cacheDir: '.cache/gpu-vite',
  resolve: { alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) } },
  plugins: [
    {
      name: 'gpu-harness-vue-auto-imports',
      enforce: 'pre',
      transform(source, id) {
        if (id.endsWith('/app/journey/scene.ts')) {
          const marker = 'const recorder = createShaderErrorRecorder(renderer)'
          if (!source.includes(marker)) throw new Error('GPU renderer observer marker missing')
          const themeMarker = 'setTheme(isDark, themeOptions) {'
          if (!source.includes(themeMarker)) throw new Error('GPU theme observer marker missing')
          const withRendererObserver = source.replace(marker, marker + '\nwindow.__cityGpuRendererObserver?.(renderer)')
          return withRendererObserver.replace(themeMarker,
            themeMarker + '\nwindow.__cityGpuThemeObserver?.(isDark, themeOptions)')
        }
        if (!id.endsWith('/app/components/JourneyCanvas.vue')) return
        return source.replace('<script setup lang="ts">', '<script setup lang="ts">\nimport { ref, onMounted, onBeforeUnmount, watch } from "vue"')
      },
    },
    vue(),
  ],
  server: { host: '127.0.0.1', port: 4175, strictPort: true },
})
