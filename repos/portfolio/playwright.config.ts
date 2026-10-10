import { defineConfig } from '@playwright/test'

const gpuPort = Number(process.env.CITY_GPU_PORT ?? 4175)
const gpuBaseUrl = `http://127.0.0.1:${gpuPort}`

export default defineConfig({
  testDir: './tests/gpu',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: gpuBaseUrl,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [{ name: 'chromium-webgl2', use: { browserName: 'chromium' } }],
  webServer: {
    command: `npx vite --config vite.gpu.config.ts --host 127.0.0.1 --port ${gpuPort} --strictPort`,
    url: `${gpuBaseUrl}/tests/gpu/harness.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
})
