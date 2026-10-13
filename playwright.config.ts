import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 4173)
const external = process.env.BASE_URL

/**
 * E2E tests run against the production build (`vite preview`) so the service worker,
 * code-splitting and prerendered pages are exercised exactly as deployed.
 * Set BASE_URL to test an already-running server instead.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    colorScheme: 'dark',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: external
    ? undefined
    : {
        command: `npm run preview -- --port ${PORT} --strictPort`,
        port: PORT,
        reuseExistingServer: true,
        timeout: 120_000,
      },
})
