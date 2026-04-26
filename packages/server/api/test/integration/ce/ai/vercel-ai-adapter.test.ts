import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const baseInput = {
    systemPrompt: 'You are a banking assistant.',
    userMessage: 'Bellafronte',
    conversationHistory: [] as Array<{ role: 'user' | 'assistant', text: string }>,
    allowedFields: ['customerName'],
    allowedInfoIntents: ['count_accounts'],
}

function makeOpenAIResponse(toolCalls: Array<{ name: string, arguments: string }>, usage?: { prompt_tokens: number, completion_tokens: number }): Response {
    const body = {
        choices: [{
            message: {
                role: 'assistant',
                content: null,
                tool_calls: toolCalls.map((tc, i) => ({
                    id: `call_${i}`,
                    type: 'function',
                    function: { name: tc.name, arguments: tc.arguments },
                })),
            },
            finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
        }],
        usage: usage ?? { prompt_tokens: 0, completion_tokens: 0 },
    }
    return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as unknown as Response
}

function makeErrorResponse(status: number, text: string): Response {
    return {
        ok: false,
        status,
        text: async () => text,
    } as unknown as Response
}

describe('VercelAIAdapter', () => {
    beforeEach(() => {
        fetchMock.mockReset()
    })
    afterEach(() => {
        fetchMock.mockReset()
    })

    it('happy path: maps SET_FIELDS tool call to ConversationCommand', async () => {
        fetchMock.mockResolvedValueOnce(makeOpenAIResponse(
            [{ name: 'SET_FIELDS', arguments: JSON.stringify({ updates: [{ field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' }] }) }],
            { prompt_tokens: 100, completion_tokens: 30 },
        ))
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', baseURL: 'http://mock/v1', apiKey: 'sk-test' })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toHaveLength(1)
        expect(result.commands[0].type).toBe('SET_FIELDS')
        expect(result.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 30 })
    })

    it('empty toolCalls → commands=[]', async () => {
        fetchMock.mockResolvedValueOnce(makeOpenAIResponse([], { prompt_tokens: 0, completion_tokens: 0 }))
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', baseURL: 'http://mock/v1', apiKey: 'sk-test' })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toEqual([])
    })

    it('Zod parse failure on one tool call → command skipped, others kept', async () => {
        fetchMock.mockResolvedValueOnce(makeOpenAIResponse([
            { name: 'SET_FIELDS', arguments: JSON.stringify({ updates: [{ field: 'customerName', value: 'X', evidence: 'XY' }] }) },
            { name: 'INVALID_TYPE', arguments: '{}' },
            { name: 'REPROMPT', arguments: JSON.stringify({ reason: 'low-confidence' }) },
        ], { prompt_tokens: 50, completion_tokens: 10 }))
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', baseURL: 'http://mock/v1', apiKey: 'sk-test' })
        const result = await adapter.proposeCommands(baseInput)
        const types = result.commands.map(c => c.type).sort()
        expect(types).toEqual(['REPROMPT', 'SET_FIELDS'])
    })

    it('fetch throws → returns commands=[] with error', async () => {
        fetchMock.mockRejectedValueOnce(new Error('network down'))
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', baseURL: 'http://mock/v1', apiKey: 'sk-test' })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toEqual([])
        expect(result.error).toContain('network down')
        expect(result.modelVersion).toBe('claude-sonnet-4-6')
    })

    it('HTTP error response → returns commands=[] with error', async () => {
        fetchMock.mockResolvedValueOnce(makeErrorResponse(500, 'Internal Server Error'))
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', baseURL: 'http://mock/v1', apiKey: 'sk-test' })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toEqual([])
        expect(result.error).toContain('500')
    })

    it('toolCalls missing → empty commands, zero tokens', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { role: 'assistant', content: null } }] }),
        } as unknown as Response)
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', baseURL: 'http://mock/v1', apiKey: 'sk-test' })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toEqual([])
        expect(result.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0 })
    })

    it('respects explicit timeoutMs config (constructor passes through)', async () => {
        fetchMock.mockResolvedValueOnce(makeOpenAIResponse([], { prompt_tokens: 0, completion_tokens: 0 }))
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({
            modelHint: 'claude-sonnet-4-6',
            baseURL: 'http://mock/v1',
            apiKey: 'sk-test',
            timeoutMs: 1000,
        })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toEqual([])
    })

    it('falls back to {type:string} when allowedFields/allowedInfoIntents are empty', async () => {
        fetchMock.mockResolvedValueOnce(makeOpenAIResponse(
            [{ name: 'SET_FIELDS', arguments: JSON.stringify({ updates: [{ field: 'anyField', value: 'X', evidence: 'XY' }] }) }],
            { prompt_tokens: 1, completion_tokens: 1 },
        ))
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', baseURL: 'http://mock/v1', apiKey: 'sk-test' })
        const result = await adapter.proposeCommands({
            ...baseInput,
            allowedFields: [],
            allowedInfoIntents: [],
        })
        expect(result.commands).toHaveLength(1)
    })

    it('tool call with malformed JSON arguments → command skipped', async () => {
        fetchMock.mockResolvedValueOnce(makeOpenAIResponse(
            [{ name: 'SET_FIELDS', arguments: 'NOT_JSON' }],
            { prompt_tokens: 0, completion_tokens: 0 },
        ))
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', baseURL: 'http://mock/v1', apiKey: 'sk-test' })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toEqual([])
    })

    it('error from non-Error value still produces sliced error string', async () => {
        fetchMock.mockRejectedValueOnce('x'.repeat(500))
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({ modelHint: 'claude-sonnet-4-6', baseURL: 'http://mock/v1', apiKey: 'sk-test' })
        const result = await adapter.proposeCommands(baseInput)
        expect(result.commands).toEqual([])
        expect(result.error).toBeDefined()
        expect((result.error ?? '').length).toBeLessThanOrEqual(200)
    })

    it('logs warning when log is provided and Zod parse fails', async () => {
        fetchMock.mockResolvedValueOnce(makeOpenAIResponse(
            [{ name: 'BAD_TOOL', arguments: '{}' }],
            { prompt_tokens: 0, completion_tokens: 0 },
        ))
        const warn = vi.fn()
        const log = { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn(), level: 'warn', silent: vi.fn(), bindings: vi.fn() }
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({
            modelHint: 'claude-sonnet-4-6',
            baseURL: 'http://mock/v1',
            apiKey: 'sk-test',
            log: log as never,
        })
        await adapter.proposeCommands(baseInput)
        expect(warn).toHaveBeenCalledTimes(1)
    })

    it('logs warning on fetch throw when log is provided', async () => {
        fetchMock.mockRejectedValueOnce(new Error('boom'))
        const warn = vi.fn()
        const log = { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn(), level: 'warn', silent: vi.fn(), bindings: vi.fn() }
        const { VercelAIAdapter } = await import('../../../../src/app/ai/command-layer/vercel-ai-adapter')
        const adapter = new VercelAIAdapter({
            modelHint: 'claude-sonnet-4-6',
            baseURL: 'http://mock/v1',
            apiKey: 'sk-test',
            log: log as never,
        })
        const result = await adapter.proposeCommands(baseInput)
        expect(warn).toHaveBeenCalledTimes(1)
        expect(result.error).toContain('boom')
    })
})
