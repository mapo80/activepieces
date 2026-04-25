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

    it('toolCalls undefined and usage undefined → empty commands, zero tokens', async () => {
        generateTextMock.mockResolvedValueOnce({})
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', resolveModel: async () => mockModel })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toEqual([])
        expect(result.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0 })
    })

    it('respects explicit timeoutMs config (constructor passes through)', async () => {
        generateTextMock.mockResolvedValueOnce({ toolCalls: [], usage: undefined })
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({
            modelHint: 'claude-sonnet-4-6',
            resolveModel: async () => mockModel,
            timeoutMs: 1000,
        })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toEqual([])
    })

    it('falls back to {type:string} when allowedFields/allowedInfoIntents are empty', async () => {
        generateTextMock.mockResolvedValueOnce({
            toolCalls: [{
                toolName: 'SET_FIELDS',
                args: { updates: [{ field: 'anyField', value: 'X', evidence: 'XY' }] },
            }],
            usage: { promptTokens: 1, completionTokens: 1 },
        })
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', resolveModel: async () => mockModel })
        const result = await adapter.proposeCommands({
            ...baseInput,
            allowedFields: [],
            allowedInfoIntents: [],
        })
        expect(result.commands).toHaveLength(1)
    })

    it('tool call with args=undefined is parsed against empty object', async () => {
        generateTextMock.mockResolvedValueOnce({
            toolCalls: [{ toolName: 'INVALID_TYPE', args: undefined }],
            usage: { promptTokens: 0, completionTokens: 0 },
        })
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', resolveModel: async () => mockModel })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toEqual([])
    })

    it('error from non-Error value still produces sliced error string', async () => {
        generateTextMock.mockRejectedValueOnce('x'.repeat(500))
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', resolveModel: async () => mockModel })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toEqual([])
        expect(result.error).toBeDefined()
        expect((result.error ?? '').length).toBeLessThanOrEqual(200)
    })

    it('logs warning when log is provided and Zod parse fails', async () => {
        generateTextMock.mockResolvedValueOnce({
            toolCalls: [{ toolName: 'BAD_TOOL', args: {} }],
            usage: { promptTokens: 0, completionTokens: 0 },
        })
        const warn = vi.fn()
        const log = { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn(), level: 'warn', silent: vi.fn(), bindings: vi.fn() }
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({
            modelHint: 'claude-sonnet-4-6',
            resolveModel: async () => mockModel,
            log: log as never,
        })
        await adapter.proposeCommands(baseInput)
        expect(warn).toHaveBeenCalledTimes(1)
    })

    it('logs warning on generateText throw when log is provided', async () => {
        generateTextMock.mockRejectedValueOnce(new Error('boom'))
        const warn = vi.fn()
        const log = { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn(), level: 'warn', silent: vi.fn(), bindings: vi.fn() }
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({
            modelHint: 'claude-sonnet-4-6',
            resolveModel: async () => mockModel,
            log: log as never,
        })
        const result = await adapter.proposeCommands(baseInput)
        expect(warn).toHaveBeenCalledTimes(1)
        expect(result.error).toContain('boom')
    })
})
