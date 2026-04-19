import { InteractiveFlowConfirmNode, InteractiveFlowStateField, InteractiveFlowUserInputNode } from '@activepieces/shared'
import { EngineConstants } from './context/engine-constants'

type QuestionGeneratorConfig = {
    aiProviderId: string
    model: string
    styleTemplate?: string
    historyWindow?: number
    maxResponseLength?: number
}

async function generate({ constants, config, node, stateFields, currentState, locale, systemPrompt, systemPromptAddendum, history }: {
    constants: EngineConstants
    config: QuestionGeneratorConfig
    node: InteractiveFlowUserInputNode | InteractiveFlowConfirmNode
    stateFields: InteractiveFlowStateField[]
    currentState: Record<string, unknown>
    locale: string
    systemPrompt?: string
    systemPromptAddendum?: string
    history?: Array<{ role: 'user' | 'assistant', text: string }>
}): Promise<string | null> {
    const outputFields = stateFields.filter(f => node.stateOutputs.includes(f.name))
    const targetFields = (outputFields.length > 0 ? outputFields : node.stateOutputs.map(name => ({
        name,
        type: 'string' as const,
    }))).map(f => ({
        name: f.name,
        label: typeof f.label === 'object' && f.label !== null ? f.label[locale] ?? f.label.en : undefined,
        description: 'description' in f ? f.description : undefined,
        format: 'format' in f ? f.format : undefined,
    }))

    const payload = {
        provider: config.aiProviderId,
        model: config.model,
        locale,
        systemPrompt,
        systemPromptAddendum,
        styleTemplate: config.styleTemplate,
        state: redactSensitive({ state: currentState, fields: stateFields }),
        history: history?.slice(-(config.historyWindow ?? 10)),
        targetFields,
        renderHint: 'render' in node ? { component: node.render.component, props: node.render.props } : undefined,
        maxOutputTokens: config.maxResponseLength ? Math.max(64, Math.ceil(config.maxResponseLength / 4)) : undefined,
    }

    const url = `${constants.internalApiUrl}v1/engine/interactive-flow-ai/question-generate`
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
        return null
    }
    if (!response.ok) {
        return null
    }
    const body = await response.json().catch(() => null) as { text?: string } | null
    const text = body?.text?.trim() ?? ''
    return text.length > 0 ? text : null
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

export const questionGenerator = {
    generate,
}
