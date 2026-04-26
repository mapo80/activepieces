import {
    AIProviderName,
    assertNotNullOrUndefined,
    EnginePrincipal,
    isNil,
} from '@activepieces/shared'
import { generateText } from 'ai'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { interactiveFlowModelFactory } from './interactive-flow-model-factory'

const LLM_QUESTION_TIMEOUT_MS = Number.parseInt(process.env.AP_LLM_QUESTION_TIMEOUT_MS ?? '20000', 10)

export const interactiveFlowAiController: FastifyPluginAsyncZod = async (app) => {
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

        const preRendered = body.preRenderedContent
        const prompt = buildQuestionPrompt({ ...body, preRendered })
        const qgPromise = generateText({ model, prompt, maxOutputTokens: body.maxOutputTokens ?? 256 }).catch(() => null)
        const qgTimeoutPromise = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), LLM_QUESTION_TIMEOUT_MS)
        })
        const qgResult = await Promise.race([qgPromise, qgTimeoutPromise])
        let text: string
        let safetyNetAppended = false
        if (qgResult === null) {
            const firstTarget = body.targetFields[0]
            const label = firstTarget?.label ?? firstTarget?.name ?? 'information'
            text = body.locale.startsWith('it')
                ? `Per procedere, indicami **${label}**.`
                : `To continue, please provide **${label}**.`
            safetyNetAppended = true
        }
        else {
            text = qgResult.text
        }

        if (preRendered && preRendered.length > 0) {
            const preHeader = preRendered.split('\n')[0]
            if (!text.includes(preHeader)) {
                text = `${text}\n\n${preRendered}`
                safetyNetAppended = true
            }
        }

        const bannedPhrases = /\b(clicca|seleziona dalla tabella|compila il form|dal menu a tendina|nel form|sul pulsante)\b/i
        if (bannedPhrases.test(text)) {
            text = text.replace(bannedPhrases, 'digita la risposta')
        }

        const jsonBlockRe = /```json[\s\S]*?```/g
        if (jsonBlockRe.test(text)) {
            text = text.replace(jsonBlockRe, '').trim()
            safetyNetAppended = true
        }
        const naturalTrailingRe = /^\s*\{[\s\S]*?\}\s*$/
        if (naturalTrailingRe.test(text)) {
            const firstTarget = body.targetFields[0]
            const label = firstTarget?.label ?? firstTarget?.name ?? 'information'
            text = body.locale.startsWith('it')
                ? `Per procedere, indicami **${label}**.`
                : `To continue, please provide **${label}**.`
            safetyNetAppended = true
        }

        const primaryTarget = body.targetFields[0]?.name
        if (primaryTarget && body.state && Object.keys(body.state).length === 0) {
            const mentionsPrimary = primaryTarget.toLowerCase().includes('customer')
                ? /\b(cliente|nome|customer|bellafronte|rossi|titolare|anagrafic)/i.test(text)
                : true
            if (!mentionsPrimary) {
                text = 'Ciao! Per procedere, indicami il nome del cliente (o NDG) su cui operare.'
                safetyNetAppended = true
            }
        }

        return {
            text,
            tokensUsed: qgResult?.usage?.totalTokens ?? 0,
            safetyNetAppended,
        }
    })
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
    preRendered,
}: z.infer<typeof QuestionGenerateRequestSchema> & { preRendered?: string }): string {
    const localeOn = (process.env.AP_PROMPT_LOCALIZATION ?? 'on').toLowerCase() !== 'off'
    const strings = localeOn && locale.startsWith('it') ? PROMPT_STRINGS.it : PROMPT_STRINGS.en
    const sections: string[] = []
    sections.push('<LANGUAGE>\n' + strings.languageLock(locale) + '\n</LANGUAGE>')
    sections.push('<ROLE>\n' + (systemPrompt ?? strings.defaultRole) + '\n</ROLE>')
    sections.push('<STYLE>\nLocale: ' + locale + (styleTemplate ? '\nTemplate: ' + styleTemplate : '') + '\n' + strings.styleRespond(locale) + '\n</STYLE>')
    if (history && history.length > 0) {
        const turns = history.slice(-10).map(t => `${t.role}: ${t.text}`).join('\n')
        sections.push('<CONVERSATION_HISTORY>\n' + turns + '\n</CONVERSATION_HISTORY>')
    }
    if (!isNil(state) && Object.keys(state).length > 0) {
        const stateLines = Object.entries(state)
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? `(${Array.isArray(v) ? `${v.length} items` : 'object'})` : String(v).slice(0, 80)}`)
            .join('\n')
        sections.push('<CURRENT_STATE_CONTEXT>\n' + strings.stateContextHeader + '\n' + stateLines + '\n</CURRENT_STATE_CONTEXT>')
    }
    if (preRendered) {
        sections.push(`<TABLE_PRERENDERED>\n${preRendered}\n</TABLE_PRERENDERED>`)
    }
    const taskLines = targetFields.map(f => {
        const parts: string[] = [`- ${f.name}`]
        if (f.label) parts.push(`label: "${f.label}"`)
        if (f.description) parts.push(`description: ${f.description}`)
        if (f.format) parts.push(`format: ${f.format}`)
        return parts.join(' | ')
    })
    let task = '<TASK>\n' + strings.taskHeader + '\n' + taskLines.join('\n')
    if (renderHint) {
        task += '\n' + strings.taskRenderHint(renderHint.component, renderHint.props ? ` ${JSON.stringify(renderHint.props)}` : '')
    }
    task += '\n</TASK>'
    sections.push(task)
    sections.push('<GUARDRAILS>\n' + strings.guardrails.join('\n') + '\n</GUARDRAILS>')
    if (systemPromptAddendum) {
        sections.push('<ADDENDUM>\n' + systemPromptAddendum + '\n</ADDENDUM>')
    }
    return sections.join('\n\n')
}

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
    preRenderedContent: z.string().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
})

const QuestionGenerateResponseSchema = z.object({
    text: z.string(),
    tokensUsed: z.number().int().nonnegative(),
    safetyNetAppended: z.boolean(),
})

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

type PromptStrings = {
    defaultRole: string
    styleRespond: (l: string) => string
    stateContextHeader: string
    taskHeader: string
    taskRenderHint: (component: string, propsTxt: string) => string
    guardrails: string[]
    languageLock: (l: string) => string
}

const PROMPT_STRINGS: Record<'en' | 'it', PromptStrings> = {
    en: {
        defaultRole: 'You are a conversational assistant.',
        styleRespond: (l: string): string => `Respond in ${l} only. Be concise.`,
        stateContextHeader: 'This is the conversation state for YOUR reference only — DO NOT echo it back to the user, DO NOT output JSON, DO NOT output code blocks. Ask a natural-language question.',
        taskHeader: 'Ask the user for the following information, one single clear question.',
        taskRenderHint: (component: string, propsTxt: string): string => `The user will answer via a UI component: ${component}${propsTxt}. Guide them accordingly.`,
        guardrails: [
            '- Do not invent data or promises.',
            '- Ask one question at a time.',
            '- No greetings or sign-offs; question only.',
            '- Match the locale exactly.',
            '- OUTPUT MUST BE natural-language prose. NEVER output JSON, code blocks, backticks, or field name dumps. NEVER echo the conversation state back to the user.',
        ],
        languageLock: (l: string): string => `Respond in ${l}. Match the user's language signals.`,
    },
    it: {
        defaultRole: 'Sei un assistente conversazionale.',
        styleRespond: (): string => 'Rispondi ESCLUSIVAMENTE in italiano. Sii conciso.',
        stateContextHeader: 'Questo è lo stato della conversazione, solo per tuo riferimento — NON ripeterlo all\'utente, NON emettere JSON, NON usare code block. Poni una domanda in linguaggio naturale.',
        taskHeader: 'Chiedi all\'utente le seguenti informazioni con una sola domanda chiara.',
        taskRenderHint: (component: string, propsTxt: string): string => `L'utente risponderà tramite il componente UI: ${component}${propsTxt}. Guidalo di conseguenza.`,
        guardrails: [
            '- Non inventare dati né promesse.',
            '- Una sola domanda per turno.',
            '- Niente saluti o chiusure estranei al compito; solo la domanda (o presentazione breve se l\'addendum lo richiede).',
            '- Rispetta esattamente il locale dell\'utente (italiano).',
            '- L\'OUTPUT DEVE essere prosa in linguaggio naturale. MAI JSON, MAI code block, MAI backtick, MAI dump di campi tecnici. MAI ripetere lo stato della conversazione all\'utente.',
        ],
        languageLock: (): string => 'Rispondi SEMPRE in italiano. Non usare mai inglese.',
    },
}
