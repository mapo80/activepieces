import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportOnFailure: true,
      include: [
        'src/features/interactive-flow/hooks/use-interactive-flow-turn-events.ts',
        'src/features/interactive-flow/hooks/interactive-flow-turn-reducer.ts',
      ],
      thresholds: {
        'src/features/interactive-flow/hooks/use-interactive-flow-turn-events.ts':
          {
            statements: 0,
            branches: 0,
            functions: 0,
            lines: 0,
          },
        'src/features/interactive-flow/hooks/interactive-flow-turn-reducer.ts':
          {
            statements: 90,
            branches: 85,
            functions: 90,
            lines: 90,
          },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@activepieces/shared': path.resolve(
        __dirname,
        '../../packages/shared/src',
      ),
    },
  },
});
