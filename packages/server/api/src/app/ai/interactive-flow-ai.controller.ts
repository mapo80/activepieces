import {
    AIProviderName,
    assertNotNullOrUndefined,
    EnginePrincipal,
    isNil,
} from '@activepieces/shared'
import { generateText, jsonSchema, tool } from 'ai'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { interactiveFlowModelFactory } from './interactive-flow-model-factory'

const StateFieldRequestSchema = z.object({
    name: z.string().min(1),
    type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'date']),
    description: z.string().optional(),
    format: z.string().optional(),
    required: z.boolean().optional(),
    sensitive: z.boolean().optional(),
})

const FieldExtractRequestSchema = z.object({
    provider: z.nativeEnum(AIProviderName),
    model: z.string().min(1),
    message: z.string().min(1),
    systemPrompt: z.string().optional(),
    locale: z.string().optional(),
    currentState: z.record(z.string(), z.unknown()).optional(),
    stateFields: z.array(StateFieldRequestSchema).min(1),
})

const FieldExtractResponseSchema = z.object({
    extractedFields: z.record(z.string(), z.unknown()),
    tokensUsed: z.number(),
})

const QuestionGenerateTargetFieldSchema = z.object({
    name: z.string(),
    label: z.string().optional(),
    description: z.string().optional(),
    format: z.string().optional(),
})

const QuestionGenerateRequestSchema = z.object({
    provider: z.nativeEnum(AIProviderName),
    model: z.string().min(1),
    locale: z.string(),
    systemPrompt: z.string().optional(),
    systemPromptAddendum: z.string().optional(),
    styleTemplate: z.string().optional(),
    state: z.record(z.string(), z.unknown()).optional(),
    history: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string(),
    })).optional(),
    targetFields: z.array(QuestionGenerateTargetFieldSchema).min(1),
    renderHint: z.object({
        component: z.string(),
        props: z.record(z.string(), z.unknown()).optional(),
    }).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
})

const QuestionGenerateResponseSchema = z.object({
    text: z.string(),
    tokensUsed: z.number(),
})

function buildExtractionSchema(stateFields: z.infer<typeof StateFieldRequestSchema>[]): Record<string, unknown> {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const field of stateFields) {
        const jsonType = field.type === 'date' ? 'string' : field.type
        properties[field.name] = {
            type: jsonType,
            description: field.description ?? `The ${field.name} field`,
            ...(field.format ? { format: field.format } : {}),
        }
        if (field.required) {
            required.push(field.name)
        }
    }
    return { type: 'object', properties, required }
}

function buildQuestionPrompt({
    systemPrompt,
    styleTemplate,
    systemPromptAddendum,
    locale,
    state,
    history,
    targetFields,
    renderHint,
}: z.infer<typeof QuestionGenerateRequestSchema>): string {
    const sections: string[] = []
    sections.push('<ROLE>\n' + (systemPrompt ?? 'You are a conversational assistant.') + '\n</ROLE>')
    sections.push('<STYLE>\nLocale: ' + locale + (styleTemplate ? '\nTemplate: ' + styleTemplate : '') + '\nRespond in ' + locale + ' only. Be concise.\n</STYLE>')
    if (history && history.length > 0) {
        const turns = history.slice(-10).map(t => `${t.role}: ${t.text}`).join('\n')
        sections.push('<CONVERSATION_HISTORY>\n' + turns + '\n</CONVERSATION_HISTORY>')
    }
    if (!isNil(state) && Object.keys(state).length > 0) {
        sections.push('<CURRENT_STATE>\n' + JSON.stringify(state) + '\n</CURRENT_STATE>')
    }
    const taskLines = targetFields.map(f => {
        const parts: string[] = [`- ${f.name}`]
        if (f.label) parts.push(`label: "${f.label}"`)
        if (f.description) parts.push(`description: ${f.description}`)
        if (f.format) parts.push(`format: ${f.format}`)
        return parts.join(' | ')
    })
    let task = '<TASK>\nAsk the user for the following information, one single clear question.\n' + taskLines.join('\n')
    if (renderHint) {
        task += `\nThe user will answer via a UI component: ${renderHint.component}${renderHint.props ? ` ${JSON.stringify(renderHint.props)}` : ''}. Guide them accordingly.`
    }
    task += '\n</TASK>'
    sections.push(task)
    sections.push('<GUARDRAILS>\n- Do not invent data or promises.\n- Ask one question at a time.\n- No greetings or sign-offs; question only.\n- Match the locale exactly.\n</GUARDRAILS>')
    if (systemPromptAddendum) {
        sections.push('<ADDENDUM>\n' + systemPromptAddendum + '\n</ADDENDUM>')
    }
    return sections.join('\n\n')
}

export const interactiveFlowAiController: FastifyPluginAsyncZod = async (app) => {
    app.post('/field-extract', FieldExtractRoute, async (request) => {
        const enginePrincipal = request.principal as EnginePrincipal
        assertNotNullOrUndefined(enginePrincipal.platform?.id, 'platformId')

        const body = request.body
        const model = await interactiveFlowModelFactory.build({
            platformId: enginePrincipal.platform.id,
            provider: body.provider,
            modelId: body.model,
            log: request.log,
        })

        const schema = buildExtractionSchema(body.stateFields)
        const extractionTool = tool({
            description: 'Extract the relevant state fields from the user message',
            inputSchema: jsonSchema(schema),
            execute: async (data) => data,
        })

        const systemSegments: string[] = []
        if (body.systemPrompt) systemSegments.push(body.systemPrompt)
        if (body.locale) systemSegments.push(`Conversation locale: ${body.locale}`)
        if (body.currentState && Object.keys(body.currentState).length > 0) {
            systemSegments.push(`Known state: ${JSON.stringify(body.currentState)}`)
        }
        systemSegments.push('Only extract fields that are clearly present in the user message. Do not invent values. If a field is not present, omit it.')

        const result = await generateText({
            model,
            system: systemSegments.join('\n\n'),
            tools: { extract: extractionTool },
            toolChoice: 'required',
            messages: [{ role: 'user', content: body.message }],
        })

        const toolCalls = result.toolCalls
        const extractedFields = toolCalls && toolCalls.length > 0 ? (toolCalls[0].input as Record<string, unknown>) : {}
        const cleaned: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(extractedFields)) {
            if (!isNil(v) && v !== '') cleaned[k] = v
        }

        return {
            extractedFields: cleaned,
            tokensUsed: result.usage?.totalTokens ?? 0,
        }
    })

    app.post('/question-generate', QuestionGenerateRoute, async (request) => {
        const enginePrincipal = request.principal as EnginePrincipal
        assertNotNullOrUndefined(enginePrincipal.platform?.id, 'platformId')

        const body = request.body
        const model = await interactiveFlowModelFactory.build({
            platformId: enginePrincipal.platform.id,
            provider: body.provider,
            modelId: body.model,
            log: request.log,
        })

        const prompt = buildQuestionPrompt(body)
        const result = await generateText({
            model,
            prompt,
            maxOutputTokens: body.maxOutputTokens ?? 256,
        })

        return {
            text: result.text,
            tokensUsed: result.usage?.totalTokens ?? 0,
        }
    })
}

const FieldExtractRoute = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        body: FieldExtractRequestSchema,
        response: {
            [StatusCodes.OK]: FieldExtractResponseSchema,
        },
    },
}

const QuestionGenerateRoute = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        body: QuestionGenerateRequestSchema,
        response: {
            [StatusCodes.OK]: QuestionGenerateResponseSchema,
        },
    },
}
