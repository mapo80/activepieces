import { ConversationCommand } from '@activepieces/shared'

export type ProviderAdapter = {
    proposeCommands(input: ProposePromptInput): Promise<ProposeResult>
}

export type ProposePromptInput = {
    systemPrompt: string
    userMessage: string
    conversationHistory: Array<{ role: 'user' | 'assistant', text: string }>
    allowedFields: string[]
    allowedInfoIntents: string[]
    modelHint?: string
}

export type ProposeResult = {
    commands: ConversationCommand[]
    tokenUsage?: {
        inputTokens: number
        outputTokens: number
    }
    modelVersion?: string
    rawResponse?: unknown
    error?: string
}

export type MockScenario = {
    matchUserMessage: (message: string) => boolean
    commands: ConversationCommand[]
    modelVersion?: string
}

export class MockProviderAdapter implements ProviderAdapter {
    private scenarios: MockScenario[] = []
    private fallback: ProposeResult = { commands: [] }

    register(scenario: MockScenario): void {
        this.scenarios.push(scenario)
    }

    setFallback(result: ProposeResult): void {
        this.fallback = result
    }

    clear(): void {
        this.scenarios = []
        this.fallback = { commands: [] }
    }

    async proposeCommands(input: ProposePromptInput): Promise<ProposeResult> {
        for (const scenario of this.scenarios) {
            if (scenario.matchUserMessage(input.userMessage)) {
                return {
                    commands: scenario.commands,
                    modelVersion: scenario.modelVersion ?? 'mock-v1',
                }
            }
        }
        return this.fallback
    }
}
