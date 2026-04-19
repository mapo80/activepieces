import { AIProviderName } from '@activepieces/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateTextMock = vi.fn()
const toolMock = vi.fn((def: unknown) => def)
const jsonSchemaMock = vi.fn((schema: unknown) => schema)

vi.mock('ai', () => ({
    generateText: (params: unknown): Promise<unknown> => generateTextMock(params) as Promise<unknown>,
    tool: (def: unknown): unknown => toolMock(def),
    jsonSchema: (schema: unknown): unknown => jsonSchemaMock(schema),
}))

const buildModelMock = vi.fn()

vi.mock('../../../../src/app/ai/interactive-flow-model-factory', () => ({
    interactiveFlowModelFactory: {
        build: (params: unknown): Promise<unknown> => buildModelMock(params) as Promise<unknown>,
    },
}))

vi.mock('../../../../src/app/core/security/authorization/fastify-security', () => ({
    securityAccess: {
        engine: (): Record<string, never> => ({}),
    },
}))

type Handlers = Record<string, (request: unknown) => Promise<unknown>>

async function runRoute({ path, request }: { path: string, request: unknown }): Promise<unknown> {
    const handlers: Handlers = {}
    const appStub = {
        post: (p: string, _opts: unknown, fn: (r: unknown) => Promise<unknown>): void => {
            handlers[p] = fn
        },
    } as unknown as Parameters<typeof import('../../../../src/app/ai/interactive-flow-ai.controller').interactiveFlowAiController>[0]
    const { interactiveFlowAiController } = await import('../../../../src/app/ai/interactive-flow-ai.controller')
    await interactiveFlowAiController(appStub, {})
    const fn = handlers[path]
    if (!fn) throw new Error(`No handler registered at ${path}`)
    return fn(request)
}

const PLATFORM_ID = 'pf1234567890123456789'
const STUB_LOG = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    fatal: vi.fn(), trace: vi.fn(), child: vi.fn(), silent: vi.fn(), level: 'info',
}

describe('interactiveFlowAiController — /field-extract', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.resetModules()
        buildModelMock.mockResolvedValue('language-model-stub')
    })

    it('returns extracted fields from the first tool call, dropping null/empty values', async () => {
        generateTextMock.mockResolvedValue({
            toolCalls: [{ input: { ndg: '42', clientName: 'Polito', closureDate: '' } }],
            usage: { totalTokens: 123 },
        })

        const result = await runRoute({
            path: '/field-extract',
            request: {
                principal: { platform: { id: PLATFORM_ID } },
                log: STUB_LOG,
                body: {
                    provider: AIProviderName.OPENAI,
                    model: 'gpt-4o-mini',
                    message: 'estingui rapporto di Polito ndg 42',
                    stateFields: [
                        { name: 'ndg', type: 'string', required: true },
                        { name: 'clientName', type: 'string' },
                        { name: 'closureDate', type: 'date' },
                    ],
                },
            },
        })

        expect(result).toEqual({ extractedFields: { ndg: '42', clientName: 'Polito' }, tokensUsed: 123 })
        expect(buildModelMock).toHaveBeenCalledWith({
            platformId: PLATFORM_ID,
            provider: AIProviderName.OPENAI,
            modelId: 'gpt-4o-mini',
            log: STUB_LOG,
        })
        const generateArgs = generateTextMock.mock.calls[0][0]
        expect(generateArgs.toolChoice).toBe('required')
        expect(generateArgs.tools.extract.inputSchema.properties.closureDate.type).toBe('string')
        expect(generateArgs.tools.extract.inputSchema.required).toEqual(['ndg'])
    })

    it('returns empty extractedFields when tool is not called', async () => {
        generateTextMock.mockResolvedValue({ toolCalls: [], usage: { totalTokens: 12 } })

        const result = await runRoute({
            path: '/field-extract',
            request: {
                principal: { platform: { id: PLATFORM_ID } },
                log: STUB_LOG,
                body: {
                    provider: AIProviderName.OPENAI,
                    model: 'gpt-4o-mini',
                    message: 'irrelevant',
                    stateFields: [{ name: 'ndg', type: 'string' }],
                },
            },
        })
        expect(result).toEqual({ extractedFields: {}, tokensUsed: 12 })
    })

    it('throws when principal has no platformId', async () => {
        await expect(runRoute({
            path: '/field-extract',
            request: {
                principal: { platform: undefined },
                log: STUB_LOG,
                body: {
                    provider: AIProviderName.OPENAI,
                    model: 'gpt-4o-mini',
                    message: 'hi',
                    stateFields: [{ name: 'ndg', type: 'string' }],
                },
            },
        })).rejects.toThrow(/platformId/)
    })
})

describe('interactiveFlowAiController — /question-generate', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.resetModules()
        buildModelMock.mockResolvedValue('language-model-stub')
    })

    it('returns generated text and token usage', async () => {
        generateTextMock.mockResolvedValue({ text: 'Qual è il NDG?', usage: { totalTokens: 34 } })

        const result = await runRoute({
            path: '/question-generate',
            request: {
                principal: { platform: { id: PLATFORM_ID } },
                log: STUB_LOG,
                body: {
                    provider: AIProviderName.OPENAI,
                    model: 'gpt-4o',
                    locale: 'it',
                    systemPrompt: 'Banking agent',
                    styleTemplate: 'banking_formal_it',
                    state: { clientName: 'Polito' },
                    history: [{ role: 'user', text: 'estingui' }],
                    targetFields: [{ name: 'ndg', label: 'NDG' }],
                    renderHint: { component: 'TextInput', props: { placeholder: 'NDG' } },
                },
            },
        })

        expect(result).toEqual({ text: 'Qual è il NDG?', tokensUsed: 34 })
        const generateArgs = generateTextMock.mock.calls[0][0]
        expect(generateArgs.model).toBe('language-model-stub')
        expect(generateArgs.prompt).toContain('<ROLE>')
        expect(generateArgs.prompt).toContain('Banking agent')
        expect(generateArgs.prompt).toContain('<STYLE>')
        expect(generateArgs.prompt).toContain('banking_formal_it')
        expect(generateArgs.prompt).toContain('<CONVERSATION_HISTORY>')
        expect(generateArgs.prompt).toContain('<CURRENT_STATE>')
        expect(generateArgs.prompt).toContain('<TASK>')
        expect(generateArgs.prompt).toContain('TextInput')
        expect(generateArgs.prompt).toContain('<GUARDRAILS>')
    })

    it('falls back to a default system prompt and omits optional sections', async () => {
        generateTextMock.mockResolvedValue({ text: 'x', usage: { totalTokens: 1 } })
        await runRoute({
            path: '/question-generate',
            request: {
                principal: { platform: { id: PLATFORM_ID } },
                log: STUB_LOG,
                body: {
                    provider: AIProviderName.OPENAI,
                    model: 'gpt-4o',
                    locale: 'en',
                    targetFields: [{ name: 'x' }],
                },
            },
        })
        const prompt = generateTextMock.mock.calls[0][0].prompt as string
        expect(prompt).toContain('conversational assistant')
        expect(prompt).not.toContain('<CONVERSATION_HISTORY>')
        expect(prompt).not.toContain('<CURRENT_STATE>')
    })
})
