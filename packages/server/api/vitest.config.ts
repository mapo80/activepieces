import path from 'path'
import { defineConfig } from 'vitest/config'

// Change CWD to repo root for compatibility with piece-loader path resolution
const repoRoot = path.resolve(__dirname, '../../..')
process.chdir(repoRoot)

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')],
    include: [path.resolve(__dirname, 'test/**/*.test.ts')],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      reportsDirectory: path.resolve(__dirname, 'coverage'),
      include: ['packages/server/api/src/app/ai/command-layer/**'],
      exclude: ['**/*.d.ts', '**/entities/**'],
      thresholds: {
        'packages/server/api/src/app/ai/command-layer/vercel-ai-adapter.ts': {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
        'packages/server/api/src/app/ai/command-layer/outbox-publisher.ts': {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
        'packages/server/api/src/app/ai/command-layer/lock-recovery.ts': {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
      },
    },
  },
  resolve: {
    alias: {
      'isolated-vm': path.resolve(__dirname, '__mocks__/isolated-vm.js'),
      '@activepieces/shared': path.resolve(__dirname, '../../../packages/shared/src/index.ts'),
      '@activepieces/pieces-framework': path.resolve(__dirname, '../../../packages/pieces/framework/src/index.ts'),
      '@activepieces/pieces-common': path.resolve(__dirname, '../../../packages/pieces/common/src/index.ts'),
      '@activepieces/server-utils': path.resolve(__dirname, '../../../packages/server/utils/src/index.ts'),

    },
  },
})
