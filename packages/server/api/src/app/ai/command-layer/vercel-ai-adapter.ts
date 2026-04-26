import { ConversationCommand, ConversationCommandSchema } from '@activepieces/shared'
import { jsonSchema, tool } from 'ai'
import { FastifyBaseLogger } from 'fastify'
import { ProposePromptInput, ProposeResult, ProviderAdapter } from './provider-adapter'

const DEFAULT_TIMEOUT_MS = 30_000

type OpenAIToolCall = {
    id: string
    type: 'function'
    function: { name: string, arguments: string }
}

type OpenAIChoice = {
    message: {
        role: string
        content: string | null
        tool_calls?: OpenAIToolCall[]
    }
    finish_reason: string
}

type OpenAIResponse = {
    choices: OpenAIChoice[]
    usage?: { prompt_tokens?: number, completion_tokens?: number }
}

function buildToolsSchema({ allowedFields, allowedInfoIntents }: {
    allowedFields: string[]
    allowedInfoIntents: string[]
}): Array<{ type: 'function', function: { name: string, description: string, parameters: unknown } }> {
    const fieldEnum = allowedFields.length > 0 ? { enum: allowedFields } : { type: 'string' }
    const infoEnum = allowedInfoIntents.length > 0 ? { enum: allowedInfoIntents } : { type: 'string' }
    return [
        {
            type: 'function',
            function: {
                name: 'SET_FIELDS',
                description: 'Atomically set one or more state fields. evidence MUST be a verbatim substring copied exactly from the user\'s most recent message.',
                parameters: {
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
                                    evidence: { type: 'string', minLength: 2, description: 'Verbatim substring from the user message that supports this field value. Must appear literally in the user message.' },
                                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                                },
                            },
                        },
                    },
                    required: ['updates'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'ASK_FIELD',
                description: 'Ask the user to provide a specific missing field',
                parameters: {
                    type: 'object',
                    properties: { field: fieldEnum, reason: { type: 'string' } },
                    required: ['field'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'ANSWER_META',
                description: 'Reply to a meta-question (re-ask, clarify, progress, help) without state advance',
                parameters: {
                    type: 'object',
                    properties: {
                        kind: { enum: ['ask-repeat', 'ask-clarify', 'ask-progress', 'ask-help'] },
                        message: { type: 'string' },
                    },
                    required: ['kind'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'ANSWER_INFO',
                description: 'Reply to an info-question using a registered intent and citing fields',
                parameters: {
                    type: 'object',
                    properties: {
                        infoIntent: infoEnum,
                        citedFields: { type: 'array', items: { type: 'string' }, minItems: 1 },
                    },
                    required: ['infoIntent', 'citedFields'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'REQUEST_CANCEL',
                description: 'Propose to cancel the current flow; creates a pending_cancel for confirmation',
                parameters: {
                    type: 'object',
                    properties: { reason: { type: 'string' } },
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'RESOLVE_PENDING',
                description: 'Accept or reject the active pending interaction',
                parameters: {
                    type: 'object',
                    properties: {
                        decision: { enum: ['accept', 'reject'] },
                        pendingType: { enum: ['confirm_binary', 'pick_from_list', 'pending_overwrite', 'pending_cancel'] },
                    },
                    required: ['decision', 'pendingType'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'REPROMPT',
                description: 'Signal that the user input is unclear; ask for re-formulation',
                parameters: {
                    type: 'object',
                    properties: {
                        reason: { enum: ['low-confidence', 'policy-rejected', 'off-topic', 'ambiguous-input', 'provider-error', 'catalog-not-ready'] },
                    },
                    required: ['reason'],
                },
            },
        },
    ]
}

function parseToolCallsToCommands({ toolCalls, log }: {
    toolCalls: OpenAIToolCall[]
    log?: FastifyBaseLogger
}): ConversationCommand[] {
    const commands: ConversationCommand[] = []
    for (const tc of toolCalls) {
        let args: Record<string, unknown>
        try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>
        }
        catch {
            log?.warn({ toolName: tc.function.name }, '[vercel-ai-adapter] failed to parse tool call arguments')
            continue
        }
        const candidate = { type: tc.function.name, ...args }
        const parsed = ConversationCommandSchema.safeParse(candidate)
        if (parsed.success) {
            commands.push(parsed.data)
        }
        else {
            log?.warn({ toolName: tc.function.name, errors: parsed.error.errors.slice(0, 3) }, '[vercel-ai-adapter] tool call rejected by Zod')
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
            const tools = buildToolsSchema({
                allowedFields: input.allowedFields,
                allowedInfoIntents: input.allowedInfoIntents,
            })
            const messages = [
                ...input.conversationHistory.map(h => ({ role: h.role, content: h.text })),
                { role: 'user', content: input.userMessage },
            ]
            const body = {
                model: this.cfg.modelHint,
                system: input.systemPrompt,
                messages,
                tools,
                tool_choice: 'auto',
            }
            const response = await fetch(`${this.cfg.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.cfg.apiKey}`,
                },
                body: JSON.stringify(body),
                signal: abortController.signal,
            })
            if (!response.ok) {
                const errText = await response.text().catch(() => '(unreadable)')
                throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`)
            }
            const data = await response.json() as OpenAIResponse
            const toolCalls = data.choices[0]?.message?.tool_calls ?? []
            this.log?.info({ toolCallCount: toolCalls.length, toolNames: toolCalls.map(t => t.function.name) }, '[vercel-ai-adapter] bridge response')
            const commands = parseToolCallsToCommands({ toolCalls, log: this.log })
            return {
                commands,
                tokenUsage: {
                    inputTokens: data.usage?.prompt_tokens ?? 0,
                    outputTokens: data.usage?.completion_tokens ?? 0,
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

// Keep re-exports for tests that import from this module
export { jsonSchema, tool }

export type VercelAIAdapterConfig = {
    modelHint: string
    baseURL: string
    apiKey: string
    log?: FastifyBaseLogger
    timeoutMs?: number
}
