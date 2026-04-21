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

    it('pre-parser extracts NDG deterministically without calling LLM', async () => {
        const result = await runRoute({
            path: '/field-extract',
            request: {
                principal: { platform: { id: PLATFORM_ID } },
                log: STUB_LOG,
                body: {
                    provider: AIProviderName.OPENAI,
                    model: 'gpt-4o-mini',
                    message: 'il mio NDG è 11255521',
                    currentNode: { nodeId: 'pick_ndg', nodeType: 'USER_INPUT', stateOutputs: ['ndg'] },
                    stateFields: [
                        { name: 'ndg', type: 'string', pattern: '^\\d{6,10}$', parser: 'ndg' },
                    ],
                },
            },
        }) as { acceptedFields: Record<string, unknown>; extractedFields: Record<string, unknown>; candidates: Array<{ source: string }> }

        expect(result.acceptedFields.ndg).toBe('11255521')
        expect(result.extractedFields.ndg).toBe('11255521')
        expect(result.candidates[0].source).toBe('pre-parser')
        expect(generateTextMock).not.toHaveBeenCalled()
    })

    it('meta-question short-circuits with template answer, no LLM call', async () => {
        const result = await runRoute({
            path: '/field-extract',
            request: {
                principal: { platform: { id: PLATFORM_ID } },
                log: STUB_LOG,
                body: {
                    provider: AIProviderName.OPENAI,
                    model: 'gpt-4o-mini',
                    message: 'cosa mi avevi chiesto?',
                    currentNode: {
                        nodeId: 'pick_ndg',
                        nodeType: 'USER_INPUT',
                        stateOutputs: ['ndg'],
                        displayName: 'Seleziona NDG',
                        prompt: 'Qual è il NDG del cliente?',
                    },
                    currentState: { customerName: 'Bellafronte' },
                    stateFields: [{ name: 'ndg', type: 'string' }],
                },
            },
        }) as { metaAnswer?: string; candidates: unknown[]; acceptedFields: Record<string, unknown> }

        expect(result.metaAnswer).toBeDefined()
        expect(result.metaAnswer).toContain('NDG')
        expect(result.candidates).toHaveLength(0)
        expect(Object.keys(result.acceptedFields)).toHaveLength(0)
        expect(generateTextMock).not.toHaveBeenCalled()
    })

    it('returns empty acceptedFields when LLM returns empty tool call', async () => {
        generateTextMock.mockResolvedValue({ toolCalls: [], usage: { totalTokens: 10 } })
        const result = await runRoute({
            path: '/field-extract',
            request: {
                principal: { platform: { id: PLATFORM_ID } },
                log: STUB_LOG,
                body: {
                    provider: AIProviderName.OPENAI,
                    model: 'gpt-4o-mini',
                    message: 'ciao',
                    currentNode: { nodeId: 'pick_ndg', nodeType: 'USER_INPUT', stateOutputs: ['ndg'] },
                    stateFields: [{ name: 'ndg', type: 'string', pattern: '^\\d{6,10}$' }],
                },
            },
        }) as { acceptedFields: Record<string, unknown>; extractedFields: Record<string, unknown> }
        expect(Object.keys(result.acceptedFields)).toHaveLength(0)
        expect(Object.keys(result.extractedFields)).toHaveLength(0)
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

        expect((result as { text: string }).text).toBe('Qual è il NDG?')
        expect((result as { tokensUsed: number }).tokensUsed).toBe(34)
        const generateArgs = generateTextMock.mock.calls[0][0]
        expect(generateArgs.model).toBe('language-model-stub')
        expect(generateArgs.prompt).toContain('<ROLE>')
        expect(generateArgs.prompt).toContain('Banking agent')
        expect(generateArgs.prompt).toContain('<STYLE>')
        expect(generateArgs.prompt).toContain('banking_formal_it')
        expect(generateArgs.prompt).toContain('<CONVERSATION_HISTORY>')
        expect(generateArgs.prompt).toContain('<CURRENT_STATE>')
        expect(generateArgs.prompt).toContain('<TASK>')
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
