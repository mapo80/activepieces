import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary'],
            reportOnFailure: true,
            include: [
                'src/lib/automation/interactive-flow/conversation-command.ts',
                'src/lib/automation/interactive-flow/turn-event.ts',
                'src/lib/automation/interactive-flow/turn-interpret-dto.ts',
            ],
            thresholds: {
                'src/lib/automation/interactive-flow/conversation-command.ts': {
                    statements: 90,
                    branches: 90,
                    functions: 90,
                    lines: 90,
                },
                'src/lib/automation/interactive-flow/turn-event.ts': {
                    statements: 90,
                    branches: 90,
                    functions: 90,
                    lines: 90,
                },
                'src/lib/automation/interactive-flow/turn-interpret-dto.ts': {
                    statements: 90,
                    branches: 85,
                    functions: 90,
                    lines: 90,
                },
            },
        },
    },
})
