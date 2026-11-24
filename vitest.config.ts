import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@screenvault/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
      '@screenvault/types': fileURLToPath(
        new URL('./packages/types/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/shared/src/**/*.test.ts',
      'apps/api/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.ts',
    ],
    execArgv: ['--experimental-sqlite'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
