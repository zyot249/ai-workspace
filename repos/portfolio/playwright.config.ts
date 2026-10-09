import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/gpu',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [{ name: 'chromium-webgl2', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run test:gpu:serve',
    url: 'http://127.0.0.1:4175/tests/gpu/harness.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
})
