import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Engine benchmarks: `npm run bench`. Results are printed and written to docs/perf-results.json.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/perf/**/*.perf.ts'], testTimeout: 900_000, hookTimeout: 900_000, pool: 'forks', fileParallelism: false },
})
