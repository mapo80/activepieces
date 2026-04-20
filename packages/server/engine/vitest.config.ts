import path from 'path'
import { defineConfig } from 'vitest/config'

// Change CWD to repo root for compatibility with piece-loader path resolution
const repoRoot = path.resolve(__dirname, '../../..')
process.chdir(repoRoot)

process.env.AP_EXECUTION_MODE = 'UNSANDBOXED'
process.env.AP_BASE_CODE_DIRECTORY = 'packages/server/engine/test/resources/codes'
process.env.AP_TEST_MODE = 'true'
process.env.AP_DEV_PIECES = 'http,data-mapper,approval,webhook,delay'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 20000,
    include: [path.resolve(__dirname, 'test/**/*.test.ts')],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportOnFailure: true,
      include: [
        'packages/server/engine/src/lib/handler/session-store.ts',
        'packages/server/engine/src/lib/handler/interactive-flow-executor.ts',
      ],
      thresholds: {
        'packages/server/engine/src/lib/handler/session-store.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        'packages/server/engine/src/lib/handler/interactive-flow-executor.ts': {
          statements: 70,
          branches: 60,
          functions: 80,
          lines: 70,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@activepieces/shared': path.resolve(__dirname, '../../../packages/shared/src/index.ts'),
      '@activepieces/pieces-framework': path.resolve(__dirname, '../../../packages/pieces/framework/src/index.ts'),
      '@activepieces/pieces-common': path.resolve(__dirname, '../../../packages/pieces/common/src/index.ts'),
    },
  },
})
