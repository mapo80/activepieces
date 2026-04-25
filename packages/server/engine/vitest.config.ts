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
                'packages/server/engine/src/lib/handler/turn-interpreter-client.ts',
                'packages/server/engine/src/lib/handler/turn-interpreter-adapter.ts',
                'packages/server/engine/src/lib/handler/status-renderer.ts',
                'packages/server/engine/src/lib/handler/turn-result.ts',
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
                'packages/server/engine/src/lib/handler/turn-interpreter-client.ts': {
                    statements: 90,
                    branches: 90,
                    functions: 90,
                    lines: 90,
                },
                'packages/server/engine/src/lib/handler/turn-interpreter-adapter.ts': {
                    statements: 90,
                    branches: 85,
                    functions: 90,
                    lines: 90,
                },
                'packages/server/engine/src/lib/handler/status-renderer.ts': {
                    statements: 90,
                    branches: 85,
                    functions: 90,
                    lines: 90,
                },
                'packages/server/engine/src/lib/handler/turn-result.ts': {
                    statements: 90,
                    branches: 90,
                    functions: 90,
                    lines: 90,
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
