import { ConversationCommand, ConversationCommandSchema } from '@activepieces/shared'
import { generateText, jsonSchema, LanguageModel, tool } from 'ai'
import { FastifyBaseLogger } from 'fastify'
import { ProposePromptInput, ProposeResult, ProviderAdapter } from './provider-adapter'

const DEFAULT_TIMEOUT_MS = 20_000

async function callGenerateText({ model, systemPrompt, userMessage, conversationHistory, tools, abortSignal }: {
    model: LanguageModel
    systemPrompt: string
    userMessage: string
    conversationHistory: Array<{ role: 'user' | 'assistant', text: string }>
    tools: Record<string, ReturnType<typeof tool>>
    abortSignal: AbortSignal
}): Promise<{ toolCalls?: Array<{ toolName: string, args: unknown }>, usage?: { promptTokens?: number, completionTokens?: number } }> {
    const messages = [
        ...conversationHistory.map(h => ({ role: h.role, content: h.text })),
        { role: 'user' as const, content: userMessage },
    ]
    const result = await generateText({
        model,
        system: systemPrompt,
        messages: messages as never,
        tools: tools as never,
        toolChoice: 'auto',
        abortSignal,
    })
    return {
        toolCalls: (result as unknown as { toolCalls?: Array<{ toolName: string, args: unknown }> }).toolCalls,
        usage: (result as unknown as { usage?: { promptTokens?: number, completionTokens?: number } }).usage,
    }
}

function buildToolsRegistry({ allowedFields, allowedInfoIntents }: {
    allowedFields: string[]
    allowedInfoIntents: string[]
}): Record<string, ReturnType<typeof tool>> {
    const fieldEnum = allowedFields.length > 0 ? { enum: allowedFields } : { type: 'string' as const }
    const infoEnum = allowedInfoIntents.length > 0 ? { enum: allowedInfoIntents } : { type: 'string' as const }
    return {
        SET_FIELDS: tool({
            description: 'Atomically set one or more state fields with evidence from the user message',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    updates: {
                        type: 'array',
                        minItems: 1,
                        items: {
                            type: 'object',
                            required: ['field', 'value', 'evidence'],
                            properties: {
                                field: fieldEnum,
                                value: {},
                                evidence: { type: 'string', minLength: 2 },
                                confidence: { type: 'number', minimum: 0, maximum: 1 },
                            },
                        },
                    },
                },
                required: ['updates'],
            }) as never,
        }) as ReturnType<typeof tool>,
        ASK_FIELD: tool({
            description: 'Ask the user to provide a specific missing field',
            inputSchema: jsonSchema({
                type: 'object',
                properties: { field: fieldEnum, reason: { type: 'string' } },
                required: ['field'],
            }) as never,
        }) as ReturnType<typeof tool>,
        ANSWER_META: tool({
            description: 'Reply to a meta-question (re-ask, clarify, progress, help) without state advance',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    kind: { enum: ['ask-repeat', 'ask-clarify', 'ask-progress', 'ask-help'] },
                    message: { type: 'string' },
                },
                required: ['kind'],
            }) as never,
        }) as ReturnType<typeof tool>,
        ANSWER_INFO: tool({
            description: 'Reply to an info-question using a registered intent and citing fields',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    infoIntent: infoEnum,
                    citedFields: { type: 'array', items: { type: 'string' }, minItems: 1 },
                },
                required: ['infoIntent', 'citedFields'],
            }) as never,
        }) as ReturnType<typeof tool>,
        REQUEST_CANCEL: tool({
            description: 'Propose to cancel the current flow; creates a pending_cancel for confirmation',
            inputSchema: jsonSchema({
                type: 'object',
                properties: { reason: { type: 'string' } },
            }) as never,
        }) as ReturnType<typeof tool>,
        RESOLVE_PENDING: tool({
            description: 'Accept or reject the active pending interaction',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    decision: { enum: ['accept', 'reject'] },
                    pendingType: { enum: ['confirm_binary', 'pick_from_list', 'pending_overwrite', 'pending_cancel'] },
                },
                required: ['decision', 'pendingType'],
            }) as never,
        }) as ReturnType<typeof tool>,
        REPROMPT: tool({
            description: 'Signal that the user input is unclear; ask for re-formulation',
            inputSchema: jsonSchema({
                type: 'object',
                properties: {
                    reason: { enum: ['low-confidence', 'policy-rejected', 'off-topic', 'ambiguous-input', 'provider-error', 'catalog-not-ready'] },
                },
                required: ['reason'],
            }) as never,
        }) as ReturnType<typeof tool>,
    }
}

function parseToolCallsToCommands({ toolCalls, log }: {
    toolCalls: Array<{ toolName: string, args: unknown }>
    log?: FastifyBaseLogger
}): ConversationCommand[] {
    const commands: ConversationCommand[] = []
    for (const tc of toolCalls) {
        const args = (tc.args ?? {}) as Record<string, unknown>
        const candidate = { type: tc.toolName, ...args }
        const parsed = ConversationCommandSchema.safeParse(candidate)
        if (parsed.success) {
            commands.push(parsed.data)
        }
        else {
            log?.warn({ toolName: tc.toolName, errors: parsed.error.errors.slice(0, 3) }, '[vercel-ai-adapter] tool call rejected by Zod')
        }
    }
    return commands
}

export class VercelAIAdapter implements ProviderAdapter {
    private readonly log?: FastifyBaseLogger

    constructor(private readonly cfg: VercelAIAdapterConfig) {
        this.log = cfg.log
    }

    async proposeCommands(input: ProposePromptInput): Promise<ProposeResult> {
        const abortController = new AbortController()
        const timeout = setTimeout(() => abortController.abort(), this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS)
        try {
            const model = await this.cfg.resolveModel()
            const tools = buildToolsRegistry({
                allowedFields: input.allowedFields,
                allowedInfoIntents: input.allowedInfoIntents,
            })
            const result = await callGenerateText({
                model,
                systemPrompt: input.systemPrompt,
                userMessage: input.userMessage,
                conversationHistory: input.conversationHistory,
                tools,
                abortSignal: abortController.signal,
            })
            const commands = parseToolCallsToCommands({ toolCalls: result.toolCalls ?? [], log: this.log })
            return {
                commands,
                tokenUsage: {
                    inputTokens: result.usage?.promptTokens ?? 0,
                    outputTokens: result.usage?.completionTokens ?? 0,
                },
                modelVersion: this.cfg.modelHint,
            }
        }
        catch (err) {
            this.log?.warn({ err: String(err).slice(0, 200) }, '[vercel-ai-adapter] generateText failed')
            return {
                commands: [],
                modelVersion: this.cfg.modelHint,
                error: String(err).slice(0, 200),
            }
        }
        finally {
            clearTimeout(timeout)
        }
    }
}

export type ResolveModelFn = () => Promise<LanguageModel>

export type VercelAIAdapterConfig = {
    modelHint: string
    resolveModel: ResolveModelFn
    log?: FastifyBaseLogger
    timeoutMs?: number
}
