import { LanguageModel } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generateTextMock = vi.fn()

vi.mock('ai', async (importActual) => {
    const actual = await importActual<typeof import('ai')>()
    return {
        ...actual,
        generateText: generateTextMock,
    }
})

const baseInput = {
    systemPrompt: 'You are a banking assistant.',
    userMessage: 'Bellafronte',
    conversationHistory: [] as Array<{ role: 'user' | 'assistant', text: string }>,
    allowedFields: ['customerName'],
    allowedInfoIntents: ['count_accounts'],
}

const mockModel = { id: 'mock-model' } as unknown as LanguageModel

describe('VercelAIAdapter', () => {
    beforeEach(() => {
        generateTextMock.mockReset()
    })
    afterEach(() => {
        generateTextMock.mockReset()
    })

    it('happy path: maps SET_FIELDS tool call to ConversationCommand', async () => {
        generateTextMock.mockResolvedValueOnce({
            toolCalls: [{
                toolName: 'SET_FIELDS',
                args: { updates: [{ field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' }] },
            }],
            usage: { promptTokens: 100, completionTokens: 30 },
        })
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', resolveModel: async () => mockModel })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toHaveLength(1)
        expect(result.commands[0].type).toBe('SET_FIELDS')
        expect(result.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 30 })
    })

    it('empty toolCalls → commands=[]', async () => {
        generateTextMock.mockResolvedValueOnce({ toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 } })
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', resolveModel: async () => mockModel })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toEqual([])
    })

    it('Zod parse failure on one tool call → command skipped, others kept', async () => {
        generateTextMock.mockResolvedValueOnce({
            toolCalls: [
                { toolName: 'SET_FIELDS', args: { updates: [{ field: 'customerName', value: 'X', evidence: 'XY' }] } },
                { toolName: 'INVALID_TYPE', args: {} },
                { toolName: 'REPROMPT', args: { reason: 'low-confidence' } },
            ],
            usage: { promptTokens: 50, completionTokens: 10 },
        })
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', resolveModel: async () => mockModel })
        const result = await adapter.proposeCommands(baseInput)
        const types = result.commands.map(c => c.type).sort()
        expect(types).toEqual(['REPROMPT', 'SET_FIELDS'])
    })

    it('generateText throws → returns commands=[] with error', async () => {
        generateTextMock.mockRejectedValueOnce(new Error('network down'))
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', resolveModel: async () => mockModel })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toEqual([])
        expect(result.error).toContain('network down')
        expect(result.modelVersion).toBe('claude-sonnet-4-6')
    })
})
