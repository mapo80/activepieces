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
import { candidatePolicy, NodeAdmissibilityDescriptor } from './candidate-policy'
import { interactiveFlowModelFactory } from './interactive-flow-model-factory'
import { CurrentNodeDescriptor as MetaNode, metaQuestionHandler } from './meta-question-handler'
import { overwritePolicy } from './overwrite-policy'
import { PendingInteraction, pendingInteractionResolver } from './pending-interaction-resolver'
import { preParser, PreParserMatch } from './pre-parser'
import { reasonResolver } from './reason-resolver'

const LLM_EXTRACT_TIMEOUT_MS = Number.parseInt(process.env.AP_LLM_EXTRACT_TIMEOUT_MS ?? '20000', 10)
const LLM_QUESTION_TIMEOUT_MS = Number.parseInt(process.env.AP_LLM_QUESTION_TIMEOUT_MS ?? '20000', 10)

const StateFieldRequestSchema = z.object({
    name: z.string().min(1),
    type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'date']),
    description: z.string().optional(),
    format: z.string().optional(),
    required: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    extractable: z.boolean().optional(),
    minLength: z.number().int().min(1).max(200).optional(),
    maxLength: z.number().int().min(1).max(1000).optional(),
    pattern: z.string().optional(),
    enumFrom: z.string().optional(),
    enumValueField: z.string().optional(),
    parser: z.enum(['ndg', 'rapportoId', 'absolute-date', 'reason-code-cued', 'confirmation-keyword', 'ner-name']).optional(),
})

const FieldExtractRequestSchema = z.object({
    provider: z.nativeEnum(AIProviderName),
    model: z.string().min(1),
    message: z.string().min(1),
    systemPrompt: z.string().optional(),
    locale: z.string().optional(),
    currentState: z.record(z.string(), z.unknown()).optional(),
    stateFields: z.array(StateFieldRequestSchema).min(1),
    currentNode: z.object({
        nodeId: z.string(),
        nodeType: z.enum(['USER_INPUT', 'CONFIRM', 'TOOL', 'BRANCH']).optional(),
        displayName: z.string().optional(),
        stateOutputs: z.array(z.string()).optional(),
        allowedExtraFields: z.array(z.string()).optional(),
        prompt: z.string().optional(),
        displayField: z.string().optional(),
        nextMissingField: z.string().optional(),
    }).optional(),
    pendingInteraction: z.union([
        z.object({ type: z.literal('confirm_binary'), field: z.string(), target: z.unknown(), nodeId: z.string() }),
        z.object({
            type: z.literal('pick_from_list'),
            field: z.string(),
            options: z.array(z.object({ ordinal: z.number(), label: z.string(), value: z.unknown() })),
            nodeId: z.string(),
        }),
        z.object({ type: z.literal('pending_overwrite'), field: z.string(), oldValue: z.unknown(), newValue: z.unknown(), nodeId: z.string() }),
        z.object({ type: z.literal('open_text'), field: z.string(), nodeId: z.string() }),
    ]).optional(),
    identityFields: z.array(z.string()).optional(),
    flowLabel: z.string().optional(),
})

const PolicyDecisionSchema = z.object({
    field: z.string(),
    action: z.enum(['accept', 'reject', 'confirm']),
    reason: z.string(),
    value: z.unknown().optional(),
    pendingOverwrite: z.object({
        field: z.string(),
        oldValue: z.unknown(),
        newValue: z.unknown(),
    }).optional(),
})

const FieldExtractResponseSchema = z.object({
    candidates: z.array(z.object({
        field: z.string(),
        value: z.unknown(),
        intent: z.enum(['set', 'correct', 'confirm', 'reject']).optional(),
        evidence: z.string().optional(),
        source: z.enum(['pre-parser', 'pending-interaction', 'llm']),
    })),
    policyDecisions: z.array(PolicyDecisionSchema),
    acceptedFields: z.record(z.string(), z.unknown()),
    turnAffirmed: z.boolean(),
    metaAnswer: z.string().optional(),
    clarifyReason: z.object({
        matches: z.array(z.object({ code: z.string(), descr: z.string() })),
    }).optional(),
    tokensUsed: z.number(),
    logEvents: z.array(z.object({
        stage: z.string(),
        data: z.record(z.string(), z.unknown()).optional(),
    })),
    extractedFields: z.record(z.string(), z.unknown()),
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
    preRenderedContent: z.string().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
})

const QuestionGenerateResponseSchema = z.object({
    text: z.string(),
    tokensUsed: z.number(),
    safetyNetAppended: z.boolean().optional(),
})

function buildExtractionSchemaFromFields({ stateFields, currentState, eligibleFields }: {
    stateFields: z.infer<typeof StateFieldRequestSchema>[]
    currentState: Record<string, unknown>
    eligibleFields: Set<string>
}): Record<string, unknown> {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const field of stateFields) {
        if (!eligibleFields.has(field.name)) continue
        if (field.extractable === false) continue
        const jsonType = field.type === 'date' ? 'string' : field.type
        const prop: Record<string, unknown> = {
            type: jsonType,
            description: field.description ?? `The ${field.name} field`,
        }
        if (field.format) prop.format = field.format
        if (field.minLength !== undefined) prop.minLength = field.minLength
        if (field.maxLength !== undefined) prop.maxLength = field.maxLength
        if (field.pattern) prop.pattern = field.pattern
        if (field.enumFrom && field.enumValueField) {
            const list = currentState[field.enumFrom]
            if (Array.isArray(list) && list.length > 0) {
                const enumValueField = field.enumValueField
                const values = list
                    .map(item => (item && typeof item === 'object' ? (item as Record<string, unknown>)[enumValueField] : undefined))
                    .filter(v => v !== undefined)
                if (values.length > 0) {
                    prop.enum = values
                }
            }
        }
        properties[field.name] = prop
        if (field.required) required.push(field.name)
    }
    return { type: 'object', properties, required, additionalProperties: false }
}

function buildSystemPromptWithState({
    systemPrompt,
    locale,
    currentState,
    lockedFields,
}: {
    systemPrompt: string | undefined
    locale: string | undefined
    currentState: Record<string, unknown>
    lockedFields: string[]
}): string {
    const segments: string[] = []
    if (systemPrompt) segments.push(systemPrompt)
    if (locale) segments.push(`Conversation locale: ${locale}`)
    const stateEntries = Object.entries(currentState).filter(([, v]) => v !== null && v !== undefined && v !== '')
    if (stateEntries.length > 0) {
        const summary = stateEntries.map(([k, v]) => `- ${k}: ${previewValue(v)}`).join('\n')
        segments.push(`<CONVERSATION_STATE>\nFields già stabiliti:\n${summary}\n</CONVERSATION_STATE>`)
    }
    if (lockedFields.length > 0) {
        segments.push(`<LOCKED_FIELDS>\n${lockedFields.join(', ')}\nQuesti campi NON devono essere re-estratti a meno che l'utente non corregga esplicitamente con cue ("scusa", "invece", "cercavo", "volevo dire", "in effetti").\n</LOCKED_FIELDS>`)
    }
    segments.push('Estrai SOLO campi esplicitamente presenti nel messaggio. Se non c\'è nulla, restituisci una tool call vuota {}. Non inventare dati.')
    return segments.join('\n\n')
}

function previewValue(value: unknown): string {
    if (typeof value === 'string') return `"${value.length > 60 ? value.slice(0, 57) + '…' : value}"`
    if (Array.isArray(value)) return `[${value.length} elementi]`
    if (value && typeof value === 'object') return '(oggetto)'
    return String(value)
}

function runPreParserForEligibleFields({ message, eligibleFields }: {
    message: string
    stateFields: z.infer<typeof StateFieldRequestSchema>[]
    eligibleFields: Set<string>
}): PreParserMatch[] {
    const result = preParser.run({ message })
    return result.candidates.filter(c => eligibleFields.has(c.field) || c.field === 'turnAffirmed')
}

function computeEligibleFields({ currentNode, identityFields, stateFields }: {
    currentNode: NodeAdmissibilityDescriptor
    identityFields: string[]
    stateFields: z.infer<typeof StateFieldRequestSchema>[]
}): Set<string> {
    const eligible = new Set<string>()
    for (const out of currentNode.stateOutputs ?? []) eligible.add(out)
    for (const id of identityFields) eligible.add(id)
    for (const extra of currentNode.allowedExtraFields ?? []) eligible.add(extra)
    for (const field of stateFields) {
        if (field.parser === 'ndg' || field.parser === 'rapportoId' || field.parser === 'absolute-date' || field.parser === 'reason-code-cued') {
            eligible.add(field.name)
        }
    }
    return eligible
}

function resolveReasonIfText({
    candidate,
    currentState,
    stateFields,
}: {
    candidate: { field: string, value: unknown, evidence?: string }
    currentState: Record<string, unknown>
    stateFields: z.infer<typeof StateFieldRequestSchema>[]
}): { action: 'keep' | 'drop' | 'ambiguous', resolvedValue?: unknown, matches?: Array<{ code: string, descr: string }> } {
    if (candidate.field !== 'closureReasonText') return { action: 'keep' }
    const reasonField = stateFields.find(f => f.name === 'closureReasonCode')
    if (!reasonField?.enumFrom || !reasonField?.enumValueField) return { action: 'keep' }
    const enumValueField = reasonField.enumValueField
    const list = currentState[reasonField.enumFrom]
    if (!Array.isArray(list) || list.length === 0) return { action: 'drop' }
    const closureReasons = list.map(item => {
        const obj = item as Record<string, unknown>
        return {
            codice: String(obj[enumValueField] ?? ''),
            descr: String(obj.descr ?? obj.description ?? obj.label ?? ''),
        }
    })
    const resolution = reasonResolver.resolve({ reasonText: String(candidate.value), closureReasons })
    if (resolution.resolution === 'unique') {
        return { action: 'keep', resolvedValue: resolution.code }
    }
    if (resolution.resolution === 'ambiguous') {
        return { action: 'ambiguous', matches: resolution.matches }
    }
    return { action: 'drop' }
}

export const interactiveFlowAiController: FastifyPluginAsyncZod = async (app) => {
    app.post('/field-extract', FieldExtractRoute, async (request) => {
        const enginePrincipal = request.principal as EnginePrincipal
        assertNotNullOrUndefined(enginePrincipal.platform?.id, 'platformId')
        const body = request.body
        const logEvents: Array<{ stage: string, data?: Record<string, unknown> }> = []
        const currentState = body.currentState ?? {}

        const metaCurrentNode: MetaNode = body.currentNode
            ? {
                nodeId: body.currentNode.nodeId,
                displayName: body.currentNode.displayName,
                displayField: body.currentNode.displayField,
                prompt: body.currentNode.prompt,
                nextMissingField: body.currentNode.nextMissingField,
            }
            : { nodeId: 'unknown' }
        const metaIntent = metaQuestionHandler.detectMetaIntent({ message: body.message })
        if (metaIntent) {
            const metaAnswer = metaQuestionHandler.renderMetaAnswer({
                intent: metaIntent,
                state: currentState,
                currentNode: metaCurrentNode,
                flowLabel: body.flowLabel,
            })
            logEvents.push({ stage: 'meta-question:detected', data: { intent: metaIntent } })
            return buildEmptyResponse({ metaAnswer, logEvents })
        }

        const identityFields = body.identityFields ?? []
        const admissibilityNode: NodeAdmissibilityDescriptor = {
            nodeId: body.currentNode?.nodeId ?? 'unknown',
            stateOutputs: body.currentNode?.stateOutputs,
            allowedExtraFields: body.currentNode?.allowedExtraFields,
        }
        const eligibleFields = computeEligibleFields({
            currentNode: admissibilityNode,
            identityFields,
            stateFields: body.stateFields,
        })

        const candidates: Array<{
            field: string
            value: unknown
            intent?: 'set' | 'correct' | 'confirm' | 'reject'
            evidence?: string
            source: 'pre-parser' | 'pending-interaction' | 'llm'
        }> = []

        const preMatches = runPreParserForEligibleFields({
            message: body.message,
            stateFields: body.stateFields,
            eligibleFields,
        })
        for (const m of preMatches) {
            candidates.push({ field: m.field, value: m.value, intent: 'set', evidence: m.evidence, source: 'pre-parser' })
            logEvents.push({ stage: 'preparser:match', data: { field: m.field, value: String(m.value).slice(0, 40) } })
        }

        if (body.pendingInteraction) {
            const resolution = pendingInteractionResolver.resolve({
                message: body.message,
                pending: body.pendingInteraction as PendingInteraction,
            })
            if (resolution.outcome === 'accept') {
                candidates.push({
                    field: resolution.field,
                    value: resolution.value,
                    intent: body.pendingInteraction.type === 'pending_overwrite' ? 'correct' : 'set',
                    evidence: resolution.evidence,
                    source: 'pending-interaction',
                })
                logEvents.push({ stage: 'pending-interaction:accept', data: { field: resolution.field } })
            }
            else if (resolution.outcome === 'reject') {
                candidates.push({
                    field: resolution.field,
                    value: null,
                    intent: 'reject',
                    evidence: resolution.evidence,
                    source: 'pending-interaction',
                })
                logEvents.push({ stage: 'pending-interaction:reject', data: { field: resolution.field } })
            }
        }

        const alreadyResolved = new Set(candidates.map(c => c.field))
        const remainingEligible = new Set([...eligibleFields].filter(f => !alreadyResolved.has(f)))
        let tokensUsed = 0

        const nodeOutputs = new Set(body.currentNode?.stateOutputs ?? [])
        const remainingNodeOutputs = [...remainingEligible].filter(f => nodeOutputs.has(f))
        const shouldSkipLlm = nodeOutputs.size > 0
            && remainingNodeOutputs.length === 0
            && !body.pendingInteraction
        if (shouldSkipLlm) {
            logEvents.push({ stage: 'llm:skipped', data: { reason: 'all-node-outputs-resolved-by-pre-parser' } })
        }

        if (remainingEligible.size > 0 && !shouldSkipLlm) {
            const extendedEligible = new Set(remainingEligible)
            extendedEligible.add('closureReasonText')
            const schemaObject = buildExtractionSchemaFromFields({
                stateFields: [
                    ...body.stateFields,
                    { name: 'closureReasonText', type: 'string', description: 'Descrizione testuale della motivazione quando l\'utente non cita un codice esplicito' },
                ],
                currentState,
                eligibleFields: extendedEligible,
            })
            if (Object.keys((schemaObject.properties as Record<string, unknown>) ?? {}).length > 0) {
                const model = await interactiveFlowModelFactory.build({
                    platformId: enginePrincipal.platform.id,
                    provider: body.provider,
                    modelId: body.model,
                    log: request.log,
                })
                const lockedFields = Object.keys(currentState).filter(k => body.stateFields.some(f => f.name === k))
                const systemPrompt = buildSystemPromptWithState({
                    systemPrompt: body.systemPrompt,
                    locale: body.locale,
                    currentState,
                    lockedFields,
                })
                const extractionTool = tool({
                    description: 'Extract fields from user message (must provide evidence as literal substring)',
                    inputSchema: jsonSchema(schemaObject),
                    execute: async (data) => data,
                })
                const llmPromise = generateText({
                    model,
                    system: systemPrompt,
                    tools: { extract: extractionTool },
                    toolChoice: 'auto',
                    messages: [{ role: 'user', content: body.message }],
                }).catch((e) => {
                    logEvents.push({ stage: 'llm:error', data: { error: (e as Error).message?.slice(0, 160) } })
                    return null
                })
                const timeoutPromise = new Promise<null>((resolve) => {
                    setTimeout(() => resolve(null), LLM_EXTRACT_TIMEOUT_MS)
                })
                const result = await Promise.race([llmPromise, timeoutPromise])
                if (result === null) {
                    logEvents.push({ stage: 'llm:timeout', data: { ms: LLM_EXTRACT_TIMEOUT_MS } })
                }
                else {
                    tokensUsed = result.usage?.totalTokens ?? 0
                    const toolCalls = result.toolCalls
                    const rawExtracted = toolCalls && toolCalls.length > 0 ? (toolCalls[0].input as Record<string, unknown>) : {}
                    for (const [k, v] of Object.entries(rawExtracted)) {
                        if (isNil(v) || v === '') continue
                        candidates.push({ field: k, value: v, intent: 'set', source: 'llm' })
                        logEvents.push({ stage: 'llm:candidate', data: { field: k } })
                    }
                }
            }
        }

        const { acceptedFields, policyDecisions, turnAffirmed, clarifyReason, extractedFields } = applyVerificationPipeline({
            candidates,
            currentState,
            stateFields: body.stateFields,
            currentNode: admissibilityNode,
            identityFields,
            userMessage: body.message,
            pendingInteractionType: body.pendingInteraction ? (body.pendingInteraction as { type?: string }).type : undefined,
            currentNodeType: body.currentNode?.nodeType,
            logEvents,
        })

        return {
            candidates,
            policyDecisions,
            acceptedFields,
            turnAffirmed,
            metaAnswer: undefined,
            clarifyReason,
            tokensUsed,
            logEvents,
            extractedFields,
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

        const preRendered = body.preRenderedContent
        const prompt = buildQuestionPrompt({ ...body, preRendered })
        const qgPromise = generateText({ model, prompt, maxOutputTokens: body.maxOutputTokens ?? 256 }).catch(() => null)
        const qgTimeoutPromise = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), LLM_QUESTION_TIMEOUT_MS)
        })
        const qgResult = await Promise.race([qgPromise, qgTimeoutPromise])
        let text: string
        let safetyNetAppended = false
        let qgTimedOut = false
        if (qgResult === null) {
            qgTimedOut = true
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
        void qgTimedOut

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

function applyVerificationPipeline({
    candidates,
    currentState,
    stateFields,
    currentNode,
    identityFields,
    userMessage,
    pendingInteractionType,
    currentNodeType,
    logEvents,
}: {
    candidates: Array<{ field: string, value: unknown, intent?: 'set' | 'correct' | 'confirm' | 'reject', evidence?: string, source: 'pre-parser' | 'pending-interaction' | 'llm' }>
    currentState: Record<string, unknown>
    stateFields: z.infer<typeof StateFieldRequestSchema>[]
    currentNode: NodeAdmissibilityDescriptor
    identityFields: string[]
    userMessage: string
    pendingInteractionType?: string
    currentNodeType: 'USER_INPUT' | 'CONFIRM' | 'TOOL' | 'BRANCH' | undefined
    logEvents: Array<{ stage: string, data?: Record<string, unknown> }>
}): {
        acceptedFields: Record<string, unknown>
        policyDecisions: Array<{ field: string, action: 'accept' | 'reject' | 'confirm', reason: string, value?: unknown, pendingOverwrite?: { field: string, oldValue: unknown, newValue: unknown } }>
        turnAffirmed: boolean
        clarifyReason?: { matches: Array<{ code: string, descr: string }> }
        extractedFields: Record<string, unknown>
    } {
    const acceptedFields: Record<string, unknown> = {}
    const policyDecisions: Array<{ field: string, action: 'accept' | 'reject' | 'confirm', reason: string, value?: unknown, pendingOverwrite?: { field: string, oldValue: unknown, newValue: unknown } }> = []
    let turnAffirmed = false
    let clarifyReason: { matches: Array<{ code: string, descr: string }> } | undefined

    const cueDetection = overwritePolicy.detectCueOfCorrection({ message: userMessage })
    const perFieldCandidates = new Map<string, Array<typeof candidates[number]>>()
    for (const c of candidates) {
        const arr = perFieldCandidates.get(c.field) ?? []
        arr.push(c)
        perFieldCandidates.set(c.field, arr)
    }

    for (const [field, fieldCandidates] of perFieldCandidates) {
        if (field === 'turnAffirmed') {
            const pendingAllowsPromotion = pendingInteractionType === 'confirm_binary' || pendingInteractionType === 'pending_overwrite'
            if (overwritePolicy.shouldPromoteTurnAffirmed({
                currentNodeType,
                pendingOverwriteActive: pendingAllowsPromotion,
            })) {
                acceptedFields['confirmed'] = true
                turnAffirmed = true
                policyDecisions.push({ field: 'confirmed', action: 'accept', reason: 'promoted-from-turnAffirmed', value: true })
                logEvents.push({ stage: 'confirmed:persisted' })
            }
            else {
                turnAffirmed = true
                logEvents.push({ stage: 'confirmed:ephemeral' })
            }
            continue
        }

        const admissibility = candidatePolicy.verifyFieldAdmissibility({
            field,
            currentNode,
            identityFields,
        })
        if (!admissibility.ok) {
            policyDecisions.push({ field, action: 'reject', reason: admissibility.reason })
            logEvents.push({ stage: 'verify:admissibility-failed', data: { field, reason: admissibility.reason } })
            continue
        }

        let chosenCandidate = fieldCandidates.find(c => c.source === 'pre-parser')
            ?? fieldCandidates.find(c => c.source === 'pending-interaction')
            ?? fieldCandidates[0]

        if (field === 'closureReasonText') {
            const resolution = resolveReasonIfText({
                candidate: chosenCandidate,
                currentState,
                stateFields,
            })
            if (resolution.action === 'drop') {
                policyDecisions.push({ field: 'closureReasonCode', action: 'reject', reason: 'reason-not-resolved' })
                logEvents.push({ stage: 'reason:vague-or-unresolved', data: { value: String(chosenCandidate.value).slice(0, 40) } })
                continue
            }
            if (resolution.action === 'ambiguous') {
                clarifyReason = { matches: resolution.matches ?? [] }
                policyDecisions.push({ field: 'closureReasonCode', action: 'confirm', reason: 'ambiguous-reason-clarify' })
                logEvents.push({ stage: 'reason:ambiguous' })
                continue
            }
            chosenCandidate = {
                field: 'closureReasonCode',
                value: resolution.resolvedValue,
                intent: 'set',
                evidence: chosenCandidate.evidence,
                source: chosenCandidate.source,
            }
        }

        if (chosenCandidate.intent === 'reject') {
            policyDecisions.push({ field: chosenCandidate.field, action: 'reject', reason: 'explicit-user-reject' })
            continue
        }

        if (chosenCandidate.source === 'llm' && chosenCandidate.evidence) {
            const evidenceCheck = candidatePolicy.verifyEvidence({ evidence: chosenCandidate.evidence, userMessage })
            if (!evidenceCheck.ok) {
                policyDecisions.push({ field: chosenCandidate.field, action: 'reject', reason: evidenceCheck.reason })
                logEvents.push({ stage: 'verify:evidence-failed', data: { field: chosenCandidate.field, reason: evidenceCheck.reason } })
                continue
            }
        }

        const fieldSpec = stateFields.find(f => f.name === chosenCandidate.field)
        const plausibility = candidatePolicy.verifyFieldPlausibility({
            field: chosenCandidate.field,
            value: chosenCandidate.value,
            rules: fieldSpec ? { minLength: fieldSpec.minLength, maxLength: fieldSpec.maxLength, pattern: fieldSpec.pattern } : undefined,
        })
        if (!plausibility.ok) {
            policyDecisions.push({ field: chosenCandidate.field, action: 'reject', reason: plausibility.reason })
            logEvents.push({ stage: 'verify:plausibility-failed', data: { field: chosenCandidate.field, reason: plausibility.reason } })
            continue
        }

        const domain = candidatePolicy.verifyDomain({
            field: chosenCandidate.field,
            value: chosenCandidate.value,
            state: currentState,
            fieldSpec: fieldSpec ? { enumFrom: fieldSpec.enumFrom, enumValueField: fieldSpec.enumValueField } : undefined,
        })
        if (!domain.ok) {
            policyDecisions.push({ field: chosenCandidate.field, action: 'reject', reason: domain.reason })
            logEvents.push({ stage: 'verify:domain-failed', data: { field: chosenCandidate.field, reason: domain.reason } })
            continue
        }

        const decision = overwritePolicy.decideOverwrite({
            field: chosenCandidate.field,
            oldValue: currentState[chosenCandidate.field],
            newValue: chosenCandidate.value,
            cuePresent: cueDetection.present || chosenCandidate.source === 'pending-interaction',
            plausible: true,
        })
        if (decision.action === 'accept') {
            acceptedFields[chosenCandidate.field] = chosenCandidate.value
            policyDecisions.push({ field: chosenCandidate.field, action: 'accept', reason: decision.reason, value: chosenCandidate.value })
            logEvents.push({ stage: 'policy:accept', data: { field: chosenCandidate.field, reason: decision.reason } })
        }
        else if (decision.action === 'confirm') {
            policyDecisions.push({
                field: chosenCandidate.field,
                action: 'confirm',
                reason: decision.reason,
                value: chosenCandidate.value,
                pendingOverwrite: decision.pendingOverwrite,
            })
            logEvents.push({ stage: 'policy:confirm-pending', data: { field: chosenCandidate.field } })
        }
        else {
            policyDecisions.push({ field: chosenCandidate.field, action: 'reject', reason: decision.reason })
            logEvents.push({ stage: 'policy:reject', data: { field: chosenCandidate.field, reason: decision.reason } })
        }
    }

    const extractedFields: Record<string, unknown> = { ...acceptedFields }
    if (turnAffirmed && !acceptedFields.confirmed) extractedFields.turnAffirmed = true
    return { acceptedFields, policyDecisions, turnAffirmed, clarifyReason, extractedFields }
}

function buildEmptyResponse({ metaAnswer, logEvents }: {
    metaAnswer?: string
    logEvents: Array<{ stage: string, data?: Record<string, unknown> }>
}): {
        candidates: Array<never>
        policyDecisions: Array<never>
        acceptedFields: Record<string, unknown>
        turnAffirmed: boolean
        metaAnswer?: string
        clarifyReason: undefined
        tokensUsed: number
        logEvents: Array<{ stage: string, data?: Record<string, unknown> }>
        extractedFields: Record<string, unknown>
    } {
    return {
        candidates: [],
        policyDecisions: [],
        acceptedFields: {},
        turnAffirmed: false,
        metaAnswer,
        clarifyReason: undefined,
        tokensUsed: 0,
        logEvents,
        extractedFields: {},
    }
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
