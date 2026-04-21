import { InteractiveFlowStateField } from '@activepieces/shared'
import { EngineConstants } from './context/engine-constants'

type FieldExtractorConfig = { aiProviderId: string, model: string }

async function extract({ constants, config, message, stateFields, currentState, systemPrompt, locale, currentNode, identityFields, pendingInteraction, flowLabel }: ExtractArgs): Promise<Record<string, unknown>> {
    const full = await extractWithPolicy({ constants, config, message, stateFields, currentState, systemPrompt, locale, currentNode, identityFields, pendingInteraction, flowLabel })
    return full.extractedFields
}

async function extractWithPolicy({ constants, config, message, stateFields, currentState, systemPrompt, locale, currentNode, identityFields, pendingInteraction, flowLabel }: ExtractArgs): Promise<ExtractResult> {
    const extractable = stateFields.filter(f => f.extractable !== false && f.sensitive !== true)
    if (extractable.length === 0 || message.trim().length === 0) {
        return { extractedFields: {}, turnAffirmed: false, policyDecisions: [] }
    }

    const url = `${constants.internalApiUrl}v1/engine/interactive-flow-ai/field-extract`
    const payload = {
        provider: config.aiProviderId,
        model: config.model,
        message,
        systemPrompt,
        locale,
        currentState: redactSensitive({ state: currentState, fields: stateFields }),
        stateFields: extractable.map(f => ({
            name: f.name,
            type: f.type,
            description: f.description,
            format: f.format,
            required: false,
            extractable: f.extractable,
            minLength: f.minLength,
            maxLength: f.maxLength,
            pattern: f.pattern,
            enumFrom: f.enumFrom,
            enumValueField: f.enumValueField,
            parser: f.parser,
        })),
        currentNode,
        identityFields,
        pendingInteraction,
        flowLabel,
    }

    let response: Response
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${constants.engineToken}`,
            },
            body: JSON.stringify(payload),
        })
    }
    catch {
        return { extractedFields: {}, turnAffirmed: false, policyDecisions: [] }
    }
    if (!response.ok) {
        return { extractedFields: {}, turnAffirmed: false, policyDecisions: [] }
    }
    const body = await response.json().catch(() => null) as {
        extractedFields?: Record<string, unknown>
        turnAffirmed?: boolean
        policyDecisions?: PolicyDecision[]
        metaAnswer?: string
        clarifyReason?: unknown
    } | null
    return {
        extractedFields: body?.extractedFields ?? {},
        turnAffirmed: body?.turnAffirmed === true,
        policyDecisions: body?.policyDecisions ?? [],
        metaAnswer: body?.metaAnswer,
        clarifyReason: body?.clarifyReason,
    }
}

function redactSensitive({ state, fields }: {
    state: Record<string, unknown>
    fields: InteractiveFlowStateField[]
}): Record<string, unknown> {
    const sensitive = new Set(fields.filter(f => f.sensitive).map(f => f.name))
    if (sensitive.size === 0) return state
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(state)) {
        if (!sensitive.has(k)) out[k] = v
    }
    return out
}

export const fieldExtractor = {
    extract,
    extractWithPolicy,
}

export type PolicyDecision = {
    field: string
    action: 'accept' | 'reject' | 'confirm'
    reason: string
    value?: unknown
    pendingOverwrite?: { field: string, oldValue: unknown, newValue: unknown }
}

export type ExtractResult = {
    extractedFields: Record<string, unknown>
    turnAffirmed: boolean
    policyDecisions: PolicyDecision[]
    metaAnswer?: string
    clarifyReason?: unknown
}

type ExtractArgs = {
    constants: EngineConstants
    config: FieldExtractorConfig
    message: string
    stateFields: InteractiveFlowStateField[]
    currentState: Record<string, unknown>
    systemPrompt?: string
    locale?: string
    currentNode?: {
        nodeId: string
        nodeType?: 'USER_INPUT' | 'CONFIRM' | 'TOOL' | 'BRANCH'
        displayName?: string
        stateOutputs?: string[]
        allowedExtraFields?: string[]
        prompt?: string
        displayField?: string
        nextMissingField?: string
    }
    identityFields?: string[]
    pendingInteraction?: unknown
    flowLabel?: string
}
